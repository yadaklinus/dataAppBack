const { z } = require('zod');
const prisma = require('@/lib/prisma');
const vtpassProvider = require('@/services/vtpassProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');
const { generateRef, generateVTPassRef } = require('@/lib/crypto');
const { isNetworkError, safeRefund } = require('@/lib/financialSafety');
const bcrypt = require('bcryptjs');

// --- SCHEMAS ---

const verifyMeterSchema = z.object({
    discoCode: z.string().min(2, "Invalid Disco Code"),
    meterNo: z.string().min(5, "Meter number is too short").max(20, "Meter number is too long"),
    meterType: z.enum(["01", "02"], { errorMap: () => ({ message: "Meter type must be 01 (Prepaid) or 02 (Postpaid)" }) })
});

const purchaseElectricitySchema = z.object({
    discoCode: z.string().min(2),
    meterNo: z.string().min(5),
    meterType: z.enum(["01", "02"]),
    amount: z.number().min(100, "Minimum purchase is ₦100").max(500000, "Maximum purchase limit exceeded"),
    transactionPin: z.string().length(4, "Transaction PIN must be 4 digits")
});

/**
 * Helper: Format Zod errors into a readable string
 * Fix: Access .issues instead of .errors
 */
const formatZodError = (error) => {
    if (!error || !error.issues) return "Validation failed";
    return error.issues.map(err => err.message).join(", ");
};

const getDiscos = async (req, res) => {
    try {
        const vtpassDiscos = await vtpassProvider.fetchElectricityDiscos();
        return res.status(200).json({
            status: "OK",
            data: vtpassDiscos
        });
    } catch (error) {
        console.error("Fetch Discos Error:", error.message);
        return res.status(500).json({ status: "ERROR", message: "Internal server error" });
    }
};

/**
 * Endpoint: Verify Meter
 */
const verifyMeterNumber = async (req, res) => {
    // Validate Query Params
    const validation = verifyMeterSchema.safeParse(req.query);



    if (!validation.success) {
        return res.status(400).json({
            status: "ERROR",
            message: formatZodError(validation.error)
        });
    }

    const { discoCode, meterNo, meterType } = validation.data;

    try {
        const typeStr = meterType === '01' ? 'prepaid' : 'postpaid';
        const result = await vtpassProvider.verifyMeter(discoCode, meterNo, typeStr);

        return res.status(200).json({ status: "OK", data: result });
    } catch (error) {
        return res.status(400).json({ status: "ERROR", message: error.message });
    }
};

/**
 * Endpoint: Pay Bill
 */
