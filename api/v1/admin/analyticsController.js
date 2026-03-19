const prisma = require('@/lib/prisma');
const axios = require('axios');
const { getCache, setCache } = require('@/lib/redis');

const vtpass = require('@/services/vtpassProvider');
const nelson = require('@/services/pinProvider');
const naija = require('@/services/naijaResultPinsProvider');

/**
 * Helper: Get Start and End dates for a given period
 */
const getPeriodDates = (period, targetDate = new Date()) => {
    const end = new Date(targetDate);
    const start = new Date(targetDate);

    switch (period) {
        case 'day':
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            break;
        case 'week':
            start.setDate(start.getDate() - 7);
            break;
        case 'month':
            start.setMonth(start.getMonth() - 1);
            break;
        case 'year':
            start.setFullYear(start.getFullYear() - 1);
            break;
        default:
            start.setHours(0, 0, 0, 0);
    }
    return { start, end };
};

/**
 * GET /api/v1/admin/analytics/overview
 * High-level system KPIs
 */
const getOverview = async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        const { start: periodStart, end: periodEnd } = getPeriodDates(period);
        const { start: todayStart, end: todayEnd } = getPeriodDates('day');

        const [
            totalUsers,
            newUsersToday,
            newUsersThisPeriod,
            totalTransactions,
            transactionStats,
            walletStats,
            fundingStats,
            revenueStats,
            revenueToday
        ] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { createdAt: { gte: todayStart, lte: todayEnd } } }),
            prisma.user.count({ where: { createdAt: { gte: periodStart } } }),
            prisma.transaction.count(),
            prisma.transaction.groupBy({
                by: ['status'],
                _count: { _all: true },
                _sum: { amount: true }
            }),
            prisma.wallet.aggregate({ _sum: { balance: true } }),
            prisma.transaction.aggregate({
                where: { 
                    type: 'WALLET_FUNDING', 
                    status: 'SUCCESS',
                    createdAt: { gte: periodStart }
                },
                _sum: { amount: true }
            }),
            prisma.transaction.aggregate({
                where: {
                    status: 'SUCCESS',
                    type: { not: 'WALLET_FUNDING' },
                    createdAt: { gte: periodStart }
                },
                _sum: { amount: true }
            }),
            prisma.transaction.aggregate({
                where: {
                    status: 'SUCCESS',
                    type: { not: 'WALLET_FUNDING' },
                    createdAt: { gte: todayStart, lte: todayEnd }
                },
                _sum: { amount: true }
            })
        ]);

        // Provider Wallets (Cache handled in separate endpoint, but providing current here)
        const cacheKey = 'admin_provider_wallets_quick';
        let providerWallets = await getCache(cacheKey);
        
        if (!providerWallets) {
            // Non-blocking fetch for overview to keep it fast
            providerWallets = {
                vtpass: { balance: 0, status: 'loading' },
                nellobyte: { balance: 0, status: 'loading' },
                naijaResultPins: { balance: 0, status: 'loading' }
            };
        }

        const txStatusBreakdown = {};
        transactionStats.forEach(stat => {
            txStatusBreakdown[stat.status] = stat._count._all;
        });

        return res.status(200).json({
            status: "OK",
            data: {
                totalUsers,
                newUsersToday,
                newUsersThisMonth: newUsersThisPeriod,
                totalTransactions,
                totalRevenue: revenueStats._sum.amount || 0,
                revenueToday: revenueToday._sum.amount || 0,
                revenueThisMonth: revenueStats._sum.amount || 0,
                totalUserWalletBalance: walletStats._sum.balance || 0,
                totalMoneyReceivedThisMonth: fundingStats._sum.amount || 0,
                transactionsByStatus: txStatusBreakdown,
                providerWallets
            }
        });

    } catch (error) {
        console.error("[Analytics Overview Error]:", error);
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

/**
 * GET /api/v1/admin/analytics/revenue
 * Time-series data for charts
 */
const getRevenueChart = async (req, res) => {
    try {
        const { period = 'week' } = req.query;
        let days = 7;
        if (period === 'month') days = 30;

        // Use queryRaw for date truncation grouping
        const stats = await prisma.$queryRaw`
            SELECT 
                DATE_TRUNC('day', "createdAt") as date,
                SUM(amount)::FLOAT as revenue,
                COUNT(*)::INT as count
            FROM "Transaction"
            WHERE status = 'SUCCESS' 
              AND type != 'WALLET_FUNDING'
              AND "createdAt" >= NOW() - INTERVAL '${days} days'
            GROUP BY 1
            ORDER BY 1 ASC
        `;

        const labels = stats.map(s => s.date.toISOString().split('T')[0]);
        const revenue = stats.map(s => s.revenue);
        const transactionCount = stats.map(s => s.count);

        return res.status(200).json({
            status: "OK",
            data: { labels, revenue, transactionCount }
        });
    } catch (error) {
        console.error("Revenue Chart Error:", error);
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

/**
 * GET /api/v1/admin/analytics/by-service
 */
const getByService = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const where = { status: 'SUCCESS' };
        if (startDate && endDate) {
            where.createdAt = { gte: new Date(startDate), lte: new Date(endDate) };
        }

        const stats = await prisma.transaction.groupBy({
            by: ['type'],
            where,
            _count: { _all: true },
            _sum: { amount: true }
        });

        const services = {};
        stats.forEach(stat => {
            services[stat.type] = {
                count: stat._count._all,
                revenue: parseFloat(stat._sum.amount) || 0
            };
        });

        return res.status(200).json({ status: "OK", data: { services } });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

/**
 * GET /api/v1/admin/analytics/transactions
 */
const getTransactions = async (req, res) => {
    try {
        const { page = 1, limit = 20, status, type, search } = req.query;
        const skip = (page - 1) * limit;

        const where = {};
        if (status) where.status = status;
        if (type) where.type = type;
        if (search) {
            where.OR = [
                { reference: { contains: search } },
                { user: { email: { contains: search } } }
            ];
        }

        const [transactions, total] = await Promise.all([
            prisma.transaction.findMany({
                where,
                include: { user: { select: { fullName: true, email: true } } },
                orderBy: { createdAt: 'desc' },
                skip: Number(skip),
                take: Number(limit)
            }),
            prisma.transaction.count({ where })
        ]);

        return res.status(200).json({
            status: "OK",
            data: transactions,
            meta: {
                total,
                page: Number(page),
                lastPage: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

/**
 * GET /api/v1/admin/analytics/users
 */
const getUsers = async (req, res) => {
    try {
        const [total, kycVerified, tierBreakdown, growth] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { isKycVerified: true } }),
            prisma.user.groupBy({
                by: ['tier'],
                _count: { _all: true }
            }),
            prisma.$queryRaw`
                SELECT 
                    DATE_TRUNC('day', "createdAt") as date,
                    COUNT(*)::INT as count
                FROM "User"
                WHERE "createdAt" >= NOW() - INTERVAL '30 days'
                GROUP BY 1
                ORDER BY 1 ASC
            `
        ]);

        const tiers = {};
        tierBreakdown.forEach(t => tiers[t.tier] = t._count._all);

        return res.status(200).json({
            status: "OK",
            data: {
                total,
                kycVerified,
                kycPending: total - kycVerified,
                tiers,
                timeSeries: growth.map(g => ({
                    label: g.date.toISOString().split('T')[0],
                    count: g.count
                }))
            }
        });
    } catch (error) {
        console.error("User Analytics Error:", error);
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

/**
 * GET /api/v1/admin/analytics/provider-wallets
 */
const getProviderWallets = async (req, res) => {
    try {
        const cacheKey = 'admin_provider_wallets_v2';
        const cached = await getCache(cacheKey);
        if (cached) return res.status(200).json({ status: "OK", data: cached });

        const [vtpassBal, nelloBal, naijaBal] = await Promise.allSettled([
            vtpass.getWalletBalance(),
            nelson.getWalletBalance(),
            naija.getWalletBalance()
        ]);

        const balances = {
            vtpass: vtpassBal.status === 'fulfilled' ? vtpassBal.value : { balance: 0, error: vtpassBal.reason?.message },
            nellobyte: nelloBal.status === 'fulfilled' ? nelloBal.value : { balance: 0, error: nelloBal.reason?.message },
            naijaResultPins: naijaBal.status === 'fulfilled' ? naijaBal.value : { balance: 0, error: naijaBal.reason?.message }
        };

        // Cache for 5 minutes
        await setCache(cacheKey, balances, 300);
        // Also set a quick cache for overview
        await setCache('admin_provider_wallets_quick', balances, 600);

        return res.status(200).json({ status: "OK", data: balances });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

/**
 * GET /api/v1/admin/analytics/funding
 */
const getFundingAnalytics = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
        const end = endDate ? new Date(endDate) : new Date();

        const [totals, gatewayStats] = await Promise.all([
            prisma.transaction.aggregate({
                where: { type: 'WALLET_FUNDING', status: 'SUCCESS', createdAt: { gte: start, lte: end } },
                _sum: { amount: true },
                _count: { _all: true }
            }),
            prisma.$queryRaw`
                SELECT 
                    metadata->>'gateway' as gateway,
                    SUM(amount)::FLOAT as amount,
                    COUNT(*)::INT as count
                FROM "Transaction"
                WHERE type = 'WALLET_FUNDING' 
                  AND status = 'SUCCESS'
                  AND "createdAt" BETWEEN ${start} AND ${end}
                GROUP BY 1
            `
        ]);

        const gateways = {};
        gatewayStats.forEach(g => {
            const name = g.gateway || 'Unknown';
            gateways[name] = { amount: g.amount, count: g.count };
        });

        return res.status(200).json({
            status: "OK",
            data: {
                totalAmount: totals._sum.amount || 0,
                totalCount: totals._count._all,
                gateways
            }
        });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

/**
 * GET /api/v1/admin/analytics/data
 */
const getDataAnalytics = async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        const { start } = getPeriodDates(period);

        const [totals, providerStats, growth] = await Promise.all([
            prisma.transaction.aggregate({
                where: { type: 'DATA', status: 'SUCCESS', createdAt: { gte: start } },
                _sum: { amount: true },
                _count: { _all: true }
            }),
            prisma.$queryRaw`
                SELECT 
                    COALESCE(metadata->>'network', metadata->>'provider', 'Unknown') as name,
                    SUM(amount)::FLOAT as revenue,
                    COUNT(*)::INT as count
                FROM "Transaction"
                WHERE type = 'DATA' AND status = 'SUCCESS' AND "createdAt" >= ${start}
                GROUP BY 1
            `,
            prisma.$queryRaw`
                SELECT 
                    DATE_TRUNC('day', "createdAt") as name,
                    SUM(amount)::FLOAT as revenue,
                    COUNT(*)::INT as count
                FROM "Transaction"
                WHERE type = 'DATA' AND status = 'SUCCESS' AND "createdAt" >= ${start}
                GROUP BY 1
                ORDER BY 1 ASC
            `
        ]);

        const byProvider = {};
        providerStats.forEach(p => {
            byProvider[p.name] = { ...p };
        });

        return res.status(200).json({
            status: "OK",
            data: {
                total: { count: totals._count._all, revenue: totals._sum.amount || 0 },
                byProvider,
                timeSeries: growth.map(g => ({
                    ...g,
                    name: g.name.toISOString().split('T')[0]
                }))
            }
        });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

/**
 * GET /api/v1/admin/analytics/airtime
 */
const getAirtimeAnalytics = async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        const { start } = getPeriodDates(period);

        const [totals, providerStats] = await Promise.all([
            prisma.transaction.aggregate({
                where: { type: 'AIRTIME', status: 'SUCCESS', createdAt: { gte: start } },
                _sum: { amount: true },
                _count: { _all: true }
            }),
            prisma.$queryRaw`
                SELECT 
                    COALESCE(metadata->>'network', metadata->>'provider', 'Unknown') as name,
                    SUM(amount)::FLOAT as revenue,
                    COUNT(*)::INT as count
                FROM "Transaction"
                WHERE type = 'AIRTIME' AND status = 'SUCCESS' AND "createdAt" >= ${start}
                GROUP BY 1
            `
        ]);

        const byProvider = {};
        providerStats.forEach(p => {
            byProvider[p.name] = { ...p };
        });

        return res.status(200).json({
            status: "OK",
            data: {
                total: { count: totals._count._all, revenue: totals._sum.amount || 0 },
                byProvider
            }
        });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

/**
 * GET /api/v1/admin/analytics/education
 */
const getEducationAnalytics = async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        const { start } = getPeriodDates(period);

        const [totals, providerStats] = await Promise.all([
            prisma.transaction.aggregate({
                where: { type: 'EDUCATION', status: 'SUCCESS', createdAt: { gte: start } },
                _sum: { amount: true },
                _count: { _all: true }
            }),
            prisma.$queryRaw`
                SELECT 
                    COALESCE(metadata->>'provider', metadata->>'exam_type', 'Unknown') as name,
                    SUM(amount)::FLOAT as revenue,
                    COUNT(*)::INT as count
                FROM "Transaction"
                WHERE type = 'EDUCATION' AND status = 'SUCCESS' AND "createdAt" >= ${start}
                GROUP BY 1
            `
        ]);

        const byProvider = {};
        providerStats.forEach(p => byProvider[p.name] = { ...p });

        return res.status(200).json({
            status: "OK",
            data: {
                total: { count: totals._count._all, revenue: totals._sum.amount || 0 },
                byProvider
            }
        });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

/**
 * GET /api/v1/admin/analytics/electricity
 */
const getElectricityAnalytics = async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        const { start } = getPeriodDates(period);

        const [totals, discoStats] = await Promise.all([
            prisma.transaction.aggregate({
                where: { type: 'ELECTRICITY', status: 'SUCCESS', createdAt: { gte: start } },
                _sum: { amount: true },
                _count: { _all: true }
            }),
            prisma.$queryRaw`
                SELECT 
                    COALESCE(metadata->>'disco', metadata->>'discoCode', 'Unknown') as name,
                    SUM(amount)::FLOAT as revenue,
                    COUNT(*)::INT as count
                FROM "Transaction"
                WHERE type = 'ELECTRICITY' AND status = 'SUCCESS' AND "createdAt" >= ${start}
                GROUP BY 1
            `
        ]);

        const byProvider = {};
        discoStats.forEach(p => byProvider[p.name] = { ...p });

        return res.status(200).json({
            status: "OK",
            data: {
                total: { count: totals._count._all, revenue: totals._sum.amount || 0 },
                byProvider
            }
        });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

/**
 * GET /api/v1/admin/analytics/cable
 */
const getCableAnalytics = async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        const { start } = getPeriodDates(period);

        const [totals, cableStats] = await Promise.all([
            prisma.transaction.aggregate({
                where: { type: 'CABLE_TV', status: 'SUCCESS', createdAt: { gte: start } },
                _sum: { amount: true },
                _count: { _all: true }
            }),
            prisma.$queryRaw`
                SELECT 
                    COALESCE(metadata->>'cable_tv', metadata->>'cableTV', 'Unknown') as name,
                    SUM(amount)::FLOAT as revenue,
                    COUNT(*)::INT as count
                FROM "Transaction"
                WHERE type = 'CABLE_TV' AND status = 'SUCCESS' AND "createdAt" >= ${start}
                GROUP BY 1
            `
        ]);

        const byProvider = {};
        cableStats.forEach(p => byProvider[p.name] = { ...p });

        return res.status(200).json({
            status: "OK",
            data: {
                total: { count: totals._count._all, revenue: totals._sum.amount || 0 },
                byProvider
            }
        });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

module.exports = {
    getOverview,
    getRevenueChart,
    getByService,
    getTransactions,
    getUsers,
    getProviderWallets,
    getFundingAnalytics,
    getDataAnalytics,
    getAirtimeAnalytics,
    getEducationAnalytics,
    getElectricityAnalytics,
    getCableAnalytics
};
