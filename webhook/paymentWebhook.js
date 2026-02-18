const prisma = require('@/lib/prisma');
const paymentProvider = require('@/services/paymentProvider');
const { TransactionStatus } = require('@prisma/client');

/**
 * Flutterwave Webhook Handler
 * Handles: charge.completed
 */
const handleFlutterwaveWebhook = async (req, res) => {
    // 1. SECURITY: Verify Secret Hash
    const secretHash = process.env.FLW_WEBHOOK_HASH;
    const signature = req.headers['verif-hash'];

    if (!signature || signature !== secretHash) {
        // Discard request if signature is missing or wrong
        return res.status(401).end();
    }

    const payload = req.body;

    // 2. ACKNOWLEDGE RECEIPT IMMEDIATELY
    // Flutterwave times out after 60s. We respond 200 now and process logic after.
    res.status(200).end();

    // 3. VALIDATE EVENT TYPE
    if (payload.event !== 'charge.completed') return;

    try {
        const { id, amount, currency, tx_ref, flw_ref, status } = payload.data;

        // 4. BEST PRACTICE: Re-verify transaction with Flutterwave API
        // This prevents "Man-in-the-Middle" attacks where someone fakes a payload.
        const verifiedData = await paymentProvider.verifyTransaction(id);

        if (
            verifiedData.status !== "successful" ||
            verifiedData.amount < amount || // Ensure amount wasn't tampered
            verifiedData.currency !== "NGN"
        ) {
            console.error(`Verification failed for Tx ID: ${id}`);
            return;
        }

        // 5. IDENTIFY THE USER
        let userId;
        let internalReference = tx_ref;

        if (tx_ref && tx_ref.startsWith('FUND-')) {
            // Case A: Gateway Payment (Link/Card)
            userId = tx_ref.split('-')[2];
        } else {
            // Case B: Virtual Account Transfer
            // FLW sends the account's order_ref in the payload
            const orderRef = payload.data.order_ref;
            const kycRecord = await prisma.kycData.findUnique({
                where: { accountReference: orderRef }
            });
            userId = kycRecord?.userId;
            internalReference = `VA-IN-${id}`; // Create a reference for VA funding
        }

        if (!userId) {
            console.error(`User not found for payment ID: ${id}`);
            return;
        }

        // 6. IDEMPOTENCY: Atomic Update & Duplicate Check
        // We use a database transaction to ensure logic is safe.
        await prisma.$transaction(async (tx) => {
            // Check if this Flutterwave ID has already been processed
            const alreadyProcessed = await tx.transaction.findUnique({
                where: { providerReference: String(id) }
            });

            if (alreadyProcessed && alreadyProcessed.status === TransactionStatus.SUCCESS) {
                return; // Exit if already funded
            }

            // Update or Create the Transaction Record
            await tx.transaction.upsert({
                where: { reference: internalReference },
                update: {
                    status: TransactionStatus.SUCCESS,
                    providerReference: String(id),
                },
                create: {
                    userId,
                    amount: verifiedData.amount,
                    type: 'WALLET_FUNDING',
                    status: TransactionStatus.SUCCESS,
                    reference: internalReference,
                    providerReference: String(id),
                    metadata: { 
                        method: payload.data.payment_type,
                        flw_ref: flw_ref 
                    }
                }
            });

            // Increment the user's wallet
            await tx.wallet.update({
                where: { userId },
                data: {
                    balance: { increment: verifiedData.amount }
                }
            });

            console.log(`Successfully funded User ${userId} with ₦${verifiedData.amount}`);
        });

    } catch (error) {
        console.error("CRITICAL: Webhook Processing Failed", error.message);
    }
};

module.exports = { handleFlutterwaveWebhook };