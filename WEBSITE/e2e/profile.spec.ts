import { expect, test, type Page } from "@playwright/test";

const TEST_USER = {
  email: process.env.TEST_USER_EMAIL || "test@trustpay.app",
  password: process.env.TEST_USER_PASSWORD || "testpassword123",
  pin: process.env.TEST_USER_PIN || "123456",
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

type TestAuthSession = {
  id: string;
  deviceId: string;
  deviceName: string;
  userAgent: string;
  ipAddress: string;
  lastUsedAt: string;
  expiresAt: string;
  createdAt: string;
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
  const { refresh_token: _refreshToken, ...clientSession } = session;
  return {
    ...clientSession,
    refresh_token: "",
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

function buildAuthSessions(): TestAuthSession[] {
  return [
    {
      id: "session-1",
      deviceId: "Unknown device",
      deviceName: "Chrome on macOS",
      userAgent: "Mozilla/5.0",
      ipAddress: "127.0.0.1",
      lastUsedAt: "2026-06-22T12:00:00.000Z",
      expiresAt: "2026-07-01T12:00:00.000Z",
      createdAt: "2026-06-20T12:00:00.000Z",
    },
  ];
}

function encodeSessionCookie(session: TestSession) {
  return `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
}

async function installProfileMocks(page: Page, email: string) {
  const session = buildSession(email);
  const clientSession = toClientSession(session);
  const profile = buildProfile(email);
  const sessions = buildAuthSessions();
  const csrfToken = "csrf-token-123";

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
      status: 200,
      json: {
        success: true,
        session: clientSession,
        csrfToken,
      },
    });
  });

  await page.route("**/api/auth/refresh", async (route) => {
    await route.fulfill({
      status: 200,
      json: { session },
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

    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        json: { sessions },
      });
      return;
    }

    await route.fulfill({
      status: 405,
      json: { message: "Method not allowed" },
    });
  });

  await page.route("**/api/auth/sessions/*", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.access_token}`,
    );

    if (route.request().method() === "DELETE") {
      const sessionId = route.request().url().split("/").pop();
      const index = sessions.findIndex((entry) => entry.id === sessionId);
      if (index >= 0) {
        sessions.splice(index, 1);
      }

      await route.fulfill({
        status: 200,
        json: { revoked: true },
      });
      return;
    }

    await route.fulfill({
      status: 405,
      json: { message: "Method not allowed" },
    });
  });

  await page.route("**/api/auth/change-password", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.access_token}`,
    );

    await route.fulfill({
      status: 200,
      json: { success: true },
    });
  });

  await page.route("**/api/auth/logout", async (route) => {
    await route.fulfill({
      status: 200,
      json: { success: true },
    });
  });
}

test.describe("TrustPay Profile", () => {
  test.beforeEach(async ({ page }) => {
    await installProfileMocks(page, TEST_USER.email);

    const seededSession = buildSession(TEST_USER.email);
    const cookieValue = encodeSessionCookie(seededSession);

    await page.context().addCookies([
      {
        name: "supabase.auth.token",
        value: cookieValue,
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
  });

  test("should render profile details and active sessions", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /^Profile$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Toggle color theme/i })).toBeVisible();
    await expect(page.getByRole("navigation", { name: /Dashboard navigation/i })).toBeVisible();
    await expect(
      page.locator('[data-slot="card-title"]').filter({ hasText: /^Account Information$/i }),
    ).toBeVisible();
    await expect(page.getByText(TEST_USER.email)).toBeVisible();
    await expect(page.getByText(/\+2348012345678/)).toBeVisible();
    await expect(
      page.locator('[data-slot="card-title"]').filter({ hasText: /^Change Password$/i }),
    ).toBeVisible();
    await expect(
      page.locator('[data-slot="card-title"]').filter({ hasText: /^Active Sessions$/i }),
    ).toBeVisible();
    await expect(page.getByText(/1 session\(s\) active/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /refresh sessions/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
  });

  test("should revoke an active session", async ({ page }) => {
    await expect(page.getByText(/1 session\(s\) active/i)).toBeVisible({
      timeout: 10000,
    });

    await page.getByRole("button", { name: /^Revoke$/i }).click();

    await expect(page.getByText(/0 session\(s\) active/i)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(/No active sessions found\./i)).toBeVisible();
  });
});
