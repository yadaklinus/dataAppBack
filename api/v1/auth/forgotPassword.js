const { z } = require('zod');
const prisma = require('@/lib/prisma');
const sendEmail = require('@/lib/mailer');
const { generateOtpEmailTemplate } = require('@/lib/emailTemplates');
const crypto = require('crypto');

const forgotPasswordSchema = z.object({
    email: z.string().email("Invalid email format").toLowerCase().trim(),
});

const forgotPassword = async (req, res) => {
    try {
        const validation = forgotPasswordSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                status: "ERROR",
                message: validation.error.issues[0].message
            });
        }

        const { email } = validation.data;

        // Check if user exists
        const user = await prisma.user.findUnique({
            where: { email }
        });

        if (!user) {
            // For security reasons, don't reveal if user exists
            return res.status(200).json({
                status: "OK",
                message: "If an account exists with this email, an OTP has been sent."
            });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

        // Save OTP to database
        await prisma.passwordResetOTP.create({
            data: {
                email,
                otp,
                expiresAt
            }
        });

        // Send Email
        await sendEmail({
            to: email,
            subject: "Mufti Pay - Password Reset OTP",
            text: `Your OTP for password reset is: ${otp}. It expires in 10 minutes.`,
            html: generateOtpEmailTemplate(otp, user.fullName || "Valued Customer")
        });

        res.status(200).json({
            status: "OK",
            message: "If an account exists with this email, an OTP has been sent."
        });

    } catch (error) {
        console.error("Forgot Password Error:", error);
        res.status(500).json({
            status: "ERROR",
            message: "An internal error occurred"
        });
    }
}

module.exports = forgotPassword;
