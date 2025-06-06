module.exports = {
    launch: {
        headless: true, // Run in headless mode for CI/CD; can be set to false for debugging
        // slowMo: 50, // Slows down Puppeteer operations by 50ms to see what's happening
    },
    server: {
        command: 'npx http-server -p 8081 -c-1', // -c-1 disables caching
        port: 8081,
        launchTimeout: 10000, // Milliseconds
        usedPortAction: 'kill'
    }
};
