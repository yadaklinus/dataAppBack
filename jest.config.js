/** @type {import('jest').Config} */
const config = {
    testEnvironment: 'node',
    // Make sure we clear mocks between each test to avoid cross-contamination
    clearMocks: true,
    moduleNameMapper: {
        // This maps the @/ alias in your imports to the src/ or root folder appropriately.
        // Assuming your base directory is the project root:
        '^@/(.*)$': '<rootDir>/$1',
    },
    testMatch: [
        '**/__tests__/**/*.test.js'
    ],
    // Setup files to run before tests if necessary
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};

module.exports = config;
