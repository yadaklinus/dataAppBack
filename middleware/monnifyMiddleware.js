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
    console.log("hit")
    const MONNIFY_SECRET = process.env.MONNIFY_SECRET_KEY;
    const signature = req.headers['monnify-signature'];

    // 1. Security: Verify HMAC-SHA512 Signature
    // Monnify sends the hash of the raw request body
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

    // We only care about successful transactions
    if (eventType !== 'SUCCESSFUL_TRANSACTION' || eventData.paymentStatus !== 'PAID') {
        return;
    }

    try {
        const flwId = eventData.transactionReference; // Monnify's internal ID
        const paymentRef = eventData.paymentReference; // Our internal Ref (e.g., FUND-MNFY-...)
        const amountPaid = Number(eventData.amountPaid);

        // 3. Double-Check via API (Safety)
        const verifiedData = await monnifyProvider.verifyTransaction(paymentRef);
        if (verifiedData.status !== 'successful') return;

        let userId;
        let internalReference = paymentRef;
        let walletCreditAmount = 0;

        // 4. Determine Association (Gateway vs Dedicated Account)
        const productType = eventData.product?.type;

        if (productType === 'RESERVED_ACCOUNT') {
            // CASE: Dedicated Virtual Account
            // product.reference is what we stored in KycData.accountReference
            const accountRef = eventData.product.reference;
            const kycRecord = await prisma.kycData.findUnique({
                where: { accountReference: accountRef }
            });

            if (!kycRecord) {
                console.error(`[Monnify] Unlinked Reserved Account: ${accountRef}`);
                return;
            }
            
            userId = kycRecord.userId;
            internalReference = `VA-MNFY-${flwId}`; // Unique ref for this specific credit
            walletCreditAmount = getWalletCreditAmount(amountPaid);
        } else {
            // CASE: Standard Gateway (One-time payment)
            // Extract userId from our FUND-MNFY-timestamp-uuid format
            // const parts = paymentRef.split('-');
            // userId = parts.slice(3).join('-');

            const existingTx = await prisma.transaction.findUnique({
                where: { reference: paymentRef }
            });

            if (!existingTx) {
                console.error(`[Webhook] Unknown reference: ${reference}`);
                return; // Reject unknown references
            }


            userId = existingTx.userId

            // Use the principal amount we calculated during initialization
            walletCreditAmount = getWalletCreditAmount(amountPaid);
        }

        if (!userId) return;

        const fee = amountPaid - walletCreditAmount;

        // 5. Atomic DB Update (Idempotent)
        await prisma.$transaction(async (tx) => {
            // Prevent double-crediting

            
             try {
                await tx.transaction.upsert({
                where: { reference: internalReference },
                update: {
                    status: TransactionStatus.SUCCESS,
                    providerReference: flwId,
                    fee: fee
                },
                create: {
                    userId,
                    amount: walletCreditAmount,
                    fee: fee,
                    type: TransactionType.WALLET_FUNDING,
                    status: TransactionStatus.SUCCESS,
                    reference: internalReference,
                    providerReference: flwId,
                    metadata: {
                        method: eventData.paymentMethod,
                        monnifyRef: flwId,
                        totalReceived: amountPaid
                        }
                    }
                });
                // Only increment wallet AFTER confirmed transaction record
                await tx.wallet.update({
                    where: { userId },
                    data: { balance: { increment: walletCreditAmount } }
                });

            } catch (e) {
                if (e.code === 'P2002') {
                    console.log(`[Webhook] Duplicate suppressed: ${flwId}`);
                    return; // Already processed by concurrent request
                }
                throw e;
            }

            console.log(`[Monnify Webhook] Credited User ${userId} with ₦${walletCreditAmount}`);
        });

    } catch (error) {
        console.error('[Monnify Webhook Error]:', error.message);
    }
};

module.exports = { handleMonnifyWebhook };