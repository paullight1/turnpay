import { expect, test } from "@playwright/test";
import type { PaystackAdverseFundingCase } from "@/services/api";

test.setTimeout(120000);

const caseId = "11111111-1111-4111-8111-111111111111";
const transactionId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

test("funding review can safely recheck an unmatched case", async ({
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

  await page.context().addCookies([
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

  const adverseCase: PaystackAdverseFundingCase = {
    id: caseId,
    provider: "PAYSTACK",
    eventType: "refund.processed",
    providerReference: "refund-delivery-001",
    economicReference: null,
    fundingReference: "fund-checkout-001",
    transactionId: null,
    userId: null,
    currency: null,
    exposureAmount: null,
    recoveredAmount: "0.00",
    status: "UNDER_REVIEW",
    verificationStatus: "UNMATCHED",
    holdRequired: true,
    providerStatus: "processed",
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: iso(-60_000),
    updatedAt: iso(-30_000),
  };

  let failedAttempts = 0;
  const recheckKeys: string[] = [];
  const recheckBodies: Array<Record<string, unknown>> = [];
  let resolveCount = 0;

  await page.route(
    "**/api/admin/payments/adverse-funding/cases**",
    async (route) => {
      await route.fulfill({ json: [adverseCase] });
    },
  );
  await page.route("**/api/admin/audit-logs**", async (route) => {
    await route.fulfill({
      json: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          adminId: null,
          action: "PAYSTACK_ADVERSE_FUNDING_REVIEW_REQUIRED",
          targetType: "FundingAdverseCase",
          targetId: caseId,
          reason:
            "Original funding was not present when the signed event arrived",
          createdAt: iso(-45_000),
        },
      ],
    });
  });
  await page.route(
    `**/api/admin/payments/adverse-funding/cases/${caseId}/recheck`,
    async (route) => {
      recheckKeys.push(route.request().headers()["idempotency-key"] ?? "");
      recheckBodies.push(
        route.request().postDataJSON() as Record<string, unknown>,
      );
      if (failedAttempts < 2) {
        failedAttempts += 1;
        await route.fulfill({
          status: 503,
          json: { message: "Temporary operator API outage" },
        });
        return;
      }
      adverseCase.status = "OPEN";
      adverseCase.verificationStatus = "VERIFIED";
      adverseCase.transactionId = transactionId;
      adverseCase.userId = userId;
      adverseCase.currency = "NGN";
      adverseCase.economicReference = "refund:9001";
      adverseCase.exposureAmount = "100.00";
      adverseCase.updatedAt = iso();
      await route.fulfill({
        json: {
          caseId,
          status: "OPEN",
          holdRequired: true,
          exposureAmount: "100.00",
          reviewRequired: false,
          rechecked: true,
        },
      });
    },
  );
  await page.route(
    `**/api/admin/payments/adverse-funding/cases/${caseId}/resolve`,
    async (route) => {
      resolveCount += 1;
      await route.fulfill({
        status: 500,
        json: { message: "Unexpected debit" },
      });
    },
  );

  await page.goto("/admin/payments/adverse-funding", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "Funding review", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    page.getByText("Provider recheck", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Recheck reason")
    .fill("The original Paystack credit is now visible in the funding ledger");
  await page
    .getByRole("button", { name: "Recheck provider", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "stored signed event",
  );
  await page
    .getByRole("button", { name: "Confirm recheck", exact: true })
    .click();
  await expect(
    page.getByText("Temporary operator API outage").last(),
  ).toBeVisible();

  // A retry without changing the reason keeps the exact same idempotency key.
  await page
    .getByRole("button", { name: "Recheck provider", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm recheck", exact: true })
    .click();
  await expect(
    page.getByText("Temporary operator API outage").last(),
  ).toBeVisible();

  // Changing the reason starts a new attempt and warns the operator.
  await page
    .getByLabel("Recheck reason")
    .fill("The provider statement was corrected and needs a fresh correlation");
  await page
    .getByRole("button", { name: "Recheck provider", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "new idempotency key" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Recheck provider", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm recheck", exact: true })
    .click();
  await expect(page.getByText("Provider recheck completed")).toBeVisible();

  expect(recheckKeys).toHaveLength(3);
  expect(recheckKeys[0]).toBeTruthy();
  expect(recheckKeys[1]).toBe(recheckKeys[0]);
  expect(recheckKeys[2]).not.toBe(recheckKeys[0]);
  expect(recheckBodies[0]).toEqual({
    reason: "The original Paystack credit is now visible in the funding ledger",
  });
  expect(recheckBodies[1]).toEqual(recheckBodies[0]);
  expect(recheckBodies[2]).toEqual({
    reason:
      "The provider statement was corrected and needs a fresh correlation",
  });
  expect(resolveCount).toBe(0);
});
