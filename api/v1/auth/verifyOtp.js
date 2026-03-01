const { z } = require('zod');
const prisma = require('@/lib/prisma');

const verifyOtpSchema = z.object({
    email: z.string().email("Invalid email format").toLowerCase().trim(),
    otp: z.string().length(6, "OTP must be 6 digits"),
});

const verifyOtp = async (req, res) => {
    try {
        const validation = verifyOtpSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                status: "ERROR",
                message: validation.error.issues[0].message
            });
        }

        const { email, otp } = validation.data;

        const record = await prisma.passwordResetOTP.findFirst({
            where: {
                email,
                otp,
                expiresAt: {
                    gt: new Date()
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        if (!record) {
            return res.status(400).json({
                status: "ERROR",
                message: "Invalid or expired OTP"
            });
        }

        res.status(200).json({
            status: "OK",
            message: "OTP verified successfully. You can now reset your password."
        });

    } catch (error) {
        console.error("Verify OTP Error:", error);
        res.status(500).json({
            status: "ERROR",
            message: "An internal error occurred"
        });
    }
}

module.exports = verifyOtp;
