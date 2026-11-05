import { defineConfig, devices } from '@playwright/test';

const PORT = 4175;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/harness.mjs',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
