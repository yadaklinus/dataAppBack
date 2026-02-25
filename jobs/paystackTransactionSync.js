const cron = require('node-cron');
const prisma = require('@/lib/prisma');
const paystackProvider = require('@/services/paystackProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');
const { getWalletCreditAmount } = require('@/lib/paymentUtils');

/**
 * Paystack Background Sync Job
 * Runs every 5 minutes to recover "lost" webhooks for Paystack payments.
 */
const startPaystackTransactionSync = () => {
    cron.schedule('*/1 * * * *', async () => {
        const now = new Date();
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

        console.log(`\n--- [Paystack Sync Job: ${now.toISOString()}] ---`);

        try {
            // 1. Fetch pending records initialized with Paystack
            const pendingTransactions = await prisma.transaction.findMany({
                where: {
                    type: TransactionType.WALLET_FUNDING,
                    status: TransactionStatus.PENDING,
                    createdAt: { lt: twoMinutesAgo },
                    metadata: {
                        path: ['provider'],
                        equals: 'PAYSTACK'
                    }
                },
                take: 15
            });

            console.log(`[Result] Found ${pendingTransactions.length} pending Paystack transaction(s) to verify.`);

            if (pendingTransactions.length === 0) return;

            for (const txn of pendingTransactions) {
                console.log(`[Process] Verifying Ref: ${txn.reference}`);

                try {
                    // 2. Query Paystack API
                    const verification = await paystackProvider.verifyTransaction(txn.reference);

                    if (!verification) {
                        console.log(`[Verify] ⚠️ No response for Ref: ${txn.reference}`);
                        continue;
                    }

                    console.log(`[Verify] Status: ${verification.status} | Paid: ₦${verification.amount}`);

                    // 3. Process Success
                    if (verification.status === "success" || verification.status === "successful") {
                        const totalPaid = Number(verification.amount);
                        const walletCreditAmount = getWalletCreditAmount(totalPaid);

                        const userId = txn.userId;
                        const pstkReference = String(verification.reference);

                        // 4. Atomic Update (Idempotent)
                        await prisma.$transaction(async (tx) => {
                            const currentTx = await tx.transaction.findUnique({
                                where: { id: txn.id }
                            });

                            if (!currentTx || currentTx.status !== TransactionStatus.PENDING) {
                                return;
                            }

                            // Update Wallet
                            await tx.wallet.update({
                                where: { userId },
                                data: { balance: { increment: walletCreditAmount } }
                            });

                            // Update Transaction
                            await tx.transaction.update({
                                where: { id: txn.id },
                                data: {
                                    status: TransactionStatus.SUCCESS,
                                    providerReference: pstkReference,
                                    fee: Math.max(0, totalPaid - walletCreditAmount)
                                }
                            });
                        });

                        console.log(`[Success] ✅ Recovered: Ref ${txn.reference}`);
                    }
                    else if (['failed', 'abandoned', 'reversed'].includes(verification.status)) {
                        console.log(`[Update] ❌ Status is ${verification.status}. Updating DB.`);
                        await prisma.transaction.update({
                            where: { id: txn.id },
                            data: { status: TransactionStatus.FAILED }
                        });
                    }
                } catch (err) {
                    const isNotFound = err.status === 404 || err.message?.includes('404');
                    if (isNotFound) {
                        console.log(`[Info] Ref: ${txn.reference} not found on Paystack (User hasn't paid).`);
                    } else {
                        console.error(`[Error] Ref: ${txn.reference} failed:`, err.message);
                    }
                }
            }
        } catch (error) {
            console.error('[Paystack Sync Job] Critical Error:', error.message);
        }
    });
};

module.exports = { startPaystackTransactionSync };
