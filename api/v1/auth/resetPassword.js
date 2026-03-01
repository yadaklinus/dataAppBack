const { z } = require('zod');
const bcrypt = require('bcrypt');
const prisma = require('@/lib/prisma');
const SALT_ROUNDS = 12;

const resetPasswordSchema = z.object({
    email: z.string().email("Invalid email format").toLowerCase().trim(),
    otp: z.string().length(6, "OTP must be 6 digits"),
    password: z.string()
        .min(8, "Password must be at least 8 characters long")
        .regex(/[a-z]/, "Password must contain at least one lowercase letter")
        .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
        .regex(/[0-9]/, "Password must contain at least one number")
        .regex(/[^a-zA-Z0-9]/, "Password must contain at least one special character")
});

const resetPassword = async (req, res) => {
    try {
        const validation = resetPasswordSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                status: "ERROR",
                message: validation.error.issues[0].message
            });
        }

        const { email, otp, password } = validation.data;

        // Verify OTP one last time
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

        // Hash new password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // Update user password and delete used OTPs
        await prisma.$transaction([
            prisma.user.update({
                where: { email },
                data: { passwordHash: hashedPassword }
            }),
            prisma.passwordResetOTP.deleteMany({
                where: { email }
            })
        ]);

        res.status(200).json({
            status: "OK",
            message: "Password reset successful. You can now login with your new password."
        });

    } catch (error) {
        console.error("Reset Password Error:", error);
        res.status(500).json({
            status: "ERROR",
            message: "An internal error occurred"
        });
    }
}

module.exports = resetPassword;
