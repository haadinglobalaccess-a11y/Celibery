import { Router } from 'express';
import { audit } from '../../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { ah, escapeRegex, ok } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import { q, validate } from '../../middleware/validate';
import { NewsletterSubscription, Order, Role, User } from '../../models';
import { emailConfigured, sendStaffInviteEmail } from '../../integrations/notifications';
import { createResetToken, resetLink } from '../auth/auth.service';
import { customerListQuery, idParam, roleInput, staffCreate, staffUpdate } from './admin.schemas';

// ---- Customers ---------------------------------------------------------------------------
export const adminCustomerRoutes = Router();

adminCustomerRoutes.get(
  '/',
  requirePermission('customers:read'),
  validate(customerListQuery, 'query'),
  ah(async (req, res) => {
    const query = q(req, customerListQuery);
    const filter: Record<string, unknown> = { type: 'customer' };
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }
    const [items, total] = await Promise.all([
      User.find(filter).select('name email phone active createdAt lastLoginAt marketingOptIn').sort({ createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
      User.countDocuments(filter),
    ]);
    const stats = await Order.aggregate([
      { $match: { customer: { $in: items.map((i) => i._id) }, status: { $ne: 'cancelled' } } },
      { $group: { _id: '$customer', orders: { $sum: 1 }, spent: { $sum: '$total' } } },
    ]);
    const map = new Map(stats.map((s: { _id: unknown; orders: number; spent: number }) => [String(s._id), s]));
    return ok(
      res,
      items.map((c) => ({ ...c, orders: map.get(String(c._id))?.orders ?? 0, spent: map.get(String(c._id))?.spent ?? 0 })),
      200,
      { total, page: query.page, pages: Math.max(1, Math.ceil(total / query.limit)) },
    );
  }),
);

adminCustomerRoutes.get(
  '/newsletter',
  requirePermission('customers:read'),
  ah(async (_req, res) => ok(res, await NewsletterSubscription.find({ active: true }).sort({ createdAt: -1 }).limit(5000).lean())),
);

adminCustomerRoutes.get(
  '/:id',
  requirePermission('customers:read'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const c = await User.findOne({ _id: req.params.id, type: 'customer' }).select('name email phone active createdAt lastLoginAt addresses wishlist marketingOptIn preferredLang').lean();
    if (!c) throw notFound('Customer');
    const orders = await Order.find({ $or: [{ customer: c._id }, { 'contact.email': c.email }] })
      .select('orderNumber total status paymentStatus paymentMethod createdAt')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return ok(res, { ...c, wishlistCount: c.wishlist?.length ?? 0, wishlist: undefined, orders });
  }),
);

// ---- Staff & roles -----------------------------------------------------------------------
export const adminStaffRoutes = Router();
adminStaffRoutes.use(requirePermission('staff:manage'));

adminStaffRoutes.get(
  '/',
  ah(async (_req, res) => ok(res, await User.find({ type: 'staff' }).select('name email title active role lastLoginAt createdAt').populate('role', 'key name').sort({ createdAt: 1 }).lean())),
);

/**
 * Staff are invited, never given a password by another person: a single-use link (72h) lets
 * them set their own password. If email is not configured yet, the link is returned once to
 * the administrator so it can be delivered securely by hand.
 */
adminStaffRoutes.post(
  '/',
  validate(staffCreate),
  ah(async (req, res) => {
    if (await User.exists({ email: req.body.email })) throw conflict('EMAIL_IN_USE', 'A user with this email already exists');
    const role = await Role.findById(req.body.roleId).lean();
    if (!role) throw badRequest('INVALID_ROLE', 'Role not found');
    const user = await User.create({ type: 'staff', name: req.body.name, email: req.body.email, title: req.body.title, role: role._id, preferredLang: 'en' });
    const token = await createResetToken(user._id, 72 * 60);
    const link = resetLink(token, 'en', true);
    const sent = await sendStaffInviteEmail(user, link);
    await audit(req, 'invite', 'staff', user._id, `${user.email} as ${role.key}`);
    return ok(res, { id: user._id, emailStatus: sent.status, inviteLink: emailConfigured() && sent.status === 'sent' ? null : link }, 201);
  }),
);

adminStaffRoutes.patch(
  '/:id',
  validate(idParam, 'params'),
  validate(staffUpdate),
  ah(async (req, res) => {
    if (req.params.id === req.user!.id && (req.body.active === false || req.body.roleId)) throw forbidden('You cannot deactivate yourself or change your own role');
    const set: Record<string, unknown> = {};
    if (req.body.name) set.name = req.body.name;
    if (req.body.title !== undefined) set.title = req.body.title;
    if (req.body.roleId) {
      if (!(await Role.exists({ _id: req.body.roleId }))) throw badRequest('INVALID_ROLE', 'Role not found');
      set.role = req.body.roleId;
    }
    const update: Record<string, unknown> = { $set: set };
    if (req.body.active !== undefined) {
      set.active = req.body.active;
      if (req.body.active === false) update.$inc = { tokenVersion: 1 }; // sign out immediately
    }
    const u = await User.findOneAndUpdate({ _id: req.params.id, type: 'staff' }, update, { new: true }).select('name email title active role').lean();
    if (!u) throw notFound('Staff member');
    await audit(req, 'update', 'staff', req.params.id, JSON.stringify(req.body));
    return ok(res, u);
  }),
);

adminStaffRoutes.post(
  '/:id/reset-link',
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const u = await User.findOne({ _id: req.params.id, type: 'staff' }).lean();
    if (!u) throw notFound('Staff member');
    const token = await createResetToken(u._id, 72 * 60);
    const link = resetLink(token, 'en', true);
    const sent = await sendStaffInviteEmail(u, link);
    await audit(req, 'reset_link', 'staff', req.params.id);
    return ok(res, { emailStatus: sent.status, inviteLink: sent.status === 'sent' ? null : link });
  }),
);

adminStaffRoutes.get('/roles/all', ah(async (_req, res) => ok(res, await Role.find().sort({ system: -1, key: 1 }).lean())));

adminStaffRoutes.post(
  '/roles',
  validate(roleInput),
  ah(async (req, res) => {
    const r = await Role.create({ ...req.body, system: false });
    await audit(req, 'create', 'role', r._id, r.key);
    return ok(res, r, 201);
  }),
);

adminStaffRoutes.put(
  '/roles/:id',
  validate(idParam, 'params'),
  validate(roleInput),
  ah(async (req, res) => {
    const role = await Role.findById(req.params.id);
    if (!role) throw notFound('Role');
    if (role.system) throw forbidden('The administrator role cannot be changed');
    role.set({ name: req.body.name, permissions: req.body.permissions });
    await role.save();
    // Permissions are re-read on every request, so changes apply immediately.
    await audit(req, 'update', 'role', role._id, role.key);
    return ok(res, role);
  }),
);

adminStaffRoutes.delete(
  '/roles/:id',
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const role = await Role.findById(req.params.id);
    if (!role) throw notFound('Role');
    if (role.system) throw forbidden('System roles cannot be deleted');
    if (await User.exists({ role: role._id })) throw conflict('ROLE_IN_USE', 'Reassign staff using this role first');
    await role.deleteOne();
    await audit(req, 'delete', 'role', req.params.id, role.key);
    return ok(res, { deleted: true });
  }),
);
