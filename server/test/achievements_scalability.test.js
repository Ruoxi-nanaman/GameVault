const assert = require('node:assert/strict')
const test = require('node:test')
const { getAchievementLibrary, getAchievementSummary } = require('../controllers/steamAchievementsController')

/**
 * Scalability-aware Mock for Supabase to handle pagination and large datasets
 */
function createPaginationMockSupabase(options = {}) {
  const {
    userGames = [],
    achievements = [],
    userAchievements = [],
    errors = {}
  } = options

  return {
    from: (table) => {
      let currentData = []
      if (table === 'user_games') currentData = userGames
      if (table === 'achievements') currentData = achievements
      if (table === 'user_achievements') currentData = userAchievements

      const query = {
        select: function() { return this },
        eq: function() { return this },
        in: function() { return this },
        order: function() { return this },
        range: function(from, to) {
          this._range = { from, to }
          return this
        },
        then: async function(resolve) {
          if (errors[table]) {
            return resolve({ data: null, error: errors[table] })
          }

          let result = [...currentData]
          
          // Apply range if specified
          if (this._range) {
            result = result.slice(this._range.from, this._range.to + 1)
          }

          return resolve({ data: result, error: null })
        }
      }
      return query
    }
  }
}

test('getAchievementLibrary Scalability: 1. Handles > 1000 achievement definitions with pagination', async () => {
  const userId = 'user-large'
  const req = { user: { gameVaultUserId: userId } }
  const res = {
    status(code) { this.statusCode = code; return this },
    json(data) { this.body = data; return this }
  }

  // Create 2,133 achievement definitions
  const gameId = 'game-1'
  const achievements = Array.from({ length: 2133 }, (_, i) => ({
    id: `a-${i}`,
    game_id: gameId,
    achievement_api_name: `ACH_${i}`,
    title: `Achievement ${i}`,
    is_active: true,
    games: { steam_app_id: 12345 }
  }))

  const userGames = [{
    game_id: gameId,
    achievement_last_synced_at: new Date().toISOString(),
    games: { id: gameId, steam_app_id: 12345, title: 'Big Game', achievement_schema_state: 'available' }
  }]

  const mockSupabase = createPaginationMockSupabase({
    userGames,
    achievements
  })

  await getAchievementLibrary(req, res, { supabaseClient: mockSupabase })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.achievements.length, 2133)
  assert.equal(res.body.games[0].totalAchievements, 2133)
  assert.equal(res.body.stats.totalAchievements, 0) // None locked or unlocked yet
  assert.equal(res.body.stats.totalUnknown, 2133)
})

test('getAchievementLibrary Scalability: 2. Handles > 1000 user progress records with pagination', async () => {
  const userId = 'user-large-progress'
  const req = { user: { gameVaultUserId: userId } }
  const res = {
    status(code) { this.statusCode = code; return this },
    json(data) { this.body = data; return this }
  }

  const gameId = 'game-1'
  const achievements = Array.from({ length: 1500 }, (_, i) => ({
    id: `a-${i}`,
    game_id: gameId,
    achievement_api_name: `ACH_${i}`,
    title: `Achievement ${i}`,
    is_active: true,
    games: { steam_app_id: 12345 }
  }))

  const userAchievements = Array.from({ length: 1500 }, (_, i) => ({
    achievement_id: `a-${i}`,
    is_unlocked: i < 800, // 800 unlocked, 700 locked
    unlocked_at: i < 800 ? new Date().toISOString() : null
  }))

  const userGames = [{
    game_id: gameId,
    achievement_last_synced_at: new Date().toISOString(),
    games: { id: gameId, steam_app_id: 12345, title: 'Big Game', achievement_schema_state: 'available' }
  }]

  const mockSupabase = createPaginationMockSupabase({
    userGames,
    achievements,
    userAchievements
  })

  await getAchievementLibrary(req, res, { supabaseClient: mockSupabase })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.achievements.length, 1500)
  assert.equal(res.body.stats.totalUnlocked, 800)
  assert.equal(res.body.stats.totalAchievements, 1500)
  assert.equal(res.body.stats.totalUnknown, 0)
  assert.equal(res.body.stats.overallCompletionPercentage, 53.33)
})

test('getAchievementLibrary Scalability: 3. Regression - Does NOT use .in() with achievement IDs for progress', async () => {
  const userId = 'user-isolation'
  const req = { user: { gameVaultUserId: userId } }
  const res = {
    status(code) { this.statusCode = code; return this },
    json(data) { this.body = data; return this }
  }

  let inQueryCalled = false
  const mockSupabase = {
    from: (table) => ({
      select: () => ({
        eq: function(col, val) {
          if (table === 'user_achievements' && col === 'user_id') {
            this._isUserIdFiltered = true
          }
          return this
        },
        in: function(col, val) {
          if (table === 'user_achievements' && col === 'achievement_id') {
            inQueryCalled = true
          }
          return this
        },
        order: function() { return this },
        range: function() { return this },
        then: function(resolve) {
          if (table === 'user_games') return resolve({ data: [{ game_id: 'g1', games: { id: 'g1' } }], error: null })
          if (table === 'achievements') return resolve({ data: [{ id: 'a1', game_id: 'g1', is_active: true }], error: null })
          if (table === 'user_achievements') {
            if (!this._isUserIdFiltered) {
              throw new Error('user_achievements MUST be filtered by user_id')
            }
            return resolve({ data: [{ achievement_id: 'a1', is_unlocked: true }], error: null })
          }
          return resolve({ data: [], error: null })
        }
      })
    })
  }

  await getAchievementLibrary(req, res, { supabaseClient: mockSupabase })

  assert.equal(res.statusCode, 200)
  assert.equal(inQueryCalled, false, 'Should not use .in() query for achievement progress')
})

