const { z } = require('zod');
const bcrypt = require('bcryptjs');
const prisma = require('@/lib/prisma');

const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS) || 12;

const changePinSchema = z.object({
    password: z.string().min(1, "Account password is required to change PIN"),
    newPin: z.string().regex(/^\d{4}$/, "New Transaction PIN must be exactly 4 digits")
});

const formatZodError = (error) => {
    return error.issues.map(err => err.message).join(", ");
};

const changePin = async (req, res) => {
    try {
        const validation = changePinSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                status: "ERROR",
                message: formatZodError(validation.error)
            });
        }

        const { password, newPin } = validation.data;
        const userId = req.user.id;

        // 1. Verify User exists and fetch their password hash
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            return res.status(404).json({
                status: "ERROR",
                message: "User account not found."
            });
        }

        // 2. Verify their main account password
        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

        if (!isPasswordValid) {
            return res.status(401).json({
                status: "ERROR",
                message: "Incorrect account password. Cannot change PIN."
            });
        }

        // 3. Hash the new 4-digit PIN
        const hashedPin = await bcrypt.hash(newPin, SALT_ROUNDS);

        // 4. Update the DB
        await prisma.user.update({
            where: { id: userId },
            data: {
                transactionPin: hashedPin
            }
        });

        res.status(200).json({
            status: "OK",
            message: "Transaction PIN successfully updated."
        });

    } catch (error) {
        console.error("Change PIN Error:", error);
        res.status(500).json({
            status: "ERROR",
            message: "An internal error occurred while changing PIN."
        });
    }
};

module.exports = changePin;
