import { expect, test, type Page } from "@playwright/test";

const session = {
  access_token: "access-token-vtu-user",
  refresh_token: "refresh-token-vtu-user",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: "bearer",
  user: { id: "vtu-user", email: "vtu@trustpay.app", role: "USER" },
  authMode: "local" as const,
};

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

  const vtuRequests: string[] = [];
  await page.route("**/api/vtu/**", async (route) => {
    vtuRequests.push(route.request().url());
    await route.abort();
  });

  return { vtuRequests };
}

test("keeps authenticated VTU purchases in the mobile app", async ({
  page,
}) => {
  const harness = await installHarness(page);
  await page.goto("/dashboard/vtu", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/\/download$/);
  await expect(
    page.getByRole("heading", { name: "Download TrustPay" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Electricity/i }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Country")).toHaveCount(0);
  await expect(page.getByLabel("Transaction PIN")).toHaveCount(0);
  expect(harness.vtuRequests).toEqual([]);
});
