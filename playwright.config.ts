import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
const useEdgeChannel = !isCI && process.platform === 'win32';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 1 : undefined,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: true,
    timeout: 120000,
  },
  projects: [
    {
      name: useEdgeChannel ? 'edge' : 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        ...(useEdgeChannel ? { channel: 'msedge' } : {}),
      },
    },
  ],
});
