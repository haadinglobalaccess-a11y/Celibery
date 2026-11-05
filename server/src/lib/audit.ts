import type { Request } from 'express';
import { logger } from './logger';
import { AuditLog } from '../models';

/** Records an administrative action. Failures to write the audit log never break the request. */
export async function audit(req: Request, action: string, entity: string, entityId: unknown, summary = '') {
  try {
    await AuditLog.create({
      user: req.user?.id,
      userName: req.user?.name ?? '',
      action,
      entity,
      entityId: entityId ? String(entityId) : '',
      summary: summary.slice(0, 500),
      ip: req.ip ?? '',
    });
  } catch (err) {
    logger.warn('Audit log write failed', { action, entity, err: String(err) });
  }
}
