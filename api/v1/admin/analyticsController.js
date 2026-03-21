const prisma = require('@/lib/prisma');
const axios = require('axios');
const { getCache, setCache } = require('@/lib/redis');

const vtpass = require('@/services/vtpassProvider');
const nelson = require('@/services/pinProvider');
const naija = require('@/services/naijaResultPinsProvider');

/**
 * Helper: Get Start and End dates for a given period
 */
const getPeriodDates = (period, targetDateInput) => {
    const targetDate = targetDateInput ? new Date(targetDateInput) : new Date();
    const end = new Date(targetDate);
    const start = new Date(targetDate);

    switch (period) {
        case 'day':
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            break;
        case 'yesterday':
            start.setDate(start.getDate() - 1);
            start.setHours(0, 0, 0, 0);
            end.setDate(end.getDate() - 1);
            end.setHours(23, 59, 59, 999);
            break;
        case '3days':
            start.setDate(start.getDate() - 3);
            start.setHours(0, 0, 0, 0);
            break;
        case '7days':
        case 'week':
            start.setDate(start.getDate() - 7);
            start.setHours(0, 0, 0, 0);
            break;
        case 'month':
            start.setMonth(start.getMonth() - 1);
            start.setHours(0, 0, 0, 0);
            break;
        case 'year':
            start.setFullYear(start.getFullYear() - 1);
            start.setHours(0, 0, 0, 0);
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
        const { period = 'month', date } = req.query;
        const { start: periodStart, end: periodEnd } = getPeriodDates(period, date);
        const { start: todayStart, end: todayEnd } = getPeriodDates('day', date);

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
            prisma.user.count({ where: { createdAt: { gte: periodStart, lte: periodEnd } } }),
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
                    createdAt: { gte: periodStart, lte: periodEnd }
                },
                _sum: { amount: true }
            }),
            prisma.transaction.aggregate({
                where: {
                    status: 'SUCCESS',
                    type: { not: 'WALLET_FUNDING' },
                    createdAt: { gte: periodStart, lte: periodEnd }
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

        const txStatusBreakdown = {
            SUCCESS: 0,
            PENDING: 0,
            FAILED: 0
        };
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
 */
const getRevenueChart = async (req, res) => {
    try {
        const { period = 'week' } = req.query;
        let days = 7;
        if (period === 'month') days = 30;
        if (period === '3days') days = 3;

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
        if (status && status !== 'all') where.status = status;
        if (type && type !== 'all') where.type = type;
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
        const { start: todayStart, end: todayEnd } = getPeriodDates('day');

        const [total, kycVerified, newToday, tierBreakdown, growth] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { isKycVerified: true } }),
            prisma.user.count({ where: { createdAt: { gte: todayStart, lte: todayEnd } } }),
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

        const tierDistribution = tierBreakdown.map(t => ({
            name: t.tier || 'Unknown',
            value: t._count._all
        }));

        return res.status(200).json({
            status: "OK",
            data: {
                total,
                newToday,
                kycVerified,
                kycPending: total - kycVerified,
                tierDistribution,
                timeSeries: growth.map(g => ({
                    label: g.date.toISOString().split('T')[0],
                    count: g.count
                }))
            }
        });
    } catch (error) {
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

        await setCache(cacheKey, balances, 300);
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
        const { startDate, endDate, period } = req.query;
        let start, end;
        
        if (period) {
            const range = getPeriodDates(period);
            start = range.start;
            end = range.end;
        } else {
            start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
            end = endDate ? new Date(endDate) : new Date();
        }

        const [totals, gatewayStats, growth, statusStats] = await Promise.all([
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
                WHERE type = 'WALLET_FUNDING' AND status = 'SUCCESS' AND "createdAt" BETWEEN ${start} AND ${end}
                GROUP BY 1
            `,
            prisma.$queryRaw`
                SELECT 
                    DATE_TRUNC('day', "createdAt") as name,
                    SUM(amount)::FLOAT as amount,
                    COUNT(*)::INT as count
                FROM "Transaction"
                WHERE type = 'WALLET_FUNDING' AND status = 'SUCCESS' AND "createdAt" BETWEEN ${start} AND ${end}
                GROUP BY 1
                ORDER BY 1 ASC
            `,
            prisma.transaction.groupBy({
                by: ['status'],
                where: { type: 'WALLET_FUNDING', createdAt: { gte: start, lte: end } },
                _count: { _all: true }
            })
        ]);

        const gateways = {};
        gatewayStats.forEach(g => {
            const name = g.gateway || 'Unknown';
            gateways[name] = { amount: g.amount, count: g.count };
        });

        const statusBreakdown = { SUCCESS: 0, PENDING: 0, FAILED: 0 };
        statusStats.forEach(s => statusBreakdown[s.status] = s._count._all);

        return res.status(200).json({
            status: "OK",
            data: {
                totalAmount: totals._sum.amount || 0,
                totalCount: totals._count._all,
                statusBreakdown,
                gateways,
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
 * Generic Service Analytics Wrapper
 */
const getServiceAnalytics = async (type, period) => {
    const { start, end } = getPeriodDates(period);

    const [totals, statusStats, providerStats, growth] = await Promise.all([
        prisma.transaction.aggregate({
            where: { type, createdAt: { gte: start, lte: end } },
            _sum: { amount: true },
            _count: { _all: true }
        }),
        prisma.transaction.groupBy({
            by: ['status'],
            where: { type, createdAt: { gte: start, lte: end } },
            _count: { _all: true }
        }),
        prisma.$queryRaw`
            SELECT 
                COALESCE(metadata->>'network', metadata->>'provider', metadata->>'disco', metadata->>'cable_tv', 'Unknown') as name,
                SUM(amount)::FLOAT as revenue,
                COUNT(*)::INT as count
            FROM "Transaction"
            WHERE type = ${type} AND status = 'SUCCESS' AND "createdAt" BETWEEN ${start} AND ${end}
            GROUP BY 1
        `,
        prisma.$queryRaw`
            SELECT 
                DATE_TRUNC('day', "createdAt") as name,
                SUM(amount)::FLOAT as revenue,
                COUNT(*)::INT as count
            FROM "Transaction"
            WHERE type = ${type} AND status = 'SUCCESS' AND "createdAt" BETWEEN ${start} AND ${end}
            GROUP BY 1
            ORDER BY 1 ASC
        `
    ]);

    const statusBreakdown = { SUCCESS: 0, PENDING: 0, FAILED: 0 };
    statusStats.forEach(s => statusBreakdown[s.status] = s._count._all);

    const byProvider = {};
    (providerStats || []).forEach(p => byProvider[p.name] = { ...p });

    const totalCount = statusBreakdown.SUCCESS + statusBreakdown.PENDING + statusBreakdown.FAILED;
    const successRate = totalCount > 0 ? (statusBreakdown.SUCCESS / totalCount) * 100 : 0;

    return {
        total: { 
            count: statusBreakdown.SUCCESS, 
            revenue: totals._sum.amount || 0,
            successRate: successRate.toFixed(1) + '%',
            ...statusBreakdown
        },
        byProvider,
        timeSeries: (growth || []).map(g => ({
            ...g,
            name: g.name.toISOString().split('T')[0]
        }))
    };
};

const getDataAnalytics = async (req, res) => {
    try {
        const data = await getServiceAnalytics('DATA', req.query.period || 'month');
        return res.status(200).json({ status: "OK", data });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

const getAirtimeAnalytics = async (req, res) => {
    try {
        const data = await getServiceAnalytics('AIRTIME', req.query.period || 'month');
        return res.status(200).json({ status: "OK", data });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

const getEducationAnalytics = async (req, res) => {
    try {
        const data = await getServiceAnalytics('EDUCATION', req.query.period || 'month');
        return res.status(200).json({ status: "OK", data });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

const getElectricityAnalytics = async (req, res) => {
    try {
        const data = await getServiceAnalytics('ELECTRICITY', req.query.period || 'month');
        return res.status(200).json({ status: "OK", data });
    } catch (error) {
        return res.status(500).json({ status: "ERROR", message: error.message });
    }
};

const getCableAnalytics = async (req, res) => {
    try {
        const data = await getServiceAnalytics('CABLE_TV', req.query.period || 'month');
        return res.status(200).json({ status: "OK", data });
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
