# 12 — Backup and Recovery Assessment

## 1. Status: NOT VERIFIED (H-06)
There was no access to the MongoDB Atlas project, the Railway dashboard or the media storage account. **Nothing in this audit shows that a production backup exists or can be restored.** No restore was attempted, and nothing was restored over production.

## 2. What exists
| Item | Evidence |
|---|---|
| Restore verifier | `scripts/verify-restore.mjs`: a read-only manifest (per-collection counts + SHA-256 + index names) and `verify` comparison of a restored copy. The earlier report shows a local synthetic drill (30 collections, 139,484 documents identical) and a negative test |
| Guidance | `BACKUP_RECOVERY_REPORT.md` §3 recommends Cloud Backup, PITR, retention, access, and secret custody |
| Dependency on secrets | A restored DB is only fully usable with the same `CREDENTIALS_ENCRYPTION_KEY` (encrypted gateway, SMTP and 2FA secrets). `JWT_SECRET` affects sessions only |
| Media | Cloudinary / S3. Versioning and replication unknown |

## 3. Failure-recovery behaviour (code, tested in the suite)
| Scenario | Behaviour |
|---|---|
| MongoDB temporarily unavailable | ≤ 2 s grace, then 503 + `Retry-After`; cached homepage/categories/settings still served; nothing half-written |
| API unavailable | The storefront shows error states; the cart persists in `localStorage` |
| Gateway timeout | 20 s; the order is kept, the customer can retry; uncertain refunds are reconciled |
| Email failure | Queued with retries; never blocks the order |
| Refresh during checkout | Idempotent replay |
| Duplicate request | Idempotent |
| Expired session | Treated as anonymous, cookie cleared |
| Deployment failure | Startup fails fast on bad configuration; Railway keeps the previous deployment running (platform behaviour, **not tested**) |
| Process crash | Reported, exit, host restart |

Monitoring and alerting are **not configured** (M-02), so these recoveries are silent.

## 4. Required actions (owner)
1. Confirm the Atlas tier. Enable **Cloud Backup + continuous PITR** (needs M10 or above), with snapshots every 6 h and retention of 7 d / 4 w / 12 m.
2. Restore the latest snapshot into a **separate** cluster. Run `node scripts/verify-restore.mjs manifest` against production during a quiet period (read-only), then `verify` against the restore. Record the date, duration (RTO) and snapshot age (RPO).
3. Turn on bucket versioning for media.
4. Store `CREDENTIALS_ENCRYPTION_KEY` (current and previous) in a password manager separate from the hosting accounts.
5. Write a one-page runbook: who restores, how DNS and environment variables are switched, how to verify.

**Acceptance criterion:** a dated restore-drill record with `RESTORE VERIFIED`.
