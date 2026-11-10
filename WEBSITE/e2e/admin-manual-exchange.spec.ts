import { expect, test, type Page, type Route } from "@playwright/test";
test.setTimeout(120000);

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
  payoutWorkflow?: "LEGACY" | "ADMIN_CEDIS" | "ADMIN_EXTERNAL";
  id: string;
  reference: string;
  status: string;
  settlementMode: "WALLET" | "BANK" | "MOMO";
  sourceCurrency: "NGN" | "GHS";
  targetCurrency: "GHS" | "NGN";
  amount: string;
  targetAmount: string;
  rate: string;
  fee: string;
  collectionAccount: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    currency: "NGN" | "GHS";
    version: string;
  };
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  reviewReason: string | null;
  userId: string;
  customerName?: string | null;
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

function canonicalRateForFixture(rate: number, quoteBasis: string) {
  if (quoteBasis !== "SOURCE_PER_TARGET") return rate;
  const [whole, fraction = ""] = rate.toString().split(".");
  const numerator = BigInt(`${whole}${fraction}`);
  const denominator = BigInt(10) ** BigInt(fraction.length);
  const scaled = (BigInt(1_000_000) * denominator) / numerator;
  return Number(scaled) / 1_000_000;
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
  overrides: Partial<AdminOrder> &
    Pick<AdminOrder, "id" | "reference" | "status" | "settlementMode">,
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
    customerName: "Test Customer",
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
  const cediWalletOrder = buildOrder({
    id: "manual-cedi-wallet-001",
    reference: "MX-CEDI-WALLET-001",
    status: "AWAITING_CONFIRMATION",
    settlementMode: "WALLET",
    sourceCurrency: "GHS",
    targetCurrency: "NGN",
    amount: "100.00",
    targetAmount: "10000.00",
    rate: "100.000000",
    collectionAccount: {
      bankName: "Merchant MoMo",
      accountName: "TrustPay",
      accountNumber: "0240000000",
      currency: "GHS",
      version: "ghs-v1",
    },
  });
  const handoverOrder = buildOrder({
    id: "manual-payout-handover-001",
    reference: "MX-PAYOUT-HANDOVER-001",
    status: "PAYOUT_PROCESSING",
    settlementMode: "BANK",
    amount: "100000.00",
    targetAmount: "2000.00",
    destinationInstitution: "Ghana Commercial Bank",
    destinationAccountMasked: "******4455",
    destinationAccount: "0241234455",
    destinationName: "Unavailable Operator Fixture",
    hasProof: true,
    payoutClaimedBy: "operator-unavailable",
  });
  const orders = [
    walletOrder,
    payoutOrder,
    handoverOrder,
    expiredWalletOrder,
    cediWalletOrder,
  ];
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

  await page.route("**/api/admin/users**", async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() !== "GET" ||
      url.searchParams.get("role") !== "ADMIN"
    ) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        users: [
          {
            id: "user-123",
            email,
            fullName: "TrustPay Admin",
            role: "ADMIN",
            isSuspended: false,
          },
          {
            id: "user-456",
            email: "second-admin@trustpay.app",
            fullName: "Second TrustPay Admin",
            role: "ADMIN",
            isSuspended: false,
          },
        ],
      },
    });
  });

  await page.route("**/api/admin/exchange/manual-orders**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(request.headers().authorization).toBe(
      `Bearer ${session.access_token}`,
    );

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
      if (url.pathname.endsWith("/queue")) {
        const counts = orders.reduce<Record<string, number>>((result, item) => {
          result[item.status] = (result[item.status] ?? 0) + 1;
          return result;
        }, {});
        await route.fulfill({
          status: 200,
          json: { items: responseOrders, nextCursor: null, counts },
        });
        return;
      }
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

    if (/(?:\/upload-url|\/handover-upload-url)$/.test(url.pathname)) {
      expect(body.contentType).toBe("application/pdf");
      expect(body.fileName).toBe("payout-proof.pdf");
      await route.fulfill({
        status: 200,
        json: {
          signedUrl:
            "https://storage-example.supabase.co/manual-proof/upload?signature=test",
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
      await route.fulfill({
        status: 404,
        json: { message: "Order not found" },
      });
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
      await route.fulfill({
        status: 503,
        json: { message: "Temporary queue outage" },
      });
      return;
    }

    const now = iso();
    const nextStatus =
      body.action === "CREDIT_WALLET"
        ? "CREDITED"
        : body.action === "CLAIM_PAYOUT"
          ? "PAYOUT_PROCESSING"
          : body.action === "HANDOVER_PAYOUT"
            ? body.payoutOutcome === "ALREADY_SENT"
              ? "PAYOUT_SENT"
              : "PAYOUT_PROCESSING"
            : body.action === "MARK_SENT"
              ? "PAYOUT_SENT"
              : body.action === "COMPLETE" ||
                  body.action === "RECORD_PAYOUT_SENT" ||
                  body.action === "RECORD_CEDIS_SENT"
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
        body.action === "CLAIM_PAYOUT"
          ? "user-123"
          : body.action === "HANDOVER_PAYOUT"
            ? body.handoverToAdminId
            : order.payoutClaimedBy,
      hasPayoutProof:
        body.action === "MARK_SENT" ||
        body.action === "RECORD_PAYOUT_SENT" ||
        body.action === "RECORD_CEDIS_SENT" ||
        body.action === "HANDOVER_PAYOUT"
          ? true
          : order.hasPayoutProof,
      events: [
        ...order.events,
        { status: nextStatus, reason: String(body.reason), createdAt: now },
      ],
    });

    await route.fulfill({ status: 200, json: order });
  });

  await page.route(
    /^https:\/\/storage-example\.supabase\.co\/manual-proof\/upload/,
    async (route) => {
      uploadHeaders = route.request().headers();
      await route.fulfill({
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    },
  );

  (
    page as Page & { manualExchangeTestState?: unknown }
  ).manualExchangeTestState = {
    reviewRequests,
    getProofRequestCount: () => proofRequestCount,
    getOrders: () => orders,
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
      getOrders: () => AdminOrder[];
      getUploadHeaders: () => Record<string, string> | null;
    };
  };
}

