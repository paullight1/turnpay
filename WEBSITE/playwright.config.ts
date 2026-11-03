import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const firefoxExecutablePath = process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH;
const webkitExecutablePath = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH;
const externalServerUrl = process.env.PLAYWRIGHT_EXTERNAL_SERVER_URL;
const DEFAULT_AUTH_PORT = 33100;
const DEFAULT_WEB_PORT = 33101;

function readPort(name: string, fallback: number) {
  const value = process.env[name];
  const port = value === undefined ? fallback : Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return port;
}

const authHost = process.env.TRUSTPAY_E2E_AUTH_HOST || '127.0.0.1';
const authPort = readPort('TRUSTPAY_E2E_AUTH_PORT', DEFAULT_AUTH_PORT);
const webHost = process.env.TRUSTPAY_E2E_WEB_HOST || '127.0.0.1';
const webPort = readPort('TRUSTPAY_E2E_WEB_PORT', DEFAULT_WEB_PORT);
const authServerUrl = `http://${authHost}:${authPort}`;
const webServerUrl = `http://${webHost}:${webPort}`;
const reuseExistingServer = process.env.TRUSTPAY_E2E_REUSE_SERVER === 'true';
const localE2EAuthToken = externalServerUrl
  ? undefined
  : process.env.TRUSTPAY_E2E_AUTH_BYPASS_TOKEN || randomUUID();
if (localE2EAuthToken) {
  process.env.TRUSTPAY_E2E_AUTH_BYPASS_TOKEN = localE2EAuthToken;
}

function withExecutablePath(
  use: Record<string, unknown>,
  executablePath?: string,
) {
  if (!executablePath) {
    return use;
  }

  const currentLaunchOptions =
    (use as { launchOptions?: Record<string, unknown> }).launchOptions ?? {};

  return {
    ...use,
    launchOptions: {
      ...currentLaunchOptions,
      executablePath,
    },
  };
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never' }]]
    : 'html',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results',
  use: {
    baseURL: externalServerUrl || webServerUrl,
    ...(localE2EAuthToken
      ? {
          extraHTTPHeaders: {
            'x-trustpay-e2e-auth': localE2EAuthToken,
          },
        }
      : {}),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...withExecutablePath(devices['Desktop Chrome'], chromiumExecutablePath),
      },
    },
    {
      name: 'firefox',
      use: {
        ...withExecutablePath(devices['Desktop Firefox'], firefoxExecutablePath),
      },
    },
    {
      name: 'webkit',
      use: {
        ...withExecutablePath(devices['Desktop Safari'], webkitExecutablePath),
      },
    },
    {
      name: 'Mobile Chrome',
      use: {
        ...withExecutablePath(devices['Pixel 5'], chromiumExecutablePath),
      },
    },
    {
      name: 'Mobile Safari',
      use: {
        ...withExecutablePath(devices['iPhone 12'], webkitExecutablePath),
      },
    },
  ],
  ...(externalServerUrl
    ? {}
    : {
        webServer: [
          {
            command: 'node e2e/mock-auth-verifier.mjs',
            url: `${authServerUrl}/health`,
            reuseExistingServer,
            timeout: 30000,
            env: {
              ...process.env,
              TRUSTPAY_E2E_AUTH_HOST: authHost,
              TRUSTPAY_E2E_AUTH_PORT: String(authPort),
            },
          },
          {
            // The retained customer pages are deliberately available only in
            // non-production mode. The separate build step still validates
            // the production bundle; run browser E2E against the dev server
            // so the QA-only bypass cannot be mistaken for a production path.
            command: `npm run dev -- --webpack --hostname ${webHost} --port ${webPort}`,
            url: webServerUrl,
            reuseExistingServer,
            timeout: 180000,
            env: {
              ...process.env,
              NEXT_PUBLIC_API_URL: authServerUrl,
              NEXT_PUBLIC_SUPABASE_URL: '',
              NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
              NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
            },
          },
        ],
      }),
});
