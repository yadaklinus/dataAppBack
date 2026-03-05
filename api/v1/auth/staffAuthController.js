const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const prisma = require('@/lib/prisma');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

const createStaffSchema = z.object({
    email: z.string().email("Invalid email format").toLowerCase().trim(),
    fullName: z.string().min(2, "Full name is required"),
    role: z.enum(['TICKETING_OFFICER', 'SUPER_ADMIN']).default('TICKETING_OFFICER')
});

const loginStaffSchema = z.object({
    email: z.string().email("Invalid email format").toLowerCase().trim(),
    password: z.string().min(6, "Password must be at least 6 characters")
});

const forceResetSchema = z.object({
    email: z.string().email("Invalid email").toLowerCase().trim(),
    oldPassword: z.string(),
    newPassword: z.string().min(8, "New password must be at least 8 characters")
});

/**
 * Super Admin creating a new staff member
 * @route POST /api/v1/auth/staff/create
 */
const createStaff = async (req, res) => {
    try {
        const validation = createStaffSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                status: "ERROR",
                message: validation.error.issues[0].message
            });
        }

        const { email, fullName, role } = validation.data;

        // Check if email exists
        const existingStaff = await prisma.staff.findUnique({ where: { email } });
        if (existingStaff) {
            return res.status(409).json({ status: "ERROR", message: "Email already exists in the system." });
        }

        // Default password assignment
        const defaultPassword = "Muftipaystaff@12345";
        const passwordHash = await bcrypt.hash(defaultPassword, 10);

        const newStaff = await prisma.staff.create({
            data: {
                email,
                fullName,
                passwordHash,
                role,
                requiresPasswordChange: true
            }
        });

        res.status(201).json({
            status: "OK",
            message: "Staff member created successfully",
            data: {
                id: newStaff.id,
                email: newStaff.email,
                fullName: newStaff.fullName,
                role: newStaff.role
            }
        });

    } catch (error) {
        console.error("Create Staff Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to create staff member" });
    }
};

/**
 * Staff Login
 * @route POST /api/v1/auth/staff/login
 */
const loginStaff = async (req, res) => {
    try {
        const validation = loginStaffSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                status: "ERROR",
                message: validation.error.issues[0].message
            });
        }

        const { email, password } = validation.data;

        const staff = await prisma.staff.findUnique({ where: { email } });

        if (!staff || !staff.isActive) {
            return res.status(401).json({ status: "ERROR", message: "Invalid credentials or inactive account." });
        }

        const isPasswordValid = await bcrypt.compare(password, staff.passwordHash);

        if (!isPasswordValid) {
            return res.status(401).json({ status: "ERROR", message: "Invalid credentials." });
        }

        // FORCE PASSWORD RESET CHECK
        if (staff.requiresPasswordChange) {
            return res.status(403).json({
                status: "FORCE_RESET_REQUIRED",
                message: "This is your first login. You must change your default password.",
                data: {
                    email: staff.email
                }
            });
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: staff.id, isStaff: true },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.status(200).json({
            status: "OK",
            message: "Login successful",
            data: {
                token,
                user: {
                    id: staff.id,
                    email: staff.email,
                    fullName: staff.fullName,
                    role: staff.role
                }
            }
        });

    } catch (error) {
        console.error("Staff Login Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to login" });
    }
};

/**
 * Handle mandatory first-time password reset
 * @route POST /api/v1/auth/staff/force-reset
 */
const forcePasswordReset = async (req, res) => {
    try {
        const validation = forceResetSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                status: "ERROR",
                message: validation.error.issues[0].message
            });
        }

        const { email, oldPassword, newPassword } = validation.data;

        console.log(email, oldPassword, newPassword);

        const staff = await prisma.staff.findUnique({ where: { email } });

        console.log(staff);

        if (!staff || !staff.isActive) {
            return res.status(401).json({ status: "ERROR", message: "Account not found." });
        }

        if (!staff.requiresPasswordChange) {
            return res.status(400).json({ status: "ERROR", message: "Password has already been reset." });
        }

        const isPasswordValid = await bcrypt.compare(oldPassword, staff.passwordHash);

        console.log("isPasswordValid", isPasswordValid);

        if (!isPasswordValid) {
            return res.status(401).json({ status: "ERROR", message: "Invalid old password." });
        }

        if (oldPassword === newPassword) {
            return res.status(400).json({ status: "ERROR", message: "New password cannot be the same as the default password." });
        }

        const newHash = await bcrypt.hash(newPassword, 10);

        console.log("newHash", newHash);

        const updatedStaff = await prisma.staff.update({
            where: { email },
            data: {
                passwordHash: newHash,
                requiresPasswordChange: false
            }
        });

        // Generate JWT
        const token = jwt.sign(
            { userId: updatedStaff.id, isStaff: true },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.status(200).json({
            status: "OK",
            message: "Password changed successfully. You are now logged in.",
            data: {
                token,
                user: {
                    id: updatedStaff.id,
                    email: updatedStaff.email,
                    fullName: updatedStaff.fullName,
                    role: updatedStaff.role
                }
            }
        });

    } catch (error) {
        console.error("Force Reset Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to reset password" });
    }
};

/**
 * Get all staff members (Super Admin only)
 * @route GET /api/v1/auth/staff
 */
const getAllStaff = async (req, res) => {
    try {
        const staff = await prisma.staff.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                email: true,
                fullName: true,
                role: true,
                isActive: true,
                requiresPasswordChange: true,
                createdAt: true
            }
        });

        // Map backend field names to frontend expectations if necessary
        // The frontend expects 'isFirstLogin' for 'requiresPasswordChange'
        const formattedStaff = staff.map(s => ({
            ...s,
            isFirstLogin: s.requiresPasswordChange
        }));

        res.status(200).json({
            status: "OK",
            data: formattedStaff
        });
    } catch (error) {
        console.error("Get All Staff Error:", error);
        res.status(500).json({ status: "ERROR", message: "Failed to fetch staff list" });
    }
};

module.exports = {
    createStaff,
    loginStaff,
    forcePasswordReset,
    getAllStaff
};
