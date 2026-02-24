"use strict";
const express = require("express");
const login = require("@/api/v1/auth/login");
const register = require("@/api/v1/auth/register");
const { refresh, logout } = require("@/api/v1/auth/refresh");
const router = express.Router();
router.get("/", (req, res) => {
    res.json("new");
});
router.post("/login", login); // LOGIN
router.post("/register", register); // REGISTER
router.post("/refresh", refresh); // REFRESH SESSION
router.post("/logout", logout); // LOGOUT/REVOKE
module.exports = router;
