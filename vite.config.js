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
      name: 'chromium', // Can be 'firefox', 'webkit', 'edge'
      provider: 'playwright',
      headless: true, // Run browser in headless mode
      // You might need to specify playwright-specific options here if necessary
      // e.g., playwright: { launchOptions: { ... } }
    },
  },
})
