require('dotenv').config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client'); // Or your custom path

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
    connectionString,
    max: 20,                      // Reduced to avoid Neon pooler limits
    min: 2,
    connectionTimeoutMillis: 30000,
    idleTimeoutMillis: 10000,
    allowExitOnIdle: true,
});
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
    adapter,
    // Add default interactive transaction timeouts here if possible, 
    // but Prisma interactive transactions usually require config during the call.
});

module.exports = prisma;