import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

/** Append-only stock ledger. Every change to Product.stock writes one movement. */
const InventoryMovementSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    type: {
      type: String,
      enum: ['adjustment', 'restock', 'order_reserve', 'order_release', 'return_restock', 'import', 'initial'],
      required: true,
    },
    delta: { type: Number, required: true },
    stockAfter: { type: Number, required: true },
    reason: { type: String, default: '', maxlength: 300 },
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

InventoryMovementSchema.index({ createdAt: -1 });

export type InventoryMovementDoc = InferSchemaType<typeof InventoryMovementSchema> & { _id: Types.ObjectId };
export const InventoryMovement: Model<InventoryMovementDoc> =
  (models.InventoryMovement as Model<InventoryMovementDoc>) || model<InventoryMovementDoc>('InventoryMovement', InventoryMovementSchema);
