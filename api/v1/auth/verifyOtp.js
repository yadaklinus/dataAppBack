const { z } = require('zod');
const prisma = require('@/lib/prisma');
const bcrypt = require('bcryptjs');

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
                message: "No active OTP found for this email. Please request a new one."
            });
        }

        // --- BRUTE FORCE PROTECTION ---
        if (record.attempts >= 5) {
            return res.status(429).json({
                status: "ERROR",
                message: "Too many failed attempts. This OTP has been locked. Please request a new one."
            });
        }

        const isOtpValid = await bcrypt.compare(otp, record.otp);

        if (!isOtpValid) {
            // Increment failed attempts
            await prisma.passwordResetOTP.update({
                where: { id: record.id },
                data: {
                    attempts: { increment: 1 }
                }
            });

            return res.status(400).json({
                status: "ERROR",
                message: "Invalid OTP"
            });
        }

        // Success - optionally mark as verified or just return success
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
