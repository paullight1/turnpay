import { expect, test, type Page, type Route } from "@playwright/test";

const session = {
  access_token: "access-token-vtu-user",
  refresh_token: "refresh-token-vtu-user",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: "bearer",
  user: { id: "vtu-user", email: "vtu@trustpay.app", role: "USER" },
  authMode: "local" as const,
};

const profile = {
  id: "vtu-user",
  email: "vtu@trustpay.app",
  phone: "+2348012345678",
  fullName: "VTU User",
  role: "USER" as const,
  kycStatus: "VERIFIED" as const,
  kycTier: "TIER_2",
  isSuspended: false as const,
};

function body<T>(route: Route): T {
  const value = route.request().postData();
  if (!value) throw new Error("Expected a JSON request body");
  return JSON.parse(value) as T;
}

function encodedSessionCookie() {
  return `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
}

async function installHarness(page: Page) {
  await page.context().addCookies([
    {
      name: "supabase.auth.token",
      value: encodedSessionCookie(),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  const purchaseRequests: Array<Record<string, unknown>> = [];
  const validationKeys: string[] = [];
  const purchaseKeys: string[] = [];

  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      json: {
        session: { ...session, refresh_token: "" },
        csrfToken: "csrf-vtu",
      },
    }),
  );
  await page.route("**/api/auth/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      json: {
        user: profile,
        wallets: [{ id: "wallet-ngn", currency: "NGN", balance: "250000.00" }],
      },
    }),
  );
  await page.route("**/api/wallets", (route) =>
    route.fulfill({
      status: 200,
      json: [{ id: "wallet-ngn", currency: "NGN", balance: "250000.00" }],
    }),
  );
  await page.route("**/api/auth/transaction-pin/status", (route) =>
    route.fulfill({
      status: 200,
      json: { configured: true, locked: false, holdUntil: null },
    }),
  );
  await page.route("**/api/vtu/providers*", async (route) => {
    const type = new URL(route.request().url()).searchParams.get("type");
    const provider =
      type === "electricity"
        ? { id: "ikedc", name: "Ikeja Electric", type, isActive: true }
        : { id: "mtn", name: "MTN", type, isActive: true };
    await route.fulfill({ status: 200, json: [provider] });
  });
  await page.route("**/api/vtu/validate/meter", async (route) => {
    validationKeys.push(route.request().headers()["idempotency-key"]);
    expect(body(route)).toEqual({
      provider: "ikedc",
      meterNumber: "45028701",
      meterType: "postpaid",
      contactPhone: "08012345678",
    });
    await route.fulfill({
      status: 200,
      json: { name: "ADA OBI", address: "12 Allen Avenue, Ikeja" },
    });
  });
  await page.route("**/api/vtu/purchase", async (route) => {
    purchaseKeys.push(route.request().headers()["idempotency-key"]);
    purchaseRequests.push(body(route));
    await route.fulfill({
      status: 201,
      json: {
        success: true,
        status: "SUCCESS",
        reference: "VTU-1",
        orderId: "order-1",
        message: "Token generated",
        amount: "5000",
        fee: "25",
        totalDebit: "5025",
        purchasedCode: "1234-5678-9012",
      },
    });
  });

  return { purchaseRequests, validationKeys, purchaseKeys };
}

test("shows future markets and completes an idempotent electricity purchase", async ({
  page,
}) => {
  const harness = await installHarness(page);
  await page.goto("/dashboard/vtu");

  await page.getByLabel("Country").click();
  await expect(
    page.getByRole("option", { name: /Ghana.*Coming soon/ }),
  ).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: /Electricity/ }).click();
  await page.getByLabel("VTpass provider").click();
  await page.getByRole("option", { name: "Ikeja Electric" }).click();
  await page.getByLabel("Contact phone number").fill("08012345678");
  await page.getByLabel("Meter type").click();
  await page.getByRole("option", { name: "Postpaid" }).click();
  await page.getByLabel("Meter number").fill("45028701");
  await page.getByRole("button", { name: "Verify customer" }).click();
  await expect(page.getByText("ADA OBI")).toBeVisible();
  await page.getByLabel("Amount (₦)").fill("5000");
  await page.getByLabel("Transaction PIN").fill("1234");
  await page.getByRole("button", { name: "Review Electricity" }).click();
  await page.getByRole("button", { name: "Confirm Electricity" }).click();

  await expect(page.getByText("1234-5678-9012")).toBeVisible();
  expect(harness.validationKeys[0]).toBeTruthy();
  expect(harness.purchaseKeys[0]).toBeTruthy();
  expect(harness.purchaseRequests[0]).toEqual({
    type: "electricity",
    provider: "ikedc",
    contactPhone: "08012345678",
    amount: "5000",
    meterNumber: "45028701",
    meterType: "postpaid",
    transactionPin: "1234",
  });
});
