import { test, expect } from '@playwright/test';

test.describe('TrustPay Landing Page', () => {
  test('should load homepage', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/TrustPay/i);
    await expect(page.getByText(/Exchange money fast/i)).toBeVisible();
    await expect(page.getByText('NGN + GHS')).toBeVisible();
    await expect(page.getByText('Choose NGN or GHS')).toBeVisible();
  });

  test('should navigate to login', async ({ page }) => {
    await page.goto('/');
    const loginLink = page.locator('header a[href="/login"]:visible').first();
    await expect(loginLink).toBeVisible();
    await loginLink.click();
    await expect(page).toHaveURL(/login/, { timeout: 20000 });
  });

  test('should navigate to register', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /start exchange/i }).click();
    await expect(page).toHaveURL(/register/);
  });
});

test.describe('TrustPay Authentication', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText(/Welcome back/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page.getByText(/forgot password/i)).toBeVisible();
  });

  test('register page renders correctly', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByText(/Create your wallet/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/phone/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test('forgot password page renders correctly', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByText(/Reset access/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });
});

test.describe('TrustPay Dashboard', () => {
  test('dashboard redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/login/);
  });
});

test.describe('TrustPay Admin', () => {
  test('admin redirects to dashboard when not authenticated', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/login/);
  });
});

test.describe('TrustPay Mobile Responsive', () => {
  test('mobile navigation works', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/dashboard');

    // Should redirect to login since not authenticated
    await expect(page).toHaveURL(/login/);
  });

  test('homepage is responsive', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page.getByRole('link', { name: /TrustPay home/i })).toBeVisible();
  });
});
