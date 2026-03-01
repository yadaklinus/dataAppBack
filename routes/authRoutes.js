const express = require("express")
const login = require("@/api/v1/auth/login")
const register = require("@/api/v1/auth/register")
const { refresh, logout } = require("@/api/v1/auth/refresh")
const forgotPassword = require("@/api/v1/auth/forgotPassword")
const verifyOtp = require("@/api/v1/auth/verifyOtp")
const resetPassword = require("@/api/v1/auth/resetPassword")

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

module.exports = router