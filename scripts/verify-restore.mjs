#!/usr/bin/env node
/**
 * Restore verification (BACKUP_RECOVERY_REPORT.md). READ-ONLY on both databases.
 *
 * After restoring a backup/snapshot into a SEPARATE database or cluster, compare it with the source
 * (or with a manifest written from the source at backup time):
 *
 *   # 1. at backup time (or right before the drill): record a manifest of the source
 *   SOURCE_URI=... SOURCE_DB=celibery node scripts/verify-restore.mjs manifest > manifest.json
 *   # 2. after the restore: compare the restored copy with the manifest
 *   TARGET_URI=... TARGET_DB=celibery node scripts/verify-restore.mjs verify manifest.json
 *
 * Per collection it compares the document count and a SHA-256 over every document's canonical
 * extended-JSON (ordered by _id), plus index names. Writes nothing, prints no document content.
 * Exit code 0 = identical, 1 = differences found (listed), 2 = usage/connection error.
 *
 * Collections whose content changes by itself (rate-limit counters, sessions, the cache version)
 * are compared by presence only.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

const VOLATILE = new Set(['rate_limits', 'sessions', 'counters']);

async function manifest(uri, dbName) {
  const client = await MongoClient.connect(uri, { readPreference: 'secondaryPreferred' });
  try {
    const db = client.db(dbName);
    const out = { db: dbName, takenAt: new Date().toISOString(), collections: {} };
    const names = (await db.listCollections({ type: 'collection' }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.')).sort();
    for (const name of names) {
      const col = db.collection(name);
      const indexes = (await col.indexes()).map((i) => i.name).sort();
      if (VOLATILE.has(name)) {
        out.collections[name] = { volatile: true, indexes };
        continue;
      }
      const hash = crypto.createHash('sha256');
      let count = 0;
      for await (const doc of col.find({}, { sort: { _id: 1 } })) {
        hash.update(EJSON.stringify(doc, { relaxed: false }));
        hash.update('\n');
        count++;
      }
      out.collections[name] = { count, sha256: hash.digest('hex'), indexes };
    }
    return out;
  } finally {
    await client.close();
  }
}

function compare(expected, actual) {
  const problems = [];
  for (const [name, e] of Object.entries(expected.collections)) {
    const a = actual.collections[name];
    if (!a) { problems.push(`${name}: missing in restored database`); continue; }
    const missingIdx = e.indexes.filter((i) => !a.indexes.includes(i));
    if (missingIdx.length) problems.push(`${name}: missing indexes ${missingIdx.join(', ')}`);
    if (e.volatile) continue;
    if (e.count !== a.count) problems.push(`${name}: ${a.count} documents, expected ${e.count}`);
    else if (e.sha256 !== a.sha256) problems.push(`${name}: same count but content differs`);
  }
  for (const name of Object.keys(actual.collections)) if (!expected.collections[name]) problems.push(`${name}: present only in restored database`);
  return problems;
}

const [cmd, file] = process.argv.slice(2);
try {
  if (cmd === 'manifest') {
    if (!process.env.SOURCE_URI || !process.env.SOURCE_DB) throw new Error('Set SOURCE_URI and SOURCE_DB');
    process.stdout.write(JSON.stringify(await manifest(process.env.SOURCE_URI, process.env.SOURCE_DB), null, 2) + '\n');
  } else if (cmd === 'verify') {
    if (!file || !process.env.TARGET_URI || !process.env.TARGET_DB) throw new Error('Usage: TARGET_URI=… TARGET_DB=… verify-restore.mjs verify manifest.json');
    const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
    const actual = await manifest(process.env.TARGET_URI, process.env.TARGET_DB);
    const problems = compare(expected, actual);
    const checked = Object.values(expected.collections).filter((c) => !c.volatile);
    const docs = checked.reduce((s, c) => s + c.count, 0);
    if (problems.length) {
      console.log(`RESTORE VERIFICATION FAILED (${problems.length} problem(s)):\n - ${problems.join('\n - ')}`);
      process.exit(1);
    }
    console.log(`RESTORE VERIFIED: ${checked.length} collections, ${docs} documents identical to the manifest of ${expected.takenAt}.`);
  } else {
    throw new Error('Usage: verify-restore.mjs manifest | verify <manifest.json>');
  }
} catch (e) {
  console.error('✖', e.message);
  process.exit(2);
}
