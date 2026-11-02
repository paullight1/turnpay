import { test, expect as baseExpect, type Page } from "@playwright/test";
test.setTimeout(120000);
const expect = baseExpect.configure({ timeout: 15000 });

test.use({ trace: "retain-on-failure" });
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && !page.isClosed()) {
    const state = await page
      .evaluate(() => ({
        auth: (window as Window & { __TRUSTPAY_AUTH_DEBUG__?: unknown })
          .__TRUSTPAY_AUTH_DEBUG__,
        pathname: window.location.pathname,
      }))
      .catch(() => null);
    await info.attach("auth-initialization", {
      body: JSON.stringify(state),
      contentType: "application/json",
    });
  }
});

const session = {
  access_token: "access-token-kyc-user",
  refresh_token: "refresh-token-kyc-user",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: "bearer",
  user: { id: "kyc-user", email: "kyc@example.test", role: "USER" },
  authMode: "local",
};
async function mocks(
  page: Page,
  tier = "TIER_0",
  bvn = "UNVERIFIED",
  nin = "",
  automatic = false,
  restricted = false,
) {
  let currentBvn = bvn;
  let currentNin = nin;
  await page.context().addCookies([
    {
      name: "supabase.auth.token",
      value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const user = {
    id: "kyc-user",
    email: "kyc@example.test",
    phone: "+2348012345678",
    fullName: "James Bond",
    role: "USER",
    isSuspended: restricted,
    kycStatus: tier === "TIER_0" ? "PENDING" : "VERIFIED",
    kycTier: tier,
  };
  await page.route("**/api/auth/session", (r) =>
    r.fulfill({
      json: {
        session: { ...session, refresh_token: "" },
        csrfToken: "kyc-csrf",
      },
    }),
  );
  await page.route("**/api/auth/bootstrap", (r) =>
    r.fulfill({ json: { user, wallets: [] } }),
  );
  await page.route("**/api/users/me", (r) => r.fulfill({ json: user }));
  await page.route("**/api/payments/banks*", (r) =>
    r.fulfill({ json: [{ code: "058", name: "Guaranty Trust Bank" }] }),
  );
  await page.route("**/api/kyc/status", (r) =>
    r.fulfill({
      json: {
        isSuspended: restricted,
        provider: "PAYSTACK",
        providerValidationStatus: currentBvn,
        kycStatus: user.kycStatus,
        kycTier: tier,
        ninVerificationAvailable: automatic,
        tierOneLimits: {
          currency: "NGN",
          perTransaction: "100.00",
          daily: "200.00",
          maxBalance: "300.00",
        },
        documents: [
          ...(currentBvn === "VERIFIED"
            ? [
                {
                  id: "bvn-1",
                  type: "BVN",
                  provider: "PAYSTACK",
                  status: "VERIFIED",
                  idNumber: "*******7777",
                },
              ]
            : []),
          ...(currentNin
            ? [
                {
                  id: "nin-1",
                  type: "NIN",
                  status: currentNin,
                  idNumber: "*******5555",
                },
              ]
            : []),
        ],
      },
    }),
  );
  return {
    setBvn: (status: string) => {
      currentBvn = status;
    },
    setNin: (status: string) => {
      currentNin = status;
    },
  };
}

test("starts with BVN and a quieter locked Tier 2 step", async ({ page }) => {
  await mocks(page);
  await page.goto("/dashboard/kyc");
  await expect(
    page.getByRole("heading", { name: "Activate your account" }),
  ).toBeVisible();
  await expect(
    page.getByText("Available after BVN verification"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Verify BVN", exact: true }).click();
  await expect(page.getByLabel("BVN", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Bank", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Date of birth", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "output/kyc-bvn-first-form.png",
    fullPage: true,
  });
});

test("Tier 1 is active without NIN and has an upgrade rather than a transaction block", async ({
  page,
}) => {
  await mocks(page, "TIER_1", "VERIFIED");
  await page.goto("/dashboard/kyc");
  await expect(
    page.getByRole("heading", { name: "Your account is active" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Transact within your Tier 1 limits. Add NIN when you’re ready to upgrade.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upgrade to Tier 2" }),
  ).toBeVisible();
  await expect(page.getByText("Withdrawals require Tier 2.")).toHaveCount(0);
  await page.screenshot({
    path: "output/kyc-bvn-first-tier-one.png",
    fullPage: true,
  });
});

test("a pending NIN keeps Tier 1 active and cannot be submitted twice", async ({
  page,
}) => {
  await mocks(page, "TIER_1", "VERIFIED", "SUBMITTED");
  await page.goto("/dashboard/kyc");
  await expect(
    page.getByRole("heading", { name: "Your account is active" }),
  ).toBeVisible();
  await expect(
    page.getByText("Your NIN is under review. Tier 1 stays active."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upgrade to Tier 2" }),
  ).toHaveCount(0);
});

test("pending BVN has a status action without another submission", async ({
  page,
}) => {
  await mocks(page, "TIER_0", "PENDING");
  await page.goto("/dashboard/kyc");
  await expect(
    page.getByRole("heading", { name: "We’re checking your BVN" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check status" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Verify BVN", exact: true }),
  ).toHaveCount(0);
});

test("automated NIN upgrade explains sharing and requires fresh consent", async ({
  page,
}) => {
  await mocks(page, "TIER_1", "VERIFIED", "", true);
  await page.goto("/dashboard/kyc");
  await page.getByRole("button", { name: "Upgrade to Tier 2" }).click();
  await expect(page.getByLabel("NIN", { exact: true })).toBeVisible();
  await expect(page.getByText(/shared securely with Ninja/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Verify NIN", exact: true }),
  ).toBeDisabled();
});

test("Tier 2 completion has no redundant upgrade or BVN submission", async ({
  page,
}) => {
  await mocks(page, "TIER_2", "VERIFIED", "VERIFIED");
  await page.goto("/dashboard/kyc");
  await expect(
    page.getByRole("heading", { name: "You’re fully verified" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upgrade to Tier 2" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Verify BVN", exact: true }),
  ).toHaveCount(0);
});

test("withdrawal gate gives a BVN-specific next action", async ({ page }) => {
  await mocks(page);
  await page.goto("/dashboard/withdraw");
  await expect(
    page.getByText("Verify BVN to continue", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Verify BVN", exact: true }),
  ).toBeVisible();
});

test("submits BVN with linked bank details, consent and a single idempotent attempt", async ({
  page,
}) => {
  const state = await mocks(page);
  let submitted: Record<string, unknown> | undefined;
  let key: string | undefined;
  await page.route("**/api/kyc/verify", async (route) => {
    submitted = route.request().postDataJSON();
    key = route.request().headers()["idempotency-key"];
    state.setBvn("PENDING");
    await route.fulfill({
      json: {
        id: "bvn-1",
        type: "BVN",
        status: "SUBMITTED",
        verificationStatus: "PENDING",
        provider: "PAYSTACK",
        reference: "test-bvn-ref",
        idNumber: "*******7777",
      },
    });
  });
  await page.goto("/dashboard/kyc");
  await page.getByRole("button", { name: "Verify BVN", exact: true }).click();
  await page.getByLabel("BVN", { exact: true }).fill("77777777777");
  await page.getByLabel("Date of birth", { exact: true }).fill("1975-01-01");
  await page.getByLabel("Bank", { exact: true }).selectOption("058");
  await page.getByLabel("Linked account number").fill("0123456789");
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await page.getByRole("button", { name: "Submit BVN", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "We’re checking your BVN" }),
  ).toBeVisible();
  expect(submitted).toMatchObject({
    type: "BVN",
    country: "NG",
    idNumber: "77777777777",
    accountNumber: "0123456789",
    bankCode: "058",
    dateOfBirth: "1975-01-01",
    consentAccepted: true,
    accountSetupConsent: true,
  });
  expect(key).toBeTruthy();
  await expect(
    page.getByRole("button", { name: "Submit BVN", exact: true }),
  ).toHaveCount(0);
});

test("a rejected automated NIN reports the real result and preserves Tier 1", async ({
  page,
}) => {
  const state = await mocks(page, "TIER_1", "VERIFIED", "", true);
  await page.route("**/api/kyc/verify", (route) => {
    state.setNin("REJECTED");
    return route.fulfill({
      json: {
        id: "nin-1",
        type: "NIN",
        status: "REJECTED",
        verificationStatus: "REJECTED",
        provider: "NINJA",
        reference: "test-nin-ref",
        idNumber: "*******7777",
      },
    });
  });
  await page.goto("/dashboard/kyc");
  await page.getByRole("button", { name: "Upgrade to Tier 2" }).click();
  await page.getByLabel("NIN", { exact: true }).fill("77777777777");
  await page.getByLabel("Date of birth", { exact: true }).fill("1975-01-01");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Verify NIN", exact: true }).click();
  await expect(
    page.getByText(
      "Your NIN could not be matched. Review your details or contact support. Tier 1 stays active.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your account is active" }),
  ).toBeVisible();
});

test("account restriction takes precedence over a verified tier", async ({
  page,
}) => {
  await mocks(page, "TIER_1", "VERIFIED", "", false, true);
  await page.goto("/dashboard/kyc");
  await expect(
    page.getByRole("heading", { name: "Your account is under review" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Contact support" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upgrade to Tier 2" }),
  ).toHaveCount(0);
});
