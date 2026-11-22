import { describe, expect, it } from 'vitest';
import { AuditLog } from '../src/models';
import { createStaff, useDatabase } from './helpers';

/**
 * The orders CSV contains customer names, emails, phones and cities, so it needs customer access as
 * well as reports access, and every download is recorded in the audit log.
 */
describe('orders CSV export (customer personal data)', () => {
  useDatabase();

  it('is refused to a role with reports access but no customer access (Product Manager)', async () => {
    const pm = await createStaff('product_manager');
    const r = await pm.get('/api/admin/reports/orders.csv');
    expect(r.status).toBe(403);
    // Non-personal reports stay available to that role.
    expect((await pm.get('/api/admin/reports/products.csv')).status).toBe(200);
  });

  it('is allowed with reports + customer access and is written to the audit log', async () => {
    const sales = await createStaff('sales_executive');
    const before = await AuditLog.countDocuments({ action: 'export', entityId: 'orders' });
    const r = await sales.get('/api/admin/reports/orders.csv');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(await AuditLog.countDocuments({ action: 'export', entityId: 'orders' })).toBe(before + 1);
  });
});
