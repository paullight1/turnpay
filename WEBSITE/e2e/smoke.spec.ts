import { test, expect } from '@playwright/test';

test.describe('TrustPay public website', () => {
  test('homepage explains the app and its everyday services', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/TrustPay/i);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Everyday payments. One simple app.');
    for (const name of ['Airtime & data', 'Bills & utilities', 'Payment records']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }
  });

  test('download action explains availability and can be dismissed', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Download the app', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'The TrustPay app is coming soon' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Got it', exact: true }).click();
    await expect(dialog).toBeHidden();
  });

  test('menu links navigate to the current service sections', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const menu = page.getByRole('navigation', { name: 'Main menu' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Services', exact: true })).toHaveAttribute('href', '#services');
    await menu.getByRole('link', { name: 'Services', exact: true }).click();
    await expect(page).toHaveURL(/#services$/);
    await expect(menu).toBeHidden();
  });

  test('FAQ discloses that the app is coming soon', async ({ page }) => {
    await page.goto('/');
    await page.locator('summary').filter({ hasText: 'When will the TrustPay app be available?' }).click();
    await expect(page.getByText('The app is coming soon to iOS and Android.', { exact: false })).toBeVisible();
  });

  test('keeps legal copy readable on light page surfaces', async ({ page }) => {
    await page.goto('/legal');

    const lightSurfaceCopy = [
      page.getByText('Clear information, clear rules.'),
      page.locator('#privacy').getByText('Privacy', { exact: true }),
      page.getByText('Information we collect', { exact: true }),
      page.getByRole('heading', { name: 'Need help with a policy or transaction?' }),
      page.getByRole('link', { name: 'Terms of Use' }).first(),
      page.getByRole('link', { name: 'Contact Support' }),
    ];

    const contrastRatios = await Promise.all(
      lightSurfaceCopy.map((locator) =>
        locator.evaluate((element) => {
          const channels = getComputedStyle(element)
            .color.match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((channel) => channel / 255)
            .map((channel) =>
              channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4,
            );
          const luminance =
            0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];

          return 1.05 / (luminance + 0.05);
        }),
      ),
    );

    expect(Math.min(...contrastRatios)).toBeGreaterThanOrEqual(4.5);
  });

  test('mobile menu can open and close', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
    await page.getByRole('button', { name: 'Close menu', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Main menu' })).toHaveCount(0);
  });

  test('mobile homepage and primary action fit the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const action = page.getByRole('button', { name: 'Download the app', exact: true }).first();
    await expect(action).toBeVisible();
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe('TrustPay authentication boundaries', () => {
  test('legacy login routes to staff sign-in', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/staff$/);
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/^password$/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in to admin', exact: true })).toBeVisible();
  });

  test('legacy registration routes customers to the mobile download page', async ({ page }) => {
    await page.goto('/register');
    await expect(page).toHaveURL(/\/download$/);
    await expect(page.getByRole('heading', { name: 'Download TrustPay' })).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0);
  });

  test('forgot password page renders an accessible email form', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test('anonymous customer bookmarks go to the mobile download page', async ({ page, context }) => {
    await context.setExtraHTTPHeaders({});
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/download$/);
  });

  test('anonymous admin access requires staff sign-in', async ({ page, context }) => {
    await context.setExtraHTTPHeaders({});
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/staff(?:\?|$)/);
    await expect(page.getByRole('button', { name: 'Sign in to admin', exact: true })).toBeVisible();
  });
});
