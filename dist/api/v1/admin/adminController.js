"use strict";
const prisma = require('@/lib/prisma');
/**
 * Get General System Statistics
 */
const getGeneralStats = async (req, res) => {
    try {
        const [userCount, txStats, walletStats] = await prisma.$transaction([
            // 1. Total User Count
            prisma.user.count(),
            // 2. Transaction Statistics (counts and volumes)
            prisma.transaction.groupBy({
                by: ['status'],
                _count: { _all: true },
                _sum: { amount: true }
            }),
            // 3. Wallet Statistics
            prisma.wallet.aggregate({
                _sum: { balance: true }
            })
        ]);
        return res.status(200).json({
            status: "OK",
            data: {
                totalUsers: userCount,
                transactions: txStats,
                totalUserBalance: walletStats._sum.balance || 0,
                serverTime: new Date().toISOString()
            }
        });
    }
    catch (error) {
        console.error("[Admin Stats Error]:", error.message);
        return res.status(500).json({ status: "ERROR", message: "Failed to fetch internal statistics" });
    }
};
module.exports = { getGeneralStats };
