import { z } from 'zod';
import { email, saudiPhone } from '../auth/auth.schemas';
import { ORDER_STATUSES, PAYMENT_METHODS } from '../../models/Order';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

export const cartItems = z
  .array(z.object({ productId: objectId, quantity: z.number().int().min(1).max(99) }))
  .min(1, 'Your cart is empty')
  .max(50);

export const quoteSchema = z.object({
  items: cartItems,
  discountCode: z.string().trim().toUpperCase().max(40).optional().or(z.literal('')),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  email: email.optional(),
  /** Delivery city, when known, so COD city rules can be shown before placing the order. */
  city: z.string().trim().max(80).optional(),
});

export const addressInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: saudiPhone,
  city: z.string().trim().min(2).max(80),
  district: z.string().trim().min(2).max(120),
  street: z.string().trim().min(2).max(200),
  buildingNumber: z.string().trim().max(10).default(''),
  postalCode: z
    .string()
    .trim()
    .regex(/^(\d{5})?$/, 'Postal code must be 5 digits')
    .default(''),
  shortAddress: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{4}\d{4})?$/, 'Short address format: ABCD1234')
    .default(''),
  notes: z.string().trim().max(300).default(''),
});

export const checkoutSchema = z.object({
  idempotencyKey: z.string().trim().min(16).max(80).regex(/^[A-Za-z0-9_-]+$/),
  items: cartItems,
  contact: z.object({ name: z.string().trim().min(2).max(120), email, phone: saudiPhone }),
  shippingAddress: addressInput,
  paymentMethod: z.enum(PAYMENT_METHODS),
  discountCode: z.string().trim().toUpperCase().max(40).optional().or(z.literal('')),
  customerNote: z.string().trim().max(500).default(''),
  lang: z.enum(['ar', 'en']).default('ar'),
  saveAddress: z.boolean().optional().default(false),
  /** Saved-checkout token (Abandoned checkouts): links that draft to this order. Never used for pricing. */
  draftToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const trackSchema = z.object({
  orderNumber: z.string().trim().toUpperCase().max(30),
  token: z.string().trim().min(10).max(100).optional(),
  phone: saudiPhone.optional(),
});

export const statusUpdateSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(500).default(''),
  notifyCustomer: z.boolean().default(true),
  trackingNumber: z.string().trim().max(60).optional(),
  courier: z.string().trim().max(80).optional(),
  restock: z.boolean().optional().default(true),
});

export const refundSchema = z.object({
  amount: z.number().int().min(1), // halalas
  reason: z.string().trim().min(2).max(300),
  /** Sent by the admin UI once per refund dialog: a double-click or retry returns the same refund. */
  idempotencyKey: z.string().trim().regex(/^[A-Za-z0-9_-]{8,80}$/).optional(),
});

export const adminOrderListQuery = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.string().trim().max(30).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const orderIdParam = z.object({ id: objectId });
export const orderNumberParam = z.object({ orderNumber: z.string().trim().toUpperCase().regex(/^CEL-\d{4,12}$/) });
