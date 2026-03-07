// Mock for prisma.js
const { mockDeep, mockReset } = require('jest-mock-extended');
const prisma = mockDeep();

beforeEach(() => {
    mockReset(prisma);
});

module.exports = prisma;
