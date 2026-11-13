# CELIBERY — Security Incident Response

Practical steps for the people who run CELIBERY: Usama M. Usman (approver, BDM), the developer on call (HaadinGlobal), and whoever holds the Railway/Vercel, MongoDB Atlas, payment-provider and domain logins. This replaces `CELIBERY_SECURITY_INCIDENT_RESPONSE.md` (11 Nov) and adds the step-up events introduced on 13 Nov.

**Rule one:** preserve evidence before changing things. Export logs and note times (Saudi time, UTC+3) before restarting services or deleting anything.

## 1. Detect

| Signal | Where | Likely meaning |
|---|---|---|
| `security:auth.account_locked` for a staff account | API logs | Password guessing, or a hijacked session guessing the password (`via: in_session_recheck`) |
| `security:auth.password_check_failed` / `auth.reauth_failed` repeated for one staff user | API logs | Someone holding a staff session is trying to unlock payment or staff changes |
| `security:auth.reauth_success` at an unusual hour or from an unknown IP | API logs | Possible account takeover: check what was changed next |
| `security:webhook.bad_signature` | API logs | Forged payment notifications |
| `security:staff.privilege_blocked` | API logs | A staff account trying to grant itself more rights |
| Audit log entries you do not recognise (staff created, role changed, integration updated, refunds) | Admin → Activity log | Misuse of a staff account |
| Orders marked paid with no money received; payment-provider dashboard does not match | Admin → Orders vs. Moyasar/Tabby | Payment manipulation, or the sandbox gateway still active (SEC-01) |
| Customers report emails/WhatsApp messages you did not send | Support | Phishing using the brand, or stolen messaging credentials |

## 2. Contain (first hour)

Do the steps that apply, in this order:

1. **Suspected staff account compromise**
   - Admin → Staff → deactivate the account (ends all its sessions immediately).
   - If it is the only Super Administrator: change its password via "Forgot password" — a reset revokes every session.
   - Admin → Staff → reset 2FA for that person, then re-enrol in person.
2. **Payment credentials may be exposed or changed**
   - In the Moyasar/Tabby dashboards: roll the secret API keys and webhook secrets.
   - Enter the new keys in Admin → Settings → Payments (requires password re-entry).
   - Check the Activity log for `integration` updates and compare the masked key fingerprints shown in the admin with the provider's.
   - If unsure, switch card/Apple Pay/STC Pay/Tabby **off** in Admin → Settings → Payments; cash on delivery keeps orders flowing.
3. **Server secrets may be exposed** (`.env`, hosting account, laptop)
   - Rotate in this order: `JWT_SECRET` (signs every user out), `CRON_SECRET`, `CREDENTIALS_ENCRYPTION_KEY` (keep the old value in `CREDENTIALS_ENCRYPTION_KEY_PREVIOUS`, deploy, run `npm run migrate -- --reencrypt`, then remove the previous key), MongoDB Atlas user password, S3 keys, SMTP password, WhatsApp token.
4. **Active attack / flood**
   - Turn on Cloudflare "Under Attack" mode if Cloudflare is in front.
   - Block offending IPs at the CDN/WAF, not in application code.
5. **Database exposure suspected**
   - In Atlas: restrict network access to the API hosts only, rotate the database user password, download the Atlas access log.

## 3. Investigate

- Admin → Activity log: filter by staff member and date; export.
- API logs: search for `security:` lines and the user id or IP from the alert. Logs contain masked emails and IPs; they never contain passwords, codes, tokens or card data.
- Payments: reconcile paid orders against the provider dashboard for the affected period.
- Record: what happened, when it started, which data and accounts were affected, what was changed.

## 4. Recover

1. Restore changed settings (payment keys, roles, content) from the Activity log details or from an Atlas backup restored to a **separate** cluster — never overwrite production blindly.
2. Re-enable payment methods only after keys are rotated and a test payment succeeds on staging.
3. Re-enrol 2FA for affected staff; set `STAFF_MFA_REQUIRED=true` if it is not already on.
4. Deploy any code fix through the normal pull request with CI passing.

## 5. Notify

- **Customers' personal data affected:** Saudi Personal Data Protection Law (PDPL) requires notifying the Saudi Data & AI Authority (SDAIA) without undue delay (within 72 hours of becoming aware) and affected individuals when the breach may harm them. Confirm the exact obligations with CELIBERY's legal advisor (Q33).
- **Payment data:** CELIBERY uses hosted payment pages and stores no card data; still inform Moyasar/Tabby of any suspected misuse of their keys.
- Keep customer messages factual: what happened, what data, what CELIBERY did, what the customer should do.

## 6. Afterwards (within one week)

- Write a short post-incident note: cause, timeline, impact, fixes, and what would have detected it sooner.
- Add a regression test for the cause (`server/tests/security*.test.ts`) so CI catches it next time.
- Review alerts in `SECURITY_CONFIGURATION_GUIDE.md §6` and add any that were missing.

## Contacts (fill in and keep current)

| Role | Name | Phone / WhatsApp |
|---|---|---|
| Approver (BDM) | Usama M. Usman | |
| Online Sales Executive | Shuja Mubeen | |
| Developer on call | HaadinGlobal | |
| Hosting / Atlas account owner | | |
| Moyasar / Tabby merchant support | | |
