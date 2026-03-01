const { z } = require('zod');
const prisma = require('@/lib/prisma');
const vtpassProvider = require('@/services/vtpassProvider');
const { TransactionStatus, TransactionType } = require('@prisma/client');
const { generateRef } = require('@/lib/crypto')
const { isNetworkError } = require('@/lib/financialSafety');

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
    phoneNo: z.string().regex(/^(\+234|0)[789][01]\d{8}$/, "Invalid Nigerian phone number")
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

    const { discoCode, meterNo, meterType, amount, phoneNo } = validation.data;
    const userId = req.user.id;
    const billAmount = Number(amount);

    try {
        // 1. Double-check meter (Safety)
        const typeStr = meterType === '01' ? 'prepaid' : 'postpaid';
        const verification = await vtpassProvider.verifyMeter(discoCode, meterNo, typeStr);

        // 2. Database Atomic Operation
        const result = await prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.findUnique({ where: { userId } });

            if (!wallet || Number(wallet.balance) < billAmount) {
                throw new Error("Insufficient wallet balance");
            }

            const requestId = generateRef("ELEC")
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
                        address: verification.customer_address,
                        token: "",
                        recipient: phoneNo
                    }
                }
            });

            await tx.wallet.update({
                where: { userId },
                data: {
                    balance: { decrement: billAmount },
                    totalSpent: { increment: billAmount }
                }
            });

            return { transaction, requestId };
        });

        // 3. Call External Provider
        try {
            const providerTypeStr = meterType === '01' ? 'prepaid' : 'postpaid';
            const providerResponse = await vtpassProvider.payElectricityBill(
                discoCode,
                providerTypeStr,
                meterNo,
                billAmount,
                phoneNo,
                result.requestId
            );

            console.log("Gotten From Provider", providerResponse)

            const finalStatus = providerResponse.isPending ? TransactionStatus.PENDING : TransactionStatus.SUCCESS;

            await prisma.transaction.update({
                where: { id: result.transaction.id },
                data: {
                    status: finalStatus,
                    providerReference: providerResponse.orderId,
                    providerStatus: providerResponse.status || providerResponse.transactionstatus,
                    metadata: {
                        ...result.transaction.metadata,
                        token: providerResponse.token || providerResponse.metertoken
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

            // 🟢 Emit WebSocket Event
            const { getIO } = require('@/lib/socket');
            try {
                getIO().to(userId).emit('transaction_update', {
                    status: 'SUCCESS',
                    type: 'ELECTRICITY',
                    amount: billAmount,
                    reference: result.requestId,
                    metadata: {
                        discoCode,
                        meterNo,
                        token: providerResponse.token || providerResponse.metertoken
                    }
                });
            } catch (socketErr) {
                console.error("[Socket Error]", socketErr.message);
            }

            return res.status(200).json({
                status: "OK",
                message: "Electricity bill paid successfully",
                token: providerResponse.token || providerResponse.metertoken,
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

            // 5. AUTO-REFUND
            await prisma.$transaction([
                prisma.transaction.update({
                    where: { id: result.transaction.id },
                    data: { status: TransactionStatus.FAILED }
                }),
                prisma.wallet.update({
                    where: { userId },
                    data: {
                        balance: { increment: billAmount },
                        totalSpent: { decrement: billAmount }
                    }
                })
            ]);

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