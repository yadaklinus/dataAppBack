const cron = require('node-cron');
const prisma = require('@/lib/prisma');
const paymentProvider = require('@/services/paymentProvider');
const airtimeProvider = require('@/services/airtimeProvider');
const dataProvider = require('@/services/dataProvider');
const electricityProvider = require('@/services/electricityProvider');
const cableProvider = require('@/services/cableProvider');
const educationProvider = require('@/services/educationProvider');
const pinProvider = require('@/services/pinProvider');

const { TransactionStatus, TransactionType } = require('@prisma/client');
const { getWalletCreditAmount } = require('@/lib/paymentUtils');

/**
 * Provider Mapping for Service Transactions
 */
const PROVIDERS = {
    [TransactionType.AIRTIME]: airtimeProvider,
    [TransactionType.DATA]: dataProvider,
    [TransactionType.ELECTRICITY]: electricityProvider,
    [TransactionType.CABLE_TV]: cableProvider,
    [TransactionType.EDUCATION]: educationProvider,
    [TransactionType.RECHARGE_PIN]: pinProvider
};

/**
 * Background Sync Job
 * Runs every minute to recover "lost" webhooks or handle timeouts.
 */
const startTransactionSync = () => {
    cron.schedule('*/6 * * * *', async () => {
        const now = new Date();
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

        console.log(`\n--- [Unified Sync Job: ${now.toISOString()}] ---`);

        try {
            // 1. Fetch ALL pending records older than 2 minutes
            const pendingTransactions = await prisma.transaction.findMany({
                where: {
                    status: TransactionStatus.PENDING,
                    createdAt: { lt: twoMinutesAgo }
                },
                take: 20
            });

            console.log(`[Result] Found ${pendingTransactions.length} stuck transaction(s) to verify.`);

            for (const txn of pendingTransactions) {
                try {
                    // --- CASE A: WALLET FUNDING (Flutterwave) ---
                    if (txn.type === TransactionType.WALLET_FUNDING) {
                        await reconcileFunding(txn);
                    }
                    // --- CASE B: SERVICES (Airtime, Data, etc) ---
                    else if (PROVIDERS[txn.type]) {
                        await reconcileService(txn);
                    }
                } catch (err) {
                    console.error(`[Error] Failed reconciling Ref ${txn.reference}:`, err.message);
                }
            }
        } catch (error) {
            console.error('[Sync Job] Critical System Error:', error.message);
        }
    });
};

/**
 * Reconcile Flutterwave Funding
 */
const reconcileFunding = async (txn) => {
    console.log(`[Reconcile] Funding Ref: ${txn.reference}`);
    const verification = await paymentProvider.verifyTransaction(txn.reference);

    if (verification?.status === "successful") {
        await prisma.$transaction(async (tx) => {
            const currentTx = await tx.transaction.findUnique({ where: { id: txn.id } });
            if (!currentTx || currentTx.status !== TransactionStatus.PENDING) return;

            const totalPaid = Number(verification.amount);
            const walletCreditAmount = getWalletCreditAmount(totalPaid);

            await tx.wallet.upsert({
                where: { userId: txn.userId },
                update: { balance: { increment: walletCreditAmount } },
                create: { userId: txn.userId, balance: walletCreditAmount }
            });

            await tx.transaction.update({
                where: { id: txn.id },
                data: {
                    status: TransactionStatus.SUCCESS,
                    providerReference: String(verification.id),
                    fee: Math.max(0, totalPaid - walletCreditAmount)
                }
            });
        });
        console.log(`[Success] ✅ Recovered Funding Ref: ${txn.reference}`);
    } else if (verification?.status === "failed") {
        await prisma.transaction.update({
            where: { id: txn.id },
            data: { status: TransactionStatus.FAILED }
        });
    }
};

/**
 * Reconcile Service Transactions (Airtime, Data, etc)
 */
const reconcileService = async (txn) => {
    console.log(`[Reconcile] ${txn.type} Ref: ${txn.reference}`);
    const provider = PROVIDERS[txn.type];

    // We try to query by providerReference first, else fallback to internal reference
    const queryId = txn.providerReference || txn.reference;
    const result = await provider.queryTransaction(queryId);

    // Business Logic: statuscode 200 is success in Nellobyte Query API
    if (result.statuscode === "200") {
        await prisma.transaction.update({
            where: { id: txn.id },
            data: { status: TransactionStatus.SUCCESS }
        });
        console.log(`[Success] ✅ Finalized ${txn.type} Ref: ${txn.reference}`);
    }
    else if (["ORDER_CANCELLED", "ORDER_FAILED"].includes(result.status)) {
        console.log(`[Failure] ❌ Provider failed ${txn.type} Ref: ${txn.reference}. Triggering REFUND.`);

        await prisma.$transaction([
            prisma.transaction.update({
                where: { id: txn.id },
                data: { status: TransactionStatus.FAILED }
            }),
            prisma.wallet.update({
                where: { userId: txn.userId },
                data: {
                    balance: { increment: txn.amount },
                    totalSpent: { decrement: txn.amount }
                }
            })
        ]);
    }
};

module.exports = { startTransactionSync };