test('getAchievementLibrary Scalability: 4. Error on second page of definitions', async () => {
  const userId = 'user-page-error'
  const req = { user: { gameVaultUserId: userId } }
  const res = {
    status(code) { this.statusCode = code; return this },
    json(data) { this.body = data; return this }
  }

  const mockSupabase = {
    from: (table) => ({
      select: () => ({
        in: function() { return this },
        eq: function() { return this },
        order: function() { return this },
        range: function(from, to) {
          this._from = from
          return this
        },
        then: function(resolve) {
          if (table === 'user_games') return resolve({ data: [{ game_id: 'g1', games: { id: 'g1' } }], error: null })
          if (table === 'achievements') {
            if (this._from === 0) {
              // First page success
              return resolve({ data: Array(500).fill({ id: 'a', is_active: true }), error: null })
            } else {
              // Second page error
              return resolve({ data: null, error: { message: 'Pagination Fail' } })
            }
          }
          return resolve({ data: [], error: null })
        }
      })
    })
  }

  await getAchievementLibrary(req, res, { supabaseClient: mockSupabase })

  assert.equal(res.statusCode, 500)
  assert.equal(res.body.errorCode, 'ACHIEVEMENTS_READ_FAILED')
})

test('getAchievementSummary Scalability: 1. Handles > 1000 records with pagination', async () => {
  const userId = 'user-large-summary'
  const req = { user: { gameVaultUserId: userId } }
  const res = {
    status(code) { this.statusCode = code; return this },
    json(data) { this.body = data; return this }
  }

  // Create 1,500 achievement definitions
  const gameId = 'game-1'
  const achievements = Array.from({ length: 1500 }, (_, i) => ({
    id: `a-${i}`,
    game_id: gameId,
    is_active: true
  }))

  // Create 1,500 progress records (800 unlocked)
  const userAchievements = Array.from({ length: 1500 }, (_, i) => ({
    achievement_id: `a-${i}`,
    is_unlocked: i < 800,
    unlocked_at: i < 800 ? new Date().toISOString() : null
  }))

  const userGames = [{ game_id: gameId }]

  const mockSupabase = createPaginationMockSupabase({
    userGames,
    achievements,
    userAchievements
  })

  await getAchievementSummary(req, res, { supabaseClient: mockSupabase })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.totalAchievements, 1500)
  assert.equal(res.body.totalUnlocked, 800)
  assert.equal(res.body.overallCompletionPercentage, 53.33)
  assert.equal(res.body.perfectGames, 0) // Only 800/1500 unlocked
})

test('Statistics Consistency: getAchievementLibrary and getAchievementSummary return identical stats', async () => {
  const userId = 'user-consistency'
  const req = { user: { gameVaultUserId: userId } }
  const gameId = 'game-1'
  
  const achievements = Array.from({ length: 100 }, (_, i) => ({
    id: `a-${i}`,
    game_id: gameId,
    achievement_api_name: `ACH_${i}`,
    title: `Achievement ${i}`,
    is_active: true,
    games: { steam_app_id: 12345 }
  }))

  const userAchievements = Array.from({ length: 100 }, (_, i) => ({
    achievement_id: `a-${i}`,
    is_unlocked: true, // All unlocked
    unlocked_at: new Date().toISOString()
  }))

  const userGames = [{
    game_id: gameId,
    achievement_last_synced_at: new Date().toISOString(),
    games: { id: gameId, steam_app_id: 12345, title: 'Test Game', achievement_schema_state: 'available' }
  }]

  const mockSupabase = createPaginationMockSupabase({
    userGames,
    achievements,
    userAchievements
  })

  const resLib = {
    status(code) { this.statusCode = code; return this },
    json(data) { this.body = data; return this }
  }
  await getAchievementLibrary(req, resLib, { supabaseClient: mockSupabase })

  const resSum = {
    status(code) { this.statusCode = code; return this },
    json(data) { this.body = data; return this }
  }
  await getAchievementSummary(req, resSum, { supabaseClient: mockSupabase })

  assert.equal(resLib.statusCode, 200)
  assert.equal(resSum.statusCode, 200)
  
  // Compare stats objects
  const libStats = resLib.body.stats
  const sumStats = resSum.body
  
  assert.equal(sumStats.totalUnlocked, libStats.totalUnlocked)
  assert.equal(sumStats.totalAchievements, libStats.totalAchievements)
  assert.equal(sumStats.totalUnknown, libStats.totalUnknown)
  assert.equal(sumStats.perfectGames, libStats.perfectGames)
  assert.equal(sumStats.overallCompletionPercentage, libStats.overallCompletionPercentage)
})