const purchaseElectricity = async (req, res) => {
    // Validate Request Body
    const validation = purchaseElectricitySchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({
            status: "ERROR",
            message: formatZodError(validation.error)
        });
    }

    const { discoCode, meterNo, meterType, amount, transactionPin } = validation.data;
    const userId = req.user.id;
    const billAmount = Number(amount);
    let user;

    try {
        // 1. Double-check meter (Safety)
        const typeStr = meterType === '01' ? 'prepaid' : 'postpaid';
        const verification = await vtpassProvider.verifyMeter(discoCode, meterNo, typeStr);

        if (verification.minAmount > billAmount) {
            return res.status(400).json({
                status: "ERROR",
                message: "Minimum purchase amount is ₦" + verification.minAmount
            });
        }

        // --- IDEMPOTENCY CHECK ---
        const idempotencyKey = req.headers['x-idempotency-key'];

        if (idempotencyKey) {
            // Explicit Idempotency
            const existingTx = await prisma.transaction.findFirst({
                where: {
                    userId,
                    type: TransactionType.ELECTRICITY,
                    metadata: { path: ['idempotencyKey'], equals: idempotencyKey }
                }
            });
            if (existingTx) {
                return res.status(409).json({
                    status: "ERROR",
                    message: "A transaction with this idempotency key has already been processed."
                });
            }
        } else {
            // Fallback Time-based Deduplication (60 seconds)
            const sixtySecondsAgo = new Date(Date.now() - 60000);
            const existingTx = await prisma.transaction.findFirst({
                where: {
                    userId,
                    type: TransactionType.ELECTRICITY,
                    amount: billAmount,
                    createdAt: { gte: sixtySecondsAgo },
                    metadata: {
                        path: ['meterNo'], equals: meterNo,
                    }
                }
            });

            if (existingTx && existingTx.metadata && existingTx.metadata.discoCode === discoCode) {
                return res.status(409).json({
                    status: "ERROR",
                    message: "Identical transaction detected within the last minute. Please wait before retrying."
                });
            }
        }

        // 2. Database Atomic Operation
        const result = await prisma.$transaction(async (tx) => {
            // Verify Transaction PIN
            user = await tx.user.findUnique({ where: { id: userId } });
            if (!user) throw new Error("User not found");
            if (!user.transactionPin) throw new Error("Please set up a transaction PIN before making purchases");

            const isPinValid = await bcrypt.compare(transactionPin, user.transactionPin);
            if (!isPinValid) throw new Error("Invalid transaction PIN");

            const walletUpdate = await tx.wallet.updateMany({
                where: {
                    userId,
                    balance: { gte: billAmount }
                },
                data: {
                    balance: { decrement: billAmount },
                    totalSpent: { increment: billAmount }
                }
            });

            if (walletUpdate.count === 0) {
                throw new Error("Insufficient wallet balance");
            }

            const requestId = generateVTPassRef("ELEC")
            const transaction = await tx.transaction.create({
                data: {
                    userId,
                    amount: billAmount,
                    type: TransactionType.ELECTRICITY,
                    status: TransactionStatus.PENDING,
                    reference: requestId,
                    metadata: {
                        discoCode,
                        meterNo,
                        meterType,
                        customerName: verification.customer_name,
                        address: verification.customer_address || verification.Address,
                        token: "",
                        recipient: user.phoneNumber,
                        unit: "",
                        ...(idempotencyKey && { idempotencyKey })
                    }
                }
            });

            return { transaction, requestId };
        }, {
            maxWait: 15000,
            timeout: 30000
        });

        // 3. Call External Provider
        try {
            const providerTypeStr = meterType === '01' ? 'prepaid' : 'postpaid';
            const providerResponse = await vtpassProvider.payElectricityBill(
                discoCode,
                providerTypeStr,
                meterNo,
                billAmount,
                user.phoneNumber,
                result.requestId
            );

            console.log("Gotten From Provider", providerResponse)

            const finalStatus = providerResponse.isPending ? TransactionStatus.PENDING : TransactionStatus.SUCCESS;

            console.log("Address", providerResponse.address === undefined ? "undefined" : "defined")

            await prisma.transaction.update({
                where: { id: result.transaction.id },
                data: {
                    status: finalStatus,
                    providerReference: providerResponse.orderId,
                    providerStatus: providerResponse.status || providerResponse.transactionstatus,
                    metadata: {
                        ...result.transaction.metadata,
                        address: providerResponse.address === undefined ? result.transaction.metadata.address || providerResponse.customerAddress : providerResponse.address,
                        token: providerResponse.token || providerResponse.metertoken,
                        units: providerResponse.units || providerResponse.PurchasedUnits
                    }
                }
            });

            if (providerResponse.isPending) {
                return res.status(202).json({
                    status: "PENDING",
                    message: "Electricity payment is processing. Please check status history for your token.",
                    transactionId: result.requestId
                });
            }

            return res.status(200).json({
                status: "OK",
                message: "Electricity bill paid successfully",
                token: providerResponse.token || providerResponse.metertoken,
                units: providerResponse.units,
                customerName: verification.customer_name,
                transactionId: result.requestId
            });

        } catch (apiError) {
            if (isNetworkError(apiError)) {
                console.warn(`[Financial Safety] Timeout for Ref: ${result.requestId}. Leaving PENDING.`);
                return res.status(202).json({
                    status: "PENDING",
                    message: "Process delayed due to network. Please check status history for your token.",
                    transactionId: result.requestId
                });
            }

            // 5. AUTO-REFUND with retry logic
            await safeRefund(prisma, userId, billAmount, result.transaction.id);

            return res.status(502).json({
                status: "ERROR",
                message: apiError.message || "Provider error. Your wallet has been refunded."
            });
        }

    } catch (error) {
        console.error("Electricity Purchase Error:", error.message);
        return res.status(error.message === "Insufficient wallet balance" ? 402 : 500).json({
            status: "ERROR",
            message: error.message || "Internal server error"
        });
    }
};

module.exports = { verifyMeterNumber, purchaseElectricity, getDiscos };