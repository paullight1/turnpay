import { expect, test, type Page, type Route } from "@playwright/test";

type AdminSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: string;
  user: {
    id: string;
    email: string;
    role: "ADMIN";
  };
  authMode: "local";
};

type AdminOrder = {
  id: string;
  reference: string;
  status: string;
  settlementMode: "WALLET" | "BANK" | "MOMO";
  sourceCurrency: "NGN";
  targetCurrency: "GHS";
  amount: string;
  targetAmount: string;
  rate: string;
  fee: string;
  collectionAccount: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    currency: "NGN";
    version: string;
  };
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  reviewReason: string | null;
  userId: string;
  destinationInstitution: string | null;
  destinationAccountMasked: string | null;
  destinationAccount: string | null;
  destinationName: string | null;
  bankReference: string | null;
  depositReference: string | null;
  payoutReference: string | null;
  payoutClaimedBy: string | null;
  hasProof: boolean;
  hasPayoutProof: boolean;
  events: Array<{ status: string; reason: string; createdAt: string }>;
};

type ReviewRequest = {
  body: Record<string, unknown>;
  idempotencyKey: string | undefined;
};

const screenshotDir = process.env.PLAYWRIGHT_ARTIFACT_DIR || "output";

function screenshotPath(fileName: string) {
  return `${screenshotDir}/${fileName}`;
}

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function parseJsonBody<T>(route: Route): T {
  const raw = route.request().postData();
  if (!raw) throw new Error(`Expected JSON body for ${route.request().url()}`);
  return JSON.parse(raw) as T;
}

