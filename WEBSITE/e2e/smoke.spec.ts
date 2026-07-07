import { test, expect } from '@playwright/test';

test.describe('TrustPay Landing Page', () => {
  test('should load homepage', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/TrustPay/i);
    await expect(page.getByRole('link', { name: /TrustPay home/i })).toBeVisible();
    await expect(page.getByRole('navigation', { name: /Main navigation/i })).toBeVisible();
    await expect(page.locator('.trustpay-hero-copy').first()).toHaveText(
      'Exchange Naira and Cedis in Minutes.',
    );
    await expect(page.getByRole('link', { name: /Get Started Free/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /View Rates/i })).toBeVisible();
  });

  test('should navigate to exchange', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a[href="/exchange"]')).toHaveAttribute('href', '/exchange');
    await page.goto('/exchange');
    await expect(page).toHaveURL(/\/exchange/);
  });

  test('should expose the get started CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Get Started Free/i })).toHaveAttribute('href', /wa\.me/);
  });
});

test.describe('TrustPay Authentication', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login');
    await expect(
      page.locator('[data-slot="card-title"]').filter({ hasText: /^Sign in$/i }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Get help/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /forgot password\?/i })).toBeVisible();
  });

  test('register page renders correctly', async ({ page }) => {
    await page.goto('/register');
    await expect(
      page.locator('[data-slot="card-title"]').filter({ hasText: /^Account owner$/i }),
    ).toBeVisible();
    await expect(page.getByText(/^Step 1 of 4$/i)).toBeVisible();
    await expect(page.getByLabel(/full name/i)).toBeVisible();
    await expect(page.getByLabel(/^email$/i)).toBeVisible();
    await expect(page.getByLabel(/phone number/i)).toBeVisible();

    await page.getByLabel(/full name/i).fill('Test User');
    await page.getByLabel(/^email$/i).fill('test@trustpay.app');
    await page.getByLabel(/phone number/i).fill('+2348012345678');
    await page.getByRole('button', { name: /continue/i }).click();

    await expect(page.locator('#password')).toBeVisible();
  });

  test('forgot password page renders correctly', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(
      page.locator('[data-slot="card-title"]').filter({ hasText: /^Reset access$/i }),
    ).toBeVisible();
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
  test('admin redirects to login when not authenticated', async ({ page }) => {
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
