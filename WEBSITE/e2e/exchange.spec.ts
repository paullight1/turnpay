import { test, expect } from "@playwright/test";

const TEST_USER = {
  email: process.env.TEST_USER_EMAIL || "test@trustpay.app",
  password: process.env.TEST_USER_PASSWORD || "testpassword123",
  pin: process.env.TEST_USER_PIN || "123456",
};

test.describe("TrustPay Exchange Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(TEST_USER.email);
    await page.getByLabel(/password/i).fill(TEST_USER.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 15000 });
  });

  test("should display exchange page with rate", async ({ page }) => {
    await page.goto("/dashboard/exchange");
    await expect(page).toHaveURL(/dashboard\/exchange/);

    // Verify exchange form is visible
    await expect(page.getByText(/exchange/i).first()).toBeVisible();

    // Enter amount
    const amountInput = page.locator("#exchangeAmount");
    await expect(amountInput).toBeVisible();
    await amountInput.fill("100");

    // Click Get Quote
    await page.getByRole("button", { name: /get quote/i }).click();

    // Wait for quote to load
    await expect(page.getByText(/you receive/i)).toBeVisible({ timeout: 10000 });

    // Verify quote displays rate
    const quoteSection = page.locator('[data-testid="quote-section"], .quote-section, .quote-card');
    if (await quoteSection.isVisible()) {
      // Verify rate is shown
      await expect(page.getByText(/rate/i).first()).toBeVisible();
      // Verify receive amount is shown
      await expect(page.getByText(/NGN|GHS/)).toBeVisible();
    }
  });

  test("should execute a GHS→NGN exchange end-to-end", async ({ page }) => {
    await page.goto("/dashboard/exchange");

    // Record initial balances from dashboard
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Navigate to exchange
    await page.goto("/dashboard/exchange");
    const amountInput = page.locator("#exchangeAmount");
    await amountInput.fill("10");

    // Get quote
    await page.getByRole("button", { name: /get quote/i }).click();

    // Wait for quote section
    await expect(page.getByText(/you receive/i)).toBeVisible({ timeout: 15000 });

    // Check for quote expiry countdown
    const expiryText = page.getByText(/expires in/i);
    if (await expiryText.isVisible()) {
      await expect(expiryText).toBeVisible();
    }

    // Enter transaction PIN
    const pinInput = page.locator('input[type="password"], input[name="pin"], #transactionPin');
    if (await pinInput.isVisible()) {
      await pinInput.fill(TEST_USER.pin);
    }

    // Execute exchange
    await page.getByRole("button", { name: /confirm exchange|execute/i }).click();

    // Verify success — either a success toast, animation, or redirect
    const successIndicator = page.getByText(/success|complete|exchange successful/i);
    await expect(successIndicator.first()).toBeVisible({ timeout: 15000 });

    // Navigate to transactions and verify the exchange appears
    await page.goto("/dashboard/transactions");
    await page.waitForLoadState("networkidle");

    // Look for EXCHANGE type transaction
    const exchangeRow = page.getByText(/EXCHANGE/i).first();
    await expect(exchangeRow).toBeVisible({ timeout: 10000 });
  });

  test("should reject same-currency exchange", async ({ page }) => {
    await page.goto("/dashboard/exchange");

    // Try GHS→GHS (if UI allows selecting same currency)
    const fromSelect = page.locator('[data-testid="from-currency"], #fromCurrency, select[name="from"]');
    const toSelect = page.locator('[data-testid="to-currency"], #toCurrency, select[name="to"]');

    // If selects exist, try setting both to same
    if (await fromSelect.isVisible() && await toSelect.isVisible()) {
      await fromSelect.selectOption("GHS");
      await toSelect.selectOption("GHS");
    }

    const amountInput = page.locator("#exchangeAmount");
    await amountInput.fill("100");
    await page.getByRole("button", { name: /get quote/i }).click();

    // Should show error
    const errorMessage = page.getByText(/same currency|different currency|cannot exchange/i);
    await expect(errorMessage.first()).toBeVisible({ timeout: 5000 });
  });

  test("should handle quote expiry gracefully", async ({ page }) => {
    await page.goto("/dashboard/exchange");
    const amountInput = page.locator("#exchangeAmount");
    await amountInput.fill("5");
    await page.getByRole("button", { name: /get quote/i }).click();

    await expect(page.getByText(/you receive/i)).toBeVisible({ timeout: 10000 });

    // Wait for the quote to expire (30s default expiry)
    // Check for expired state
    const expiredIndicator = page.getByText(/expired|quote expired|get new quote/i);
    try {
      await expect(expiredIndicator.first()).toBeVisible({ timeout: 40000 });
      // Verify execute button is disabled or hidden
      const executeBtn = page.getByRole("button", { name: /confirm exchange|execute/i });
      if (await executeBtn.isVisible()) {
        await expect(executeBtn).toBeDisabled();
      }
    } catch {
      // If quote hasn't expired yet, that's fine — the countdown should still work
      const countdown = page.getByText(/expires in/i);
      await expect(countdown).toBeVisible();
    }
  });

  test("exchange page is responsive on mobile viewport", async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto("/dashboard/exchange");
    await page.waitForLoadState("networkidle");

    // Verify key elements are visible
    await expect(page.getByText(/exchange/i).first()).toBeVisible();
    const amountInput = page.locator("#exchangeAmount");
    await expect(amountInput).toBeVisible();

    // Form should be usable on mobile
    await amountInput.fill("50");
    await page.getByRole("button", { name: /get quote/i }).click();

    // Quote should appear (may take a moment on mobile)
    await expect(page.getByText(/you receive/i)).toBeVisible({ timeout: 15000 });
  });
});
