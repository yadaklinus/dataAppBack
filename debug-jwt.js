const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const path = require('path');

// Load .env from dataapp directory
dotenv.config({ path: path.join(__dirname, '.env') });

const secret = process.env.JWT_SECRET;
const expiresIn = process.env.JWT_EXPIRES_IN || '15m';

console.log("Testing with Secret (prefix):", secret ? secret.substring(0, 10) : "MISSING");

if (!secret) {
    console.error("No JWT_SECRET found in .env");
    process.exit(1);
}

const payload = { userId: "test-user-id", isStaff: true };
const token = jwt.sign(payload, secret, { expiresIn });

console.log("Generated Token:", token.substring(0, 20) + "...");

try {
    const decoded = jwt.verify(token, secret);
    console.log("Verification Success!");
    console.log("Decoded Payload:", decoded);

    if (decoded.isStaff === true) {
        console.log("isStaff Check: PASSED");
    } else {
        console.log("isStaff Check: FAILED (Expected true, got " + decoded.isStaff + ")");
    }
} catch (err) {
    console.error("Verification Failed:", err.message);
}
