import { expect, test, type Page } from "@playwright/test";

test.setTimeout(120000);

const notificationId = "11111111-1111-4111-8111-111111111111";
const providerNotificationId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function installAdminSession(page: Page, baseURL: string | undefined) {
  const email = process.env.TEST_ADMIN_EMAIL || "admin@trustpay.app";
  const session = {
    access_token: `admin-access-token-${email}`,
    refresh_token: "admin-refresh-token",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: { id: "admin-123", email, role: "ADMIN" },
    authMode: "local" as const,
  };

  await page.setExtraHTTPHeaders({
    "x-trustpay-e2e-auth": process.env.TRUSTPAY_E2E_AUTH_BYPASS_TOKEN ?? "",
  });
  await page.context().addCookies([
    {
      name: "trustpay.e2e-auth",
      value: process.env.TRUSTPAY_E2E_AUTH_BYPASS_TOKEN ?? "",
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "supabase.auth.token",
      value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { session: { ...session, refresh_token: "" }, csrfToken: "csrf-test" },
    }),
  );
  await page.route("**/api/auth/bootstrap", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "admin-123",
          email,
          role: "ADMIN",
          fullName: "TrustPay Operations",
          kycStatus: "VERIFIED",
        },
        wallets: [],
      },
    }),
  );
  await page.route("**/api/auth/refresh", (route) =>
    route.fulfill({ json: { session } }),
  );
}

