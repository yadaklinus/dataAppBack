const prisma = require('@/lib/prisma');
const cron = require('node-cron');

/**
 * Cleanup Job
 * Purges expired or long-revoked refresh tokens to keep the database lean.
 */
const startCleanupJob = () => {
    // Run every night at 2:00 AM
    cron.schedule('0 2 * * *', async () => {
        console.log('[Cleanup Job] Starting RefreshToken purge...');
        try {
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            
            const deleted = await prisma.refreshToken.deleteMany({
                where: {
                    OR: [
                        { expiresAt: { lt: new Date() } },
                        { revoked: true, updatedAt: { lt: sevenDaysAgo } }
                    ]
                }
            });
            console.log(`[Cleanup Job] Purged ${deleted.count} old refresh tokens successfully.`);
        } catch (error) {
            console.error('[Cleanup Job] Error purging tokens:', error.message);
        }
    });
    
    console.log('[System] RefreshToken Cleanup Job Scheduled (2:00 AM daily)');
};

module.exports = { startCleanupJob };
