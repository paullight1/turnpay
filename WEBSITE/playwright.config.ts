import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const firefoxExecutablePath = process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH;
const webkitExecutablePath = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH;
const externalServerUrl = process.env.PLAYWRIGHT_EXTERNAL_SERVER_URL;
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
  reporter: 'html',
  use: {
    baseURL: externalServerUrl || 'http://127.0.0.1:3001',
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
        webServer: {
          command: 'npm run dev -- --hostname 127.0.0.1 --port 3001',
          url: 'http://127.0.0.1:3001',
          reuseExistingServer: !process.env.CI,
          timeout: 180000,
          env: {
            TRUSTPAY_E2E_AUTH_BYPASS_TOKEN: localE2EAuthToken!,
          },
        },
      }),
});
