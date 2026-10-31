import { expect, test, type Page } from "@playwright/test";

const accessToken = "access-token-kyc-user";
const session = {
  access_token: accessToken,
  refresh_token: "refresh-token-kyc-user",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: "bearer",
  user: { id: "user-kyc", email: "kyc@trustpay.app", role: "USER" },
  authMode: "local",
};

type KycOverviewFixture = {
  provider: string;
  kycStatus: string;
  kycTier: string;
  latestVerification?: {
    provider: string;
    status: string;
    reference: string;
    errorMessage?: string;
  } | null;
  documents: Array<{
    id: string;
    type: string;
    idNumber: string;
    status: string;
  }>;
};

function encodeSessionCookie() {
  return `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
}

async function installKycMocks(page: Page, overview: KycOverviewFixture) {
  await page.context().addCookies([
    {
      name: "supabase.auth.token",
      value: encodeSessionCookie(),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      json: {
        session: { ...session, refresh_token: "" },
        csrfToken: "csrf-token-kyc",
      },
    }),
  );
  await page.route("**/api/auth/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      json: {
        user: {
          id: "user-kyc",
          email: "kyc@trustpay.app",
          phone: "+2348012345678",
          fullName: "James Bond",
          role: "USER",
          kycStatus: overview.kycStatus,
          kycTier: overview.kycTier,
        },
        wallets: [],
      },
    }),
  );
  await page.route("**/api/kyc/status", (route) =>
    route.fulfill({ status: 200, json: overview }),
  );
}

const emptyOverview: KycOverviewFixture = {
  provider: "MONNIFY",
  kycStatus: "PENDING",
  kycTier: "TIER_0",
  latestVerification: null,
  documents: [],
};

test.describe("Monnify KYC", () => {
  test("shows a Nigeria-only form, useful empty state, and submits exact DOB", async ({
    page,
  }) => {
    await installKycMocks(page, emptyOverview);
    let submittedBody: Record<string, unknown> | undefined;
    let idempotencyKey: string | undefined;
    await page.route("**/api/kyc/verify", async (route) => {
      submittedBody = route.request().postDataJSON();
      idempotencyKey = route.request().headers()["idempotency-key"];
      await route.fulfill({
        status: 200,
        json: {
          id: "document-1",
          type: "NIN",
          idNumber: "*******7777",
          status: "VERIFIED",
          verificationStatus: "VERIFIED",
          provider: "MONNIFY",
          reference: "document-1",
        },
      });
    });

    await page.goto("/dashboard/kyc");

    await expect(
      page.getByRole("heading", { name: "Identity verification" }),
    ).toBeVisible();
    await expect(page.getByText("Nigeria", { exact: true })).toBeVisible();
    await expect(page.getByText("Ghana", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "BVN", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "NIN", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Date of birth")).toBeVisible();
    await expect(
      page.getByText(/prepare my NGN account automatically/i),
    ).toBeVisible();
    await expect(page.getByText("No identity checks yet.")).toBeVisible();
    await expect(
      page.getByText(/Choose BVN or NIN above to begin/i),
    ).toBeVisible();

    await page.getByRole("button", { name: "NIN", exact: true }).click();
    await page.getByLabel("Identity number").fill("77777777777");
    await page.getByLabel("Date of birth").fill("1975-01-01");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Submit and prepare account" }).click();

    await expect
      .poll(() => submittedBody)
      .toEqual({
        country: "NG",
        type: "NIN",
        idNumber: "77777777777",
        dateOfBirth: "1975-01-01",
        consentAccepted: true,
      });
    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
  });

  for (const [status, message] of [
    ["REVIEW_REQUIRED", "Your identity check needs a manual review."],
    ["REJECTED", "We could not match those identity details."],
    ["FAILED", "The identity service could not complete your check."],
  ] as const) {
    test(`renders the ${status} recovery state`, async ({ page }) => {
      await installKycMocks(page, {
        provider: "MONNIFY",
        kycStatus: status === "REVIEW_REQUIRED" ? "SUBMITTED" : "REJECTED",
        kycTier: "TIER_0",
        latestVerification: {
          provider: "MONNIFY",
          status,
          reference: "document-state",
          errorMessage:
            status === "FAILED" ? "Provider unavailable" : undefined,
        },
        documents: [
          {
            id: "document-state",
            type: "BVN",
            idNumber: "*******7777",
            status,
          },
        ],
      });

      await page.goto("/dashboard/kyc");

      await expect(page.getByText(message)).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Verify (BVN|NIN)/ }),
      ).toBeVisible();
    });
  }

  test("renders a quiet completion state at Tier 2", async ({ page }) => {
    await installKycMocks(page, {
      provider: "MONNIFY",
      kycStatus: "VERIFIED",
      kycTier: "TIER_2",
      latestVerification: {
        provider: "MONNIFY",
        status: "VERIFIED",
        reference: "document-nin",
      },
      documents: [
        {
          id: "document-bvn",
          type: "BVN",
          idNumber: "*******1111",
          status: "VERIFIED",
        },
        {
          id: "document-nin",
          type: "NIN",
          idNumber: "*******2222",
          status: "VERIFIED",
        },
      ],
    });

    await page.goto("/dashboard/kyc");

    await expect(
      page.getByText("Identity verification complete"),
    ).toBeVisible();
    await expect(page.getByLabel("Identity number")).toHaveCount(0);
    await expect(page.getByText("*******1111")).toBeVisible();
    await expect(page.getByText("*******2222")).toBeVisible();
  });
});
