import { defineConfig, devices } from '@playwright/test';

const isCi = Boolean(globalThis.process?.env?.['CI']);

export default defineConfig({
  testDir: './e2e',
  timeout: 10_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  retries: isCi ? 1 : 0,
  reporter: isCi
    ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !isCi,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        browserName: 'firefox',
      },
    },
  ],
});
