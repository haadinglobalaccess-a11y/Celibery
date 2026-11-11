# CELIBERY — Security Incident Response Guide

For the owner, the developer and whoever holds the Railway / Vercel / MongoDB Atlas / payment gateway accounts. Keep a printed or offline copy: during an incident the admin or hosting may be unavailable.

---

## 0. General procedure (every incident)

1. **Stay calm and write things down.** Open a timeline document. Record the time, who noticed, what was seen, and every action taken (UTC + local time).
2. **Preserve evidence before changing things.** Export logs for the period (Railway → service → Logs, Vercel → Logs, Atlas → Project → Activity Feed / Database Access History). Take screenshots. Do not delete records or accounts that hold evidence. Disable them instead.
3. **Contain → eradicate → recover → review.** Contain fast. Do not rebuild until you understand the entry point.
4. **Decide on notification** (§10) within 24 hours of confirming that personal data was affected.
5. **Post-incident review** within 5 working days: root cause, what worked, follow-up tasks.

### Roles

| Role | Responsibility | Holder |
|---|---|---|
| Incident lead | Decisions, timeline, communication | Owner / Super Administrator |
| Technical lead | Logs, containment, fixes, deploys | Developer |
| Payments contact | Moyasar / Tabby / bank | Owner |
| Legal / regulator contact | PDPL notification (SDAIA), customers | Owner (with legal advice) |

Keep phone numbers for each holder and for the providers' security/support desks in the offline copy.

### Where to look

| Source | What it shows |
|---|---|
| Application logs, filter `"security":true` | `auth.login_failed`, `auth.account_locked`, `mfa.*`, `authz.denied`, `rate_limit.exceeded`, `webhook.bad_signature`, `cron.bad_secret`, `staff.privilege_blocked`, `auth.session_rejected` — each with IP, path, user id |
| Admin → Activity log | Every staff change: orders, refunds, products, settings, staff, roles, 2FA |
| MongoDB `sessions` collection | Active sessions per user (IP, user agent, created, revoked) |
| Admin → Orders → history | Payment reviews, amount mismatches, duplicate payments, sandbox payments |
| Atlas Activity Feed / Access History | Database logins, user and network changes |
| Gateway dashboards | Real payments, refunds, API key usage |

### Universal containment switches

| Need | How |
|---|---|
| Sign out one customer everywhere | Admin → Customers → Suspend (ends sessions), then reactivate after the reset |
| Sign out one staff member everywhere | Admin → Staff → Deactivate (ends sessions immediately) |
| Sign out **everyone** | Change `JWT_SECRET` in Railway/Vercel and redeploy |
| Stop online payments | Admin → Settings → Payments: switch the methods off (COD stays) |
| Pause deliveries | Admin → Settings → Shipping → delivery unavailable |
| Take the API offline | Railway → service → scale to 0 / remove the domain (last resort) |

---

## 1. Suspected customer account compromise

**Signs:** a customer reports orders or address changes they did not make; many `auth.login_failed` events for one masked email, followed by `auth.login_success` from a new IP.

1. Suspend the customer (Admin → Customers → Suspend). This ends every session immediately.
2. Review their orders: cancel unshipped orders they did not place, and check delivery addresses.
3. Reactivate the account and ask the customer to use *Forgot password* (the reset ends any remaining session).
4. Look for the same IP in other `auth.login_success` events. Credential stuffing usually hits many accounts: if so, follow §5 as well.
5. Record the case and decide on notification (§10).

## 2. Exposed API key or secret

**Signs:** a secret was pasted in chat or email, committed to Git, seen in a screenshot or log, or a provider reports unusual usage.

1. **Rotate immediately** using the table in `CELIBERY_PRODUCTION_SECURITY_CHECKLIST.md §8`. Revoke the old value at the provider. Do not just replace it in the app.
2. If it was committed to Git: rotating is the fix. Rewriting history is optional and does not remove copies others already pulled.
3. Check the provider's usage logs for the exposure window (payments and refunds at the gateway, emails sent, WhatsApp messages, bucket objects, Atlas connections).
4. If `CREDENTIALS_ENCRYPTION_KEY` **and** a database copy leaked together, treat every stored credential **and staff 2FA secret** as exposed: rotate every credential, rotate the key, and have staff re-enrol 2FA (Staff → Reset 2FA for each).
5. If `JWT_SECRET` leaked: change it and redeploy (everyone is signed out). Sessions also need a server-side session record, so forged tokens fail anyway. Still rotate the secret.

## 3. Administrator account takeover

**Signs:** unexpected staff actions in the Activity log; new staff accounts or roles; changed payment credentials or webhook secrets; `mfa.disabled` / `mfa.reset_by_admin` you did not do; `staff.privilege_blocked`.

1. From a trusted device, a Super Administrator **deactivates** the compromised staff account. This ends its sessions at once. If the Super Administrator account itself is compromised and you cannot sign in: change `JWT_SECRET` (signs everyone out), then use `npm run create-staff` from a trusted machine against production to create a fresh Super Administrator, and deactivate the old one.
2. Review the Activity log for everything the account did. Check in particular: staff and roles created or changed, payment integration changes (webhook secret, keys, active mode), settings links (announcement / hero / social; possible phishing redirects), refunds, discounts, product prices.
3. Revert malicious changes. Rotate every credential in Admin → Settings (§2), because an attacker with `payments:manage` could replace keys or webhook secrets.
4. Reset the staff member's password (Staff → Send reset link) and 2FA (Staff → Reset 2FA). They re-enrol on a clean device.
5. Set `STAFF_MFA_REQUIRED=true` if it was not already on.
6. Find the entry point: phishing, a reused password, a malware-infected device, a leaked recovery code.

