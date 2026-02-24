const REQUIRED = [
  "DATABASE_URL", "JWT_SECRET", "ENCRYPTION_KEY",
  "FLW_SECRET_KEY", "FLW_WEBHOOK_HASH",
  "MONNIFY_API_KEY", "MONNIFY_SECRET_KEY", "MONNIFY_CONTRACT_CODE",
  "FRONTEND_URL", "CALLBACK_URL",
  "NELLOBYTE_USER_ID", "NELLOBYTE_API_KEY",
  "MONNIFY_BASE_URL", "ACTIVE_PAYMENT_GATEWAY"
];


function validateEnv() {
  const missing = REQUIRED.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error("FATAL: Missing env vars:", missing.join(", "));
    process.exit(1);
  }
  if (Buffer.from(process.env.ENCRYPTION_KEY).length !== 32) {
    console.error("FATAL: ENCRYPTION_KEY must be exactly 32 bytes");
    process.exit(1);
  }
}

module.exports = { validateEnv };