test("admin notification inbox dedupes retries, retries read state, and deep-links manual orders", async ({
  page,
  baseURL,
}) => {
  await installAdminSession(page, baseURL);

  const manualNotification = {
    id: notificationId,
    eventKey: "manual-exchange:proof-submitted:33333333",
    audience: "ADMIN",
    orderId,
    title: "Customer submitted exchange proof",
    createdAt: iso(-20_000),
    readAt: null as string | null,
  };
  const providerNotification = {
    id: providerNotificationId,
    eventKey: "vtu:requery-exhausted:44444444",
    audience: "ADMIN",
    orderId: "44444444-4444-4444-8444-444444444444",
    title: "VTU order requires manual recovery",
    createdAt: iso(-10_000),
    readAt: null as string | null,
  };
  let readFailures = 0;
  const readKeys: string[] = [];
  let unreadCount = 51;

  const listedNotifications = [
    manualNotification,
    { ...manualNotification },
    providerNotification,
    ...Array.from({ length: 48 }, (_, index) => ({
      id: `55555555-5555-4555-8555-${String(index + 1).padStart(12, "0")}`,
      eventKey: `vtu:requery-exhausted:older-${index + 1}`,
      audience: "ADMIN",
      orderId: `66666666-6666-4666-8666-${String(index + 1).padStart(12, "0")}`,
      title: `Older VTU recovery notification ${index + 1}`,
      createdAt: iso(-60_000 - index * 1_000),
      readAt: null,
    })),
  ];

  await page.route("**/api/admin/notifications", async (route) => {
    await route.fulfill({ json: listedNotifications });
  });
  await page.route("**/api/admin/notifications/unread-count", async (route) => {
    await route.fulfill({ json: { unreadCount } });
  });
  await page.route(
    `**/api/admin/notifications/${notificationId}/read`,
    async (route) => {
      readKeys.push(route.request().headers()["idempotency-key"] ?? "");
      if (readFailures === 0) {
        readFailures += 1;
        await route.fulfill({
          status: 503,
          json: { message: "Temporary notification store outage" },
        });
        return;
      }

      manualNotification.readAt = iso();
      unreadCount = 50;
      await route.fulfill({
        json: {
          notificationId,
          adminId: "admin-123",
          readAt: manualNotification.readAt,
        },
      });
    },
  );

  await page.route("**/api/admin/exchange/manual-orders**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/reconciliation")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname.endsWith("/queue")) {
      const status = url.searchParams.get("status");
      await route.fulfill({
        json: {
          items: !status || status === "ALL" ? [
            {
              id: orderId,
              reference: "MX-NOTIFY-001",
              status: "AWAITING_CONFIRMATION",
              settlementMode: "WALLET",
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
              expiresAt: iso(3600000),
              createdAt: iso(-30000),
              updatedAt: iso(-30000),
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
              events: [],
            },
          ] : [],
          nextCursor: null,
          counts: { AWAITING_CONFIRMATION: 1 },
        },
      });
      return;
    }
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/admin/users**", (route) =>
    route.fulfill({ json: { users: [] } }),
  );

  await page.goto("/admin/exchange/manual-orders", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "Exchange requests", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("table").getByText("MX-NOTIFY-001", { exact: true }),
  ).toBeVisible();

  // Start from a restrictive queue view, then follow an older notification
  // into an order that belongs to a different status.
  await page.getByRole("combobox", { name: "Filter manual exchange orders" }).click();
  await page.getByRole("option", { name: "Rejected", exact: true }).click();
  await expect(page.getByText("No orders in this view", { exact: true })).toBeVisible();

  await page
    .getByRole("button", { name: /Admin notifications/ })
    .click();
  await expect(page.getByTestId("admin-notification-inbox")).toBeVisible();
  await expect(
    page.getByTestId(`admin-notification-${notificationId}`),
  ).toHaveCount(1);
  await expect(page.getByTestId("admin-notification-unread-count")).toHaveText(
    "51",
  );
  const screenshotProject = test.info().project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  await page.screenshot({
    path: `output/exchange-notifications/admin-inbox-${screenshotProject}.png`,
    fullPage: false,
  });
  const displayedNotificationRows = await page
    .locator('[data-testid^="admin-notification-"]')
    .evaluateAll((nodes) =>
      nodes.filter((node) => {
        const testId = node.getAttribute("data-testid") ?? "";
        return (
          testId !== "admin-notification-inbox" &&
          testId !== "admin-notification-unread-count" &&
          !testId.includes("-mark-read-")
        );
      }).length,
    );
  expect(displayedNotificationRows).toBe(50);

  await expect(
    page
      .getByTestId(`admin-notification-${notificationId}`)
      .getByRole("link"),
  ).toHaveAttribute(
    "href",
    `/admin/exchange/manual-orders?orderId=${orderId}`,
  );

  await page
    .getByTestId(`admin-notification-${notificationId}`)
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/exchange/manual-orders\\?orderId=${orderId}$`),
  );
  await expect(
    page.getByRole("table").getByText("MX-NOTIFY-001", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Admin notifications/ }).click();

  await page
    .getByTestId(`admin-notification-mark-read-${notificationId}`)
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Temporary notification store outage" }),
  ).toBeVisible();
  await expect(page.getByTestId("admin-notification-unread-count")).toHaveText(
    "51",
  );

  await page
    .getByTestId(`admin-notification-${notificationId}`)
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(
    page.getByTestId(`admin-notification-${notificationId}`).getByText("Read", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("admin-notification-unread-count")).toHaveText("50");
  expect(readKeys).toHaveLength(2);
  expect(readKeys[0]).toBeTruthy();
  expect(readKeys[1]).toBe(readKeys[0]);

  // A poll may return the same event again; the inbox remains one row.
  await page.waitForTimeout(15500);
  await expect(
    page.getByTestId(`admin-notification-${notificationId}`),
  ).toHaveCount(1);
});

test("admin inbox does not claim zero when the unread count request fails", async ({
  page,
  baseURL,
}) => {
  await installAdminSession(page, baseURL);

  await page.route("**/api/admin/notifications", async (route) => {
    await route.fulfill({
      json: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          eventKey: "manual-exchange:proof-submitted:read-row",
          audience: "ADMIN",
          orderId: "88888888-8888-4888-8888-888888888888",
          title: "Previously reviewed exchange proof",
          createdAt: iso(-120_000),
          readAt: iso(-60_000),
        },
      ],
    });
  });
  await page.route("**/api/admin/notifications/unread-count", async (route) => {
    await route.fulfill({
      status: 503,
      json: { message: "Temporary unread count outage" },
    });
  });
  await page.route("**/api/admin/exchange/manual-orders**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/reconciliation")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname.endsWith("/queue")) {
      await route.fulfill({
        json: { items: [], nextCursor: null, counts: {} },
      });
      return;
    }
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/admin/users**", (route) =>
    route.fulfill({ json: { users: [] } }),
  );

  await page.goto("/admin/exchange/manual-orders", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "Exchange requests", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("button", { name: /Admin notifications/ })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Unread count unavailable" }),
  ).toBeVisible();
  await expect(page.getByText("You’re up to date", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByTestId("admin-notification-unread-count")).toHaveCount(
    0,
  );
});


test("admin inbox reconciles a saved read after the response is lost", async ({ page, baseURL }) => {
  await installAdminSession(page, baseURL);
  let readAt: string | null = null;
  let readRequests = 0;
  await page.route("**/api/admin/notifications", route => route.fulfill({ json: [{
    id: notificationId, eventKey: "manual-exchange:proof-submitted:lost-response",
    audience: "ADMIN", orderId, title: "Payment ready for review", createdAt: iso(-30000), readAt,
  }] }));
  await page.route("**/api/admin/notifications/unread-count", route =>
    route.fulfill({ json: { unreadCount: readAt ? 0 : 1 } }));
  await page.route(`**/api/admin/notifications/${notificationId}/read`, route => {
    readRequests += 1;
    readAt = iso();
    return route.fulfill({ status: 503, json: { message: "Read response lost" } });
  });
  await page.route("**/api/admin/exchange/manual-orders**", route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: url.pathname.endsWith("/queue")
      ? { items: [], nextCursor: null, counts: {} } : [] });
  });
  await page.goto("/admin/exchange/manual-orders", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Admin notifications/ }).click();
  const card = page.getByTestId(`admin-notification-${notificationId}`);
  await card.getByRole("button", { name: "Mark read", exact: true }).click();
  await expect(card.getByRole("alert")).toHaveText("Read response lost");
  await expect(card.getByText("Read", { exact: true })).toBeVisible({ timeout: 25000 });
  await expect(card.getByRole("alert")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
  expect(readRequests).toBe(1);
});
