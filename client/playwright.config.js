import { defineConfig } from '@playwright/test';

// REAL_STACK=1 runs the specs against the Docker Compose stack (client on :8080) instead of MSW.
const realStack = process.env.REAL_STACK === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: realStack ? (process.env.REAL_STACK_URL || 'http://localhost:8080') : 'http://localhost:5173', trace: 'on-first-retry' },
  webServer: realStack ? undefined : {
    command: 'npm run dev:mock',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
