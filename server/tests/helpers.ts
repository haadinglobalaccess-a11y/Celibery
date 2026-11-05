import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, inject } from 'vitest';
import { createApp } from '../src/app';
import { connectDb, disconnectDb } from '../src/db/connect';
import { hashPassword } from '../src/modules/auth/auth.service';
import { Role, User } from '../src/models';
import { seedDemo } from '../src/seed/seed';

export const app = createApp();

/** Each test file gets its own fresh database on the shared in-memory replica set. */
export function useDatabase() {
  beforeAll(async () => {
    const dbName = 'test_' + crypto.randomBytes(6).toString('hex');
    process.env.MONGODB_DB_NAME = dbName;
    const { env } = await import('../src/config/env');
    (env as { MONGODB_DB_NAME: string }).MONGODB_DB_NAME = dbName;
    await connectDb(inject('mongoUri'));
    await seedDemo();
  });
  afterAll(async () => {
    await mongoose.connection.db?.dropDatabase();
    await disconnectDb();
  });
}

/** Supertest agent that keeps cookies and sends the CSRF header like the real frontend. */
export function client() {
  const agent = request.agent(app);
  const wrap = (m: 'get' | 'post' | 'put' | 'patch' | 'delete') => (url: string) => agent[m](url).set('X-Requested-With', 'celibery');
  return { get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), delete: wrap('delete'), agent };
}

export async function createStaff(roleKey: string, email = `${roleKey}-${crypto.randomBytes(3).toString('hex')}@test.local`, password = 'Passw0rd!x') {
  const role = await Role.findOne({ key: roleKey }).lean();
  if (!role) throw new Error('role missing ' + roleKey);
  await User.create({ type: 'staff', name: `Test ${roleKey}`, email, passwordHash: await hashPassword(password), role: role._id });
  const c = client();
  const res = await c.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error('staff login failed ' + JSON.stringify(res.body));
  return c;
}

export async function createCustomer(email = `cust-${crypto.randomBytes(3).toString('hex')}@test.local`, password = 'Passw0rd!x') {
  const c = client();
  const res = await c.post('/api/auth/register').send({ name: 'Test Customer', email, password, phone: '0551234567', lang: 'en' });
  if (res.status !== 201) throw new Error('register failed ' + JSON.stringify(res.body));
  return { c, email, id: res.body.data._id as string };
}

export const uid = () => crypto.randomUUID().replace(/-/g, '');

export const address = {
  fullName: 'Test Customer',
  phone: '0551234567',
  city: 'Riyadh',
  district: 'Al Olaya',
  street: 'King Fahd Road',
  buildingNumber: '1234',
  postalCode: '12211',
  shortAddress: '',
  notes: '',
};

export const contact = { name: 'Test Customer', email: 'guest@test.local', phone: '0551234567' };
