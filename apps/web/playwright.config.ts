import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config. Runs against a already-running stack (docker compose up):
 *   web on http://localhost:3000, api on http://localhost:3001.
 * Override the base URL with WEB_BASE_URL.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
