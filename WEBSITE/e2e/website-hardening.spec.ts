import { expect, test } from "@playwright/test";
import { canonicalizeMoneyAmount } from "../src/lib/money";
import {
  DEFAULT_API_ORIGIN,
  resolveApiOrigin,
} from "../src/lib/api-origin";

test.describe("website hardening contracts", () => {
  test("canonicalizes withdrawal amounts without binary rounding", () => {
    expect(canonicalizeMoneyAmount("001.2")).toBe("1.20");
    expect(canonicalizeMoneyAmount("0.5")).toBe("0.50");
    expect(canonicalizeMoneyAmount("1000000000.99")).toBe("1000000000.99");
    expect(canonicalizeMoneyAmount("1e3")).toBeNull();
    expect(canonicalizeMoneyAmount("0.00")).toBeNull();
    expect(canonicalizeMoneyAmount("10000000000")).toBeNull();
  });

  test("rejects non-HTTPS production API origins before requests", () => {
    expect(() =>
      resolveApiOrigin("http://api.example.test", { production: true }),
    ).toThrow(/HTTPS/);
    expect(
      resolveApiOrigin("http://127.0.0.1:33100", { production: true }),
    ).toBe("http://127.0.0.1:33100");
    expect(resolveApiOrigin("", { production: true })).toBe(
      DEFAULT_API_ORIGIN,
    );
  });

  test("serves a fresh CSP script nonce for each page response", async ({
    request,
  }) => {
    const first = await request.get("/");
    expect(first.ok()).toBe(true);
    const firstPolicy = first.headers()["content-security-policy"];
    const firstNonce = firstPolicy?.match(/script-src[^;]*'nonce-([^']+)'/)?.[1];
    expect(firstNonce).toBeTruthy();
    expect(firstPolicy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(await first.text()).toContain(`nonce="${firstNonce}"`);

    const second = await request.get("/");
    const secondPolicy = second.headers()["content-security-policy"];
    const secondNonce = secondPolicy?.match(
      /script-src[^;]*'nonce-([^']+)'/,
    )?.[1];
    expect(secondNonce).toBeTruthy();
    expect(secondNonce).not.toBe(firstNonce);
  });

  test("keeps logout visible and retryable when cookie cleanup fails", async ({
    page,
  }) => {
    const session = {
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 900,
      expires_in: 900,
      token_type: "bearer",
      authMode: "local",
      user: {
        id: "synthetic-admin",
        email: "admin@trustpayhq.com",
        role: "ADMIN",
      },
    };
    let deleteAttempts = 0;
    let deleted = false;

    await page.route("**/api/auth/session", async (route) => {
      const method = route.request().method();
      if (method === "DELETE") {
        deleteAttempts += 1;
        if (deleteAttempts === 1) {
          await route.fulfill({
            status: 503,
            json: { message: "temporary cleanup failure" },
          });
          return;
        }
        deleted = true;
        await route.fulfill({ status: 200, json: { success: true } });
        return;
      }

      await route.fulfill({
        status: 200,
        json: {
          session: deleted ? null : session,
          csrfToken: "synthetic-csrf",
        },
      });
    });
    await page.route("**/api/auth/bootstrap", (route) =>
      route.fulfill({ json: { user: session.user, wallets: [] } }),
    );
    await page.route("**/api/auth/logout", (route) =>
      route.fulfill({ status: 200, json: { success: true } }),
    );

    await page.goto("/staff");
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "secure sign out" }),
    ).toBeVisible();
    expect(deleteAttempts).toBe(1);

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Sign in to admin", exact: true }),
    ).toBeVisible();
    expect(deleteAttempts).toBe(2);
  });
});
