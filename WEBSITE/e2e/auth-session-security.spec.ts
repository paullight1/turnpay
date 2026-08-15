import { expect, test, type Page } from "@playwright/test";

const TEST_USER = {
  email: process.env.TEST_USER_EMAIL || "test@trustpay.app",
  password: process.env.TEST_USER_PASSWORD || "testpassword123",
};

type TestSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
  authMode: "local";
};

type ClientSession = Omit<TestSession, "refresh_token"> & {
  refresh_token: "";
};

type TestProfile = {
  id: string;
  email: string;
  phone: string;
  role: string;
  kycStatus: string;
};

function buildSession(email: string): TestSession {
  const expiresIn = 60 * 60;

  return {
    access_token: `access-token-${email}`,
    refresh_token: `refresh-token-${email}`,
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    token_type: "bearer",
    user: {
      id: "user-123",
      email,
      role: "USER",
    },
    authMode: "local",
  };
}

function toClientSession(session: TestSession): ClientSession {
  return {
    ...session,
    refresh_token: "" as const,
  };
}

function buildProfile(email: string): TestProfile {
  return {
    id: "user-123",
    email,
    phone: "+2348012345678",
    role: "USER",
    kycStatus: "VERIFIED",
  };
}

function encodeSessionCookie(session: TestSession) {
  return `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
}

async function readStoredSession(page: Page) {
  return page.evaluate(() => window.localStorage.getItem("trustpay.auth.session"));
}

async function installAuthSessionMocks(page: Page, email: string) {
  const session = buildSession(email);
  const clientSession = toClientSession(session);
  const profile = buildProfile(email);
  const csrfToken = "csrf-token-123";

  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        user: profile,
        session,
        authMode: "local",
      },
    });
  });

  await page.route("**/api/auth/bootstrap", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.access_token}`,
    );

    await route.fulfill({
      status: 200,
      json: {
        user: profile,
        wallets: [],
      },
    });
  });

  await page.route("**/api/auth/session", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        headers: {
          "set-cookie": `supabase.auth.token=${encodeSessionCookie(session)}; Path=/; HttpOnly; SameSite=Lax`,
        },
        json: {
          success: true,
          session: clientSession,
          csrfToken,
        },
      });
      return;
    }

    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        json: {
          session: clientSession,
          csrfToken,
        },
      });
      return;
    }

    if (route.request().method() === "DELETE") {
      expect(route.request().headers()["x-csrf-token"]).toBe(csrfToken);

      await route.fulfill({
        status: 200,
        json: { success: true },
      });
      return;
    }

    await route.fulfill({
      status: 405,
      json: { message: "Method not allowed" },
    });
  });

  await page.route("**/api/auth/logout", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.access_token}`,
    );

    await route.fulfill({
      status: 200,
      json: { success: true },
    });
  });

  await page.route("**/api/users/me", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.access_token}`,
    );

    await route.fulfill({
      status: 200,
      json: profile,
    });
  });

  await page.route("**/api/auth/sessions", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.access_token}`,
    );

    await route.fulfill({
      status: 200,
      json: { sessions: [] },
    });
  });

  return { session };
}

test.describe("web session hardening", () => {
  test("does not persist auth tokens in localStorage after login", async ({
    page,
  }) => {
    await installAuthSessionMocks(page, TEST_USER.email);

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(TEST_USER.email);
    await page.getByLabel(/^password$/i).fill(TEST_USER.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect.poll(() => readStoredSession(page)).toBeNull();

    const visibleCookies = await page.evaluate(() => document.cookie);
    expect(visibleCookies).not.toContain("supabase.auth.token");
  });

  test("bootstraps from the HttpOnly session route without localStorage tokens", async ({
    page,
    context,
  }) => {
    const { session } = await installAuthSessionMocks(page, TEST_USER.email);

    await context.addCookies([
      {
        name: "supabase.auth.token",
        value: encodeSessionCookie(session),
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/dashboard/profile");
    await expect(page.getByRole("heading", { name: /^Profile$/i })).toBeVisible({
      timeout: 15000,
    });
    await expect.poll(() => readStoredSession(page)).toBeNull();

    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
