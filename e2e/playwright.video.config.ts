import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './video',
  timeout: 600_000, // 10 minutes
  retries: 0,
  workers: 1,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    video: {
      mode: 'on',
      size: { width: 1280, height: 720 },
    },
    launchOptions: {
      args: ['--disable-web-security', '--allow-file-access-from-files'],
    },
  },
  projects: [
    {
      name: 'intro-video',
      use: {
        browserName: 'chromium',
      },
    },
  ],
})
