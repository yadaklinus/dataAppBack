const express = require("express")
const login = require("@/api/v1/auth/login")
const register = require("@/api/v1/auth/register")

const router = express.Router()

router.get("/",(req,res)=>{
    res.json("new")
})

router.post("/login",login) // LOGIN
router.post("/register",register) // REGISTER

module.exports = router