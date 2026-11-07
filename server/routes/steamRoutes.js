const express = require('express')
const { requireAuth } = require('../middleware/authMiddleware')
const { syncOwnedGames, getOwnedGames } = require('../controllers/steamGamesController')
const {
  getGameAchievements,
  syncGameAchievements,
  syncAllGameAchievements,
} = require('../controllers/steamAchievementsController')

const router = express.Router()
router.post('/sync/games', requireAuth, syncOwnedGames)
router.get('/games', requireAuth, getOwnedGames)
router.post('/achievements/sync-all', requireAuth, syncAllGameAchievements)
router.get('/games/:appId/achievements', requireAuth, getGameAchievements)
router.post('/games/:appId/achievements/sync', requireAuth, syncGameAchievements)

module.exports = router
