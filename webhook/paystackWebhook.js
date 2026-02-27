const prisma = require('@/lib/prisma');
const paystackProvider = require('@/services/paystackProvider');
const { TransactionStatus } = require('@prisma/client');
const crypto = require('crypto');
const { getWalletCreditAmount } = require('@/lib/paymentUtils');

/**
 * Logic: Reverse-calculate the principal to credit the wallet
 * based on the ₦40 / 2% / ₦2000 fee structure.
 */

/**
 * Paystack Webhook Handler
 */
const handlePaystackWebhook = async (req, res) => {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const signature = req.headers['x-paystack-signature'];

    // 1. Validate Event Origin
    const hash = crypto.createHmac('sha512', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');

    if (hash !== signature) {
        console.warn('[Paystack Webhook] Invalid signature from IP:', req.ip);
        return res.status(401).end();
    }

    // Always acknowledge 200 to Paystack immediately to avoid timeouts
    res.status(200).end();

    const { event, data } = req.body;

    try {
        // CASE A: Successful Payment
        if (event === 'charge.success') {
            await handleChargeSuccess(data);
        }
        // CASE B: Dedicated Account Assignment
        else if (event === 'dedicatedaccount.assign.success') {
            await handleDvaAssignment(data);
        }
        else {
            console.log(`[Paystack Webhook] Ignored event: ${event}`);
        }
    } catch (error) {
        console.error("[Paystack Webhook] Logic Error:", error.message);
    }
};

/**
 * Handle successful payment charge
 */
const handleChargeSuccess = async (data) => {
    const reference = data.reference;
    const amount = data.amount / 100; // Paystack amount is in kobo
    const pstkId = String(data.id);

    // 1. Verify with Paystack API (Security check)
    const verifiedData = await paystackProvider.verifyTransaction(reference);
    if (verifiedData.status !== 'success') {
        console.error(`[Paystack Webhook] Verification failed for Ref: ${reference}`);
        return;
    }

    const totalPaid = Number(verifiedData.amount);
    const walletCreditAmount = getWalletCreditAmount(totalPaid);

    // 2. Atomic DB Update
    await prisma.$transaction(async (tx) => {
        // Check for existing pending transaction
        const existingTx = await tx.transaction.findUnique({
            where: { reference }
        });

        if (!existingTx || existingTx.status !== TransactionStatus.PENDING) {
            console.log(`[Paystack Webhook] Skipping: Ref ${reference} already processed or unknown.`);
            return;
        }

        const userId = existingTx.userId;
        const platformFee = Math.max(0, totalPaid - walletCreditAmount);

        // Update Wallet
        await tx.wallet.update({
            where: { userId },
            data: { balance: { increment: walletCreditAmount } }
        });

        // Update Transaction
        await tx.transaction.update({
            where: { id: existingTx.id },
            data: {
                status: TransactionStatus.SUCCESS,
                providerReference: pstkId,
                fee: platformFee,
                metadata: {
                    ...existingTx.metadata,
                    webhookPayload: {
                        channel: data.channel,
                        paidAt: data.paid_at
                    }
                }
            }
        });

        // 🟢 Emit WebSocket Event for Wallet Funding
        const { getIO } = require('@/lib/socket');
        try {
            getIO().to(userId).emit('wallet_funded', {
                amount: walletCreditAmount,
                method: data.channel || 'paystack',
                reference: reference
            });
        } catch (socketErr) {
            console.error("[Socket Error]", socketErr.message);
        }

        console.log(`[Paystack Webhook] SUCCESS: User ${userId} wallet +₦${walletCreditAmount}`);
    });
};

/**
 * Handle successful dedicated account assignment
 */
const handleDvaAssignment = async (data) => {
    const customerEmail = data.customer.email;
    const bankDetails = data.dedicated_account;

    if (!bankDetails) return;

    try {
        const user = await prisma.user.findUnique({
            where: { email: customerEmail },
            include: { kycData: true }
        });

        if (!user || !user.kycData) {
            console.error(`[Paystack Webhook] User not found for DVA: ${customerEmail}`);
            return;
        }

        await prisma.kycData.update({
            where: { userId: user.id },
            data: {
                virtualAccountNumber: bankDetails.account_number,
                bankName: bankDetails.bank.name,
                status: 'VERIFIED',
                verifiedAt: new Date()
            }
        });

        console.log(`[Paystack Webhook] DVA Assigned: ${customerEmail} | ${bankDetails.account_number}`);
    } catch (error) {
        console.error("[Paystack Webhook] DVA Logic Error:", error.message);
    }
};

module.exports = { handlePaystackWebhook };
