import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Step-up re-authentication in the Admin Dashboard (SECURITY_AUDIT_REPORT.md CEL-SEC-01).
 * A browser session cannot be aged from here, so the FIRST staff-create call is answered with the
 * server's REAUTH_REQUIRED response; everything after it is real: the prompt, the password check
 * by POST /api/auth/reauth, and the retried request that creates the staff member.
 */
const creds = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '.artifacts/admin.json'), 'utf8')) as { email: string; password: string };

async function login(page: Page) {
  const c = creds();
  await page.goto('/admin');
  await page.getByLabel('Email').fill(c.email);
  await page.getByLabel('Password').fill(c.password);
  await page.getByTestId('admin-login').click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function openInvite(page: Page, email: string) {
  await page.goto('/admin/staff');
  await page.getByRole('button', { name: '+ Invite staff member' }).click();
  await page.getByLabel('Full name').fill('Step Up Colleague');
  await page.getByLabel('Work email').fill(email);
}

/** Answers the first POST /api/admin/staff like an old session would; later calls reach the server. */
async function requireStepUpOnce(page: Page) {
  let blocked = 0;
  await page.route('**/api/admin/staff', async (route) => {
    if (route.request().method() === 'POST' && blocked === 0) {
      blocked++;
      return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'REAUTH_REQUIRED', message: 'Confirm your password to continue' } }) });
    }
    return route.continue();
  });
}

test.describe.serial('admin step-up re-authentication', () => {
  test('asks for the password, then completes the original action', async ({ page }) => {
    await login(page);
    await requireStepUpOnce(page);
    const email = `stepup-${Date.now()}@test.local`;
    await openInvite(page, email);
    await page.getByRole('button', { name: 'Create & send invitation' }).click();

    const prompt = page.getByTestId('reauth-prompt');
    await expect(prompt).toBeVisible();
    // A wrong password is refused by the real server and the prompt stays open.
    await page.getByTestId('reauth-password').fill('not-the-password');
    await page.getByTestId('reauth-submit').click();
    await expect(prompt.getByText('Current password is incorrect')).toBeVisible();

    const reauth = page.waitForResponse((r) => r.url().endsWith('/api/auth/reauth') && r.status() === 200);
    const created = page.waitForResponse((r) => r.url().endsWith('/api/admin/staff') && r.request().method() === 'POST' && r.status() === 201);
    await page.getByTestId('reauth-password').fill(creds().password);
    await page.getByTestId('reauth-submit').click();
    await reauth;
    await created;
    await expect(prompt).toBeHidden();
    await expect(page.getByText(email)).toBeVisible();
  });

  test('cancelling leaves nothing changed and shows the reason', async ({ page }) => {
    await login(page);
    await requireStepUpOnce(page);
    const email = `stepup-cancel-${Date.now()}@test.local`;
    await openInvite(page, email);
    await page.getByRole('button', { name: 'Create & send invitation' }).click();
    await expect(page.getByTestId('reauth-prompt')).toBeVisible();
    await page.getByTestId('reauth-prompt').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('reauth-prompt')).toBeHidden();
    await expect(page.getByText('Confirm your password to continue')).toBeVisible();
    const list = await page.request.get('/api/admin/staff', { headers: { 'X-Requested-With': 'celibery' } });
    expect(JSON.stringify(await list.json())).not.toContain(email);
  });
});
