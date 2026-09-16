import { test, expect } from "@playwright/test";
import { POST } from "../src/app/api/auth/session/route";
import { proxy } from "../src/proxy";
import { NextRequest } from "next/server";

for (const path of [
  "/dashboard",
  "/dashboard/fund",
  "/dashboard/send",
  "/dashboard/withdraw",
  "/dashboard/exchange",
  "/dashboard/vtu",
  "/dashboard/kyc",
  "/dashboard/profile",
]) {
  test(`staff cannot enter customer workspace ${path}`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      Response.json({ user: { role: "ADMIN" } });
    try {
      const value = `base64-${Buffer.from(JSON.stringify({ access_token: "synthetic-access" })).toString("base64url")}`;
      const response = await proxy(
        new NextRequest(`http://localhost:3001${path}`, {
          headers: { cookie: `supabase.auth.token=${value}` },
        }),
      );
      expect(response.headers.get("location")).toBe(
        "http://localhost:3001/admin",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("customer accounts are sent to the mobile app download page", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ user: { role: "USER", canAccessAdmin: false } });
  try {
    const value = `base64-${Buffer.from(JSON.stringify({ access_token: "synthetic-access" })).toString("base64url")}`;
    const response = await proxy(
      new NextRequest("http://localhost:3001/dashboard", {
        headers: { cookie: `supabase.auth.token=${value}` },
      }),
    );
    expect(response.headers.get("location")).toBe('http://localhost:3001/download');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("running session route accepts fractional TTL before rejecting an invalid token", async ({
  request,
}) => {
  const response = await request.post("/api/auth/session", {
    data: {
      session: {
        access_token: "synthetic-invalid-access",
        refresh_token: "synthetic-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 900,
        expires_in: 899.437,
        token_type: "bearer",
        user: { id: "synthetic" },
      },
    },
  });
  expect(response.status()).toBe(401);
  expect(response.headers()["set-cookie"]).toContain('Max-Age=0');
});

test("secure session rejects cross-origin submission before token verification", async () => {
  const response = await POST(
    new Request("http://localhost:3001/api/auth/session", {
      method: "POST",
      headers: {
        "Sec-Fetch-Site": "cross-site",
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
  );
  expect(response.status).toBe(403);
  expect(response.headers.get("set-cookie")).toBeNull();
});

test("session handoff accepts fractional Supabase TTL and verifies the token", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return Response.json({ user: { id: "synthetic-staff", role: "ADMIN" } });
  };
  try {
    const response = await POST(
      new Request("http://localhost:3001/api/auth/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify({
          session: {
            access_token: "synthetic-access",
            refresh_token: "synthetic-refresh",
            expires_at: Math.floor(Date.now() / 1000) + 900,
            expires_in: 899.437,
            token_type: "bearer",
            user: { id: "synthetic-staff" },
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(calls.length).toBeGreaterThan(0);
    const data = await response.json();
    expect(Number.isInteger(data.session.expires_in)).toBe(true);
    expect(data.session.refresh_token).toBe("");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed secure persistence cannot expose an authenticated admin profile", async ({
  page,
}) => {
  const user = {
    id: "synthetic-staff",
    email: "staff-test@trustpayhq.com",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: new Date().toISOString(),
  };
  const part = (data: object) =>
    Buffer.from(JSON.stringify(data)).toString("base64url");
  const token = `${part({ alg: "HS256" })}.${part({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 900 })}.${Buffer.alloc(32).toString("base64url")}`;
  await page.route("**/auth/v1/user", (route) => route.fulfill({ json: user }));
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      json: {
        authMode: "supabase",
        user,
        session: {
          access_token: token,
          refresh_token: "synthetic-refresh",
          expires_at: Math.floor(Date.now() / 1000) + 900,
          expires_in: 900,
          token_type: "bearer",
          user,
        },
      },
    }),
  );
  await page.route("**/api/auth/bootstrap", (route) =>
    route.fulfill({
      json: {
        user: { ...user, role: "USER", canAccessAdmin: true },
        wallets: [],
      },
    }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill(
      route.request().method() === "POST"
        ? { status: 400, json: { message: "Invalid auth session payload" } }
        : { json: { session: null, csrfToken: "synthetic-csrf" } },
    ),
  );
  await page.goto("/staff");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("SyntheticPassword123");
  await page
    .getByRole("button", { name: "Sign in to admin", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "secure session" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open admin panel" }),
  ).toHaveCount(0);
});

test("authenticated staff screen offers account actions without another login form", async ({
  page,
}) => {
  const user = {
    id: "synthetic-staff",
    email: "staff-test@trustpayhq.com",
    role: "ADMIN",
    canAccessAdmin: true,
  };
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        session: {
          access_token: "synthetic",
          refresh_token: "",
          expires_at: Math.floor(Date.now() / 1000) + 900,
          expires_in: 900,
          token_type: "bearer",
          user,
        },
        csrfToken: "synthetic-csrf",
      },
    }),
  );
  await page.route("**/api/auth/bootstrap", (route) =>
    route.fulfill({ json: { user, wallets: [] } }),
  );
  await page.goto("/staff");
  await expect(
    page.getByRole("link", { name: "Open admin panel" }),
  ).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  // A refreshed raw session has no backend capability. Keep the verified
  // screen mounted until the replacement bootstrap completes.
  let releaseBootstrap!: () => void;
  const pendingBootstrap = new Promise<void>(resolve => { releaseBootstrap = resolve; });
  await page.route("**/api/auth/bootstrap", async route => {
    await pendingBootstrap;
    await route.fulfill({ json: { user, wallets: [] } });
  });
  await page.evaluate(rawUser => window.dispatchEvent(new CustomEvent('trustpay-auth-session-updated', {
    detail: { access_token: 'synthetic-refreshed', refresh_token: '', expires_at: Math.floor(Date.now()/1000)+900, expires_in: 900, token_type: 'bearer', user: rawUser },
  })), { id: user.id, email: user.email, role: 'USER' });
  try {
    await expect(page.getByRole('link', { name: 'Open admin panel' })).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  } finally {
    releaseBootstrap();
  }
});

test("server admin gate sends the required idempotency key when verifying staff", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) =>
    new Headers(init?.headers).has("Idempotency-Key")
      ? Response.json({ user: { role: "ADMIN" } })
      : Response.json(
          { message: "Idempotency-Key header is required" },
          { status: 400 },
        );
  try {
    const cookie = `base64-${Buffer.from(JSON.stringify({ access_token: "synthetic-access" })).toString("base64url")}`;
    const response = await proxy(
      new NextRequest("http://localhost:3001/admin", {
        headers: { cookie: `supabase.auth.token=${cookie}` },
      }),
    );
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
