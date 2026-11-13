# CELIBERY — Backup & Disaster Recovery Report

**Date:** 13 November 2026 · **Status: production backups NOT verified.** I had no access to the Atlas project, Vercel, Railway or the media bucket. Nothing below claims that a production backup exists or can be restored.

## 1. What the repository shows

| Item | Finding |
|---|---|
| Database | MongoDB Atlas (DEPLOYMENT.md). Replica set required; production refuses to start without one. |
| Backup configuration | Not in code (it is Atlas project configuration). `docs/DEPLOYMENT.md` and `PRODUCTION-READINESS-AUDIT-2026-11-09.md` list "enable Atlas backups and test a restore" as **owner action, pending**. |
| Media | S3-compatible bucket recommended (`MEDIA_STORAGE=s3`). Versioning or replication recommended but unverified. A Railway local disk is not persistent without a volume. |
| Secrets needed to read restored data | `CREDENTIALS_ENCRYPTION_KEY`: without it, the encrypted payment/SMTP credentials in a restored database cannot be decrypted. `JWT_SECRET`: sessions only. |
| Existing backups touched | None. Nothing was deleted or overwritten. |

## 2. What was built and verified locally

`scripts/verify-restore.mjs` is a **read-only** verifier for restore drills, with no new dependencies:

1. `manifest` records, for every collection of the source: document count, a SHA-256 over all documents in canonical Extended JSON ordered by `_id`, and index names.
2. `verify` recomputes the same for the restored copy and lists every difference. Exit code 0 = identical, 1 = differences. Volatile collections (`rate_limits`, `sessions`, `counters`) are compared by presence and indexes only.

**Local drill** (synthetic data, 13 Nov 2026):
- Manifest of `celibery_loadtest`: 33 collections, 72,703 orders, taken in 15 s.
- Server-side copy with indexes into `celibery_restore_drill` (stands in for a restore). Result: `RESTORE VERIFIED: 30 collections, 139,484 documents identical`.
- Negative test: one order deleted and one product price changed in the copy. Result: `FAILED: orders 72702 documents, expected 72703 / products: same count but content differs`, exit 1.
- Drill database dropped afterwards.

**Not done:** a real `mongodump`/`mongorestore` cycle. Downloading MongoDB Database Tools was blocked in this session. Atlas snapshot restores do not need those tools.

## 3. Recommended configuration (owner action in Atlas)

| Setting | Recommendation | Why |
|---|---|---|
| Backup | **Cloud Backup on** (M10+), snapshots every 6 h, daily kept 7 days, weekly 4 weeks, monthly 12 months | Standard Atlas policy. Shared tiers (M0/M2/M5) have limited or no backup options; check the tier in use. |
| Point-in-time recovery | **On** (Continuous Cloud Backup, M10+) with a 2–7 day window | Orders and payments change all day. Snapshots alone lose up to 6 h. |
| Encryption | Atlas encrypts snapshots at rest by default. Use customer-managed keys only if required by policy. | Verify in Project → Security |
| Access | Restore/backup roles only for the owner and one engineer (Project Owner / Backup Manager). MFA on all Atlas accounts. | A backup is a full copy of customer data |
| Region | Same approved region as the cluster (Q33 data-residency decision pending) | Legal |
| Media bucket | Versioning on, lifecycle to delete non-current versions after 30–90 days | Accidental deletion or overwrite |
| Secrets | Store `CREDENTIALS_ENCRYPTION_KEY` (current and previous) in a password manager separate from the hosting accounts | Without it a restore is incomplete |

## 4. Targets (proposed, to confirm with the owner)

| Objective | Target | Achievable with |
|---|---|---|
| RPO (max data loss) | ≤ 15 minutes | PITR on. Snapshots only: up to 6 h. |
| RTO (time to restore service) | ≤ 2 hours for a full restore. Minutes for a node failure (automatic election). | Atlas restore into a new cluster, then switch `MONGODB_URI` in Vercel/Railway and redeploy |

## 5. Restore drill procedure (do before launch, then quarterly)

1. `SOURCE_URI=<prod read-only user> SOURCE_DB=celibery node scripts/verify-restore.mjs manifest > manifest-<date>.json`. Read-only; run off-peak.
2. In Atlas, restore the latest snapshot or a point in time **into a new, separate cluster**. Never restore over production.
3. `TARGET_URI=<restore cluster> TARGET_DB=celibery node scripts/verify-restore.mjs verify manifest-<date>.json`
   - Expect differences only for orders written after the snapshot time. Pick a quiet window or compare against a manifest taken at the snapshot time.
4. Point a **staging** deployment at the restored cluster and check:
   - sign-in
   - an order page
   - Admin → Settings → Integrations decrypts (needs `CREDENTIALS_ENCRYPTION_KEY`)
5. Record the start/end times. Measured RTO = time from step 2 to step 4 passing.
6. Delete the restore cluster.

**A backup counts as verified only after step 4 passes.**

## 6. Failover

Atlas elects a new primary automatically, typically within seconds. The application side was verified locally:
- During a full outage requests fail fast and cached pages keep serving.
- After the database returns, the app recovers by itself (RELIABILITY_REPORT.md §2.1).

**Not verified:** an Atlas "Test Failover" under traffic. Run it on staging and watch `/api/health` and checkout.
