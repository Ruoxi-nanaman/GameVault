const express = require('express')
const { getSessionState, createDevelopmentSession, logout, steamLogin, steamCallback, syncSteamProfile } = require('../controllers/authController')
const { requireAuth } = require('../middleware/authMiddleware')

const router = express.Router()
router.get('/session', getSessionState)
router.post('/dev/login', createDevelopmentSession)
router.post('/logout', logout)
router.get('/steam', steamLogin)
router.get('/steam/callback', steamCallback)
router.get('/steam/profile', requireAuth, syncSteamProfile)

module.exports = router
