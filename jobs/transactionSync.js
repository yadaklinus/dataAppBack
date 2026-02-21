const cron = require('node-cron');
const prisma = require('@/lib/prisma');
const paymentProvider = require('@/services/paymentProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');

/**
 * Background Sync Job
 * Runs every minute to recover "lost" webhooks.
 * Enhanced with debugging logs to track verification steps.
 */
const startTransactionSync = () => {
    cron.schedule('*/1 * * * *', async () => {
        const now = new Date();
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
        
        console.log(`\n--- [Sync Job Debug: ${now.toISOString()}] ---`);
        console.log(`[Check] Looking for PENDING transactions created before: ${twoMinutesAgo.toISOString()}`);

        try {
            // 1. Fetch pending records
            const pendingTransactions = await prisma.transaction.findMany({
                where: {
                    type: TransactionType.WALLET_FUNDING,
                    status: TransactionStatus.PENDING,
                    createdAt: { lt: twoMinutesAgo }
                },
                take: 15 
            });

            console.log(`[Result] Found ${pendingTransactions.length} stuck transaction(s) to verify.`);

            if (pendingTransactions.length === 0) return;

            for (const txn of pendingTransactions) {
                console.log(`\n[Process] Verifying Ref: ${txn.reference}`);
                
                try {
                    // 2. Query Flutterwave API
                    const verification = await paymentProvider.verifyTransaction(txn.reference);

                    if (!verification) {
                        console.log(`[Verify] ⚠️ No response from Provider for Ref: ${txn.reference}`);
                        continue;
                    }

                    console.log(`[Verify] Provider Status: ${verification.status} | Amount: ${verification.amount} ${verification.currency}`);

                    // 3. Logic Check
                    if (verification.status === "successful") {
                        const principalToCredit = Number(txn.amount);
                        const userId = txn.userId;
                        const flwId = String(verification.id);

                        console.log(`[Action] Attempting recovery for User: ${userId} | Credit: ₦${principalToCredit}`);

                        // 4. Atomic Update
                        await prisma.$transaction(async (tx) => {
                            const currentTx = await tx.transaction.findUnique({
                                where: { id: txn.id }
                            });

                            // Check if status changed while we were processing
                            if (!currentTx || currentTx.status !== TransactionStatus.PENDING) {
                                console.log(`[Abort] Ref: ${txn.reference} is no longer PENDING in DB. Already processed?`);
                                return;
                            }

                            // Update Wallet (Upsert for safety)
                            await tx.wallet.upsert({
                                where: { userId },
                                update: { balance: { increment: principalToCredit } },
                                create: { userId: userId, balance: principalToCredit }
                            });

                            // Update Transaction
                            await tx.transaction.update({
                                where: { id: txn.id },
                                data: { 
                                    status: TransactionStatus.SUCCESS,
                                    providerReference: flwId
                                }
                            });
                        });

                        console.log(`[Success] ✅ Recovered: Ref ${txn.reference} | Wallet updated.`);
                    } 
                    else if (verification.status === "failed") {
                        console.log(`[Update] ❌ Provider marked Ref: ${txn.reference} as FAILED. Updating DB...`);
                        await prisma.transaction.update({
                            where: { id: txn.id },
                            data: { status: TransactionStatus.FAILED }
                        });
                    } else {
                        console.log(`[Skip] ⏳ Ref: ${txn.reference} is still ${verification.status} at Provider.`);
                    }
                } catch (err) {
                    // If 404, the user likely never even reached the payment page after the link was generated
                    const isNotFound = err.message?.includes('404') || err.response?.status === 404;
                    if (isNotFound) {
                        console.log(`[Info] Ref: ${txn.reference} not found on Provider (User likely abandoned checkout).`);
                    } else {
                        console.error(`[Error] Failed verifying Ref: ${txn.reference}:`, err.message);
                    }
                }
            }
            console.log(`--- [Sync Job Finished] ---\n`);
        } catch (error) {
            console.error('[Sync Job] Critical System Error:', error.message);
        }
    });
};

module.exports = { startTransactionSync };