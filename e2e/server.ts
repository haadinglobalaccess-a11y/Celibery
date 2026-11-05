/**
 * End-to-end test server: in-memory MongoDB replica set + demo data + the real Express API
 * serving the built storefront (client/dist) on one origin, exactly like production on Vercel.
 * A throwaway admin account is created with a random password written to e2e/.artifacts.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const PORT = Number(process.env.E2E_PORT ?? 4173);

async function main() {
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = rs.getUri();
  process.env.MONGODB_DB_NAME = 'e2e';
  process.env.PUBLIC_SITE_URL = `http://localhost:${PORT}`;
  process.env.CORS_ORIGINS = `http://localhost:${PORT}`;
  process.env.PAYMENT_GATEWAY = 'sandbox';
  process.env.SMTP_HOST = '';
  process.env.WHATSAPP_ACCESS_TOKEN = '';

  const { connectDb } = await import('../server/src/db/connect');
  const { createApp } = await import('../server/src/app');
  const { seedDemo } = await import('../server/src/seed/seed');
  const { Role, User, Settings } = await import('../server/src/models');
  const { hashPassword } = await import('../server/src/modules/auth/auth.service');

  await connectDb();
  await seedDemo();
  await Settings.updateOne({ key: 'store' }, { $set: { 'business.whatsappNumber': '966500000000' } });

  const password = crypto.randomBytes(12).toString('base64url') + '1a';
  const email = 'e2e-admin@test.local';
  const role = await Role.findOne({ key: 'admin' }).lean();
  await User.create({ type: 'staff', name: 'E2E Admin', email, passwordHash: await hashPassword(password), role: role!._id });
  const dir = path.resolve(__dirname, '.artifacts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'admin.json'), JSON.stringify({ email, password }));

  const app = createApp({ serveClient: path.resolve(__dirname, '../client/dist') });
  const server = app.listen(PORT, () => console.log(`E2E server on http://localhost:${PORT}`));
  const stop = async () => {
    server.close();
    await rs.stop();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
