import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/connected.spec.ts', '**/bookings.spec.ts'],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5175', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 5175 --strictPort',
    env: { VITE_DATA_MODE: 'demo' },
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'small-phone',
      use: { ...devices['iPhone SE'], defaultBrowserType: 'chromium' },
    },
    {
      name: 'large-phone',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    {
      name: 'webkit-phone',
      use: { ...devices['iPhone 13'], browserName: 'webkit' },
    },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 } } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
  ],
});
