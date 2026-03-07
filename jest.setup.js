// Global test configuration
process.env.JWT_SECRET = 'test-secret';
// Must be exactly 32 bytes for the crypto module
process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
