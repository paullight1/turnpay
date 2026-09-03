import { expect, test } from "@playwright/test";

const publicAuthForms = [
  { name: "login", path: "/login" },
  { name: "registration", path: "/register" },
  { name: "password recovery", path: "/forgot-password" },
  { name: "password reset", path: "/reset-password?code=e2e-recovery" },
] as const;

test.describe("public auth routes before hydration", () => {
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
