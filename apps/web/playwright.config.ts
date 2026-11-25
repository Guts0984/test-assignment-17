import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8088';

// The e2e suite runs against the real compose stack (nginx, both api copies, worker, stub).
export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
});
