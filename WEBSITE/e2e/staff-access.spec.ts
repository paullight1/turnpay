import { expect, test } from '@playwright/test';
import { getErrorMessage } from '../src/lib/errors';
import { hasAdminAccess } from '../src/lib/admin-access';

test('staff signup is email-only and preserves its key across a failed response', async ({ page }) => {
  const requests: Array<{ key: string | undefined; body: Record<string, unknown> }> = [];
  await page.route('**/api/auth/staff/register', async (route) => {
    requests.push({ key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() });
    await route.fulfill({ status: requests.length === 1 ? 503 : 201, contentType: 'application/json', body: JSON.stringify(requests.length === 1 ? { message: 'Service unavailable' } : { success: true, requiresEmailConfirmation: true }) });
  });
  await page.goto('/staff');
  await page.getByRole('button', { name: 'New staff member? Create account' }).click();
  await expect(page.getByLabel('Phone', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Transaction PIN', { exact: true })).toHaveCount(0);
  await page.getByLabel('Work email').fill('staff-test@trustpayhq.com');
  await page.getByLabel('Password', { exact: true }).fill('SyntheticPassword123');
  await page.getByRole('button', { name: 'Create staff account', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'temporarily unavailable' })).toBeVisible();
  await page.getByRole('button', { name: 'Create staff account', exact: true }).click();
  await expect(page.getByText('Check your work email', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0].key).toBeTruthy();
  expect(requests[1].key).toBe(requests[0].key);
  expect(requests[0].body).not.toHaveProperty('phone');
  expect(requests[0].body).not.toHaveProperty('transactionPin');
  expect(requests[0].body).not.toHaveProperty('role');
});

test('staff signup rejects a lookalike domain before submission', async ({ page }) => {
  let submitted = false;
  await page.route('**/api/auth/staff/register', async (route) => { submitted = true; await route.abort(); });
  await page.goto('/staff');
  await page.getByRole('button', { name: 'New staff member? Create account' }).click();
  await page.getByLabel('Work email').fill('staff@trustpayhq.com.attacker.test');
  await page.getByLabel('Password', { exact: true }).fill('SyntheticPassword123');
  await page.getByRole('button', { name: 'Create staff account', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'work email' })).toBeVisible();
  expect(submitted).toBe(false);
});

test('anonymous admin access redirects to staff authentication', async ({ page }) => {
  await page.goto('/admin/exchange/manual-orders');
  await expect(page).toHaveURL(/\/staff(?:\?|$)/);
  await expect(page.getByRole('button', { name: 'Sign in to admin' })).toBeVisible();
});

test('registration errors explain known conflicts without exposing provider details', async () => {
  expect(getErrorMessage({ config: { url: '/api/auth/register' }, response: { status: 409, data: { message: { code: 'PHONE_ALREADY_REGISTERED', message: 'internal detail' } } } }, 'failed')).toContain('phone number is already linked');
  expect(getErrorMessage({ config: { url: '/api/auth/register' }, response: { status: 500, data: { message: 'private database details' } } }, 'failed')).not.toContain('private');
});

test('client access display requires an authoritative capability, not an email suffix', async () => {
  expect(hasAdminAccess({ role: 'USER' })).toBe(false);
  expect(hasAdminAccess({ role: 'USER', canAccessAdmin: true })).toBe(true);
  expect(hasAdminAccess({ role: 'ADMIN' })).toBe(true);
});
