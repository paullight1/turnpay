import { expect, test, type Page, type Route } from "@playwright/test";

const TEST_USER = {
  email: process.env.TEST_USER_EMAIL || "test@trustpay.app",
  password: process.env.TEST_USER_PASSWORD || "testpassword123",
  pin: process.env.TEST_USER_PIN || "123456",
};

type TestSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
  authMode: "local";
};

type ClientSession = Omit<TestSession, "refresh_token"> & {
  refresh_token: "";
};

type TestProfile = {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  role: "USER";
  kycStatus: "VERIFIED";
  isSuspended: false;
};

type TestWallet = {
  id: string;
  currency: "NGN" | "GHS";
  balance: number;
  updatedAt: string;
};

type TestTransaction = {
  id: string;
  type: "EXCHANGE" | "FUND";
  amount: number;
  currency: "NGN" | "GHS";
  status: "SUCCESS";
  reference: string;
  fee: number;
  metadata: Record<string, never> | null;
  createdAt: string;
  updatedAt: string;
};

type ExchangeQuote = {
  id: string;
  from: string;
  to: string;
  amount: number;
  rate: number;
  markupPercent: number;
  fee: number;
  sendAmount: number;
  receiveAmount: number;
  expiresAt: string;
  createdAt: string;
};

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function parseJsonBody<T>(route: Route): T {
  const raw = route.request().postData();
  if (!raw) {
    throw new Error(`Expected JSON body for ${route.request().url()}`);
  }

  return JSON.parse(raw) as T;
}

function buildProfile(email: string): TestProfile {
  return {
    id: "user-123",
    email,
    phone: "+2348012345678",
    fullName: "Test User",
    role: "USER",
    kycStatus: "VERIFIED",
    isSuspended: false,
  };
}

function buildSession(email: string): TestSession {
  const expiresIn = 60 * 60;

  return {
    access_token: `access-token-${email}`,
    refresh_token: `refresh-token-${email}`,
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    token_type: "bearer",
    user: {
      id: "user-123",
      email,
      role: "USER",
    },
    authMode: "local",
  };
}

function toClientSession(session: TestSession): ClientSession {
  const { refresh_token: _refreshToken, ...clientSession } = session;
  return {
    ...clientSession,
    refresh_token: "",
  };
}

