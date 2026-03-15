require('dotenv').config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client'); // Or your custom path

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
    connectionString,
    max: 150,                      // Scaled for 300+ concurrent VU load with PM2 Cluster
    min: 20,
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