/**
 * READ-ONLY query-plan report for CELIBERY's hot queries (explain "executionStats").
 * Safe on any database (it only runs explain); point it at a staging copy, not production.
 *
 *   LOADTEST_MONGODB_URI=... LOADTEST_DB_NAME=celibery_loadtest npx tsx loadtest/explain-queries.ts
 */
process.env.MONGODB_URI = process.env.LOADTEST_MONGODB_URI ?? '';
process.env.MONGODB_DB_NAME = process.env.LOADTEST_DB_NAME ?? '';

type Stats = { executionStats: { nReturned: number; totalKeysExamined: number; totalDocsExamined: number; executionTimeMillis: number }; queryPlanner: { winningPlan: unknown } };

function stages(plan: unknown, out: string[] = []): string[] {
  if (!plan || typeof plan !== 'object') return out;
  const p = plan as Record<string, unknown>;
  if (typeof p.stage === 'string') out.push(p.indexName ? `${p.stage}(${p.indexName})` : p.stage);
  for (const k of ['inputStage', 'queryPlan', 'winningPlan']) stages(p[k], out);
  if (Array.isArray(p.inputStages)) p.inputStages.forEach((s) => stages(s, out));
  return out;
}

async function main() {
  const { connectDb, disconnectDb } = await import('../server/src/db/connect');
  const { Order, Product, Review, User } = await import('../server/src/models');
  await connectDb();
  // Build any index declared in the schemas but not yet present (what Mongoose autoIndex does on deploy).
  await Promise.all([Order.init(), Product.init(), Review.init(), User.init()]);
  await Promise.all([Order.createIndexes(), Product.createIndexes()]);
  const anyCustomer = await User.findOne({ type: 'customer' }).lean();
  const anyProduct = await Product.findOne({ status: 'active' }).lean();
  const since = new Date(Date.now() - 90 * 864e5);

  const finds: [string, () => Promise<unknown>][] = [
    ['catalog: list default sort', () => Product.find({ status: 'active' }).sort({ featured: -1, sortOrder: 1, createdAt: -1, _id: 1 }).limit(24).explain('executionStats')],
    ['catalog: list by category', () => Product.find({ status: 'active', category: anyProduct!.category }).sort({ featured: -1, sortOrder: 1, createdAt: -1, _id: 1 }).limit(24).explain('executionStats')],
    ['catalog: search regex', () => Product.find({ status: 'active', $or: [{ 'name.ar': /power/i }, { 'name.en': /power/i }, { model: /power/i }, { sku: /power/i }, { tags: /power/i }, { series: /power/i }] }).limit(24).explain('executionStats')],
    ['home: featured', () => Product.find({ status: 'active', featured: true }).sort({ sortOrder: 1 }).limit(8).explain('executionStats')],
    ['product: by slug', () => Product.findOne({ slug: anyProduct!.slug, status: 'active' }).explain('executionStats')],
    ['product: review stats', () => Review.find({ product: anyProduct!._id, status: 'approved' }).explain('executionStats')],
    ['account: my orders', () => Order.find({ customer: anyCustomer!._id }).sort({ createdAt: -1 }).limit(100).explain('executionStats')],
    ['checkout: open COD per phone (old: suffix regex)', () => Order.find({ paymentMethod: 'cod', status: { $in: ['pending', 'confirmed', 'processing'] }, 'contact.phone': { $regex: '512345678$' } }).explain('executionStats')],
    ['checkout: open COD per phone (new: exact variants)', () => Order.find({ paymentMethod: 'cod', status: { $in: ['pending', 'confirmed', 'processing'] }, 'contact.phone': { $in: ['512345678', '0512345678', '966512345678', '+966512345678'] } }).explain('executionStats')],
    ['checkout: discount per customer (old: phone regex)', () => Order.find({ 'discount.id': anyProduct!._id, status: { $ne: 'cancelled' }, $or: [{ customer: anyCustomer!._id }, { 'contact.email': anyCustomer!.email }, { 'contact.phone': { $regex: '512345678$' } }] }).explain('executionStats')],
    ['checkout: discount per customer (new: exact variants)', () => Order.find({ 'discount.id': anyProduct!._id, status: { $ne: 'cancelled' }, $or: [{ customer: anyCustomer!._id }, { 'contact.email': anyCustomer!.email }, { 'contact.phone': { $in: ['512345678', '0512345678', '966512345678', '+966512345678'] } }] }).explain('executionStats')],
    ['admin: payment_review count', () => Order.find({ 'history.status': 'payment_review' }).explain('executionStats')],
    ['admin: orders list page 1', () => Order.find({}).sort({ createdAt: -1 }).limit(25).explain('executionStats')],
    ['jobs: expired reservations', () => Order.find({ status: 'pending', paymentMethod: { $ne: 'cod' }, paymentStatus: { $in: ['pending', 'failed'] }, reservationExpiresAt: { $lt: new Date() }, stockReleased: false }).limit(200).explain('executionStats')],
  ];
  const rows: string[] = [];
  for (const [name, run] of finds) {
    const e = (await run()) as Stats;
    const s = e.executionStats;
    rows.push(`| ${name} | ${stages(e.queryPlanner.winningPlan).reverse().join(' → ')} | ${s.totalKeysExamined} | ${s.totalDocsExamined} | ${s.nReturned} | ${s.executionTimeMillis} |`);
  }
  // Aggregations: wall-clock timing (median of 5).
  const timed = async (name: string, fn: () => Promise<unknown>) => {
    const t: number[] = [];
    for (let i = 0; i < 5; i++) { const a = performance.now(); await fn(); t.push(performance.now() - a); }
    t.sort((x, y) => x - y);
    rows.push(`| ${name} | aggregate | – | – | – | ${t[2].toFixed(1)} (median of 5) |`);
  };
  await timed('home: best sellers (90 days)', () => Order.aggregate([
    { $match: { createdAt: { $gte: since }, paymentStatus: { $in: ['paid', 'cod_pending', 'cod_collected'] }, status: { $nin: ['cancelled', 'returned'] } } },
    { $unwind: '$items' }, { $group: { _id: '$items.product', qty: { $sum: '$items.quantity' } } }, { $sort: { qty: -1 } }, { $limit: 16 },
  ]));
  await timed('categories: product counts', () => Product.aggregate([{ $match: { status: 'active' } }, { $group: { _id: '$category', n: { $sum: 1 } } }]));
  await timed('admin overview: revenue totals', () => Order.aggregate([{ $match: { status: { $nin: ['cancelled', 'returned'] }, paymentStatus: { $in: ['paid', 'partially_refunded', 'cod_pending', 'cod_collected'] } } }, { $group: { _id: null, n: { $sum: 1 }, r: { $sum: '$total' } } }]));
  await timed('admin overview: orders by status', () => Order.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]));

  console.log('| Query | Plan | Keys examined | Docs examined | Returned | ms |\n|---|---|---|---|---|---|\n' + rows.join('\n'));
  await disconnectDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