function encodeSessionCookie(session: TestSession) {
  return `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
}

function buildWallets(now: string): TestWallet[] {
  return [
    {
      id: "wallet-ngn",
      currency: "NGN",
      balance: 250000,
      updatedAt: now,
    },
    {
      id: "wallet-ghs",
      currency: "GHS",
      balance: 1200.5,
      updatedAt: now,
    },
  ];
}

function buildSeedTransactions(now: string): TestTransaction[] {
  return [
    {
      id: "tx-seed-001",
      type: "FUND",
      amount: 50000,
      currency: "NGN",
      status: "SUCCESS",
      reference: "FUND-20260622-001",
      fee: 0,
      metadata: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

async function installExchangeMocks(page: Page, credentials: typeof TEST_USER) {
  const profile = buildProfile(credentials.email);
  const session = buildSession(credentials.email);
  const clientSession = toClientSession(session);
  const now = iso();
  const wallets = buildWallets(now);
  const transactions = buildSeedTransactions(now);
  const quotes = new Map<string, ExchangeQuote>();
  const receipts: Array<Record<string, unknown>> = [];
  const payouts: Array<Record<string, unknown>> = [];
  let quoteCount = 0;
  let receiptCount = 0;
  let payoutCount = 0;
  let transactionCount = transactions.length;
  const csrfToken = "csrf-token-123";

  await page.route("**/api/auth/login", async (route) => {
    const body = parseJsonBody<{ email?: string; password?: string }>(route);
    expect(body.email).toBe(credentials.email);
    expect(body.password).toBe(credentials.password);
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();

    await route.fulfill({
      status: 200,
      json: {
        user: profile,
        session,
        authMode: "local",
      },
    });
  });

  await page.route("**/api/auth/bootstrap", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.access_token}`,
    );

    await route.fulfill({
      status: 200,
      json: {
        user: profile,
        wallets,
      },
    });
  });

  await page.route("**/api/auth/session", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        json: {
          success: true,
          session: clientSession,
          csrfToken,
        },
      });
      return;
    }

    await route.fulfill({
      status: 200,
      json: {
        session: clientSession,
        csrfToken,
      },
    });
  });

  await page.route("**/api/auth/refresh", async (route) => {
    await route.fulfill({
      status: 200,
      json: { session },
    });
  });

  await page.route("**/api/wallets", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.access_token}`,
    );

    await route.fulfill({
      status: 200,
      json: wallets,
    });
  });

  await page.route("**/api/transactions*", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.access_token}`,
    );

    await route.fulfill({
      status: 200,
      json: {
        transactions,
        total: transactions.length,
        page: 1,
        totalPages: 1,
      },
    });
  });

  await page.route("**/api/exchange/payouts", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.access_token}`,
    );

    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        json: payouts,
      });
      return;
    }

    expect(route.request().headers()["idempotency-key"]).toBeTruthy();

    const body = parseJsonBody<{
      sourceAmount: string;
      destinationBankName: string;
      destinationBankCode?: string;
      destinationAccountNumber: string;
      destinationAccountName: string;
      transactionPin?: string;
    }>(route);

    expect(body.transactionPin).toBe(credentials.pin);

    const payoutAmount = Number(body.sourceAmount);
    const payout = {
      id: `payout-${++payoutCount}`,
      status: "PENDING_APPROVAL",
      sourceAmount: body.sourceAmount,
      destinationAmount: Number((payoutAmount * 0.0007).toFixed(2)).toString(),
      rate: "0.0007",
      fee: "25.00",
      sourceCurrency: "NGN",
      destinationCurrency: "GHS",
      destinationBankName: body.destinationBankName,
      destinationBankCode: body.destinationBankCode ?? null,
      destinationAccountNumber: body.destinationAccountNumber,
      destinationAccountName: body.destinationAccountName,
      adminPaymentReceipt: null,
      notificationSent: false,
      adminNote: null,
      createdAt: iso(),
      reviewedAt: null,
      sentAt: null,
      transaction: {
        reference: `PAYOUT-${payoutCount}`,
        status: "PENDING",
        createdAt: iso(),
      },
    };

    payouts.unshift(payout);

    await route.fulfill({
      status: 200,
      json: payout,
    });
  });

  await page.route("**/api/exchange/receipts", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.access_token}`,
    );

    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        json: receipts,
      });
      return;
    }

    expect(route.request().headers()["idempotency-key"]).toBeTruthy();

    const body = parseJsonBody<{
      amount: string;
      bankReference: string;
      senderName: string;
      senderBankName?: string;
      receiptUrl?: string;
      receiptObjectKey?: string;
      note?: string;
    }>(route);

    const receiptAmount = Number(body.amount);
    const receipt = {
      id: `receipt-${++receiptCount}`,
      amount: body.amount,
      expectedCreditAmount: Number((receiptAmount / 1500).toFixed(2)).toString(),
      rate: "1500.00",
      bankReference: body.bankReference,
      senderName: body.senderName,
      senderBankName: body.senderBankName ?? null,
      receiptUrl: body.receiptUrl ?? "https://example.com/receipt.png",
      status: "SUBMITTED",
      metadata: {
        providerVerificationStatus: "verified",
      },
      reviewReason: null,
      createdAt: iso(),
      reviewedAt: null,
      creditedAt: null,
      transaction: {
        reference: body.bankReference,
        status: "PENDING",
        createdAt: iso(),
      },
    };

    receipts.unshift(receipt);

    await route.fulfill({
      status: 200,
      json: receipt,
    });
  });

  await page.route("**/api/exchange/quote", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.access_token}`,
    );
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();

    const body = parseJsonBody<{ from: string; to: string; amount: number }>(
      route,
    );
    const amount = Number(body.amount);

    if (body.from === body.to) {
      await route.fulfill({
        status: 400,
        json: { message: "You cannot exchange the same currency." },
      });
      return;
    }

    const isWalletExchange = body.from === "GHS" && body.to === "NGN";
    const rate = isWalletExchange ? 1500 : 0.0007;
    const fee = isWalletExchange ? 0 : 25;
    const receiveAmount = Number((amount * rate).toFixed(2));
    const sendAmount = Number((isWalletExchange ? amount : amount + fee).toFixed(2));
    const expiresInSeconds = amount <= 5 ? 2 : 25;

    const quote: ExchangeQuote = {
      id: `quote-${++quoteCount}`,
      from: body.from,
      to: body.to,
      amount,
      rate,
      markupPercent: 0,
      fee,
      sendAmount,
      receiveAmount,
      expiresAt: iso(expiresInSeconds * 1000),
      createdAt: iso(),
    };

    quotes.set(quote.id, quote);

    await route.fulfill({
      status: 200,
      json: quote,
    });
  });

  await page.route("**/api/exchange/execute", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.access_token}`,
    );
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();

    const body = parseJsonBody<{ quoteId: string; transactionPin?: string }>(
      route,
    );
    expect(body.transactionPin).toBe(credentials.pin);

    const quote = quotes.get(body.quoteId);
    if (!quote) {
      await route.fulfill({
        status: 404,
        json: { message: "Quote not found" },
      });
      return;
    }

    const transaction: TestTransaction = {
      id: `tx-${++transactionCount}`,
      type: "EXCHANGE",
      amount: quote.amount,
      currency: quote.from === "GHS" ? "GHS" : "NGN",
      status: "SUCCESS",
      reference: `EX-${quote.id}`,
      fee: quote.fee,
      metadata: null,
      createdAt: quote.createdAt,
      updatedAt: iso(),
    };

    transactions.unshift(transaction);

    await route.fulfill({
      status: 200,
      json: {
        success: true,
        transaction,
      },
    });
  });

  await page.route("**/api/exchange/monnify-deposit-intents", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.access_token}`,
    );
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();

    const body = parseJsonBody<{ amount: string }>(route);
    const receiptAmount = Number(body.amount);
    const receipt = {
      id: `deposit-${++receiptCount}`,
      amount: body.amount,
      expectedCreditAmount: Number((receiptAmount / 1500).toFixed(2)).toString(),
      rate: "1500.00",
      bankReference: `MNFY-${receiptCount}`,
      senderName: profile.fullName,
      senderBankName: "Monnify",
      receiptUrl: "monnify://deposit-intent",
      status: "SUBMITTED",
      metadata: {
        providerVerificationStatus: "verified",
      },
      reviewReason: null,
      createdAt: iso(),
      reviewedAt: null,
      creditedAt: null,
      transaction: {
        reference: `MNFY-${receiptCount}`,
        status: "PENDING",
        createdAt: iso(),
      },
    };

    receipts.unshift(receipt);

    await route.fulfill({
      status: 200,
      json: {
        id: receipt.id,
        amount: body.amount,
        status: receipt.status,
        reference: receipt.bankReference,
      },
    });
  });
}

async function selectCurrency(page: Page, index: number, label: string) {
  const triggers = page.locator('[data-slot="select-trigger"]');
  await triggers.nth(index).click();
  await page.getByRole("option", { name: label }).click({ force: true });
}

test.describe("TrustPay Exchange Flow", () => {
  test.beforeEach(async ({ page }) => {
    await installExchangeMocks(page, TEST_USER);

    const seededSession = buildSession(TEST_USER.email);
    const cookieValue = encodeSessionCookie(seededSession);

    await page.context().addCookies([
      {
        name: "supabase.auth.token",
        value: cookieValue,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/dashboard/exchange");
    await expect(
      page.getByRole("heading", { name: /^Currency Exchange$/i }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("should display exchange page with rate", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /^Currency Exchange$/i }),
    ).toBeVisible({ timeout: 15000 });

    const amountInput = page.locator("#exchangeAmount");
    await expect(amountInput).toBeVisible();
    await amountInput.fill("100");

    await page.getByRole("button", { name: /get quote/i }).click();

    await expect(page.getByText(/quote ready/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/expires in/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /confirm exchange/i })).toBeVisible();
  });

  test("should execute a GHS→NGN exchange end-to-end", async ({ page }) => {
    const amountInput = page.locator("#exchangeAmount");
    await amountInput.fill("10");
    await page.getByRole("button", { name: /get quote/i }).click();

    await expect(
      page.getByRole("button", { name: /^Confirm Exchange$/i }),
    ).toBeVisible({ timeout: 15000 });

    const pinInput = page.locator('input[type="password"]');
    await expect(pinInput).toBeVisible();
    await pinInput.fill(TEST_USER.pin);

    const executeResponse = page.waitForResponse((response) => {
      return (
        response.url().includes("/api/exchange/execute") &&
        response.request().method() === "POST" &&
        response.status() === 200
      );
    });
    await page.getByRole("button", { name: /confirm exchange/i }).click({ force: true });
    await executeResponse;

    await page.goto("/dashboard/transactions", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/EX-quote-1/i)).toBeVisible({
      timeout: 15000,
    });
  });

  test("should reject same-currency exchange", async ({ page }) => {
    await selectCurrency(page, 1, "GHS (₵)");

    const amountInput = page.locator("#exchangeAmount");
    await amountInput.fill("100");
    await page.getByRole("button", { name: /get quote/i }).click();

    await expect(
      page.getByText(/same currency|different currency|cannot exchange/i),
    ).toBeVisible({ timeout: 5000 });
  });

  test("should handle quote expiry gracefully", async ({ page }) => {
    const amountInput = page.locator("#exchangeAmount");
    await amountInput.fill("5");
    await page.getByRole("button", { name: /get quote/i }).click();

    await expect(page.getByText(/quote ready/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /^Quote Expired$/i })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole("button", { name: /^Quote Expired$/i })).toBeDisabled();
  });

  test("exchange page is responsive on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto("/dashboard/exchange");
    await expect(
      page.getByRole("heading", { name: /^Currency Exchange$/i }),
    ).toBeVisible({ timeout: 15000 });

    const amountInput = page.locator("#exchangeAmount");
    await expect(amountInput).toBeVisible();

    await amountInput.fill("50");
    await page.getByRole("button", { name: /get quote/i }).click();

    await expect(page.getByText(/quote ready/i)).toBeVisible({ timeout: 15000 });
  });
});
