const crypto = require('crypto');
const prisma = require('@/lib/prisma');
const monnifyProvider = require('@/services/monnifyProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');

/**
 * Internal helper to calculate wallet credit based on tiered fees:
 * ₦40 flat for <= 2500, 2% for mid, ₦2000 cap for > 100k
 */
const getWalletCreditAmount = (totalReceived) => {
    const total = Number(totalReceived);
    if (total <= 40) return 0;

    if (total <= 2540) return total - 40;
    if (total > 102000) return total - 2000;
    return Math.floor(total * 0.98);
};

function safeCompare(a, b) {
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch { return false; }
}

const handleMonnifyWebhook = async (req, res) => {
    const MONNIFY_SECRET = process.env.MONNIFY_SECRET_KEY;
    const signature = req.headers['monnify-signature'];

    // 1. Security: Verify HMAC-SHA512 Signature
    const computedHash = crypto
        .createHmac('sha512', MONNIFY_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

    if (!signature || !safeCompare(signature, computedHash)) {
        console.warn("[Monnify Webhook] Invalid signature from IP:", req.ip);
        return res.status(401).end();
    }

    // 2. Immediate Acknowledge (Best Practice)
    res.status(200).end();

    const { eventType, eventData } = req.body;

    if (eventType !== 'SUCCESSFUL_TRANSACTION' || eventData.paymentStatus !== 'PAID') {
        return;
    }

    try {
        const flwId = eventData.transactionReference; // Monnify's internal ID
        const paymentRef = eventData.paymentReference; // Our internal Ref
        const amountPaid = Number(eventData.amountPaid);

        // 3. Double-Check via API (Safety)
        const verifiedData = await monnifyProvider.verifyTransaction(paymentRef);
        if (verifiedData.status !== 'successful') return;

        let userId;
        let internalReference = paymentRef;
        let walletCreditAmount = 0;
        const productType = eventData.product?.type;

        // 4. Determine Association (Gateway vs Dedicated Account)
        if (productType === 'RESERVED_ACCOUNT') {
            const accountRef = eventData.product.reference;
            const kycRecord = await prisma.kycData.findUnique({
                where: { accountReference: accountRef }
            });

            if (!kycRecord) {
                console.error(`[Monnify] Unlinked Reserved Account: ${accountRef}`);
                return;
            }
            
            userId = kycRecord.userId;
            internalReference = `VA-MNFY-${flwId}`; 
            walletCreditAmount = getWalletCreditAmount(amountPaid);
        } else {
            const existingTx = await prisma.transaction.findUnique({
                where: { reference: paymentRef }
            });

            if (!existingTx) {
                // Fix: Changed 'reference' to 'paymentRef' to avoid ReferenceError
                console.error(`[Webhook] Unknown reference: ${paymentRef}`);
                return; 
            }

            userId = existingTx.userId;
            walletCreditAmount = getWalletCreditAmount(amountPaid);
        }

        if (!userId) return;

        const fee = amountPaid - walletCreditAmount;

        // 5. Atomic DB Update (Idempotent & Race-Condition Safe)
        await prisma.$transaction(async (tx) => {
            
            if (productType === 'RESERVED_ACCOUNT') {
                // CASE A: Virtual Account Funding (Create new record)
                try {
                    await tx.transaction.create({
                        data: {
                            userId,
                            amount: walletCreditAmount,
                            fee: fee,
                            type: TransactionType.WALLET_FUNDING,
                            status: TransactionStatus.SUCCESS,
                            reference: internalReference, // Must be mapped as @unique in Prisma schema
                            providerReference: flwId,
                            metadata: {
                                method: eventData.paymentMethod,
                                monnifyRef: flwId,
                                totalReceived: amountPaid
                            }
                        }
                    });
                    
                    // Only hits this if create succeeds (meaning no duplicate existed)
                    await tx.wallet.update({
                        where: { userId },
                        data: { balance: { increment: walletCreditAmount } }
                    });

                } catch (e) {
                    if (e.code === 'P2002') {
                        console.log(`[Webhook] Duplicate Virtual Account webhook suppressed: ${flwId}`);
                        return; // Safely exit, already processed
                    }
                    throw e;
                }
            } else {
                // CASE B: Standard Gateway (Update existing PENDING record)
                // Use updateMany to prevent race conditions. It will only update if NOT already SUCCESS.
                const updateResult = await tx.transaction.updateMany({
                    where: { 
                        reference: internalReference,
                        status: { not: TransactionStatus.SUCCESS } 
                    },
                    data: {
                        status: TransactionStatus.SUCCESS,
                        providerReference: flwId,
                        fee: fee
                    }
                });

                // If count is 0, the record was already marked SUCCESS by a concurrent webhook
                if (updateResult.count === 0) {
                    console.log(`[Webhook] Duplicate Gateway webhook suppressed: ${flwId}`);
                    return; 
                }

                // Only hits this if exactly 1 record was updated from PENDING to SUCCESS
                await tx.wallet.update({
                    where: { userId },
                    data: { balance: { increment: walletCreditAmount } }
                });
            }
            
            // Console log outside the conditional blocks to confirm success
            console.log(`[Monnify Webhook] Credited User ${userId} with ₦${walletCreditAmount}`);
        });

    } catch (error) {
        console.error('[Monnify Webhook Error]:', error.message);
    }
};

module.exports = { handleMonnifyWebhook };