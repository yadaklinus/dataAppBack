require('dotenv').config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client'); // Or your custom path

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
    connectionString,
    max: 20, // Increase pool size from default 10 to 20
    connectionTimeoutMillis: 10000, // Timeout after 10s if pool is full
    idleTimeoutMillis: 30000,
});
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
    adapter,
    // Add default interactive transaction timeouts here if possible, 
    // but Prisma interactive transactions usually require config during the call.
});

module.exports = prisma;