import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e', fullyParallel:false, workers:1, timeout:60000,
  use:{baseURL:process.env.TEST_BASE_URL??'http://localhost:3100', trace:'off', launchOptions:{channel:'chrome'}},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}}],
  reporter:'list',
});
