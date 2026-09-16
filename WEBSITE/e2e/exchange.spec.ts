import { expect, test, type BrowserContext } from "@playwright/test";

type CustomerSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: "bearer";
  user: {
    id: string;
    email: string;
    role: "USER";
  };
  authMode: "local";
};

function buildCustomerSession(): CustomerSession {
  const expiresIn = 60 * 60;
  const email = "customer.exchange-policy@trustpay.app";

  return {
    access_token: `access-token-${email}`,
    refresh_token: `refresh-token-${email}`,
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    token_type: "bearer",
    user: {
      id: "customer-123",
      email,
      role: "USER",
    },
    authMode: "local",
  };
}

function encodeSessionCookie(session: CustomerSession) {
  return `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
}

async function installVerifiedCustomerSession(
  context: BrowserContext,
  baseURL: string | undefined,
) {
  if (!baseURL) {
    throw new Error("Playwright baseURL is required for customer policy tests");
  }

  const session = buildCustomerSession();
  await context.addCookies([
    {
      name: "supabase.auth.token",
      value: encodeSessionCookie(session),
      url: new URL("/", baseURL).toString(),
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test.describe("Customer web exchange policy", () => {
  test("redirects an authenticated customer to the mobile app without executing exchange", async ({
    browser,
    baseURL,
  }) => {
    // Use a clean context instead of the shared E2E fixture context so this
    // test exercises the real customer-token verification path, not the local
    // protected-route bypass used by admin UI tests.
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const exchangeRequests: string[] = [];

    await page.route("**/api/exchange/**", async (route) => {
      exchangeRequests.push(route.request().url());
      await route.abort();
    });

    try {
      await installVerifiedCustomerSession(context, baseURL);

      await page.goto("/dashboard/exchange", { waitUntil: "domcontentloaded" });

      await expect(page).toHaveURL(/\/download$/);
      await expect(
        page.getByRole("heading", { name: "Download TrustPay" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: /Currency Exchange/i }),
      ).toHaveCount(0);
      expect(exchangeRequests).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
