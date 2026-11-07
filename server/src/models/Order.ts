import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';
import { LocalizedSchema } from './common';

export const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'expired', 'refunded', 'partially_refunded', 'cod_pending', 'cod_collected'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['card', 'applepay', 'stcpay', 'tabby', 'cod'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Allowed order status transitions (enforced in the order service). */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'shipped', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};

const OrderItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true },
    model: { type: String, default: '' },
    slug: { type: String, default: '' },
    name: { type: LocalizedSchema, required: true },
    image: { type: String, default: '' },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    warrantyMonths: { type: Number, default: 0 },
  },
  { _id: false },
);

const OrderAddressSchema = new Schema(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    city: { type: String, required: true },
    district: { type: String, required: true },
    street: { type: String, required: true },
    buildingNumber: { type: String, default: '' },
    postalCode: { type: String, default: '' },
    shortAddress: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { _id: false },
);

const HistorySchema = new Schema(
  {
    status: { type: String, required: true },
    note: { type: String, default: '' },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    visibleToCustomer: { type: Boolean, default: true },
    at: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const OrderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    idempotencyKey: { type: String, required: true, unique: true },
    accessTokenHash: { type: String, required: true, select: false },
    lang: { type: String, enum: ['ar', 'en'], default: 'ar' },
    contact: { type: new Schema({
      name: { type: String, required: true },
      email: { type: String, required: true, lowercase: true, trim: true },
      phone: { type: String, required: true },
    }, { _id: false }), required: true },
    shippingAddress: { type: OrderAddressSchema, required: true },
    items: { type: [OrderItemSchema], required: true },
    currency: { type: String, default: 'SAR' },
    subtotal: { type: Number, required: true, min: 0 },
    discountTotal: { type: Number, default: 0, min: 0 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    /** Delivery zone (Admin → Settings → Shipping) that priced delivery; '' = store-wide rules. */
    shippingZone: { type: String, default: '' },
    codFee: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    vatRate: { type: Number, default: 0 },
    vatAmount: { type: Number, default: 0 },
    discount: {
      id: { type: Schema.Types.ObjectId, ref: 'Discount' },
      code: { type: String },
    },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'pending', index: true },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending', index: true },
    stockReleased: { type: Boolean, default: false },
    reservationExpiresAt: { type: Date, index: true },
    delivery: {
      courier: { type: String, default: '' },
      trackingNumber: { type: String, default: '' },
      trackingUrl: { type: String, default: '' },
      estimatedDelivery: { type: LocalizedSchema, default: () => ({}) },
      shippedAt: { type: Date },
      deliveredAt: { type: Date },
    },
    /** Refunds confirmed by the gateway (halalas). Only grows after confirmation. */
    refundedAmount: { type: Number, default: 0 },
    /** In-flight refunds (halalas): reserved before the gateway call so concurrent refunds can never exceed the total. */
    refundReservedAmount: { type: Number, default: 0 },
    /** Refund ledger ids already added to refundedAmount / released from the reservation (exactly-once guards). */
    appliedRefunds: { type: [{ type: Schema.Types.ObjectId, ref: 'Refund' }], default: [] },
    releasedRefunds: { type: [{ type: Schema.Types.ObjectId, ref: 'Refund' }], default: [] },
    customerNote: { type: String, default: '', maxlength: 500 },
    internalNotes: { type: String, default: '', maxlength: 2000 },
    history: { type: [HistorySchema], default: [] },
    paidAt: { type: Date },
    cancelledAt: { type: Date },
  },
  { timestamps: true },
);

OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ 'contact.email': 1 });
OrderSchema.index({ 'contact.phone': 1 });

export type OrderDoc = InferSchemaType<typeof OrderSchema> & { _id: Types.ObjectId };
export const Order: Model<OrderDoc> = (models.Order as Model<OrderDoc>) || model<OrderDoc>('Order', OrderSchema);
