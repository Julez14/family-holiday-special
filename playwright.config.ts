import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 12000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'https://localhost:8790',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'api', testMatch: 'api.spec.ts' },
    {
      name: 'desktop',
      testMatch: 'ui.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'mobile',
      testMatch: 'ui.spec.ts',
      use: { ...devices['iPhone 13'], viewport: { width: 360, height: 780 } },
    },
  ],
  webServer: {
    command: 'npm run db:e2e && npm run dev:e2e',
    url: 'https://localhost:8790/api/health',
    reuseExistingServer: !process.env.CI,
    ignoreHTTPSErrors: true,
    timeout: 120000,
  },
});
