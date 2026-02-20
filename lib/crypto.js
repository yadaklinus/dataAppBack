const crypto = require('crypto');

// You MUST set a 32-byte (256-bit) ENCRYPTION_KEY in your .env
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; 
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

if (!ENCRYPTION_KEY) {
  console.error("FATAL: ENCRYPTION_KEY env var is not set");
  process.exit(1);
}

if (Buffer.from(ENCRYPTION_KEY).length !== 32) {
  console.error(`FATAL: ENCRYPTION_KEY must be exactly 32 bytes (got ${Buffer.from(ENCRYPTION_KEY).length})`);
  process.exit(1);
}



/**
 * Encrypts a string (e.g. BVN)
 * Returns a format: iv:authTag:encryptedData
 */
function encrypt(text) {
    if (!text) return null;
    
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    // Combine everything into one string for database storage
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts the stored string back to plain text
 */
function decrypt(encryptedText) {
    if (!encryptedText) return null;

    try {
        const [ivHex, authTagHex, encryptedDataHex] = encryptedText.split(':');
        
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
        
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        console.error("Decryption failed:", error.message);
        return null; // or throw error
    }
}

module.exports = { encrypt, decrypt };