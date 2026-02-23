const prisma = require('@/lib/prisma');
const paymentProvider = require('@/services/paymentProvider');
const { TransactionStatus } = require('@prisma/client');
const crypto = require('crypto');

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

const getWalletCreditAmount = (totalReceived) => {
    const total = Number(totalReceived);
    
    // Safety check for very small amounts to avoid negative balances
    if (total <= 40) return 0;

    if (total <= 2540) {
        // Tier 1: Small amounts (Principal <= ₦2,500)
        return total - 40;
    } else if (total > 102000) { 
        // Tier 3: Large amounts (Principal > ₦100,000)
        return total - 2000;
    } else {
        // Tier 2: Mid-range (2% Fee)
        return Math.floor(total * 0.98);
    }
};

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
    res.status(200).end(); // Always acknowledge 200 to FLW first to prevent unnecessary retries

    if (payload.event !== 'charge.completed' || payload.status !== 'successful') return;

    try {
        const data = payload.data || payload;
        const flwId = data.id;
        const reference = data.tx_ref || data.txRef; 
        const orderRef = data.order_ref || data.orderRef;

        // 1. Re-verify with Flutterwave API (Security against payload spoofing)
        const verifiedData = await paymentProvider.verifyTransaction(flwId);
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
            walletCreditAmount = Number(existingTx.amount);
            isExistingTransaction = true;
        } 
        // CASE B: Dedicated Virtual Account Transfer
        else if (reference && reference.startsWith('VA-REG-')) {
            const parts = reference.split('-');
            userId = parts.slice(3).join('-'); 
            internalReference = `VA-IN-${flwId}`;
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
                // updateMany acts as an atomic lock. It only updates if status is NOT SUCCESS.
                const updateResult = await tx.transaction.updateMany({
                    where: { 
                        reference: internalReference,
                        status: { not: TransactionStatus.SUCCESS } 
                    },
                    data: {
                        status: TransactionStatus.SUCCESS,
                        providerReference: String(flwId),
                        fee: platformFee
                    }
                });

                if (updateResult.count === 0) {
                    console.log(`[Webhook] Duplicate Gateway webhook suppressed: ${flwId}`);
                    return; // Another thread already updated this to SUCCESS
                }
                isNewSuccess = true;
            } else {
                // CREATE FLOW: For Virtual Accounts where no prior record exists.
                // We rely on the DB's unique constraint on `providerReference` to prevent duplicates.
                try {
                    await tx.transaction.create({
                        data: {
                            userId,
                            amount: walletCreditAmount,
                            fee: platformFee,
                            type: 'WALLET_FUNDING',
                            status: TransactionStatus.SUCCESS,
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
                    throw e; // Throw unexpected errors so the transaction rolls back
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

                console.log(`[Webhook] SUCCESS: User ${userId} wallet +₦${walletCreditAmount}`);
            }
        });

    } catch (error) {
        console.error("[Webhook] Logic Error:", error.message);
    }
};

module.exports = { handleFlutterwaveWebhook };