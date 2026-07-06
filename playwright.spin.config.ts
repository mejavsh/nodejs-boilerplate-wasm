import type { ChromaticConfig } from '@chromatic-com/playwright';
import { defineConfig, devices } from '@playwright/test';

// Spin serves on port 3000 by default.
const baseURL = 'http://127.0.0.1:3000';

/**
 * Playwright config for running e2e tests against a live Spin WASM server.
 *
 * Prerequisites before running:
 *   npm run db:pg:start   # start Docker PostgreSQL
 *   npm run db:migrate:pg # apply Drizzle migrations
 *   npm run build         # compile Next.js → WASM
 *
 * Then run:
 *   npm run test:e2e:spin:run
 * Or all-in-one (includes build):
 *   npm run test:e2e:spin
 */
export default defineConfig<ChromaticConfig>({
  testDir: './tests',
  testMatch: '*.@(spec|e2e).?(c|m)[jt]s?(x)',
  timeout: 30 * 1000,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',

  expect: {
    timeout: 15 * 1000,
  },

  // Start `spin up` before the test suite and kill it after.
  webServer: {
    command: 'spin up',
    url: baseURL,
    timeout: 60 * 1000,
    // Reuse an already-running Spin instance in local development.
    reuseExistingServer: !process.env.CI,
  },

  use: {
    baseURL,
    trace: process.env.CI ? 'on' : 'retain-on-failure',
    disableAutoSnapshot: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    ...(process.env.CI
      ? [
          {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
          },
        ]
      : []),
  ],
});
