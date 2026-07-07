import { defineConfig, devices } from '@playwright/test';

const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const firefoxExecutablePath = process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH;
const webkitExecutablePath = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH;
const externalServerUrl = process.env.PLAYWRIGHT_EXTERNAL_SERVER_URL;

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
        },
      }),
});
