const express = require('express')
const { getSessionState, createDevelopmentSession, logout, steamLogin } = require('../controllers/authController')

const router = express.Router()
router.get('/session', getSessionState)
router.post('/dev/login', createDevelopmentSession)
router.post('/logout', logout)
router.get('/steam', steamLogin)

module.exports = router