## 4. Payment fraud

**Signs:** orders marked paid without money at the gateway; history notes "TEST payment (sandbox gateway)", "Gateway amount did not match", "second payment"; chargebacks; many failed payments from one IP.

1. **Never ship** an order whose payment is not visible in the gateway dashboard with the same amount.
2. Sandbox payments in production: set the live gateway (checklist §0 #2). Until then, switch online methods off.
3. Amount mismatch: the order stays unconfirmed for review. Compare with the gateway, then refund or cancel.
4. Duplicate payment: refund the extra payment from the order page (refunds are capped and idempotent).
5. Card testing (many small failed payments): enable WAF rate limits / challenges on `/api/checkout` and tell the gateway. The application limit is 20 checkouts per minute per IP.
6. Refund abuse by staff: check Activity log entries for `refund`, and remove `orders:refund` from roles that do not need it.

## 5. DDoS or abusive traffic

**Signs:** slow site; many `rate_limit.exceeded` events; Railway CPU or memory at the limit; Atlas connection alerts.

1. Confirm in the Railway metrics and logs which paths are hit and from where.
2. Put or keep the domain behind Cloudflare (or the Vercel Firewall): turn on "Under Attack" / Attack Challenge Mode, add rate-limit rules for the targeted paths, and block abusive ASNs or countries temporarily.
3. Scale the Railway API service horizontally if the plan allows. Rate limits stay correct across replicas (shared store).
4. If MongoDB is the bottleneck, `rate_limit.store_unavailable` appears and limits fall back to per-instance counting. Raise the Atlas tier temporarily.
5. Credential stuffing (`auth.login_failed` from many IPs against many emails): challenge `/api/auth/login` at the WAF; the per-account limit and lock-out already apply.
6. After the attack: keep the WAF rules, and write down thresholds that would have alerted earlier.

## 6. Database exposure

**Signs:** Atlas alerts for an unknown IP or user; a database user or network rule you did not create; data found outside.

1. In Atlas: remove unknown network-access entries and database users, and **rotate the application user password** (update `MONGODB_URI`, redeploy).
2. Check the Atlas Activity Feed and Access History for the window: which user, which IP, which operations.
3. Determine what was readable. Customer names, emails, phones and addresses are in `users` and `orders`. Passwords are bcrypt hashes. Reset tokens and recovery codes are SHA-256 hashes. Integration credentials and 2FA secrets are encrypted (safe **only if** `CREDENTIALS_ENCRYPTION_KEY` did not leak too). No card data is stored.
4. If personal data was accessed, follow §7.
5. Recommend customers change their passwords if hashes were taken. Consider forcing a reset by changing `JWT_SECRET` and emailing reset links.

## 7. Data breach (personal data)

1. Contain the source (§3, §6 or §2).
2. Determine the scope: which records, which fields, how many customers, which period.
3. **Saudi PDPL:** notify the Saudi Data & Artificial Intelligence Authority (SDAIA) without undue delay and **within 72 hours** of becoming aware, when the breach may harm data subjects. Notify affected customers without undue delay when it may cause them harm. Confirm current requirements with legal counsel. Notify other markets' regulators if customers there are affected.
4. Prepare customer communication in Arabic and English: what happened, what data, what we did, and what they should do (change password, beware of phishing).
5. Keep all evidence and the timeline for the regulator.

## 8. Malicious file upload

**Signs:** unexpected media in Admin → Media; a hero or banner pointing to an unknown external URL; a report of malware from the site.

1. Uploaded files are sniffed by content: only JPEG, PNG, WebP, AVIF, GIF, MP4 and WebM are accepted. SVG, HTML and scripts are refused, names are random, and local files are served with a sandbox CSP. A malicious upload is therefore most likely an *external URL* or a crafted image.
2. Find the asset and its creator in Media and the Activity log (`upload` / `add_url`). Remove it from every place it is used (Media → usage), then delete it.
3. If the creator's account was misused, follow §3.
4. Delete the object from the bucket as well (S3 console) and purge the CDN cache.
5. If an external URL points to a hostile site, check the other settings links for the same domain.

---

## 9. Recovery checklist (after any incident)

- [ ] Root cause identified and fixed in code or configuration
- [ ] Every potentially exposed secret rotated (checklist §8)
- [ ] Unauthorised changes reverted (Activity log reviewed end to end)
- [ ] `npm test` and `npm run test:e2e` pass on the fix; deployed
- [ ] Monitoring or alert added that would have caught it earlier
- [ ] Notifications sent where required (§10), with copies archived
- [ ] Post-incident review held; tasks assigned with dates

## 10. Notification decision table

| Data affected | Customers | Regulator (SDAIA) | Payment gateway / bank |
|---|---|---|---|
| None (attempt blocked) | No | No | No |
| Contact data / addresses / order history | Yes, if harm is likely | Yes, within 72 h if harm is likely | No |
| Password hashes | Yes (advise a password change) | Assess with counsel | No |
| Payment fraud / gateway keys | If they were charged | Assess | **Yes, immediately** |
