import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/lib/logger';
import { currentRequestId, requestContext } from '../../src/lib/request-context';
import { errorHandler } from '../../src/middleware/error';

function app() {
  const a = express();
  a.use(requestContext);
  a.get('/id', async (_req, res) => {
    await new Promise((r) => setTimeout(r, 5)); // the id survives async work
    res.json({ id: currentRequestId() });
  });
  a.get('/boom', () => {
    throw new Error('internal detail');
  });
  a.use(errorHandler);
  return a;
}

describe('request correlation id', () => {
  it('generates an id, returns it in X-Request-Id and keeps it across async work', async () => {
    const r = await request(app()).get('/id');
    expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.body.id).toBe(r.headers['x-request-id']);
  });

  it('reuses a well-formed incoming id and replaces an unsafe one', async () => {
    const good = await request(app()).get('/id').set('X-Request-Id', 'cdg1::abc123-xyz');
    expect(good.headers['x-request-id']).toBe('cdg1::abc123-xyz');
    const bad = await request(app()).get('/id').set('X-Request-Id', '<script>alert(1)</script>');
    expect(bad.headers['x-request-id']).not.toContain('<');
  });

  it('500 responses carry the id (no internal detail) and the error log line includes it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await request(app()).get('/boom');
    expect(r.status).toBe(500);
    expect(r.body.error.requestId).toBe(r.headers['x-request-id']);
    expect(JSON.stringify(r.body)).not.toContain('internal detail');
    const line = JSON.parse(String(spy.mock.calls.at(-1)?.[0]));
    expect(line.requestId).toBe(r.headers['x-request-id']);
    spy.mockRestore();
  });

  it('logs outside a request have no id', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logger.error('background job');
    expect(JSON.parse(String(spy.mock.calls.at(-1)?.[0])).requestId).toBeUndefined();
    spy.mockRestore();
  });
});
