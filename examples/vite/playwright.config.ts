import { defineConfig, devices } from '@playwright/test';

// The shop as it ships: built, then served by `vite preview`, with the tests finding its text through the catalog.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: Boolean(process.env['CI']),
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'bun run build && bun run start',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
