import { test, expect } from '@playwright/test';
import { POST, GET, PUT } from '../src/app/api/auth/session/route';

for (const method of ['POST', 'GET', 'PUT'] as const) {
  test(`website ${method} refuses a valid customer session`, async () => {
    const session = { access_token: 'synthetic-customer', refresh_token: 'synthetic-refresh', expires_at: Math.floor(Date.now()/1000)+900, expires_in: 900, token_type: 'bearer', user: { id: 'customer', role: 'ADMIN' } };
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = async (input) => String(input).endsWith('/refresh')
      ? Response.json({ session })
      : Response.json({ user: { id: 'customer', role: 'USER', canAccessAdmin: false } });
    try {
      const cookie = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
      const response = await ({POST, GET, PUT}[method])(new Request('http://localhost:3001/api/auth/session', {
        method, headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'x-csrf-token': 'synthetic-csrf', cookie: `supabase.auth.token=${cookie}; trustpay.csrf-token=synthetic-csrf` },
        ...(method === 'POST' ? {body: JSON.stringify({session})} : {}),
      }));
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.session).toBeUndefined();
      expect(body.code).toBe('STAFF_WEB_ONLY');
    } finally { globalThis.fetch = fetchBefore; }
  });
}

test('old customer login and registration pages expose no customer forms', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByText('Customer sign-in', {exact:true})).toHaveCount(0);
  await page.goto('/register');
  await expect(page).toHaveURL(/\/download$/);
  await expect(page.getByLabel('Password', {exact:true})).toHaveCount(0);
});
