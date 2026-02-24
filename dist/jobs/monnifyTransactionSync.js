"use strict";
const cron = require('node-cron');
const prisma = require('@/lib/prisma');
const monnifyProvider = require('@/services/monnifyProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');
/**
 * Monnify Background Sync Job
 * Runs every minute to recover "lost" webhooks for Monnify payments.
 */
const startMonnifyTransactionSync = () => {
    cron.schedule('*/5 * * * *', async () => {
        const now = new Date();
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
        console.log(`\n--- [Monnify Sync Job: ${now.toISOString()}] ---`);
        try {
            // 1. Fetch pending records
            // We specifically look for transactions that were initialized but not yet finalized.
            const pendingTransactions = await prisma.transaction.findMany({
                where: {
                    type: TransactionType.WALLET_FUNDING,
                    status: TransactionStatus.PENDING,
                    createdAt: { lt: twoMinutesAgo },
                    // Optional: If you support multiple providers, filter by metadata
                    // metadata: { path: ['provider'], equals: 'MONNIFY' }
                },
                take: 15
            });
            console.log(`[Result] Found ${pendingTransactions.length} pending transaction(s) to verify.`);
            if (pendingTransactions.length === 0)
                return;
            for (const txn of pendingTransactions) {
                console.log(`[Process] Verifying Ref: ${txn.reference}`);
                try {
                    // 2. Query Monnify API using the paymentReference
                    const verification = await monnifyProvider.verifyTransaction(txn.reference);
                    if (!verification) {
                        console.log(`[Verify] ⚠️ No response for Ref: ${txn.reference}`);
                        continue;
                    }
                    console.log(`[Verify] Status: ${verification.status} | Paid: ₦${verification.amount}`);
                    // 3. Process Success
                    if (verification.status === "successful") {
                        const principalToCredit = Number(txn.amount);
                        const userId = txn.userId;
                        const mnfyId = String(verification.id);
                        // 4. Atomic Update (Idempotent)
                        await prisma.$transaction(async (tx) => {
                            const currentTx = await tx.transaction.findUnique({
                                where: { id: txn.id }
                            });
                            // Critical: Ensure it hasn't been updated by a webhook in the last millisecond
                            if (!currentTx || currentTx.status !== TransactionStatus.PENDING) {
                                return;
                            }
                            // Update Wallet
                            await tx.wallet.update({
                                where: { userId },
                                data: { balance: { increment: principalToCredit } }
                            });
                            // Update Transaction
                            await tx.transaction.update({
                                where: { id: txn.id },
                                data: {
                                    status: TransactionStatus.SUCCESS,
                                    providerReference: mnfyId
                                }
                            });
                        });
                        console.log(`[Success] ✅ Recovered: Ref ${txn.reference}`);
                    }
                    else if (['failed', 'expired', 'cancelled'].includes(verification.status)) {
                        console.log(`[Update] ❌ Status is ${verification.status}. Updating DB.`);
                        await prisma.transaction.update({
                            where: { id: txn.id },
                            data: { status: TransactionStatus.FAILED }
                        });
                    }
                }
                catch (err) {
                    // Monnify returns 404 if the user never even opened the checkout link
                    const isNotFound = err.status === 404 || err.message?.includes('404');
                    if (isNotFound) {
                        console.log(`[Info] Ref: ${txn.reference} not found (User abandoned checkout).`);
                        await prisma.transaction.update({
                            where: { id: txn.id },
                            data: { status: TransactionStatus.FAILED }
                        });
                    }
                    else {
                        console.error(`[Error] Ref: ${txn.reference} failed:`, err.message);
                    }
                }
            }
        }
        catch (error) {
            console.error('[Sync Job] Critical Error:', error.message);
        }
    });
};
module.exports = { startMonnifyTransactionSync };
