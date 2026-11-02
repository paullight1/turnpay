import { expect, test } from "@playwright/test";

test.setTimeout(120000);

const caseId = "11111111-1111-4111-8111-111111111111";
const transactionId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

test("funding review keeps explicit collection safe and idempotent", async ({
  page,
  baseURL,
}) => {
  const email = process.env.TEST_ADMIN_EMAIL || "admin@trustpay.app";
  const session = {
    access_token: `admin-access-token-${email}`,
    refresh_token: "",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: { id: "admin-123", email, role: "ADMIN" },
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
  const bypass = process.env.TRUSTPAY_E2E_AUTH_BYPASS_TOKEN;
  if (bypass) {
    await page.context().addCookies([
      {
        name: "trustpay.e2e-auth",
        value: bypass,
        url: baseURL!,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { session, csrfToken: "csrf-admin" } }),
  );
  await page.route("**/api/auth/bootstrap", (route) =>
    route.fulfill({
      json: {
        user: {
          id: userId,
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

  const adverseCase = {
    id: caseId,
    provider: "PAYSTACK",
    eventType: "refund.processed",
    providerReference: "refund-delivery-001",
    economicReference: "refund:9001",
    fundingReference: "fund-checkout-001",
    transactionId,
    userId,
    currency: "NGN",
    exposureAmount: "80.00",
    recoveredAmount: "0.00",
    status: "OPEN",
    verificationStatus: "VERIFIED",
    holdRequired: true,
    providerStatus: "processed",
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: iso(-60_000),
    updatedAt: iso(-30_000),
  };

  let failedAttempts = 0;
  const collectionKeys: string[] = [];
  const collectionBodies: Array<Record<string, unknown>> = [];

  await page.route("**/api/admin/payments/adverse-funding/cases**", async (route) => {
    await route.fulfill({ json: [adverseCase] });
  });
  await page.route("**/api/admin/audit-logs**", async (route) => {
    await route.fulfill({
      json: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          adminId: null,
          action: "PAYSTACK_ADVERSE_FUNDING_REVIEW_REQUIRED",
          targetType: "FundingAdverseCase",
          targetId: caseId,
          reason: "Independent refund evidence matched the original funding transaction",
          createdAt: iso(-45_000),
        },
      ],
    });
  });
  await page.route(
    `**/api/admin/payments/adverse-funding/cases/${caseId}/resolve`,
    async (route) => {
      const request = route.request();
      collectionKeys.push(request.headers()["idempotency-key"] ?? "");
      collectionBodies.push(request.postDataJSON() as Record<string, unknown>);
      if (failedAttempts < 2) {
        failedAttempts += 1;
        await route.fulfill({
          status: 503,
          json: { message: "Temporary operator API outage" },
        });
        return;
      }
      adverseCase.status = "UNDER_REVIEW";
      adverseCase.recoveredAmount = String(collectionBodies.at(-1)?.amount ?? "0.00");
      await route.fulfill({
        json: {
          caseId,
          status: adverseCase.status,
          holdRequired: true,
          recoveredAmount: adverseCase.recoveredAmount,
          reference: "fund-adverse-recovery-fixture",
          idempotent: false,
        },
      });
    },
  );

  await page.goto("/admin/payments/adverse-funding", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "Funding review", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Global outbound hold" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByText("Review case", { exact: true })).toBeVisible();
  await expect(page.getByText("Independent refund evidence matched the original funding transaction")).toBeVisible();

  await page.getByLabel("Decision").click();
  await page.getByRole("option", { name: "Collect explicit amount" }).click();
  await page.getByLabel("Amount to collect").fill("10.00");
  await page
    .getByLabel("Audit reason")
    .fill("Collect only the independently verified refund exposure");
  await page.getByRole("button", { name: "Review collection", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("₦10.00");
  await page.getByRole("button", { name: "Confirm decision", exact: true }).click();
  await expect(page.getByText("Temporary operator API outage").last()).toBeVisible();

  // A retry without changing the request must keep the exact same key.
  await page.getByRole("button", { name: "Review collection", exact: true }).click();
  await page.getByRole("button", { name: "Confirm decision", exact: true }).click();
  await expect(page.getByText("Temporary operator API outage").last()).toBeVisible();

  // Changing the amount after failed attempts starts a new attempt and warns.
  await page.getByLabel("Amount to collect").fill("11.00");
  await page.getByRole("button", { name: "Review collection", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "new idempotency key" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review collection", exact: true }).click();
  await page.getByRole("button", { name: "Confirm decision", exact: true }).click();
  await expect(page.getByText("Funding review decision recorded")).toBeVisible();
  expect(collectionKeys).toHaveLength(3);
  expect(collectionKeys[0]).toBeTruthy();
  expect(collectionKeys[1]).toBe(collectionKeys[0]);
  expect(collectionKeys[2]).not.toBe(collectionKeys[0]);
  expect(collectionBodies[0]).toEqual(collectionBodies[1]);
  expect(collectionBodies[2]).toMatchObject({ amount: "11.00" });
});
