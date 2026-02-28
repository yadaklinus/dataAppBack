const cron = require('node-cron');
const prisma = require('@/lib/prisma');
const axios = require('axios');
const { TransactionStatus, TransactionType } = require('@prisma/client');

const USER_ID = process.env.NELLOBYTE_USER_ID;
const API_KEY = process.env.NELLOBYTE_API_KEY;
const BASE_URL = 'https://www.nellobytesystems.com';

/**
 * Background Sync Job for NelloBytes
 * Runs every minute to verify transactions stuck in ORDER_RECEIVED
 */
const startNelloByteStatusJob = () => {
    cron.schedule('*/1 * * * *', async () => {
        try {
            // Fetch transactions stuck in ORDER_RECEIVED, or marked PENDING/FAILED
            const pendingTransactions = await prisma.transaction.findMany({
                where: {
                    OR: [
                        { providerStatus: "ORDER_RECEIVED" },
                        { providerStatus: "TXN_HISTORY" },
                        { status: TransactionStatus.PENDING },
                        { status: TransactionStatus.FAILED }
                    ],
                    type: {
                        in: [
                            TransactionType.DATA,
                            TransactionType.AIRTIME,
                            TransactionType.ELECTRICITY,
                            TransactionType.CABLE_TV,
                            TransactionType.EDUCATION,
                            TransactionType.RECHARGE_PIN
                        ]
                    },
                    createdAt: {
                        gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) // limit to past 3 days
                    }
                },
                take: 50, // max 50 per minute to prevent rate limiting
                orderBy: { createdAt: 'desc' }
            });

            if (pendingTransactions.length === 0) return;

            console.log(`\n--- [NelloByte Status Job] Verifying ${pendingTransactions.length} transaction(s) stuck in ORDER_RECEIVED ---`);

            for (const txn of pendingTransactions) {
                try {
                    // Query NelloByte API
                    const response = await axios.get(`${BASE_URL}/APIQueryV1.asp`, {
                        params: {
                            UserID: USER_ID,
                            APIKey: API_KEY,
                            RequestID: txn.reference
                        },
                        timeout: 15000,
                    });

                    const data = response.data;

                    if (data.statuscode === "200" && data.status === "ORDER_COMPLETED") {
                        const updateData = {
                            providerStatus: "ORDER_COMPLETED",
                            providerReference: data.orderid ? String(data.orderid) : txn.providerReference
                        };

                        // Process metadata updates for specific types (like Electricity tokens)
                        let metadata = {};
                        if (txn.metadata) {
                            metadata = typeof txn.metadata === 'string' ? JSON.parse(txn.metadata) : txn.metadata;
                        }

                        if (txn.type === TransactionType.ELECTRICITY && data.metertoken) {
                            metadata.token = data.metertoken;
                            updateData.metadata = metadata;
                        }

                        if (txn.type === TransactionType.RECHARGE_PIN && data.metertoken) {
                            metadata.token = data.metertoken;
                            updateData.metadata = metadata;
                        }

                        const updateQueries = [];

                        // Always ensure it's set to SUCCESS at this point
                        updateQueries.push(prisma.transaction.update({
                            where: { id: txn.id },
                            data: { ...updateData, status: TransactionStatus.SUCCESS }
                        }));

                        // If it was previously marked as FAILED, the user's wallet was refunded.
                        // We must DEDUCT the money again so they get properly charged for the successful order
                        if (txn.status === TransactionStatus.FAILED) {
                            updateQueries.push(prisma.wallet.update({
                                where: { userId: txn.userId },
                                data: {
                                    balance: { decrement: txn.amount },
                                    totalSpent: { increment: txn.amount }
                                }
                            }));
                            console.log(`[Correction] ⚠️ Re-deducting ${txn.amount} from wallet for recovered FAILED transaction Ref: ${txn.reference}`);
                        }

                        await prisma.$transaction(updateQueries);

                        console.log(`[Success] ✅ Verified and Updated ${txn.type} Ref: ${txn.reference} to SUCCESS`);
                    } else if (data.status === "ORDER_CANCELLED" || data.status === "ORDER_FAILED" || data.status === "MISSING_ORDERID") {
                        // Mark as failed and refund wallet if it was still pending or successful (safety)
                        if (txn.status !== TransactionStatus.FAILED && txn.status !== TransactionStatus.REVERSED) {
                            await prisma.$transaction([
                                prisma.transaction.update({
                                    where: { id: txn.id },
                                    data: {
                                        status: TransactionStatus.FAILED,
                                        providerStatus: data.status
                                    }
                                }),
                                prisma.wallet.update({
                                    where: { userId: txn.userId },
                                    data: {
                                        balance: { increment: txn.amount },
                                        totalSpent: { decrement: txn.amount }
                                    }
                                })
                            ]);
                            console.log(`[Failure] ❌ Provider failed ${txn.type} Ref: ${txn.reference}. Triggering REFUND.`);
                        } else {
                            // If already failed, just update provider status to match reality
                            await prisma.transaction.update({
                                where: { id: txn.id },
                                data: { providerStatus: data.status }
                            });
                        }
                    }
                } catch (err) {
                    console.error(`[Error] Failed verifying Ref ${txn.reference}:`, err.message);
                }
            }
        } catch (error) {
            console.error('[NelloByte Status Job] Critical System Error:', error.message);
        }
    });
};

module.exports = { startNelloByteStatusJob };
