import { test, expect } from "@playwright/test";
test.setTimeout(120000);

test("provider queue sends once and keeps Sending until confirmed, on a small screen", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120000);
  const email = process.env.TEST_ADMIN_EMAIL || "admin@trustpay.app";
  const session = {
    access_token: `admin-access-token-${email}`,
    refresh_token: "",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: { id: "user-123", email, role: "ADMIN" },
    authMode: "local",
  };
  await page
    .context()
    .addCookies([
      {
        name: "supabase.auth.token",
        value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
        url: baseURL!,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { session, csrfToken: "csrf-test" } }),
  );
  await page.route("**/api/auth/bootstrap", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "user-123",
          email,
          role: "ADMIN",
          fullName: "Test Admin",
          kycStatus: "VERIFIED",
        },
        wallets: [],
      },
    }),
  );
  let sends = 0;
  const notification = {
    id: "33333333-3333-4333-8333-333333333333",
    orderId: "22222222-2222-4222-8222-222222222222",
    title: "Exchange payment confirmed",
    createdAt: new Date().toISOString(),
    readAt: null as string | null,
  };
  const order = {
    id: "22222222-2222-4222-8222-222222222222",
    status: "READY",
    fundedAt: new Date().toISOString(),
    reference: "PX-test",
    quote: {
      sourceCurrency: "GHS",
      targetCurrency: "NGN",
      amount: "10.00",
      fee: "0.00",
      total: "10.00",
      targetAmount: "1000.00",
      fundingSource: "EXTERNAL",
      destinationName: "Verified Receiver",
      destinationMasked: "******6789",
      destinationType: "BANK",
      destinationCode: "058",
      rate: "100.000000",
      expiresAt: new Date().toISOString(),
    },
  };
  await page.route("**/api/admin/exchange/provider/**", async (route) => {
    if (route.request().url().endsWith("/notifications"))
      return route.fulfill({ json: [notification] });
    if (route.request().url().endsWith("/read")) {
      notification.readAt = new Date().toISOString();
      return route.fulfill({ json: notification });
    }
    if (route.request().url().endsWith("/send")) {
      sends++;
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      order.status = "PROCESSING";
      return route.fulfill({ json: order });
    }
    const status = new URL(route.request().url()).searchParams.get("status");
    return route.fulfill({
      json: {
        items:
          !status || status === "ALL" || status === order.status ? [order] : [],
        nextCursor: null,
        counts: { [order.status]: 1 },
      },
    });
  });
  await page.route("**/api/admin/payments/kora/readiness", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        configured: true,
        activationStatus: "UNCONFIRMED",
        availableBalance: "1000.00",
      },
    }),
  );
  const bypass = process.env.TRUSTPAY_E2E_AUTH_BYPASS_TOKEN!;
  await page.setExtraHTTPHeaders({ "x-trustpay-e2e-auth": bypass });
  await page
    .context()
    .addCookies([
      {
        name: "trustpay.e2e-auth",
        value: bypass,
        url: baseURL!,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/exchange/provider", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "Exchange payments", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "output/playwright/kora-admin-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "output/playwright/kora-admin-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Send naira", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Verified Receiver");
  await page
    .getByLabel("Payment note")
    .fill("Verified source funds; release approved payout");
  await page
    .getByRole("button", { name: "Confirm and send", exact: true })
    .click();
  await expect(page.getByText("Sending", { exact: true }).last()).toBeVisible();
  expect(sends).toBe(1);
  await page
    .getByText("Recent payment notifications (1)", { exact: true })
    .click();
  await page.getByRole("button", { name: "Mark read", exact: true }).click();
  await expect(page.getByText("Read", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
