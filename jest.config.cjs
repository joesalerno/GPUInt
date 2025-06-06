module.exports = {
    preset: "jest-puppeteer",
    testMatch: ["**/__tests__/**/*.+(browser.test).[jt]s?(x)", "**/?(*.)+(browser.test).[jt]s?(x)"],
    transform: {
        '^.+\\.m?js$': 'babel-jest' // Process .js and .mjs files with babel-jest
    }
};
