import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom', // Default environment
    setupFiles: ['./src/setupTests.js'],
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true, // Run browser in headless mode
      instances: [
        {
          browser: 'chromium', // Correct key as per Vitest documentation
        },
        // Example for other browsers if needed later:
        // {
        //   browser: 'firefox',
        // },
        // {
        //   browser: 'webkit',
        // },
      ],
      // You might need to specify playwright-specific options here if necessary
      // e.g., playwright: { launchOptions: { ... } }
    },
    transformMode: {
      web: ['**/*.js'],
    },
  },
})
