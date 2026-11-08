import { expect, test } from "@playwright/test";

const publicAuthForms = [
  { name: "login", path: "/login" },
  { name: "registration", path: "/register" },
  { name: "password recovery", path: "/forgot-password" },
  { name: "password reset", path: "/reset-password?code=e2e-recovery" },
] as const;

test.describe("public auth routes before hydration", () => {
  test("unconfigured recovery shows a safe error without rendering a framework crash", async ({ page }) => {
    test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_SERVER_URL), "Missing-configuration regression requires the local test server");
    await page.goto("/reset-password?code=e2e-recovery");
    await expect(page.getByText("Set a new password", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Password recovery is currently unavailable" })).toHaveText(
      "Password recovery is currently unavailable. Please contact support.",
    );
    await expect(page.locator("form")).toHaveCount(0);
  });
  for (const authForm of publicAuthForms) {
    test(`${authForm.name} exposes no active controls without client JavaScript`, async ({
      page,
    }) => {
      await page.route("**/*.js", (route) => route.abort());
      const response = await page.goto(authForm.path, {
        waitUntil: "domcontentloaded",
      });

      expect(response?.ok()).toBe(true);
      await expect(
        page.locator("form input:enabled, form button:enabled"),
      ).toHaveCount(0);
    });
  }
});
