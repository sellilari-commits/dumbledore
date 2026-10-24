import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e-sim',
  timeout: 60_000,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
})
