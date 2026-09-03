import { test, expect } from '@playwright/test';

test.describe('TrustPay Landing Page', () => {
  test('keeps a headline visible through every hero slide handoff', async ({ page }) => {
    await page.goto('/');

    const minimumHeadlineOpacity = await page.evaluate(() => {
      const headlines = Array.from(
        document.querySelectorAll<HTMLElement>('.trustpay-hero-copy'),
      );
      const animations = document
        .getAnimations()
        .filter(
          (animation) =>
            animation instanceof CSSAnimation &&
            animation.animationName === 'trustpay-hero-copy',
        );

      animations.forEach((animation) => animation.pause());

      return [0, 5_000, 10_000].reduce((minimumOpacity, handoffTime) => {
        animations.forEach((animation) => {
          animation.currentTime = handoffTime;
        });

        const visibleOpacity = Math.max(
          ...headlines.map((headline) =>
            Number.parseFloat(getComputedStyle(headline).opacity),
          ),
        );

        return Math.min(minimumOpacity, visibleOpacity);
      }, 1);
    });

    expect(minimumHeadlineOpacity).toBeGreaterThanOrEqual(0.98);
  });

  test('stacks full-width hero actions on narrow mobile screens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    const primaryAction = page.getByRole('link', { name: /Get Started Free/i });
    const secondaryAction = page.getByRole('link', { name: /View Rates/i });
    const [primaryBox, secondaryBox] = await Promise.all([
      primaryAction.boundingBox(),
      secondaryAction.boundingBox(),
    ]);

    expect(primaryBox).not.toBeNull();
    expect(secondaryBox).not.toBeNull();
    expect(primaryBox!.width).toBeGreaterThanOrEqual(340);
    expect(secondaryBox!.width).toBeGreaterThanOrEqual(340);
    expect(secondaryBox!.y).toBeGreaterThan(primaryBox!.y + primaryBox!.height);
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

  test('should load homepage', async ({ page, isMobile }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/TrustPay/i);
    await expect(page.getByRole('link', { name: /TrustPay home/i })).toBeVisible();
    if (isMobile) {
      await expect(page.getByLabel(/Open menu/i)).toBeVisible();
    } else {
      await expect(
        page.getByRole('navigation', { name: /Main navigation/i }),
      ).toBeVisible();
    }
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
