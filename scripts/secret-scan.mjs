#!/usr/bin/env node
// High-confidence secret scan of every file tracked by Git (CI gate; no dependencies).
// Only patterns that are real credentials when they match; documented placeholders are skipped.
// Exit code 1 when a likely secret is found. Matches are reported masked, never in full.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const PATTERNS = [
  ['Moyasar/Stripe-style live secret key', /\bsk_live_[A-Za-z0-9]{16,}/],
  ['AWS access key id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['MongoDB URI with credentials', /mongodb(?:\+srv)?:\/\/[^\s:/@"'`<>]+:[^\s@"'`<>]{6,}@[^\s"'`<>]+/],
  ['Meta / WhatsApp access token', /\bEAA[A-Za-z0-9]{60,}/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}/],
];
// Placeholders used in documentation and tests (never real credentials).
// `.example` is the RFC 2606 reserved test domain; AKIAGOOD…/AKIABADK… are the S3 stand-in fixtures in server/tests.
const ALLOW = [/<user>|<password>|<pass>|USER:PASSWORD|user:pass(word)?@|username:password|example\.com|AKIAIOSFODNN7EXAMPLE/i, /@[a-z0-9.-]+\.example(?:[/:?]|$)/i, /^AKIA(?:GOODKEY|BADKEY0)0{8}1$/];
const SKIP_FILE = /\.(png|jpe?g|webp|avif|gif|ico|mp4|webm|woff2?|ttf|pdf|zip)$|package-lock\.json$/i;

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const findings = [];
for (const file of files) {
  if (SKIP_FILE.test(file)) continue;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue; // binary
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [name, rx] of PATTERNS) {
      const m = rx.exec(line);
      if (!m || ALLOW.some((a) => a.test(m[0]))) continue;
      const hit = m[0];
      findings.push(`${file}:${i + 1}  ${name}  ${hit.slice(0, 6)}…${'*'.repeat(6)} (${hit.length} chars)`);
    }
  });
}

if (findings.length) {
  console.error(`Possible secrets in tracked files (${findings.length}):\n${findings.join('\n')}`);
  console.error('\nRemove the value, rotate the credential, and keep secrets in environment variables or Admin → Settings.');
  process.exit(1);
}
console.log(`Secret scan: ${files.length} tracked files, no secrets found.`);
