import { defineConfig, devices } from '@playwright/test'

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8080'
const BASE_URL = process.env.BASE_URL || 'http://localhost:8081'
const VERSION = process.env.REPORT_VERSION || 'local'

export default defineConfig({
  testDir: './src',
  outputDir: `../reports/${VERSION}/test-results`,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : 2,
  reporter: [
    ['list'],
    ['html', { outputFolder: `../reports/${VERSION}/playwright-report`, open: 'never' }],
    ['allure-playwright', { outputFolder: `../reports/${VERSION}/allure-results`, detail: true }],
    ['junit', { outputFile: `../reports/${VERSION}/junit.xml` }]
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'api',
      testMatch: /.*\.api\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: API_BASE_URL }
    },
    {
      name: 'ui',
      testMatch: /.*\.ui\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
    }
  ]
})
