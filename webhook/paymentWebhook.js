const prisma = require('@/lib/prisma');
const paymentProvider = require('@/services/paymentProvider');
const { TransactionStatus } = require('@prisma/client');
const crypto = require('crypto');
const { getWalletCreditAmount } = require('@/lib/paymentUtils');

/**
 * Logic: Reverse-calculate the principal to credit the wallet
 * based on the ₦40 / 2% / ₦2000 fee structure.
 */
function safeCompare(a, b) {
    try {
        return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
        return false; // different lengths
    }
}


/**
 * Flutterwave Webhook Handler
 */
const handleFlutterwaveWebhook = async (req, res) => {
    const secretHash = process.env.FLW_WEBHOOK_HASH;
    const signature = req.headers['verif-hash'];

    if (!signature || !safeCompare(signature, secretHash)) {
        console.warn('[Webhook] Invalid hash from IP:', req.ip);
        return res.status(401).end();
    }

    const payload = req.body;


    // Always acknowledge 200 to FLW first to prevent unnecessary retries and queue blocks
    res.status(200).end();

    // FLW sends different event keys depending on the API version and payment method.
    // Standard cards use 'event', Bank transfers often use 'event.type'
    const eventType = payload.event || payload['event.type'];
    const validEvents = ['charge.completed', 'BANK_TRANSFER_TRANSACTION', 'transfer.completed'];

    if (!validEvents.includes(eventType) || payload.data.status !== 'successful') {
        console.log(`[Webhook] Ignored event: ${eventType} | Status: ${payload.data.status}`);
        return;
    }

    try {
        // Handle both nested { data: {} } and flat payloads
        const data = payload.data;
        const flwId = data.id;

        // Exact matching based on your payload
        const reference = data.txRef || data.tx_ref;
        const orderRef = data.orderRef || data.order_ref;

        // 1. Re-verify with Flutterwave API (Security against payload spoofing)
        // NOTE: Make sure your `verifyTransaction` uses the Transaction ID (flwId), 
        // as FLW v3 endpoints prefer ID over tx_ref for verification.
        const verifiedData = await paymentProvider.verifyTransaction(reference);

        if (verifiedData.status !== "successful") {
            console.error(`[Webhook] Verification failed: Status is ${verifiedData.status}`);
            return;
        }

        const totalPaidByCustomer = Number(verifiedData.amount);

        // 2. Identify User & Determine Wallet Credit
        let userId;
        let internalReference = reference;
        let walletCreditAmount = 0;
        let isExistingTransaction = false;

        // CASE A: Standard Gateway (Card/USSD)
        if (reference && reference.startsWith('FUND-')) {
            const existingTx = await prisma.transaction.findUnique({
                where: { reference }
            });

            if (!existingTx) {
                console.error(`[Webhook] Unknown reference: ${reference}`);
                return; // Reject unknown references
            }

            userId = existingTx.userId;

            walletCreditAmount = getWalletCreditAmount(totalPaidByCustomer);
            isExistingTransaction = true;
        }
        // CASE B: Dedicated Virtual Account Transfer
        else if (reference && reference.startsWith('VA-REG-')) {
            const parts = reference.split('-');
            userId = parts.slice(3).join('-');
            //internalReference = `VA-IN-${flwId}`;

            const kycRecord = await prisma.kycData.findFirst({
                where: { userId }
            });

            if (!kycRecord) { console.error('[Webhook] Unknown VA reference'); return; }
            walletCreditAmount = getWalletCreditAmount(totalPaidByCustomer);
        }
        // CASE C: Fallback for orderRef
        else if (orderRef) {
            const kycRecord = await prisma.kycData.findUnique({
                where: { accountReference: orderRef }
            });
            userId = kycRecord?.userId;
            internalReference = `VA-IN-${flwId}`;
            walletCreditAmount = getWalletCreditAmount(totalPaidByCustomer);
        }

        if (!userId || walletCreditAmount <= 0) {
            console.error(`[Webhook] FAILED association: ID ${flwId} | Ref ${reference} | OrderRef ${orderRef}`);
            return;
        }

        // 3. Atomic Database Update (Race-Condition Safe)
        await prisma.$transaction(async (tx) => {
            const platformFee = Math.max(0, totalPaidByCustomer - walletCreditAmount);
            let isNewSuccess = false;

            if (isExistingTransaction) {
                // UPDATE FLOW: For Gateway payments where the PENDING record already exists.
                const updateResult = await tx.transaction.updateMany({
                    where: {
                        reference: internalReference,
                        status: { not: 'SUCCESS' } // Assuming TransactionStatus.SUCCESS equals 'SUCCESS'
                    },
                    data: {
                        status: 'SUCCESS',
                        providerReference: String(flwId),
                        fee: platformFee
                    }
                });

                if (updateResult.count === 0) {
                    console.log(`[Webhook] Duplicate Gateway webhook suppressed: ${flwId}`);
                    return; // Another thread already updated this
                }
                isNewSuccess = true;
            } else {
                // CREATE FLOW: For Virtual Accounts where no prior record exists.
                try {
                    await tx.transaction.create({
                        data: {
                            userId,
                            amount: walletCreditAmount,
                            fee: platformFee,
                            type: 'WALLET_FUNDING',
                            status: 'SUCCESS',
                            reference: internalReference,
                            providerReference: String(flwId), // Must be @unique in schema
                            metadata: {
                                totalCharged: totalPaidByCustomer,
                                method: data.payment_type || 'transfer',
                                originalRef: reference
                            }
                        }
                    });
                    isNewSuccess = true;
                } catch (e) {
                    if (e.code === 'P2002') {
                        console.log(`[Webhook] Duplicate Virtual Account webhook suppressed: ${flwId}`);
                        return; // Another thread already inserted this record
                    }
                    throw e;
                }
            }

            // Only increment the wallet if we successfully bypassed the concurrency locks above
            if (isNewSuccess) {
                await tx.wallet.upsert({
                    where: { userId },
                    update: {
                        balance: { increment: walletCreditAmount }
                    },
                    create: {
                        userId: userId,
                        balance: walletCreditAmount
                    }
                });

                // 🟢 Emit WebSocket Event for Wallet Funding
                const { getIO } = require('@/lib/socket');
                try {
                    getIO().to(userId).emit('wallet_funded', {
                        amount: walletCreditAmount,
                        method: data.payment_type || 'transfer',
                        reference: reference
                    });
                } catch (socketErr) {
                    console.error("[Socket Error]", socketErr.message);
                }

                console.log(`[Webhook] SUCCESS: User ${userId} wallet +₦${walletCreditAmount}`);
            }
        });

    } catch (error) {
        console.error("[Webhook] Logic Error:", error.message);
    }
};

module.exports = { handleFlutterwaveWebhook };