async function waitForPayoutToast(page: Page, message: string) {
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: message });
  await expect(toast).toBeHidden({ timeout: 10000 });
}

async function openRequestGroups(page: Page) {
  await page.getByRole("button", { name: "Naira requests", exact: true }).click();
  await page.getByRole("button", { name: "Cedis requests", exact: true }).click();
}

test.describe("Admin manual exchange queue", () => {
  test.beforeEach(async ({ page }) => {
    await installAdminManualExchangeMocks(page);
    await page.goto("/admin/exchange/manual-orders");
    await expect(
      page.getByRole("heading", { name: "Exchange requests" }),
    ).toBeVisible({ timeout: 15000 });
    await openRequestGroups(page);
  });

  test("groups recent requests and opens approval without submitting it", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    const state = getTestState(page).manualExchangeTestState;
    const waitingOrder = state.getOrders().find(({ reference }) => reference === "MX-PAYOUT-001")!;
    waitingOrder.status = "AWAITING_TRANSFER";
    waitingOrder.hasProof = false;
    await page.reload();
    const naira = page.getByRole("button", { name: "Naira requests", exact: true });
    const cedis = page.getByRole("button", { name: "Cedis requests", exact: true });
    await expect(naira).toHaveAttribute("aria-expanded", "false");
    await expect(cedis).toHaveAttribute("aria-expanded", "false");
    await naira.click();
    const nairaList = page.getByRole("region", { name: "Naira requests" });
    const order = nairaList.getByRole("listitem").filter({ hasText: "MX-WALLET-001" });
    await expect(order.getByText("Test Customer", { exact: true })).toBeVisible();
    await expect(order.getByText("Needs attention", { exact: true })).toBeVisible();
    await order.getByRole("button", { name: "Approve MX-WALLET-001" }).click();
    const detail = page.getByRole("dialog", { name: "Exchange payment details" });
    await expect(detail.getByRole("button", { name: "Approve and credit wallet", exact: true })).toBeVisible();
    expect(state.reviewRequests).toHaveLength(0);
    await detail.getByRole("button", { name: "Close", exact: true }).click();
    await expect(order.getByText("Opened", { exact: true })).toBeVisible();
    await order.getByRole("button", { name: "Review MX-WALLET-001" }).click();
    const summary = detail.getByRole("region", { name: "Transaction summary" });
    const swipe = (start: number, end: number) => summary.evaluate((element, points) => {
      const touch = (clientX: number) => new Touch({ identifier: 1, target: element, clientX, clientY: 200 });
      const start = [touch(points.start)];
      element.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: start, targetTouches: start, changedTouches: start }));
      element.dispatchEvent(new TouchEvent("touchend", { bubbles: true, changedTouches: [touch(points.end)] }));
    }, { start, end });
    await swipe(280, 100);
    await expect(summary).toContainText("MX-PAYOUT-001");
    await expect(detail.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: "Keep waiting" })).toBeVisible();
    await swipe(100, 280);
    await expect(summary).toContainText("MX-WALLET-001");
    await detail.getByRole("button", { name: "Keep waiting" }).click();
    await expect(summary).toContainText("MX-PAYOUT-001");
    expect(state.reviewRequests).toHaveLength(0);
    await detail.getByRole("button", { name: "Close", exact: true }).click();
    await cedis.click();
    await expect(page.getByRole("region", { name: "Cedis requests" })).toContainText("MX-CEDI-WALLET-001");
    await expect(nairaList).not.toContainText("MX-CEDI-WALLET-001");
    await page.getByRole("link", { name: "Rates", exact: true }).click();
    await expect(page.getByRole("region", { name: "Exchange rate controls" }).locator("details")).toHaveAttribute("open", "", { timeout: 15000 });
  });

  test("admin sets each direction from an empty rate without an API feed", async ({
    page,
  }) => {
    const saved = new Map<string, { rate: number; quoteBasis: string }>();
    const writes: Record<string, unknown>[] = [];
    await page.route("**/api/exchange/rate?*", (route) => {
      const q = new URL(route.request().url()).searchParams;
      const from = q.get("from")!,
        to = q.get("to")!;
      const savedRate = saved.get(`${from}:${to}`);
      const rate = savedRate?.rate;
      return route.fulfill({
        json: {
          from,
          to,
          configured: rate !== undefined,
          baseRate: savedRate
            ? canonicalRateForFixture(rate!, savedRate.quoteBasis)
            : null,
          inputRate: rate ?? null,
          quoteBasis: savedRate?.quoteBasis ?? null,
          effectiveRate: savedRate
            ? canonicalRateForFixture(rate!, savedRate.quoteBasis)
            : null,
          markupPercent: rate === undefined ? null : 0,
          isStale: rate === undefined,
        },
      });
    });
    await page.route("**/api/exchange/rates", (route) => {
      const body = route.request().postDataJSON();
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      expect(body.markup).toBe(0);
      const canonical = canonicalRateForFixture(body.rate, body.quoteBasis);
      saved.set(`${body.from}:${body.to}`, {
        rate: body.rate,
        quoteBasis: body.quoteBasis,
      });
      writes.push(body);
      return route.fulfill({
        json: {
          success: true,
          ...body,
          inputRate: body.rate,
          baseRate: canonical,
          effectiveRate: canonical,
        },
      });
    });
    const menu = page.getByRole("button", { name: "Open menu", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page
      .getByRole("navigation", { name: "Admin navigation" })
      .getByRole("link", { name: "Exchange rates", exact: true })
      .click();
    await page.getByRole("region", { name: "Exchange rate controls" }).locator("summary").click();
    const rates = page.getByRole("region", { name: "Exchange rate controls" });
    await expect(rates).toBeVisible({ timeout: 30000 });
    const naira = rates.getByRole("region", {
      name: "Naira to cedis",
      exact: true,
    });
    const cedis = rates.getByRole("region", {
      name: "Cedis to naira",
      exact: true,
    });
    await expect(naira.getByRole("status")).toHaveText("Not set");
    await expect(cedis.getByRole("status")).toHaveText("Not set");
    await naira.getByLabel("NGN per 1 GHS").fill("87");
    await expect(
      naira.getByText("87 NGN = 1 GHS", { exact: true }),
    ).toBeVisible();
    await expect(
      naira.getByText("1 NGN ≈ 0.011494 GHS", { exact: true }),
    ).toBeVisible();
    await naira
      .getByRole("button", { name: "Save naira to cedis", exact: true })
      .click();
    await expect(naira.getByRole("status")).toHaveText("Saved");
    await expect(cedis.getByLabel("NGN received for 1 GHS")).toHaveValue("");
    await expect(cedis.getByRole("status")).toHaveText("Not set");
    await cedis.getByLabel("NGN received for 1 GHS").fill("0.03");
    await expect(
      cedis.getByRole("button", { name: "Save cedis to naira", exact: true }),
    ).toBeDisabled();
    await expect(cedis.getByRole("alert")).toContainText("above 1");
    await cedis.getByLabel("NGN received for 1 GHS").fill("85");
    await expect(
      cedis.getByText("1 GHS ≈ 85 NGN", { exact: true }),
    ).toBeVisible();
    await expect(
      cedis.getByText("To receive at least 1 NGN, send 0.02 GHS.", {
        exact: true,
      }),
    ).toBeVisible();
    await cedis
      .getByRole("button", { name: "Save cedis to naira", exact: true })
      .click();
    await expect(cedis.getByRole("status")).toHaveText("Saved");
    expect(writes).toEqual([
      {
        from: "NGN",
        to: "GHS",
        rate: 87,
        quoteBasis: "SOURCE_PER_TARGET",
        markup: 0,
      },
      {
        from: "GHS",
        to: "NGN",
        rate: 85,
        quoteBasis: "TARGET_PER_SOURCE",
        markup: 0,
      },
    ]);
  });

  test("keeps unsafe saved prices editable and blocks a crossed draft until corrected", async ({
    page,
  }) => {
    const writes: Record<string, unknown>[] = [];
    await page.route("**/api/exchange/rate?*", (route) => {
      const from = new URL(route.request().url()).searchParams.get("from");
      const ngn = from === "NGN";
      return route.fulfill({
        json: {
          from,
          to: ngn ? "GHS" : "NGN",
          configured: false,
          baseRate: ngn ? 0.011494 : 90.09009,
          inputRate: ngn ? 87 : 0.0111,
          quoteBasis: "SOURCE_PER_TARGET",
          markupPercent: 0,
          effectiveRate: null,
          isStale: false,
          blockedReason: "EXCHANGE_RATE_PAIR_CONFLICT",
        },
      });
    });
    await page.route("**/api/exchange/rates", (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      return route.fulfill({
        json: {
          ...body,
          success: true,
          inputRate: body.rate,
          baseRate: 0.010526,
          effectiveRate: 0.010526,
        },
      });
    });
    const menu = page.getByRole("button", { name: "Open menu", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page
      .getByRole("navigation", { name: "Admin navigation" })
      .getByRole("link", { name: "Exchange rates", exact: true })
      .click();
    await page.getByRole("region", { name: "Exchange rate controls" }).locator("summary").click();
    const naira = page.getByRole("region", {
      name: "Naira to cedis",
      exact: true,
    });
    await expect(naira.getByLabel("NGN per 1 GHS")).toHaveValue("87");
    await expect(naira.getByRole("alert")).toContainText("round trip");
    await expect(
      naira.getByRole("button", { name: "Save naira to cedis", exact: true }),
    ).toBeDisabled();
    await naira.getByLabel("NGN per 1 GHS").fill("95");
    await expect(
      naira.getByRole("button", { name: "Save naira to cedis", exact: true }),
    ).toBeEnabled();
    await naira
      .getByRole("button", { name: "Save naira to cedis", exact: true })
      .click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({
      from: "NGN",
      to: "GHS",
      rate: 95,
      quoteBasis: "SOURCE_PER_TARGET",
    });
  });

  test("rounds a divisor reciprocal down before and after saving", async ({
    page,
  }) => {
    const saved = new Map<string, { rate: number; quoteBasis: string }>();
    const writes: Record<string, unknown>[] = [];
    await page.route("**/api/exchange/rate?*", (route) => {
      const q = new URL(route.request().url()).searchParams;
      const from = q.get("from")!;
      const to = q.get("to")!;
      const savedRate = saved.get(`${from}:${to}`);
      const rate = savedRate?.rate;
      const canonical = savedRate
        ? canonicalRateForFixture(rate!, savedRate.quoteBasis)
        : null;
      return route.fulfill({
        json: {
          from,
          to,
          configured: rate !== undefined,
          baseRate: canonical,
          inputRate: rate ?? null,
          quoteBasis: savedRate?.quoteBasis ?? null,
          effectiveRate: canonical,
          markupPercent: rate === undefined ? null : 0,
          isStale: rate === undefined,
        },
      });
    });
    await page.route("**/api/exchange/rates", (route) => {
      const body = route.request().postDataJSON();
      const canonical = canonicalRateForFixture(body.rate, body.quoteBasis);
      writes.push(body);
      saved.set(`${body.from}:${body.to}`, {
        rate: body.rate,
        quoteBasis: body.quoteBasis,
      });
      return route.fulfill({
        json: {
          success: true,
          ...body,
          inputRate: body.rate,
          baseRate: canonical,
          effectiveRate: canonical,
        },
      });
    });

    const menu = page.getByRole("button", { name: "Open menu", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page
      .getByRole("navigation", { name: "Admin navigation" })
      .getByRole("link", { name: "Exchange rates", exact: true })
      .click();
    await page.getByRole("region", { name: "Exchange rate controls" }).locator("summary").click();
    const rates = page.getByRole("region", { name: "Exchange rate controls" });
    await expect(rates).toBeVisible({ timeout: 30000 });
    const naira = rates.getByRole("region", {
      name: "Naira to cedis",
      exact: true,
    });

    await naira.getByLabel("NGN per 1 GHS").fill("115");
    await expect(
      naira.getByText("1 NGN ≈ 0.008695 GHS", { exact: true }),
    ).toBeVisible();
    await naira
      .getByRole("button", { name: "Save naira to cedis", exact: true })
      .click();
    await expect(naira.getByRole("status")).toHaveText("Saved");
    await expect(
      naira.getByText("1 NGN ≈ 0.008695 GHS", { exact: true }),
    ).toBeVisible();
    expect(writes).toEqual([
      {
        from: "NGN",
        to: "GHS",
        rate: 115,
        quoteBasis: "SOURCE_PER_TARGET",
        markup: 0,
      },
    ]);
  });

  test("lets an admin correct a rejected receipt with a new attempt key", async ({
    page,
  }) => {
    const keys: string[] = [];
    let rejectedKey: string | undefined;
    await page.route(
      "**/api/admin/exchange/manual-orders/*/review",
      (route) => {
        const body = route.request().postDataJSON();
        if (body.action !== "CREDIT_WALLET") return route.fallback();
        const key = route.request().headers()["idempotency-key"];
        keys.push(key);
        if (body.actualAmount === "100.01") rejectedKey = key;
        if (key === rejectedKey)
          return route.fulfill({
            status: 400,
            json: { message: "The received amount does not match the order." },
          });
        return route.fallback();
      },
    );
    await page
      .getByRole("listitem")
      .filter({ hasText: "MX-CEDI-WALLET-001" })
      .getByRole("button", { name: /Review MX-CEDI-WALLET-001/ })
      .click();
    await page
      .getByRole("button", {
        name: "Approve",
        exact: true,
      })
      .click();
    const form = page.locator("form");
    await form.locator("#manual-deposit-reference").fill("MOMO-CORRECTED-001");
    await form.locator("#manual-actual-amount").fill("100.01");
    await form
      .getByLabel("Reason")
      .fill("Checked the cedi receipt in the merchant statement.");
    await form
      .getByRole("button", {
        name: "Confirm cedis and credit naira",
        exact: true,
      })
      .click();
    await expect(form.getByRole("alert")).toContainText("does not match");
    await form.locator("#manual-actual-amount").fill("100.00");
    await form
      .getByRole("button", {
        name: "Confirm cedis and credit naira",
        exact: true,
      })
      .click();
    await expect.poll(() => keys.length).toBe(2);
    expect(keys[1]).not.toBe(keys[0]);
    await expect(form).toHaveCount(0);
  });

  test("loads older requests into the correct currency group", async ({
    page,
  }) => {
    const items = getTestState(page).manualExchangeTestState.getOrders();
    const older = {
      ...items.find((item) => item.sourceCurrency === "GHS")!,
      id: "older-request",
      reference: "MX-OLDER-READY-001",
    };
    await page.route("**/api/admin/exchange/manual-orders/queue*", (route) => {
      const next = new URL(route.request().url()).searchParams.get("cursor");
      return route.fulfill({
        json: {
          items: next ? [older] : items,
          nextCursor: next ? null : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          counts: {
            AWAITING_CONFIRMATION: 77,
            PAYOUT_PENDING: 8,
            COMPLETED: 12,
          },
        },
      });
    });
    await page.reload();
    await openRequestGroups(page);
    await page
      .getByRole("button", { name: "Load more requests", exact: true })
      .click();
    const row = page.getByRole("region", { name: "Cedis requests" })
      .getByRole("listitem").filter({ hasText: "MX-OLDER-READY-001" });
    await expect(row).toBeVisible();
    await row
      .getByRole("button", { name: /Review MX-OLDER-READY-001/ })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Approve",
        exact: true,
      }),
    ).toBeVisible();
  });
  test("budgets live refresh requests when browsing eight queue pages", async ({
    page,
  }) => {
    const sample = getTestState(page).manualExchangeTestState.getOrders()[0];
    let requests = 0;
    await page.route("**/api/admin/exchange/manual-orders/queue*", (route) => {
      requests++;
      const index = Number(
        new URL(route.request().url()).searchParams.get("cursor") ?? "0",
      );
      return route.fulfill({
        json: {
          items: [
            { ...sample, id: `page-${index}`, reference: `MX-PAGE-${index}` },
          ],
          nextCursor: index < 7 ? String(index + 1) : null,
          counts: { AWAITING_CONFIRMATION: 8 },
        },
      });
    });
    await page.reload();
    await openRequestGroups(page);
    await expect(page.getByText("MX-PAGE-0", { exact: true })).toBeVisible();
    await page.clock.install();
    for (let index = 1; index < 8; index++) {
      await page
        .getByRole("button", { name: "Load more requests", exact: true })
        .click();
      await expect(
        page.getByText(`MX-PAGE-${index}`, { exact: true }),
      ).toBeVisible();
    }
    const before = requests;
    await page.clock.fastForward(15000);
    await page.waitForTimeout(250);
    expect(requests).toBe(before);
    await page.clock.fastForward(80000);
    await expect.poll(() => requests).toBe(before + 8);
  });

  test("keeps a held payout unclaimed and does not offer recording a transfer", async ({
    page,
  }) => {
    await page.route(
      "**/api/admin/exchange/manual-orders/*/review",
      (route) => {
        if (route.request().postDataJSON().action === "CLAIM_PAYOUT")
          return route.fulfill({
            status: 503,
            json: {
              message:
                "Payouts are on hold. Resolve reconciliation before paying.",
            },
          });
        return route.fallback();
      },
    );
    const row = page.getByRole("listitem").filter({ hasText: "MX-PAYOUT-001" });
    await row.getByRole("button", { name: /Review MX-PAYOUT-001/ }).click();
    await page
      .getByRole("button", { name: "Start cedi transfer", exact: true })
      .click();
    const form = page.locator("form");
    await form.getByLabel("Reason").fill("Preparing to send the quoted cedis.");
    await form
      .getByRole("button", { name: "Start cedi transfer", exact: true })
      .click();
    await expect(form.getByRole("alert")).toContainText("on hold");
    await expect(
      page.getByRole("button", { name: "I sent the cedis", exact: true }),
    ).toHaveCount(0);
  });

  test("opens protected deposit evidence and keeps the destination protected in the queue", async ({
    page,
  }) => {
    await expect(
      page.locator('a[href="/admin/exchange/manual-orders"]').first(),
    ).toHaveAttribute("href", "/admin/exchange/manual-orders");
    const payoutRow = page
      .getByRole("listitem")
      .filter({ hasText: "MX-PAYOUT-001" });
    await expect(payoutRow.getByText("******6789")).toBeVisible();
    await expect(payoutRow).not.toContainText("0241234567");
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => sessionStorage.setItem("test-copied-value", value) },
    }));
    const payoutTrigger = payoutRow.getByRole("button", { name: "Review MX-PAYOUT-001", exact: true });
    await payoutTrigger.click();
    const detail = page.getByRole("dialog", { name: "Exchange payment details" });
    await detail.getByRole("button", { name: "Copy destination account" }).click();
    expect(await page.evaluate(() => sessionStorage.getItem("test-copied-value"))).toBe("0241234567");
    await page.keyboard.press("Escape");
    await expect(payoutTrigger).toBeFocused();

    const walletRow = page
      .getByRole("listitem")
      .filter({ hasText: "MX-WALLET-001" });
    await walletRow
      .getByRole("button", { name: /Review MX-WALLET-001/ })
      .click();
    await detail.getByText("More transaction details", { exact: true }).click();
    await expect(detail.getByText("Customer bank reference")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "View deposit receipt" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "View deposit receipt" }).click();
    await expect
      .poll(() =>
        getTestState(page).manualExchangeTestState.getProofRequestCount(),
      )
      .toBe(1);
    await expect(page.locator("body")).not.toContainText(
      "https://proof.example.test/private/manual-proof.pdf",
    );
  });

  test("admin queue fits desktop and mobile without document overflow", async ({
    page,
  }) => {
    for (const width of [1087, 430, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(
        page.getByRole("heading", { name: "Exchange requests" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const heading = await page.getByRole("heading", { name: "Review queue" }).boundingBox();
      const filter = await page.getByRole("combobox", { name: "Filter manual exchange orders" }).boundingBox();
      expect(filter!.x).toBeGreaterThan(heading!.x + heading!.width);
      expect(Math.abs((heading!.y + heading!.height / 2) - (filter!.y + filter!.height / 2))).toBeLessThan(2);
      await page.screenshot({
        path: screenshotPath(`admin-exchange-${width}.png`),
        fullPage: true,
      });
    }
    const header = page.getByRole("banner");
    await expect(header.getByRole("button", { name: /Admin notifications/ })).toBeVisible();
    await expect(header.getByRole("group", { name: "Appearance" })).toHaveCount(0);
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "Navigation menu" });
    const appearance = menu.getByRole("group", { name: "Appearance" });
    await expect(appearance).toBeHidden();
    await menu.getByText("Settings", { exact: true }).click();
    const light = appearance.getByRole("button", { name: "Light", exact: true });
    const dark = appearance.getByRole("button", { name: "Dark", exact: true });
    await expect(dark).toHaveAttribute("aria-pressed", "true");
    await expect(menu.getByRole("button", { name: "Log out", exact: true })).toBeVisible();

    await page.emulateMedia({ colorScheme: "dark" });
    await light.click();
    await expect(light).toHaveAttribute("aria-pressed", "true");
    await expect(menu).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.locator(".trustpay-admin-console")).toHaveCSS("background-color", "rgb(248, 250, 252)");

    await page.reload();
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
    await expect(page.locator(".trustpay-admin-console")).toHaveCSS("background-color", "rgb(248, 250, 252)");
    await page.setViewportSize({ width: 1087, height: 844 });
    const desktopSidebar = page.getByRole("complementary").filter({ has: page.getByRole("navigation", { name: "Admin navigation" }) });
    await desktopSidebar.getByText("Settings", { exact: true }).click();
    await expect(desktopSidebar.getByRole("button", { name: "Light", exact: true })).toHaveAttribute("aria-pressed", "true");
    await desktopSidebar.getByRole("button", { name: "Dark", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(page.locator(".trustpay-admin-console")).toHaveCSS("background-color", "rgb(12, 16, 21)");
    await page.reload();
    await expect(page.locator(".trustpay-admin-console")).toHaveCSS("background-color", "rgb(12, 16, 21)");
  });

  test("opens payments and review steps from the exchange workspace on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    const payment = {
      id: "exchange-payment",
      reference: "EXCHANGE-PAYMENT-001",
      type: "EXCHANGE",
      amount: "5000",
      currency: "NGN",
      status: "SUCCESS",
      createdAt: "2026-11-01T12:00:00Z",
      user: { email: "customer@example.test" },
    };
    await page.route("**/api/admin/notifications", route => route.fulfill({
      json: [{
        id: "payment-alert",
        eventKey: "manual-exchange:order-1:payment-submitted:proof",
        audience: "ADMIN",
        orderId: "order-1",
        title: "Exchange payment submitted",
        createdAt: payment.createdAt,
        readAt: null,
      }],
    }));
    await page.route("**/api/admin/transactions?limit=50", route => route.fulfill({ json: [payment] }));
    let awaitingTransfer = true;
    await page.route("**/api/admin/transactions/EXCHANGE-PAYMENT-001", route => route.fulfill({
      json: {
        ...payment,
        manualExchange: {
          id: "manual-wallet-001",
          status: awaitingTransfer ? "AWAITING_TRANSFER" : "AWAITING_CONFIRMATION",
          settlementMode: "BANK",
          destinationInstitution: "History Bank",
          destinationAccount: "2345678901",
          destinationName: "History Recipient",
          targetAmount: "50",
          targetCurrency: "GHS",
          hasProof: !awaitingTransfer,
          hasPayoutProof: false,
        },
      },
    }));
    await page.route("**/api/admin/exchange/manual-orders/manual-wallet-001/proof-url", route =>
      route.fulfill({ json: { url: "https://proof.example.test/private/history.pdf" } })
    );
    await page.route("**/api/admin/exchange/receipts?*", route => route.fulfill({
      json: [{
        id: "deposit-1",
        status: "SUBMITTED",
        amount: "5000",
        expectedCreditAmount: "50",
        bankReference: "BANK-DEPOSIT-001",
        receiptUrl: "receipt-object",
        transaction: { reference: "DEPOSIT-001" },
      }],
    }));
    await page.route("**/api/admin/exchange/payouts?*", route => route.fulfill({
      json: [{
        id: "payout-1",
        status: "PENDING_APPROVAL",
        sourceAmount: "5000",
        destinationAmount: "50",
        destinationBankName: "Test Bank",
        destinationAccountName: "Test Recipient",
        destinationAccountNumber: "1234567890",
        transaction: { reference: "PAYOUT-001" },
      }],
    }));
    await page.route("**/api/admin/exchange/payouts/stats", route => route.fulfill({ json: { pendingApproval: 1, approved: 0, sent: 0 } }));

    await page.goto("/admin?tab=exchange");
    const payments = page.getByRole("button", { name: "See payments", exact: true });
    await expect(payments).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("link", { name: /Exchange requests/ })).toHaveAttribute("href", "/admin/exchange/manual-orders");
    await payments.click();
    await page.getByText("New payment alerts (1)", { exact: true }).click();
    await expect(page.getByRole("link", { name: "Exchange payment submitted" }))
      .toHaveAttribute("href", "/admin/exchange/manual-orders?orderId=order-1");
    const search = page.getByRole("searchbox", { name: "Search recent payments" });
    await search.fill("no such reference");
    await expect(page.getByText("No recent payments match your search.")).toBeVisible();
    await search.fill("EXCHANGE-PAYMENT-001");
    await page.getByRole("button", { name: /NGN 5,000.00.*See payment/ }).click();
    const dialog = page.getByRole("dialog", { name: "Payment details", exact: true });
    const summary = dialog.getByRole("region", { name: "Transaction summary" });
    await expect(summary.getByText(payment.reference, { exact: true })).toBeVisible();
    await expect(dialog.getByText("Waiting for the customer’s payment.")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Open exchange request" })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Review & approve" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "Confirm deposits", exact: true }).click();
    await expect(page.getByRole("button", { name: "See receipt", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Review deposit", exact: true }).click();
    await expect(page.getByText("Bank reference BANK-DEPOSIT-001")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve and credit", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Approve payouts", exact: true }).click();
    await page.getByRole("button", { name: "Review payout", exact: true }).click();
    await expect(page.getByText("Test Recipient", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve payout", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(430);

    awaitingTransfer = false;
    await page.goto("/admin");
    await expect(page.getByRole("navigation", { name: "Quick access" })).toHaveCount(0);
    const history = page.getByRole("region", { name: "Exchange history" });
    await expect(history.getByText("New payment alerts (1)", { exact: true })).toBeVisible();
    const historySearch = history.getByRole("searchbox");
    await history.getByRole("button", { name: "Filter by payment status", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "SUCCESS", exact: true }).click();
    await expect(history.getByRole("button", { name: /Filter by payment status, SUCCESS selected/ })).toBeVisible();
    await history.getByRole("button", { name: /Filter by payment status, SUCCESS selected/ }).click();
    await page.getByRole("menuitemradio", { name: "All statuses", exact: true }).click();
    await historySearch.fill("missing reference");
    await expect(history.getByText("No recent payments match your search.")).toBeVisible();
    await historySearch.fill(payment.reference);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (value: string) => sessionStorage.setItem("history-copy", value) },
      });
      window.open = (url) => {
        sessionStorage.setItem("history-proof", String(url));
        return null;
      };
    });
    const historyRow = history.getByRole("button", { name: /NGN 5,000.00.*See payment/ });
    await historyRow.click();
    await expect(summary.getByText(payment.reference, { exact: true })).toBeVisible();
    const recipient = dialog.getByRole("region", { name: "Recipient details" });
    await expect(recipient.getByText("History Recipient")).toBeVisible();
    await recipient.getByRole("button", { name: "Copy destination account" }).click();
    expect(await page.evaluate(() => sessionStorage.getItem("history-copy"))).toBe("2345678901");
    await expect(dialog.getByText("Ledger entries", { exact: true })).toBeHidden();
    const proofRequest = page.waitForRequest("**/api/admin/exchange/manual-orders/manual-wallet-001/proof-url");
    await dialog.getByRole("button", { name: "View payment receipt" }).click();
    const proof = await proofRequest;
    expect(proof.postDataJSON()).toEqual({ kind: "DEPOSIT" });
    expect(proof.headers()["idempotency-key"]).toBeTruthy();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("history-proof")))
      .toBe("https://proof.example.test/private/history.pdf");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(historyRow).toBeFocused();

    const rates = page.getByRole("region", { name: "Exchange rate controls" });
    await expect(rates.locator("summary svg[aria-hidden='true']").first()).toBeVisible();
    await rates.getByText("Exchange rates", { exact: true }).click();
    await expect(rates.getByRole("region", { name: "Naira to cedis" })).toBeVisible();
    await page.screenshot({ path: screenshotPath("admin-overview-exchange-history.png") });

    await historyRow.click();
    const approve = dialog.getByRole("link", { name: "Review & approve" });
    await expect(approve).toHaveAttribute("href", "/admin/exchange/manual-orders?orderId=manual-wallet-001");
    await approve.click();
    const request = page.getByRole("dialog", { name: "Exchange payment details" });
    await expect(request.getByText("MX-WALLET-001", { exact: true })).toBeVisible();
    await expect(request.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
    expect(getTestState(page).manualExchangeTestState.reviewRequests).toHaveLength(0);
  });

  test("overview tabs remain above content and follow sidebar navigation", async ({
    page,
  }) => {
    const openNavigation = async () => {
      const menu = page.getByRole("button", { name: "Open menu", exact: true });
      if (await menu.isVisible()) {
        await menu.click();
        await expect(
          page.getByRole("dialog", { name: "Navigation menu", exact: true }),
        ).toBeVisible();
      }
    };
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Admin overview" }),
    ).toHaveClass("sr-only");
    await expect(page.getByText("Your business at a glance.")).toHaveCount(0);
    const overviewCards = page.getByRole("navigation", { name: "Overview cards" });
    await expect(overviewCards.getByRole("link")).toHaveCount(4);
    for (const [card, heading] of [
      [/^Customers/, "Customers"],
      [/^Transactions/, "Finance"],
      [/^Amount processed/, "Reports & system health"],
      [/^Exchange/, "Exchange management"],
    ] as const) {
      await overviewCards.getByRole("link", { name: card }).click();
      await expect(page.getByRole("heading", { name: heading, exact: true, level: 1 })).toBeVisible();
      await page.goBack();
      await expect(overviewCards).toBeVisible();
    }
    expect(
      await page
        .locator('[data-slot="tabs"]')
        .evaluate((el) => getComputedStyle(el).flexDirection),
    ).toBe("column");
    await openNavigation();
    await page
      .getByRole("navigation", { name: "Admin navigation" })
      .getByRole("link", { name: "Transactions", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Finance", exact: true }),
    ).toBeVisible();
    await openNavigation();
    await page
      .getByRole("navigation", { name: "Admin navigation" })
      .getByRole("link", { name: "Overview", exact: true })
      .click();
    await expect(
      overviewCards,
    ).toBeVisible();
    for (const width of [1440, 430, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: screenshotPath(`admin-overview-${width}.png`),
        fullPage: true,
      });
    }
  });

  test("retries wallet credit with the same idempotency key and exact deposit data", async ({
    page,
  }) => {
    const walletRow = page
      .getByRole("listitem")
      .filter({ hasText: "MX-WALLET-001" });
    await walletRow
      .getByRole("button", { name: /Review MX-WALLET-001/ })
      .click();
    await page.getByRole("button", { name: "Approve", exact: true }).click();

    const form = page.locator("form");
    await form.locator("#manual-deposit-reference").fill("BANK-REAL-001");
    await form.locator("#manual-actual-amount").fill("50000.00");
    await form
      .getByLabel("Reason")
      .fill("Matched the bank inflow to the dedicated collection statement.");

    const submit = form.getByRole("button", {
      name: "Approve and credit wallet",
    });
    await submit.click();
    await expect(form.getByRole("alert")).toContainText(
      "Temporary queue outage",
    );
    await submit.click();

    const summary = page.getByRole("region", { name: "Transaction summary" });
    await expect(summary).toContainText("MX-WALLET-EXP-001");
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
    await page.getByRole("dialog", { name: "Exchange payment details" }).getByRole("button", { name: "Close", exact: true }).click();
    await expect(walletRow.getByText("Credited to Wallet")).toBeVisible();
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

  test("records the actual cedi transfer and completes once with proof and exact amount", async ({
    page,
  }) => {
    const row = page.getByRole("listitem").filter({ hasText: "MX-PAYOUT-001" });
    await row.getByRole("button", { name: /Review MX-PAYOUT-001/ }).click();
    await page
      .getByRole("button", { name: "Start cedi transfer", exact: true })
      .click();
    let form = page.locator("form");
    await form
      .getByLabel("Reason")
      .fill("I am taking ownership before sending the cedis.");
    await form
      .getByRole("button", { name: "Start cedi transfer", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Transaction summary" }).getByText("Payout Being Processed", { exact: true }),
    ).toBeVisible();
    await waitForPayoutToast(page, "Payout claimed for this admin");
    await page
      .getByRole("button", { name: "I sent the cedis", exact: true })
      .click();
    form = page.locator("form");
    await form.locator("#manual-payout-proof").setInputFiles({
      name: "payout-proof.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("private payout evidence"),
    });
    await form
      .getByRole("button", { name: "Upload proof", exact: true })
      .click();
    await expect(
      form.getByText("Proof uploaded and ready to attach"),
    ).toBeVisible();
    await form.locator("#manual-payout-reference").fill("GHS-TRANSFER-001");
    await form.getByLabel("Cedis actually sent").fill("2000.00");
    await form
      .getByLabel("Reason")
      .fill(
        "Matched the completed cedi transfer to the recipient and statement.",
      );
    await waitForPayoutToast(page, "Payout proof uploaded securely");
    await form
      .getByRole("button", { name: "Confirm cedis sent", exact: true })
      .click();
    await expect(page.getByRole("region", { name: "Transaction summary" }).getByText("Completed", { exact: true })).toBeVisible();
    const state = getTestState(page).manualExchangeTestState;
    const requests = state.reviewRequests.filter(
      (r) => r.body.action === "RECORD_CEDIS_SENT",
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toMatchObject({
      payoutReference: "GHS-TRANSFER-001",
      payoutAmount: "2000.00",
      payoutProofObjectKey: "manual-exchange/payout-proof-001.pdf",
    });
    expect(state.getUploadHeaders()?.authorization).toBeUndefined();
    await expect(
      page.getByRole("button", { name: "I sent the cedis", exact: true }),
    ).toHaveCount(0);
  });
  test("hands over a claimed payout only after an outcome check and protected evidence", async ({
    page,
  }) => {
    const row = page
      .getByRole("listitem")
      .filter({ hasText: "MX-PAYOUT-HANDOVER-001" });
    await row
      .getByRole("button", { name: /Review MX-PAYOUT-HANDOVER-001/ })
      .click();
    await page
      .getByRole("button", { name: "Supervised handover", exact: true })
      .click();
    const form = page.locator("form");
    await form.getByLabel("Receiving administrator").click();
    await page.getByRole("option", { name: /Second TrustPay Admin/ }).click();
    await form.getByLabel("Real-world payout outcome").click();
    await page.getByRole("option", { name: /Confirmed not sent/ }).click();
    await form.locator("#manual-payout-proof").setInputFiles({
      name: "payout-proof.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("external outcome evidence"),
    });
    await form
      .getByRole("button", { name: "Upload proof", exact: true })
      .click();
    await expect(
      form.getByText("Proof uploaded and ready to attach"),
    ).toBeVisible();
    await form
      .getByLabel("Reason")
      .fill(
        "Supervisor checked the bank statement and confirmed no payout was sent.",
      );
    await waitForPayoutToast(page, "Payout proof uploaded securely");
    await form
      .getByRole("button", {
        name: "Handover payout under supervision",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("region", { name: "Transaction summary" }).getByText("Payout Being Processed", { exact: true }),
    ).toBeVisible();
    await expect(form).toHaveCount(0);
    const request =
      getTestState(page).manualExchangeTestState.reviewRequests.at(-1);
    expect(request?.body).toMatchObject({
      action: "HANDOVER_PAYOUT",
      handoverToAdminId: "user-456",
      payoutOutcome: "NOT_SENT",
      payoutProofObjectKey: "manual-exchange/payout-proof-001.pdf",
    });
  });
  test("records a direct naira bank payout with its exact amount and protected evidence", async ({
    page,
  }) => {
    const state = getTestState(page).manualExchangeTestState;
    Object.assign(
      state
        .getOrders()
        .find((order) => order.reference === "MX-CEDI-WALLET-001")!,
      {
        settlementMode: "BANK",
        payoutWorkflow: "ADMIN_EXTERNAL",
        status: "PAYOUT_PENDING",
        amount: "10000000000.00",
        targetAmount: "1000000000000.00",
        destinationInstitution: "Synthetic Nigerian Bank",
        destinationAccount: "0123456789",
        destinationAccountMasked: "***6789",
        destinationName: "Synthetic Beneficiary",
      },
    );
    await page.reload();
    await openRequestGroups(page);
    const row = page.getByRole("listitem").filter({ hasText: "MX-CEDI-WALLET-001" });
    await row
      .getByRole("button", { name: /Review MX-CEDI-WALLET-001/ })
      .click();
    await expect(
      page
        .getByRole("definition")
        .filter({ hasText: "Synthetic Nigerian Bank" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start naira transfer", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Start naira transfer", exact: true })
      .click();
    let form = page.locator("form");
    await form
      .getByLabel("Reason")
      .fill("Taking ownership of the verified bank payout.");
    await form
      .getByRole("button", { name: "Start naira transfer", exact: true })
      .click();
    await page
      .getByRole("button", { name: "I sent the naira", exact: true })
      .click();
    form = page.locator("form");
    await form.locator("#manual-payout-proof").setInputFiles({
      name: "payout-proof.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("synthetic private evidence"),
    });
    await form
      .getByRole("button", { name: "Upload proof", exact: true })
      .click();
    await expect(
      form.getByText("Proof uploaded and ready to attach"),
    ).toBeVisible();
    await form.getByLabel("Naira actually sent").fill("1000000000000.00");
    await form.locator("#manual-payout-reference").fill("NGN-BANK-PAYOUT-001");
    await form
      .getByLabel("Reason")
      .fill("Verified completed naira payment to the recorded beneficiary.");
    await form
      .getByRole("button", { name: "Confirm naira sent", exact: true })
      .click();
    await expect(page.getByRole("region", { name: "Transaction summary" }).getByText("Completed", { exact: true })).toBeVisible();
    const requests = state.reviewRequests.filter(
      (r) => r.body.action === "RECORD_PAYOUT_SENT",
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toMatchObject({
      payoutAmount: "1000000000000.00",
      payoutReference: "NGN-BANK-PAYOUT-001",
      payoutProofObjectKey: "manual-exchange/payout-proof-001.pdf",
    });
    expect(requests[0].idempotencyKey).toBeTruthy();
    expect(state.getUploadHeaders()?.authorization).toBeUndefined();
    await expect(
      page.getByRole("button", {
        name: "Approve",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.screenshot({
      path: screenshotPath("admin-direct-naira-payout.png"),
      fullPage: true,
    });
  });

  test("confirms received cedis and credits the frozen naira wallet amount", async ({
    page,
  }) => {
    await page
      .getByRole("listitem")
      .filter({ hasText: "MX-CEDI-WALLET-001" })
      .getByRole("button", { name: /Review MX-CEDI-WALLET-001/ })
      .click();
    await page.getByText("More transaction details", { exact: true }).click();
    await expect(page.getByText("100.000000 NGN per GHS", { exact: true })).toBeVisible();
    await page
      .getByRole("button", {
        name: "Approve",
        exact: true,
      })
      .click();
    const form = page.locator("form");
    await form.locator("#manual-deposit-reference").fill("MOMO-RECEIVED-001");
    await form.locator("#manual-actual-amount").fill("100.00");
    await form
      .getByLabel("Reason")
      .fill("Verified the actual cedis received in the merchant MoMo account.");
    await form
      .getByRole("button", {
        name: "Confirm cedis and credit naira",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Approve",
        exact: true,
      }),
    ).toHaveCount(0);
    const requests = getTestState(
      page,
    ).manualExchangeTestState.reviewRequests.filter(
      (r) =>
        r.body.action === "CREDIT_WALLET" && r.body.actualAmount === "100.00",
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toMatchObject({
      action: "CREDIT_WALLET",
      actualAmount: "100.00",
      depositReference: "MOMO-RECEIVED-001",
    });
    await expect(
      page.getByRole("button", {
        name: "Approve",
        exact: true,
      }),
    ).toHaveCount(0);
  });

  test("requires an explicit frozen-terms acknowledgement for expired deposits", async ({
    page,
  }) => {
    const expiredRow = page
      .getByRole("listitem")
      .filter({ hasText: "MX-WALLET-EXP-001" });
    await expiredRow
      .getByRole("button", { name: /Review MX-WALLET-EXP-001/ })
      .click();
    await page.getByRole("button", { name: "Approve", exact: true }).click();

    const form = page.locator("form");
    await form.locator("#manual-deposit-reference").fill("BANK-EXPIRED-001");
    await form.locator("#manual-actual-amount").fill("50000.00");
    await form
      .getByLabel("Reason")
      .fill(
        "Verified the inflow and will honor the original frozen quoted terms.",
      );
    await form
      .getByRole("button", { name: "Approve and credit wallet" })
      .click();
    await expect(form.getByRole("alert")).toContainText(
      "original quoted terms",
    );

    await form
      .getByLabel("Honor the original quoted amount for this expired order")
      .check();
    await form
      .getByRole("button", { name: "Approve and credit wallet" })
      .click();
    await expect(page.getByText("Credited to Wallet").first()).toBeVisible({
      timeout: 10000,
    });

    const request =
      getTestState(page).manualExchangeTestState.reviewRequests.at(-1);
    expect(request?.body).toMatchObject({
      action: "CREDIT_WALLET",
      depositReference: "BANK-EXPIRED-001",
      actualAmount: "50000.00",
      acceptExpiredQuote: true,
    });
  });
});
