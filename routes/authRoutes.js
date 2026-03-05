const express = require("express")
const login = require("@/api/v1/auth/login")
const register = require("@/api/v1/auth/register")
const { refresh, logout } = require("@/api/v1/auth/refresh")
const forgotPassword = require("@/api/v1/auth/forgotPassword")
const verifyOtp = require("@/api/v1/auth/verifyOtp")
const resetPassword = require("@/api/v1/auth/resetPassword")
const changePin = require("@/api/v1/auth/changePin")
const { createStaff, loginStaff, forcePasswordReset, getAllStaff } = require("@/api/v1/auth/staffAuthController")
const { authMiddleware, requireSuperAdmin } = require("@/middleware/authMiddleware")

const router = express.Router()

router.get("/", (req, res) => {
    res.json("new")
})

router.post("/login", login) // LOGIN
router.post("/register", register) // REGISTER
router.post("/refresh", refresh) // REFRESH SESSION
router.post("/logout", logout) // LOGOUT/REVOKE

router.post("/forgot-password", forgotPassword) // FORGOT PASSWORD
router.post("/verify-otp", verifyOtp) // VERIFY OTP
router.post("/reset-password", resetPassword) // RESET PASSWORD

// AUTHENTICATED USER ROUTES
router.post("/change-pin", authMiddleware, changePin) // CHANGE TRANSACTION PIN

// STAFF AUTHENTICATION
router.post("/staff/login", loginStaff) // STAFF LOGIN
router.post("/staff/force-reset", forcePasswordReset) // STAFF FORCE PASSWORD RESET
router.get("/staff", authMiddleware, requireSuperAdmin, getAllStaff) // SUPER ADMIN LIST STAFF
router.post("/staff/create", authMiddleware, requireSuperAdmin, createStaff) // SUPER ADMIN CREATE STAFF

module.exports = router