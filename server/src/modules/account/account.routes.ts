import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { notFound, unprocessable } from '../../lib/errors';
import { ah, ok } from '../../lib/http';
import { requireCustomer } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { Product, User, getSettings } from '../../models';
import { saudiPhone } from '../auth/auth.schemas';
import { addressInput } from '../orders/order.schemas';
import { PUBLIC_PRODUCT_FIELDS, toPublicProduct } from '../catalog/catalog.service';

/** Customer self-service: profile, saved addresses, wishlist. Customers only see their own data. */
export const accountRoutes = Router();
accountRoutes.use(requireCustomer);

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);

accountRoutes.patch(
  '/profile',
  validate(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      phone: saudiPhone.optional().or(z.literal('')),
      preferredLang: z.enum(['ar', 'en']).optional(),
      marketingOptIn: z.boolean().optional(),
    }),
  ),
  ah(async (req: Request, res: Response) => {
    const user = await User.findByIdAndUpdate(req.user!.id, { $set: req.body }, { new: true }).select('name email phone preferredLang marketingOptIn').lean();
    return ok(res, user);
  }),
);

// ---- Addresses -------------------------------------------------------------------------

const addressBody = addressInput.extend({ label: z.string().trim().max(60).default(''), isDefault: z.boolean().default(false) });

accountRoutes.get(
  '/addresses',
  ah(async (req, res) => {
    const u = await User.findById(req.user!.id).select('addresses').lean();
    return ok(res, u?.addresses ?? []);
  }),
);

accountRoutes.post(
  '/addresses',
  validate(addressBody),
  ah(async (req, res) => {
    const u = await User.findById(req.user!.id).select('addresses');
    if (!u) throw notFound('Account');
    if (u.addresses.length >= 10) throw unprocessable('ADDRESS_LIMIT', 'You can save up to 10 addresses');
    if (req.body.isDefault || u.addresses.length === 0) u.addresses.forEach((a) => (a.isDefault = false));
    u.addresses.push({ ...req.body, isDefault: req.body.isDefault || u.addresses.length === 0 });
    await u.save();
    return ok(res, u.addresses, 201);
  }),
);

accountRoutes.put(
  '/addresses/:addressId',
  validate(z.object({ addressId: objectId }), 'params'),
  validate(addressBody),
  ah(async (req, res) => {
    const u = await User.findById(req.user!.id).select('addresses');
    const addr = u?.addresses.id(req.params.addressId);
    if (!u || !addr) throw notFound('Address');
    if (req.body.isDefault) u.addresses.forEach((a) => (a.isDefault = false));
    addr.set(req.body);
    await u.save();
    return ok(res, u.addresses);
  }),
);

accountRoutes.delete(
  '/addresses/:addressId',
  validate(z.object({ addressId: objectId }), 'params'),
  ah(async (req, res) => {
    const u = await User.findById(req.user!.id).select('addresses');
    const addr = u?.addresses.id(req.params.addressId);
    if (!u || !addr) throw notFound('Address');
    const wasDefault = addr.isDefault;
    addr.deleteOne();
    if (wasDefault && u.addresses[0]) u.addresses[0].isDefault = true;
    await u.save();
    return ok(res, u.addresses);
  }),
);

// ---- Wishlist --------------------------------------------------------------------------

async function wishlistView(userId: string) {
  const s = await getSettings();
  const u = await User.findById(userId).select('wishlist').lean();
  const ids = u?.wishlist ?? [];
  const prods = await Product.find({ _id: { $in: ids }, status: 'active' }).select(PUBLIC_PRODUCT_FIELDS).lean();
  return prods.map((p) => toPublicProduct(p as never, s?.commerce?.lowStockThreshold ?? 5));
}

accountRoutes.get('/wishlist', ah(async (req, res) => ok(res, await wishlistView(req.user!.id))));

accountRoutes.post(
  '/wishlist',
  validate(z.object({ productIds: z.array(objectId).min(1).max(100) })),
  ah(async (req, res) => {
    const valid = await Product.find({ _id: { $in: req.body.productIds }, status: 'active' }).select('_id').lean();
    await User.updateOne({ _id: req.user!.id }, { $addToSet: { wishlist: { $each: valid.map((v) => v._id) } } });
    return ok(res, await wishlistView(req.user!.id));
  }),
);

accountRoutes.delete(
  '/wishlist/:productId',
  validate(z.object({ productId: objectId }), 'params'),
  ah(async (req, res) => {
    await User.updateOne({ _id: req.user!.id }, { $pull: { wishlist: req.params.productId } });
    return ok(res, await wishlistView(req.user!.id));
  }),
);
