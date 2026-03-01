const prisma = require('@/lib/prisma');
const { TransactionStatus } = require('@prisma/client');
const { getIO } = require('@/lib/socket');

/**
 * VTPass Webhook Handler
 * Endpoint where VTPass sends transaction updates (e.g. delivered, reversed)
 */
const handleVTPassWebhook = async (req, res) => {
    // 1. MUST immediately acknowledge receipt with "success" as requested by VTPass docs
    res.status(200).json({ response: "success" });

    try {
        const payload = req.body;
        if (!payload || !payload.type) {
            console.warn('[VTPass Webhook] Received invalid payload format');
            return;
        }

        const { type, data } = payload;

        if (type === 'transaction-update') {
            await processTransactionUpdate(data);
        } else {
            console.log(`[VTPass Webhook] Ignored event type: ${type}`);
        }
    } catch (error) {
        console.error("[VTPass Webhook] Logic Error:", error.message);
    }
};

/**
 * Handles the 'transaction-update' event
 */
const processTransactionUpdate = async (data) => {
    if (!data) return;

    const { code, content, response_description, amount, requestId, purchased_code } = data;

    // Safety check for content structure
    const txContent = content?.transactions;
    if (!txContent) {
        console.warn(`[VTPass Webhook] Missing content.transactions for Ref: ${requestId}`);
        return;
    }

    const providerStatus = txContent.status; // e.g., 'delivered', 'reversed'
    const transactionId = txContent.transactionId; // VTpass identifier

    if (!requestId) {
        console.warn(`[VTPass Webhook] Missing requestId in payload`);
        return;
    }

    // 1. Fetch transaction from DB to check status
    const existingTx = await prisma.transaction.findUnique({
        where: { reference: requestId }
    });

    if (!existingTx) {
        console.log(`[VTPass Webhook] Skipping Ref ${requestId}: Transaction not found.`);
        return;
    }

    if (existingTx.status !== TransactionStatus.PENDING) {
        console.log(`[VTPass Webhook] Skipping Ref ${requestId}: Already processed (Status: ${existingTx.status}).`);
        return;
    }

    const userId = existingTx.userId;

    // 2. Identify Success or Reversal
    if (providerStatus === 'delivered' && (code === '000' || code === '099')) {
        // SUCCESSFUL Transaction

        let tokenToSave = purchased_code || txContent.token || txContent.metertoken || null;

        // Update DB
        await prisma.transaction.update({
            where: { id: existingTx.id },
            data: {
                status: TransactionStatus.SUCCESS,
                providerReference: transactionId,
                providerStatus: response_description,
                metadata: {
                    ...(typeof existingTx.metadata === 'object' ? existingTx.metadata : {}),
                    token: tokenToSave,
                    webhookPayload: {
                        deliveredAt: new Date().toISOString() // Track when it arrived
                    }
                }
            }
        });

        // Emit Socket event to User for real-time frontend update
        try {
            getIO().to(userId).emit('transaction_update', {
                status: 'SUCCESS',
                type: existingTx.type,
                amount: existingTx.amount,
                reference: requestId,
                token: tokenToSave,
                metadata: existingTx.metadata
            });
        } catch (socketErr) {
            console.error("[Socket Error]", socketErr.message);
        }

        console.log(`[VTPass Webhook] SUCCESS: Ref ${requestId} delivered. Token: ${tokenToSave ? 'Yes' : 'No'}`);

    } else if (providerStatus === 'reversed' || code === '040' || providerStatus === 'failed') {
        // REVERSAL OR FAILURE => Refund Wallet
        const amountToRefund = Number(existingTx.amount);

        await prisma.$transaction(async (tx) => {
            // Mark Transaction as Failed
            await tx.transaction.update({
                where: { id: existingTx.id },
                data: {
                    status: TransactionStatus.FAILED,
                    providerReference: transactionId,
                    providerStatus: response_description,
                    metadata: {
                        ...(typeof existingTx.metadata === 'object' ? existingTx.metadata : {}),
                        webhookPayload: {
                            reversedAt: new Date().toISOString(),
                            reason: response_description
                        }
                    }
                }
            });

            // Refund User Wallet immediately
            await tx.wallet.update({
                where: { userId },
                data: {
                    balance: { increment: amountToRefund },
                    totalSpent: { decrement: amountToRefund }
                }
            });
        });

        // Emit Socket event to notify User
        try {
            getIO().to(userId).emit('transaction_update', {
                status: 'FAILED',
                type: existingTx.type,
                amount: amountToRefund,
                reference: requestId,
                message: "Transaction reversed, waller refunded."
            });
        } catch (socketErr) {
            console.error("[Socket Error]", socketErr.message);
        }

        console.log(`[VTPass Webhook] REVERSED: Ref ${requestId}. Refunded ₦${amountToRefund} to user ${userId}.`);
    } else {
        console.log(`[VTPass Webhook] Ignored Status: ${providerStatus} for Ref ${requestId}`);
    }
};

module.exports = { handleVTPassWebhook };