function encodeSessionCookie(session: AdminSession) {
  return `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
}

function buildSession(email: string): AdminSession {
  const expiresIn = 60 * 60;
  return {
    access_token: `admin-access-token-${email}`,
    refresh_token: `admin-refresh-token-${email}`,
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    token_type: "bearer",
    user: { id: "user-123", email, role: "ADMIN" },
    authMode: "local",
  };
}

function buildOrder(
  overrides: Partial<AdminOrder> & Pick<AdminOrder, "id" | "reference" | "status" | "settlementMode">,
): AdminOrder {
  const now = iso();
  const base: AdminOrder = {
    id: overrides.id,
    reference: overrides.reference,
    status: overrides.status,
    settlementMode: overrides.settlementMode,
    sourceCurrency: "NGN",
    targetCurrency: "GHS",
    amount: "50000.00",
    targetAmount: "1000.00",
    rate: "0.020000",
    fee: "0.00",
    collectionAccount: {
      bankName: "TrustPay Collection Bank",
      accountName: "TrustPay Exchange Collection",
      accountNumber: "0123456789",
      currency: "NGN",
      version: "v1",
    },
    expiresAt: iso(60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
    reviewReason: null,
    userId: "user-123",
    destinationInstitution: null,
    destinationAccountMasked: null,
    destinationAccount: null,
    destinationName: null,
    bankReference: "CUSTOMER-REF-001",
    depositReference: null,
    payoutReference: null,
    payoutClaimedBy: null,
    hasProof: true,
    hasPayoutProof: false,
    events: [
      {
        status: overrides.status,
        reason: "Customer proof attached",
        createdAt: now,
      },
    ],
  };
  return { ...base, ...overrides };
}

async function installAdminManualExchangeMocks(page: Page) {
  const email = process.env.TEST_ADMIN_EMAIL || "admin@trustpay.app";
  const e2eAuthToken = process.env.TRUSTPAY_E2E_AUTH_BYPASS_TOKEN;
  if (!e2eAuthToken) throw new Error("Missing local E2E authentication token");
  const session = buildSession(email);
  const clientSession = { ...session, refresh_token: "" as const };
  const profile = {
    id: "user-123",
    email,
    phone: "+2348012345678",
    fullName: "TrustPay Admin",
    role: "ADMIN" as const,
    kycStatus: "VERIFIED" as const,
    isSuspended: false as const,
  };
  const walletOrder = buildOrder({
    id: "manual-wallet-001",
    reference: "MX-WALLET-001",
    status: "AWAITING_CONFIRMATION",
    settlementMode: "WALLET",
  });
  const payoutOrder = buildOrder({
    id: "manual-payout-001",
    reference: "MX-PAYOUT-001",
    status: "PAYOUT_PENDING",
    settlementMode: "BANK",
    amount: "100000.00",
    targetAmount: "2000.00",
    destinationInstitution: "Ghana Commercial Bank",
    destinationAccountMasked: "******6789",
    destinationAccount: "0241234567",
    destinationName: "Test Recipient",
    hasProof: true,
  });
  const expiredWalletOrder = buildOrder({
    id: "manual-wallet-expired-001",
    reference: "MX-WALLET-EXP-001",
    status: "AWAITING_CONFIRMATION",
    settlementMode: "WALLET",
    expiresAt: iso(-60 * 1000),
  });
  const orders = [walletOrder, payoutOrder, expiredWalletOrder];
  const reviewRequests: ReviewRequest[] = [];
  let walletReviewFailures = 1;
  let proofRequestCount = 0;
  let uploadHeaders: Record<string, string> | null = null;

  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      json: { session: clientSession, csrfToken: "csrf-token-admin" },
    });
  });

  await page.route("**/api/auth/bootstrap", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.access_token}`,
    );
    await route.fulfill({ status: 200, json: { user: profile, wallets: [] } });
  });

  await page.route("**/api/auth/refresh", async (route) => {
    await route.fulfill({ status: 200, json: { session } });
  });

  await page.route("**/api/admin/exchange/manual-orders**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(request.headers().authorization).toBe(`Bearer ${session.access_token}`);

    if (request.method() === "GET") {
      if (url.pathname.endsWith("/reconciliation")) {
        await route.fulfill({
          status: 200,
          json: [
            {
              id: "reconciliation-001",
              status: "COMPLETED",
              startedAt: iso(-30_000),
              completedAt: iso(-29_000),
              checkedCount: orders.length,
              mismatchCount: 0,
              mismatchDetails: [],
            },
          ],
        });
        return;
      }
      const status = url.searchParams.get("status");
      const responseOrders = status
        ? orders.filter((order) => order.status === status)
        : orders;
      await route.fulfill({ status: 200, json: responseOrders });
      return;
    }

    const body = parseJsonBody<Record<string, unknown>>(route);
    expect(request.headers()["idempotency-key"]).toBeTruthy();

    if (url.pathname.endsWith("/proof-url")) {
      expect(body.kind === "DEPOSIT" || body.kind === "PAYOUT").toBe(true);
      proofRequestCount += 1;
      await route.fulfill({
        status: 200,
        json: { url: "https://proof.example.test/private/manual-proof.pdf" },
      });
      return;
    }

    if (url.pathname.endsWith("/upload-url")) {
      expect(body.contentType).toBe("application/pdf");
      expect(body.fileName).toBe("payout-proof.pdf");
      await route.fulfill({
        status: 200,
        json: {
          signedUrl: "https://storage-example.supabase.co/manual-proof/upload?signature=test",
          objectKey: "manual-exchange/payout-proof-001.pdf",
          token: "signed-upload-token",
        },
      });
      return;
    }

    if (!url.pathname.endsWith("/review")) {
      await route.fulfill({ status: 404, json: { message: "Not found" } });
      return;
    }

    const orderId = url.pathname.split("/").at(-2);
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      await route.fulfill({ status: 404, json: { message: "Order not found" } });
      return;
    }

    reviewRequests.push({
      body,
      idempotencyKey: request.headers()["idempotency-key"],
    });

    if (
      body.action === "CREDIT_WALLET" &&
      order.id === walletOrder.id &&
      walletReviewFailures > 0
    ) {
      walletReviewFailures -= 1;
      await route.fulfill({ status: 503, json: { message: "Temporary queue outage" } });
      return;
    }

    const now = iso();
    const nextStatus =
      body.action === "CREDIT_WALLET"
        ? "CREDITED"
        : body.action === "CLAIM_PAYOUT"
          ? "PAYOUT_PROCESSING"
          : body.action === "MARK_SENT"
            ? "PAYOUT_SENT"
            : body.action === "COMPLETE"
              ? "COMPLETED"
              : body.action === "REQUEST_INFO"
                ? "NEEDS_MORE_INFO"
                : body.action === "REJECT"
                  ? "REJECTED"
                  : "PAYOUT_PENDING";
    Object.assign(order, {
      status: nextStatus,
      updatedAt: now,
      reviewReason: body.reason,
      depositReference: body.depositReference ?? order.depositReference,
      payoutReference: body.payoutReference ?? order.payoutReference,
      payoutClaimedBy:
        body.action === "CLAIM_PAYOUT" ? "user-123" : order.payoutClaimedBy,
      hasPayoutProof:
        body.action === "MARK_SENT" ? true : order.hasPayoutProof,
      events: [
        ...order.events,
        { status: nextStatus, reason: String(body.reason), createdAt: now },
      ],
    });

    await route.fulfill({ status: 200, json: order });
  });

  await page.route(/^https:\/\/storage-example\.supabase\.co\/manual-proof\/upload/, async (route) => {
    uploadHeaders = route.request().headers();
    await route.fulfill({
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  });

  (page as Page & { manualExchangeTestState?: unknown }).manualExchangeTestState = {
    reviewRequests,
    getProofRequestCount: () => proofRequestCount,
    getUploadHeaders: () => uploadHeaders,
  };

  await page.setExtraHTTPHeaders({ "x-trustpay-e2e-auth": e2eAuthToken });
  await page.context().addCookies([
    {
      name: "trustpay.e2e-auth",
      value: e2eAuthToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "supabase.auth.token",
      value: encodeSessionCookie(session),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

function getTestState(page: Page) {
  return page as Page & {
    manualExchangeTestState: {
      reviewRequests: ReviewRequest[];
      getProofRequestCount: () => number;
      getUploadHeaders: () => Record<string, string> | null;
    };
  };
}

test.describe("Admin manual exchange queue", () => {
  test.beforeEach(async ({ page }) => {
    await installAdminManualExchangeMocks(page);
    await page.goto("/admin/exchange/manual-orders");
    await expect(
      page.getByRole("heading", { name: "Exchange requests" }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("opens protected deposit evidence and keeps the destination protected in the queue", async ({
    page,
  }) => {
    await expect(
      page.locator('a[href="/admin/exchange/manual-orders"]').first(),
    ).toHaveAttribute("href", "/admin/exchange/manual-orders");
    const payoutRow = page.getByRole("row").filter({ hasText: "MX-PAYOUT-001" });
    await expect(payoutRow.getByText("******6789")).toBeVisible();
    await expect(payoutRow).not.toContainText("0241234567");

    const walletRow = page.getByRole("row").filter({ hasText: "MX-WALLET-001" });
    await walletRow.getByRole("button", { name: /Review MX-WALLET-001/ }).click();
    await expect(page.getByText("Customer bank reference")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "View deposit receipt" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "View deposit receipt" }).click();
    await expect
      .poll(() => getTestState(page).manualExchangeTestState.getProofRequestCount())
      .toBe(1);
    await expect(page.locator("body")).not.toContainText(
      "https://proof.example.test/private/manual-proof.pdf",
    );
  });

  test("admin queue fits desktop and mobile without document overflow", async ({ page }) => {
    for (const width of [1087, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.getByRole('heading', { name: 'Exchange requests' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: screenshotPath(`admin-exchange-${width}.png`), fullPage: true });
    }
  });

  test("overview tabs remain above content and follow sidebar navigation", async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Admin overview' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Business totals' })).toBeVisible();
    expect(await page.locator('[data-slot="tabs"]').evaluate(el => getComputedStyle(el).flexDirection)).toBe('column');
    await page
      .getByRole('navigation', { name: 'Admin navigation' })
      .getByRole('link', { name: 'Transactions', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Finance', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Admin overview' })).toBeVisible();
    for (const width of [1087, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: screenshotPath(`admin-overview-${width}.png`), fullPage: true });
    }
  });

  test("retries wallet credit with the same idempotency key and exact deposit data", async ({
    page,
  }) => {
    const walletRow = page.getByRole("row").filter({ hasText: "MX-WALLET-001" });
    await walletRow.getByRole("button", { name: /Review MX-WALLET-001/ }).click();
    await page.getByRole("button", { name: "Approve & credit wallet" }).click();

    const form = page.locator("form");
    await form.locator("#manual-deposit-reference").fill("BANK-REAL-001");
    await form.locator("#manual-actual-amount").fill("50000.00");
    await form.getByLabel("Reason").fill(
      "Matched the bank inflow to the dedicated collection statement.",
    );

    const submit = form.getByRole("button", { name: "Approve and credit wallet" });
    await submit.click();
    await expect(form.getByRole("alert")).toContainText("Temporary queue outage");
    await submit.click();

    await expect(page.getByText("Credited to Wallet").first()).toBeVisible({ timeout: 10000 });
    const requests = getTestState(page).manualExchangeTestState.reviewRequests;
    expect(requests).toHaveLength(2);
    expect(requests[0]?.idempotencyKey).toBe(requests[1]?.idempotencyKey);
    expect(requests[0]?.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(requests[1]?.body).toMatchObject({
      action: "CREDIT_WALLET",
      reason: "Matched the bank inflow to the dedicated collection statement.",
      depositReference: "BANK-REAL-001",
      actualAmount: "50000.00",
    });
  });

  test("claims, uploads protected payout proof, marks sent, and completes", async ({
    page,
  }) => {
    const payoutRow = page.getByRole("row").filter({ hasText: "MX-PAYOUT-001" });
    await payoutRow.getByRole("button", { name: /Review MX-PAYOUT-001/ }).click();
    await page.getByRole("button", { name: "Claim payout" }).click();
    let form = page.locator("form");
    await form.getByLabel("Reason").fill("I am taking ownership of this payout review.");
    await form.getByRole("button", { name: "Claim payout" }).click();

    await expect(
      page.getByRole("table").getByText("Payout Being Processed"),
    ).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Mark sent" }).click();
    form = page.locator("form");
    await form.locator("#manual-payout-proof").setInputFiles({
      name: "payout-proof.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("private payout evidence"),
    });
    await form.getByRole("button", { name: "Upload proof" }).click();
    await expect(form.getByText("Proof uploaded and ready to attach")).toBeVisible();
    await form.locator("#manual-payout-reference").fill("GHS-TRANSFER-001");
    await form.getByLabel("Reason").fill("Matched the completed GHS transfer to the payout statement.");
    await form.getByRole("button", { name: "Mark payout as sent" }).click();

    await expect(
      page.getByRole("table").getByText("Payout Sent"),
    ).toBeVisible({ timeout: 10000 });
    const state = getTestState(page).manualExchangeTestState;
    const uploadRequest = state.reviewRequests.find(
      (request) => request.body.action === "MARK_SENT",
    );
    expect(uploadRequest?.body).toMatchObject({
      action: "MARK_SENT",
      payoutReference: "GHS-TRANSFER-001",
      payoutProofObjectKey: "manual-exchange/payout-proof-001.pdf",
    });
    expect(state.getUploadHeaders()?.authorization).toBeUndefined();

    await page.getByRole("button", { name: "Complete" }).click();
    form = page.locator("form");
    await form.getByLabel("Reason").fill("Verified recipient settlement and payout evidence.");
    await form.getByRole("button", { name: "Complete settlement" }).click();
    await expect(
      page.getByRole("table").getByText("Completed"),
    ).toBeVisible({ timeout: 10000 });
  });

  test("requires an explicit frozen-terms acknowledgement for expired deposits", async ({
    page,
  }) => {
    const expiredRow = page.getByRole("row").filter({ hasText: "MX-WALLET-EXP-001" });
    await expiredRow.getByRole("button", { name: /Review MX-WALLET-EXP-001/ }).click();
    await page.getByRole("button", { name: "Approve & credit wallet" }).click();

    const form = page.locator("form");
    await form.locator("#manual-deposit-reference").fill("BANK-EXPIRED-001");
    await form.locator("#manual-actual-amount").fill("50000.00");
    await form.getByLabel("Reason").fill(
      "Verified the inflow and will honor the original frozen quoted terms.",
    );
    await form.getByRole("button", { name: "Approve and credit wallet" }).click();
    await expect(form.getByRole("alert")).toContainText("original quoted terms");

    await form.getByLabel("Honor the original quoted amount for this expired order").check();
    await form.getByRole("button", { name: "Approve and credit wallet" }).click();
    await expect(page.getByText("Credited to Wallet").first()).toBeVisible({ timeout: 10000 });

    const request = getTestState(page).manualExchangeTestState.reviewRequests.at(-1);
    expect(request?.body).toMatchObject({
      action: "CREDIT_WALLET",
      depositReference: "BANK-EXPIRED-001",
      actualAmount: "50000.00",
      acceptExpiredQuote: true,
    });
  });
});
