/**
 * SYNTHETIC LOAD-TEST DATA — isolated local/staging databases only.
 *
 *   LOADTEST_MONGODB_URI="mongodb://127.0.0.1:27099/?replicaSet=rs0" \
 *   LOADTEST_DB_NAME=celibery_loadtest \
 *   npx tsx loadtest/seed-synthetic.ts [--products 1200] [--customers 2000] [--orders 60000]
 *
 * Safety (all enforced, none can be skipped by accident):
 *  - the database name must contain "loadtest";
 *  - the URI host must be localhost / 127.0.0.1 unless --allow-remote-staging is given;
 *  - refuses to run with NODE_ENV=production;
 *  - refuses to write into a database that already holds non-synthetic orders.
 * Every synthetic record is recognisable: SKUs start with "LT-", e-mails end with "@loadtest.invalid",
 * order numbers are CEL-9xxxxxx. Writes fixtures to loadtest/.fixtures.json (git-ignored) for k6.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const num = (name: string, def: number) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : def;
};
const URI = process.env.LOADTEST_MONGODB_URI ?? '';
const DB = process.env.LOADTEST_DB_NAME ?? '';
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run with NODE_ENV=production');
if (!URI || !DB) throw new Error('Set LOADTEST_MONGODB_URI and LOADTEST_DB_NAME');
if (!/loadtest/i.test(DB)) throw new Error('LOADTEST_DB_NAME must contain "loadtest"');
const host = URI.replace(/^mongodb(\+srv)?:\/\/([^@/]*@)?/, '').split(/[/?,]/)[0];
if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && !argv.includes('--allow-remote-staging')) {
  throw new Error(`Refusing non-local host "${host}". Use --allow-remote-staging only for an authorised staging cluster.`);
}

// The app's env module reads these at import time.
process.env.MONGODB_URI = URI;
process.env.MONGODB_DB_NAME = DB;

const PRODUCTS = num('products', 1200);
const CUSTOMERS = num('customers', 2000);
const ORDERS = num('orders', 60000);
export const LOADTEST_PASSWORD = 'LoadTest-Synthetic-Passw0rd!';

async function main() {
  const { connectDb, disconnectDb } = await import('../server/src/db/connect');
  const models = await import('../server/src/models');
  const { seedDemo } = await import('../server/src/seed/seed');
  const { sha256 } = await import('../server/src/lib/tokens');
  const bcrypt = (await import('bcryptjs')).default;
  const { Category, Product, Order, User, Role } = models;

  await connectDb();
  const real = await Order.countDocuments({ orderNumber: { $not: /^CEL-9\d{6}$/ } });
  if (real > 0) throw new Error(`Database ${DB} holds ${real} non-synthetic orders — refusing to continue.`);

  await seedDemo();
  // Synthetic store only: cash on delivery on (off by default) so the checkout scenario can place orders.
  await models.Settings.updateOne({ key: 'store' }, { $set: { 'commerce.codEnabled': true } });
  const cats = await Category.find().lean();
  const rnd = (n: number) => Math.floor(Math.random() * n);
  const pick = <T,>(a: readonly T[]) => a[rnd(a.length)];
  const words = ['Power', 'Bank', 'Charger', 'Cable', 'Hub', 'Stand', 'Wireless', 'Pro', 'Max', 'Lite', 'Travel', 'Fast'];

  // Products
  const have = await Product.countDocuments({ sku: /^LT-/ });
  const productDocs = [];
  for (let i = have; i < PRODUCTS; i++) {
    const cat = pick(cats);
    const name = `${pick(words)} ${pick(words)} ${i}`;
    productDocs.push({
      slug: `lt-product-${i}`,
      sku: `LT-${String(i).padStart(6, '0')}`,
      model: `LT${i}`,
      name: { en: name, ar: `منتج تجريبي ${i}` },
      shortDescription: { en: `Synthetic load-test product ${i}`, ar: `منتج اختبار ${i}` },
      description: { en: 'Synthetic product for load testing. '.repeat(10), ar: 'منتج لاختبار الحمل. '.repeat(10) },
      category: cat._id,
      series: pick(['Nova', 'Orbit', 'Pulse', 'Volt']),
      images: [{ url: `/placeholders/product-${(i % 6) + 1}.svg`, alt: { en: name, ar: name } }],
      price: 2900 + rnd(40000),
      compareAtPrice: Math.random() < 0.3 ? 50000 : undefined,
      stock: 1_000_000, // never the bottleneck of a checkout test
      status: 'active',
      featured: Math.random() < 0.05,
      attributes: { capacityMah: pick([5000, 10000, 20000]), powerW: pick([20, 30, 65]), connectors: ['usb-c'], color: { key: 'black', name: { en: 'Black', ar: 'أسود' }, hex: '#000' } },
      tags: ['loadtest', pick(words).toLowerCase()],
      sortOrder: rnd(100),
      dataSource: 'demo',
      createdAt: new Date(Date.now() - rnd(365) * 864e5),
      updatedAt: new Date(),
    });
  }
  for (let i = 0; i < productDocs.length; i += 1000) await Product.collection.insertMany(productDocs.slice(i, i + 1000));
  const products = await Product.find({ sku: /^LT-/ }).select('slug sku name price images category').lean();

  // Customers (one bcrypt hash shared by all synthetic accounts; real cost factor 12)
  const hash = await bcrypt.hash(LOADTEST_PASSWORD, 12);
  const haveU = await User.countDocuments({ email: /@loadtest\.invalid$/, type: 'customer' });
  const users = [];
  for (let i = haveU; i < CUSTOMERS; i++) {
    users.push({ type: 'customer', name: `Load Test ${i}`, email: `lt-user-${i}@loadtest.invalid`, phone: `05${String(10000000 + i).slice(-8)}`, passwordHash: hash, active: true, tokenVersion: 0, preferredLang: 'en', addresses: [], createdAt: new Date(), updatedAt: new Date() });
  }
  for (let i = 0; i < users.length; i += 1000) await User.collection.insertMany(users.slice(i, i + 1000));
  const customers = await User.find({ email: /^lt-user-\d+@loadtest\.invalid$/ }).select('_id email phone name').lean();

  // One synthetic admin (no MFA) for admin API tests.
  const adminRole = await Role.findOne({ key: 'admin' }).lean();
  await User.updateOne(
    { email: 'lt-admin@loadtest.invalid' },
    { $setOnInsert: { type: 'staff', name: 'Load Test Admin', email: 'lt-admin@loadtest.invalid', passwordHash: hash, active: true, tokenVersion: 0, role: adminRole!._id, preferredLang: 'en' } },
    { upsert: true },
  );

  // Orders spread over 180 days with realistic status / payment mixes.
  const haveO = await Order.countDocuments({ orderNumber: /^CEL-9\d{6}$/ });
  const statuses = [
    ['delivered', 'paid', 'card'], ['delivered', 'cod_collected', 'cod'], ['shipped', 'paid', 'card'], ['processing', 'cod_pending', 'cod'],
    ['confirmed', 'cod_pending', 'cod'], ['cancelled', 'expired', 'card'], ['pending', 'pending', 'card'], ['delivered', 'paid', 'tabby'],
  ] as const;
  const tokens: { orderNumber: string; token: string }[] = [];
  let batch = [];
  for (let i = haveO; i < ORDERS; i++) {
    const c = pick(customers);
    const [status, paymentStatus, paymentMethod] = pick(statuses);
    const items = Array.from({ length: 1 + rnd(3) }, () => {
      const p = pick(products);
      const quantity = 1 + rnd(2);
      return { product: p._id, sku: p.sku, model: '', slug: p.slug, name: p.name, image: p.images?.[0]?.url ?? '', unitPrice: p.price, quantity, lineTotal: p.price * quantity, discount: 0, warrantyMonths: 24 };
    });
    const subtotal = items.reduce((s, x) => s + x.lineTotal, 0);
    const orderNumber = `CEL-${9000000 + i}`;
    const token = crypto.createHash('sha256').update(`lt-${i}`).digest('base64url').slice(0, 32);
    if (i < 2000) tokens.push({ orderNumber, token });
    const createdAt = new Date(Date.now() - rnd(180) * 864e5 - rnd(864e5));
    batch.push({
      orderNumber, customer: c._id, idempotencyKey: `lt-idem-${i}-${crypto.randomUUID()}`, accessTokenHash: sha256(token), lang: 'en',
      contact: { name: c.name, email: c.email, phone: c.phone },
      shippingAddress: { fullName: c.name, phone: c.phone, city: pick(['Riyadh', 'Jeddah', 'Dammam']), district: 'Synthetic', street: 'Load Test St', buildingNumber: '1', postalCode: '', shortAddress: '', notes: '' },
      items, currency: 'SAR', subtotal, discountTotal: 0, deliveryFee: 0, shippingZone: '', codFee: 0, total: subtotal, vatRate: 15, vatAmount: Math.round((subtotal * 15) / 115),
      paymentMethod, paymentStatus, status, stockReleased: status === 'cancelled',
      delivery: { courier: '', trackingNumber: '', trackingUrl: '', estimatedDelivery: { ar: '', en: '' } },
      refundedAmount: 0, refundReservedAmount: 0, appliedRefunds: [], releasedRefunds: [], customerNote: '', internalNotes: '',
      history: [{ status: 'pending', note: 'Order placed', visibleToCustomer: true, at: createdAt }, { status, note: '', visibleToCustomer: true, at: createdAt }],
      createdAt, updatedAt: createdAt,
    });
    if (batch.length === 5000) { await Order.collection.insertMany(batch); batch = []; }
  }
  if (batch.length) await Order.collection.insertMany(batch);

  // Make sure every schema index exists (as on a deployed cluster: Mongoose autoIndex).
  for (const m of Object.values(models)) if (m && typeof (m as { syncIndexes?: unknown }).syncIndexes === 'function') await (m as { createIndexes: () => Promise<void> }).createIndexes().catch(() => undefined);

  const fixtures = {
    password: LOADTEST_PASSWORD,
    admin: 'lt-admin@loadtest.invalid',
    customers: customers.slice(0, 500).map((c) => c.email),
    products: products.slice(0, 600).map((p) => ({ id: String(p._id), slug: p.slug })),
    categories: cats.map((c) => c.slug),
    orders: tokens,
    searchTerms: ['power', 'cable', 'charger', 'hub', 'wireless', 'travel', 'pro', 'LT-0001'],
  };
  fs.writeFileSync(path.join(__dirname, '.fixtures.json'), JSON.stringify(fixtures));
  const counts = { products: await Product.estimatedDocumentCount(), customers: await User.estimatedDocumentCount(), orders: await Order.estimatedDocumentCount() };
  console.log(JSON.stringify(counts));
  await disconnectDb();
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
