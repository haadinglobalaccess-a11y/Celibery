# Payment gateway configuration (Moyasar, Tabby)

## Before anything: the encryption key (developer)

Credentials typed in the admin are encrypted with AES-256-GCM using `CREDENTIALS_ENCRYPTION_KEY`, which lives only in the hosting provider's secret settings — never in the database or Git.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set it in Vercel → Settings → Environment Variables (Production and Preview) and redeploy. Without it, production refuses to store credentials (development uses a built-in, clearly insecure key). Losing the key only means re-entering the credentials.

Rotation: set the new key as `CREDENTIALS_ENCRYPTION_KEY`, put the old one in `CREDENTIALS_ENCRYPTION_KEY_PREVIOUS`, deploy, run `npm run migrate -- --reencrypt`, then remove the previous key.

## Who can do it

Only roles with **payments:manage** (Super Administrator by default). Everyone else sees that the section is restricted. Secrets are never shown again after saving — only a masked preview (`sk_test_••••••••9f3a`) — and the API never returns them. The Activity log records which fields changed, never their values.

## Steps (Admin → Settings → Payments)

1. Choose the **Test credentials** tab of the gateway and paste the test keys:
   - Moyasar: publishable key `pk_test_…`, secret key `sk_test_…`, webhook shared secret (the "secret token" you set on the webhook in the Moyasar dashboard).
   - Tabby: public key, secret key, merchant code (Saudi store), webhook header secret.
   A live key in the test slot (or the reverse) is refused.
2. **Save**, then **Test connection**. This makes a read-only call to the gateway (no money moves). Tabby's merchant code is confirmed only at the first test checkout.
3. **Enable in test mode**. Customers now see the methods ticked in "Payment methods offered at checkout".
4. Register webhooks in the gateway dashboards:
   - Moyasar → `https://<your-domain>/api/webhooks/moyasar` with the same secret token.
   - Tabby → `https://<your-domain>/api/webhooks/tabby`, header `X-Celibery-Webhook-Secret: <webhook header secret>`.
5. Place a full test order, pay, refund part of it, and check the order and refund ledger. Apple Pay needs domain verification in the Moyasar dashboard; STC Pay must be activated on the merchant account.
6. Enter the **Live credentials**, Save, Test connection, then **Switch to live…** and type `LIVE`. Make one small real payment and refund it.

Replacing the keys of a gateway that is in use is tested first; a failing key is not saved. A gateway cannot be left enabled without its required keys.

## Before the admin manages them

Existing deployments that use `MOYASAR_*` / `TABBY_*` environment variables keep working unchanged ("Using server environment variables (legacy)"). The first save in the admin moves management to the dashboard; the environment values are then ignored and can be removed.

## Payment status and refunds

An order becomes paid only after the server fetches the status from the gateway (webhook body and browser redirect are never trusted). See `docs/ADMIN-SETTINGS-GUIDE.md` → Refunds, and `docs/UPGRADE-REPORT-2026-11-03.md` §2 for how uncertain refunds are protected.

**Status: neither gateway has been tested with real credentials yet.** Treat steps 1–6 as the acceptance test.
