import { expect, test } from "@playwright/test";

const publicAuthForms = [
  { name: "login", path: "/login" },
  { name: "registration", path: "/register" },
  { name: "password recovery", path: "/forgot-password" },
  { name: "password reset", path: "/reset-password?code=e2e-recovery" },
] as const;

test.describe("public auth forms before hydration", () => {
  for (const authForm of publicAuthForms) {
    test(`${authForm.name} keeps controls inert without client JavaScript`, async ({
      page,
    }) => {
      await page.route("**/*.js", (route) => route.abort());
      await page.goto(authForm.path, { waitUntil: "domcontentloaded" });

      const form = page.locator("form");
      await expect(form).toBeVisible();

      const controls = form.locator("input, button");
      expect(await controls.count()).toBeGreaterThan(0);
      for (const control of await controls.all()) {
        await expect(control).toBeDisabled();
      }
    });
  }
});
