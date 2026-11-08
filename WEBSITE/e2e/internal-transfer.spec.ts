import { expect, test, type Page, type Route } from "@playwright/test";

const session = {
  access_token: "access-token-transfer-user",
  refresh_token: "refresh-token-transfer-user",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: "bearer",
  user: { id: "sender-user", email: "sender@trustpay.app", role: "USER" },
  authMode: "local" as const,
};

const profile = {
  id: "sender-user",
  email: "sender@trustpay.app",
  phone: "+2348012345678",
  fullName: "Transfer Sender",
  role: "USER" as const,
  kycStatus: "VERIFIED" as const,
  kycTier: "TIER_2",
  isSuspended: false as const,
};

const clientSession = { ...session, refresh_token: "" };

function encodedSessionCookie() {
  return `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
}

type SendBehavior = "success" | "rate-limit-once" | "insufficient-funds";
type TransferHarness = { sendKeys: string[]; setPinKeys: string[] };

function parseBody<T>(route: Route): T {
  const body = route.request().postData();
  if (!body) throw new Error(`Missing request body for ${route.request().url()}`);
  return JSON.parse(body) as T;
}

async function installTransferHarness(
  page: Page,
  options: { pinConfigured?: boolean; behavior?: SendBehavior } = {},
): Promise<TransferHarness> {
  const cookieUrl = test.info().project.use.baseURL;
  if (!cookieUrl) throw new Error("Playwright baseURL is required");
  const e2eAuthToken = process.env.TRUSTPAY_E2E_AUTH_BYPASS_TOKEN;
  if (!e2eAuthToken) throw new Error("Missing local E2E authentication token");
  await page.setExtraHTTPHeaders({ "x-trustpay-e2e-auth": e2eAuthToken });
  await page.context().addCookies([
    {
      name: "trustpay.e2e-auth",
      value: e2eAuthToken,
      url: cookieUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  let pinConfigured = options.pinConfigured ?? true;
  let sendAttempts = 0;
  const sendKeys: string[] = [];
  const setPinKeys: string[] = [];

  await page.route("**/api/auth/login", async (route) => {
    expect(parseBody(route)).toMatchObject({ email: profile.email });
    await route.fulfill({ status: 200, json: { user: profile, session, authMode: "local" } });
  });
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      ...(route.request().method() === "POST" ? {
        headers: { "set-cookie": `supabase.auth.token=${encodedSessionCookie()}; Path=/; HttpOnly; SameSite=Lax` },
      } : {}),
      json: { session: clientSession, csrfToken: "csrf-transfer" },
    });
  });
  await page.route("**/api/auth/bootstrap", (route) => route.fulfill({ status: 200, json: { user: profile, wallets: [] } }));
  await page.route("**/api/wallets", (route) => route.fulfill({ status: 200, json: [
    { id: "wallet-ngn", currency: "NGN", balance: "250000.00" },
    { id: "wallet-ghs", currency: "GHS", balance: "2500.00" },
  ] }));
  await page.route("**/api/auth/transaction-pin/status", (route) => route.fulfill({ status: 200, json: { configured: pinConfigured, locked: false, holdUntil: null } }));
  await page.route("**/api/auth/transaction-pin", async (route) => {
    expect(parseBody<{ pin: string }>(route).pin).toMatch(/^\d{4,6}$/);
    const key = route.request().headers()["idempotency-key"];
    expect(key).toBeTruthy();
    setPinKeys.push(key);
    pinConfigured = true;
    await route.fulfill({ status: 200, json: { success: true } });
  });
  await page.route("**/api/transfers/recipient/preview", async (route) => {
    expect(parseBody(route)).toEqual({ recipientEmail: "recipient@example.com" });
    await route.fulfill({ status: 200, json: { found: true, displayName: "R******* P*****", maskedIdentifier: "r*******t@example.com", avatarInitials: "RP" } });
  });
  await page.route("**/api/transfers/internal", async (route) => {
    sendAttempts += 1;
    const key = route.request().headers()["idempotency-key"];
    expect(key).toBeTruthy();
    sendKeys.push(key);
    expect(parseBody(route)).toEqual({ recipientEmail: "recipient@example.com", amount: "1250.50", currency: "NGN", note: "Lunch settlement", transactionPin: "1234" });
    if (options.behavior === "rate-limit-once" && sendAttempts === 1) {
      await route.fulfill({ status: 429, json: { message: "Too many transfer attempts. Try again shortly." } });
      return;
    }
    if (options.behavior === "insufficient-funds") {
      await route.fulfill({ status: 400, json: { message: "Insufficient balance" } });
      return;
    }
    await route.fulfill({ status: 201, json: {
      reference: "IT-20260901-001", status: "SUCCESS", amount: "1250.50", currency: "NGN",
      senderTransactionReference: "IT-20260901-001-OUT", senderBalanceAfter: "248749.50",
      recipient: { maskedIdentifier: "r*******t@example.com", avatarInitials: "RP" }, createdAt: "2026-09-01T12:00:00.000Z",
    } });
  });
  await page.route("**/api/transfers/internal/IT-20260901-001", (route) => route.fulfill({ status: 200, json: {
    reference: "IT-20260901-001", transactionReference: "IT-20260901-001-OUT", direction: "OUT", status: "SUCCESS",
    amount: "1250.50", currency: "NGN", fee: "0", counterparty: { maskedIdentifier: "r*******t@example.com" },
    note: "Lunch settlement", createdAt: "2026-09-01T12:00:00.000Z",
  } }));
  // Customer login is mobile-only. Seed the retained, non-production QA
  // session directly; the local token/header still gates these old pages.
  await page.context().addCookies([{
    name: "supabase.auth.token",
    value: encodedSessionCookie(),
    url: cookieUrl,
    httpOnly: true,
    sameSite: "Lax",
  }]);
  return { sendKeys, setPinKeys };
}

async function completeTransferForm(page: Page) {
  await page.getByLabel("Recipient email or phone").fill("recipient@example.com");
  await page.getByRole("button", { name: "Verify recipient" }).click();
  await expect(page.getByText("r*******t@example.com")).toBeVisible();
  await page.getByLabel("Amount").fill("1250.50");
  await page.getByLabel("Note (optional)").fill("Lunch settlement");
  await page.getByLabel("Transaction PIN").fill("1234");
}

test.describe("TrustPay internal transfer", () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_SERVER_URL), "Retained customer flows require the local non-production QA server");
  test("masks the recipient, reviews exact totals, and renders the final receipt", async ({ page }) => {
    await installTransferHarness(page);
    await page.goto("/dashboard/send");
    await completeTransferForm(page);
    await page.getByRole("button", { name: "Review transfer" }).click();
    await expect(page.getByRole("dialog", { name: "Review transfer" })).toBeVisible();
    await expect(page.getByTestId("review-fee")).toHaveText("NGN 0.00");
    await expect(page.getByTestId("review-total")).toHaveText("NGN 1,250.50");
    await page.getByRole("button", { name: "Confirm transfer" }).click();
    await expect(page.getByRole("heading", { name: "Transfer complete" })).toBeVisible();
    await expect(page.getByText("IT-20260901-001")).toBeVisible();
    await expect(page.getByTestId("receipt-fee")).toHaveText("NGN 0.00");
    await expect(page.getByTestId("receipt-total")).toHaveText("NGN 1,250.50");
  });

  test("sets up a missing transaction PIN with an explicit idempotency key", async ({ page }) => {
    const harness = await installTransferHarness(page, { pinConfigured: false });
    await page.goto("/dashboard/send");
    await expect(page.getByRole("heading", { name: "Create transaction PIN" })).toBeVisible();
    await page.getByLabel("New transaction PIN").fill("1234");
    await page.getByLabel("Confirm transaction PIN").fill("1234");
    await page.getByRole("button", { name: "Create PIN" }).click();
    await expect(page.getByText("Your transaction PIN is ready")).toBeVisible();
    expect(harness.setPinKeys).toHaveLength(1);
  });

  test("rejects invalid money strings and a note over 120 code points before submission", async ({ page }) => {
    const harness = await installTransferHarness(page);
    await page.goto("/dashboard/send");
    await page.getByLabel("Recipient email or phone").fill("recipient@example.com");
    await page.getByRole("button", { name: "Verify recipient" }).click();
    await page.getByLabel("Transaction PIN").fill("1234");
    for (const invalid of ["-1", "1e3", "10.001"]) {
      await page.getByLabel("Amount").fill(invalid);
      await page.getByRole("button", { name: "Review transfer" }).click();
      await expect(page.getByText("Enter a positive amount with no more than 2 decimal places.")).toBeVisible();
    }
    await page.getByLabel("Amount").fill("1250.50");
    await page.getByLabel("Note (optional)").fill("😀".repeat(121));
    await expect(page.getByText("Keep the note to 120 characters or fewer.")).toBeVisible();
    expect(harness.sendKeys).toHaveLength(0);
  });

  test("reuses the same attempt key after a 429 and allows a controlled retry", async ({ page }) => {
    const harness = await installTransferHarness(page, { behavior: "rate-limit-once" });
    await page.goto("/dashboard/send");
    await completeTransferForm(page);
    await page.getByRole("button", { name: "Review transfer" }).click();
    await page.getByRole("button", { name: "Confirm transfer" }).click();
    await expect(page.getByText("Too many transfer attempts. Try again shortly.")).toBeVisible();
    await page.getByRole("button", { name: "Retry transfer" }).click();
    await expect(page.getByRole("heading", { name: "Transfer complete" })).toBeVisible();
    expect(harness.sendKeys).toHaveLength(2);
    expect(harness.sendKeys[1]).toBe(harness.sendKeys[0]);
  });

  test("surfaces insufficient funds without losing the reviewed attempt", async ({ page }) => {
    const harness = await installTransferHarness(page, { behavior: "insufficient-funds" });
    await page.goto("/dashboard/send");
    await completeTransferForm(page);
    await page.getByRole("button", { name: "Review transfer" }).click();
    await page.getByRole("button", { name: "Confirm transfer" }).click();
    await expect(page.getByText("Insufficient balance")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry transfer" })).toBeVisible();
    expect(harness.sendKeys).toHaveLength(1);
  });
});
