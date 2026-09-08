import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser',
  timeout: 30000,
  workers: 1,
  use: { browserName: 'chromium', viewport: {width:1440,height:1000}, locale:'en-US', timezoneId:'UTC', trace:'retain-on-failure' },
  reporter: [['list'], ['html', {open:'never'}]],
});
