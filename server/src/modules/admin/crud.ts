import { Router, type Request } from 'express';
import type { Model } from 'mongoose';
import type { ZodTypeAny } from 'zod';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { ah, ok } from '../../lib/http';
import type { Permission } from '../../lib/permissions';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { idParam } from './admin.schemas';

type CrudOptions = {
  entity: string;
  readPermission: Permission;
  writePermission: Permission;
  sort?: Record<string, 1 | -1>;
  /** Transform validated input before saving (e.g. SAR → halalas). */
  transform?: (body: Record<string, unknown>, req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Throw to block deletion (e.g. category still has products). */
  beforeDelete?: (id: string) => Promise<void>;
  populate?: string;
  summary?: (doc: Record<string, unknown>) => string;
};

/** Generic, permission-checked, audited CRUD endpoints for simple admin resources. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function crudRouter(model: Model<any>, schema: ZodTypeAny, opts: CrudOptions) {
  const r = Router();
  const tx = opts.transform ?? ((b) => b);
  const summary = opts.summary ?? ((d) => String(d.slug ?? d.code ?? d._id));

  r.get(
    '/',
    requirePermission(opts.readPermission),
    ah(async (_req, res) => {
      let query = model.find().sort(opts.sort ?? { createdAt: -1 }).limit(500);
      if (opts.populate) query = query.populate(opts.populate);
      return ok(res, await query.lean());
    }),
  );

  r.get(
    '/:id',
    requirePermission(opts.readPermission),
    validate(idParam, 'params'),
    ah(async (req, res) => {
      const doc = await model.findById(req.params.id).lean();
      if (!doc) throw notFound(opts.entity);
      return ok(res, doc);
    }),
  );

  r.post(
    '/',
    requirePermission(opts.writePermission),
    validate(schema),
    ah(async (req, res) => {
      const doc = await model.create(await tx(req.body, req));
      await audit(req, 'create', opts.entity, doc._id, summary(doc.toObject()));
      return ok(res, doc.toObject(), 201);
    }),
  );

  r.put(
    '/:id',
    requirePermission(opts.writePermission),
    validate(idParam, 'params'),
    validate(schema),
    ah(async (req, res) => {
      const doc = await model.findByIdAndUpdate(req.params.id, { $set: await tx(req.body, req) }, { new: true, runValidators: true }).lean();
      if (!doc) throw notFound(opts.entity);
      await audit(req, 'update', opts.entity, req.params.id, summary(doc as Record<string, unknown>));
      return ok(res, doc);
    }),
  );

  r.delete(
    '/:id',
    requirePermission(opts.writePermission),
    validate(idParam, 'params'),
    ah(async (req, res) => {
      if (opts.beforeDelete) await opts.beforeDelete(req.params.id);
      const doc = await model.findByIdAndDelete(req.params.id).lean();
      if (!doc) throw notFound(opts.entity);
      await audit(req, 'delete', opts.entity, req.params.id, summary(doc as Record<string, unknown>));
      return ok(res, { deleted: true });
    }),
  );

  return r;
}
