import { test, expect } from '@playwright/test';

test.describe('TrustPay Landing Page', () => {
  test('should load homepage', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/TrustPay/i);
    await expect(page.getByText(/Send Money/i)).toBeVisible();
    await expect(page.getByText(/Buy Airtime/i)).toBeVisible();
    await expect(page.getByText(/Pay Bills/i)).toBeVisible();
  });

  test('should navigate to login', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Sign In');
    await expect(page).toHaveURL(/login/);
  });

  test('should navigate to register', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Get Started');
    await expect(page).toHaveURL(/register/);
  });
});

test.describe('TrustPay Authentication', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText(/Sign in/i)).toBeVisible();
    await expect(page.getByLabelText(/email/i)).toBeVisible();
    await expect(page.getByLabelText(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page.getByText(/forgot password/i)).toBeVisible();
  });

  test('register page renders correctly', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByText(/Create your account/i)).toBeVisible();
    await expect(page.getByLabelText(/email/i)).toBeVisible();
    await expect(page.getByLabelText(/phone/i)).toBeVisible();
    await expect(page.getByLabelText(/password/i)).toBeVisible();
  });

  test('forgot password page renders correctly', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByText(/Reset your password/i)).toBeVisible();
    await expect(page.getByLabelText(/email/i)).toBeVisible();
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
    await expect(page.getByText(/TrustPay/i)).toBeVisible();
  });
});
