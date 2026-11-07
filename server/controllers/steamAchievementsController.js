const { getSupabaseServerClient } = require('../config/supabase')
const {
  fetchSteamAchievementDefinitions,
  fetchPlayerAchievements,
  mergeAchievementData,
} = require('../services/steamWebApi')
const {
  synchronizeAchievementSchema,
  synchronizePlayerProgress,
  acquireSyncLock,
  releaseSyncLock,
  clearAllSyncLocks,
  acquireBulkSyncLock,
  releaseBulkSyncLock,
  isBulkSyncLocked,
  clearAllBulkSyncLocks,
  DEFAULT_BULK_SYNC_CONCURRENCY,
  runWithConcurrencyLimit,
  executeGameAchievementSync,
  steamAchievementStateForError,
} = require('../services/achievementSyncService')

function buildAchievementResponse(definitions, playerAchievements, dataState = 'available') {
  if (!Array.isArray(definitions) || definitions.length === 0) {
    return {
      dataState: 'no_achievements',
      achievements: [],
      totalAchievements: 0,
      unlockedAchievements: 0,
      lockedAchievements: 0,
      unknownAchievements: 0,
      isCompleteSnapshot: true,
      completionPercentage: null,
    }
  }

  const achievements = mergeAchievementData(definitions, playerAchievements)
  const totalAchievements = achievements.length
  const unlockedAchievements = achievements.filter((achievement) => achievement.playerDataAvailable && achievement.unlocked).length
  const lockedAchievements = achievements.filter((achievement) =>
    achievement.playerDataAvailable && !achievement.unlocked
  ).length
  const unknownAchievements = totalAchievements - (unlockedAchievements + lockedAchievements)
  const isCompleteSnapshot = totalAchievements > 0 && unknownAchievements === 0
  return {
    dataState,
    achievements,
    totalAchievements,
    unlockedAchievements,
    lockedAchievements,
    unknownAchievements,
    isCompleteSnapshot,
    completionPercentage: isCompleteSnapshot
      ? Number(((unlockedAchievements / totalAchievements) * 100).toFixed(2))
      : null,
  }
}

async function getGameAchievements(req, res, options = {}) {
  const appId = Number(req.params?.appId)
  if (!Number.isSafeInteger(appId) || appId <= 0) {
    return res.status(400).json({
      error: 'A valid Steam App ID is required',
      errorCode: 'STEAM_APP_ID_INVALID',
    })
  }

  const gameVaultUserId = req.user?.gameVaultUserId || req.user?.id
  const steamId = req.user?.steamId
  if (!gameVaultUserId || gameVaultUserId === 'development-user') {
    return res.status(400).json({
      error: 'A Steam-linked GameVault account is required',
      errorCode: 'STEAM_LINK_REQUIRED',
    })
  }
  if (!steamId) {
    return res.status(400).json({
      error: 'SteamID is missing from the authenticated session',
      errorCode: 'STEAM_ID_INVALID',
    })
  }

  try {
    const supabase = options.supabaseClient || getSupabaseServerClient()

    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('id, steam_app_id, title')
      .eq('steam_app_id', appId)
      .maybeSingle()
    if (gameError) {
      return res.status(500).json({
        error: 'Unable to verify the requested game',
        errorCode: 'LIBRARY_READ_FAILED',
      })
    }
    if (!game?.id) {
      return res.status(404).json({
        error: 'Steam game is not in the authenticated user library',
        errorCode: 'GAME_NOT_IN_LIBRARY',
      })
    }

    const { data: userGame, error: ownershipError } = await supabase
      .from('user_games')
      .select('game_id')
      .eq('user_id', gameVaultUserId)
      .eq('game_id', game.id)
      .maybeSingle()
    if (ownershipError) {
      return res.status(500).json({
        error: 'Unable to verify the authenticated user library',
        errorCode: 'LIBRARY_READ_FAILED',
      })
    }
    if (!userGame?.game_id) {
      return res.status(404).json({
        error: 'Steam game is not in the authenticated user library',
        errorCode: 'GAME_NOT_IN_LIBRARY',
      })
    }

    const fetchDefinitions = options.fetchDefinitions || fetchSteamAchievementDefinitions
    const fetchPlayer = options.fetchPlayer || fetchPlayerAchievements

    let definitions
    try {
      definitions = await fetchDefinitions(appId, options.fetchOptions)
    } catch (error) {
      const result = steamAchievementStateForError(error)
      return res.status(result.status).json({
        dataState: result.state,
        achievements: [],
        totalAchievements: 0,
        unlockedAchievements: 0,
        lockedAchievements: 0,
        completionPercentage: null,
        errorCode: result.errorCode,
        error: result.message,
      })
    }

    if (!Array.isArray(definitions) || definitions.length === 0) {
      return res.json(buildAchievementResponse([], null, 'no_achievements'))
    }

    let playerAchievements
    try {
      playerAchievements = await fetchPlayer(steamId, appId, options.fetchOptions)
    } catch (error) {
      const result = steamAchievementStateForError(error)
      return res.status(result.status).json({
        dataState: result.state,
        achievements: [],
        totalAchievements: definitions.length,
        unlockedAchievements: 0,
        lockedAchievements: 0,
        completionPercentage: null,
        errorCode: result.errorCode,
        error: result.message,
      })
    }

    if (!Array.isArray(playerAchievements) || playerAchievements.length === 0) {
      return res.status(200).json({
        dataState: 'player_data_unavailable',
        achievements: [],
        totalAchievements: definitions.length,
        unlockedAchievements: 0,
        lockedAchievements: 0,
        completionPercentage: null,
        errorCode: 'STEAM_PLAYER_DATA_UNAVAILABLE',
        error: 'Steam player achievement data is unavailable',
      })
    }

    return res.json(buildAchievementResponse(definitions, playerAchievements, 'available'))
  } catch {
    return res.status(500).json({
      dataState: 'steam_unavailable',
      achievements: [],
      totalAchievements: 0,
      unlockedAchievements: 0,
      lockedAchievements: 0,
      completionPercentage: null,
      errorCode: 'STEAM_API_REQUEST_FAILED',
      error: 'Steam achievement data is temporarily unavailable',
    })
  }
}

async function syncGameAchievements(req, res, options = {}) {
  const appId = Number(req.params?.appId)
  if (!Number.isSafeInteger(appId) || appId <= 0) {
    return res.status(400).json({
      error: 'A valid Steam App ID is required',
      errorCode: 'STEAM_APP_ID_INVALID',
    })
  }

  const gameVaultUserId = req.user?.gameVaultUserId || req.user?.id
  const steamId = req.user?.steamId
  if (!gameVaultUserId || gameVaultUserId === 'development-user') {
    return res.status(400).json({
      error: 'A Steam-linked GameVault account is required',
      errorCode: 'STEAM_LINK_REQUIRED',
    })
  }
  if (!steamId) {
    return res.status(400).json({
      error: 'SteamID is missing from the authenticated session',
      errorCode: 'STEAM_ID_INVALID',
    })
  }

  try {
    const supabase = options.supabaseClient || getSupabaseServerClient()

    const { data: userRecord, error: userError } = await supabase
      .from('users')
      .select('id, steam_id')
      .eq('id', gameVaultUserId)
      .eq('steam_id', steamId)
      .maybeSingle()
    if (userError) {
      return res.status(500).json({
        error: 'Unable to verify session identity',
        errorCode: 'AUTH_VERIFICATION_FAILED',
      })
    }
    if (!userRecord) {
      return res.status(401).json({
        error: 'Authenticated session identity is invalid or mismatched',
        errorCode: 'SESSION_IDENTITY_MISMATCH',
      })
    }

    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('id, steam_app_id, title')
      .eq('steam_app_id', appId)
      .maybeSingle()
    if (gameError) {
      return res.status(500).json({
        error: 'Unable to verify the requested game',
        errorCode: 'LIBRARY_READ_FAILED',
      })
    }
    if (!game?.id) {
      return res.status(404).json({
        error: 'Steam game is not in the authenticated user library',
        errorCode: 'GAME_NOT_IN_LIBRARY',
      })
    }

    const { data: userGame, error: ownershipError } = await supabase
      .from('user_games')
      .select('game_id')
      .eq('user_id', gameVaultUserId)
      .eq('game_id', game.id)
      .maybeSingle()
    if (ownershipError) {
      return res.status(500).json({
        error: 'Unable to verify the authenticated user library',
        errorCode: 'LIBRARY_READ_FAILED',
      })
    }
    if (!userGame?.game_id) {
      return res.status(404).json({
        error: 'Steam game is not in the authenticated user library',
        errorCode: 'GAME_NOT_IN_LIBRARY',
      })
    }

    const result = await executeGameAchievementSync({
      supabase,
      userId: gameVaultUserId,
      steamId,
      game,
      fetchDefinitions: options.fetchDefinitions || fetchSteamAchievementDefinitions,
      fetchPlayer: options.fetchPlayer || fetchPlayerAchievements,
      fetchOptions: options.fetchOptions,
      acquireLock: options.acquireSyncLock || acquireSyncLock,
      releaseLock: options.releaseSyncLock || releaseSyncLock,
    })

    if (result.status === 'skipped_locked') {
      return res.status(409).json({
        error: result.error,
        errorCode: result.errorCode,
      })
    }

    const httpStatus = result.httpStatus || 200
    const responsePayload = { ...result }
    delete responsePayload.httpStatus
    delete responsePayload.gameId
    delete responsePayload.appId
    delete responsePayload.title
    delete responsePayload.status

    return res.status(httpStatus).json(responsePayload)
  } catch {
    return res.status(500).json({
      schemaState: 'unchanged',
      playerDataState: 'unchanged',
      schemaSynced: false,
      playerProgressSynced: false,
      errorCode: 'ACHIEVEMENT_SYNC_FAILED',
      error: 'Achievement synchronization is temporarily unavailable',
    })
  }
}

async function syncAllGameAchievements(req, res, options = {}) {
  const gameVaultUserId = req.user?.gameVaultUserId || req.user?.id
  const steamId = req.user?.steamId
  if (!gameVaultUserId || gameVaultUserId === 'development-user') {
    return res.status(400).json({
      error: 'A Steam-linked GameVault account is required',
      errorCode: 'STEAM_LINK_REQUIRED',
    })
  }
  if (!steamId) {
    return res.status(400).json({
      error: 'SteamID is missing from the authenticated session',
      errorCode: 'STEAM_ID_INVALID',
    })
  }

  try {
    const supabase = options.supabaseClient || getSupabaseServerClient()

    const { data: userRecord, error: userError } = await supabase
      .from('users')
      .select('id, steam_id')
      .eq('id', gameVaultUserId)
      .eq('steam_id', steamId)
      .maybeSingle()

    if (userError) {
      return res.status(500).json({
        error: 'Unable to verify session identity',
        errorCode: 'AUTH_VERIFICATION_FAILED',
      })
    }
    if (!userRecord) {
      return res.status(401).json({
        error: 'Authenticated session identity is invalid or mismatched',
        errorCode: 'SESSION_IDENTITY_MISMATCH',
      })
    }

    const acquireBulkLock = options.acquireBulkSyncLock || acquireBulkSyncLock
    const releaseBulkLock = options.releaseBulkSyncLock || releaseBulkSyncLock

    if (!acquireBulkLock(gameVaultUserId)) {
      return res.status(409).json({
        error: 'Bulk achievement synchronization is already running for this user',
        errorCode: 'BULK_SYNC_IN_PROGRESS',
      })
    }

    try {
      const { data: userGames, error: userGamesError } = await supabase
        .from('user_games')
        .select('game_id')
        .eq('user_id', gameVaultUserId)

      if (userGamesError) {
        return res.status(500).json({
          error: 'Unable to retrieve user library',
          errorCode: 'LIBRARY_READ_FAILED',
        })
      }

      const gameIds = [...new Set((userGames || []).map((row) => row.game_id))]
      if (gameIds.length === 0) {
        return res.status(200).json({
          totalGamesProcessed: 0,
          totalGames: 0,
          successfulSynchronizations: 0,
          gamesWithNoAchievements: 0,
          gamesWithUnavailablePlayerData: 0,
          failedSynchronizations: 0,
          results: [],
        })
      }

      const { data: games, error: gamesError } = await supabase
        .from('games')
        .select('id, steam_app_id, title')
        .in('id', gameIds)

      if (gamesError) {
        return res.status(500).json({
          error: 'Unable to retrieve game metadata',
          errorCode: 'LIBRARY_READ_FAILED',
        })
      }

      const validGames = (games || []).filter(
        (g) => g && Number.isSafeInteger(Number(g.steam_app_id)) && Number(g.steam_app_id) > 0
      )

      const concurrency = options.concurrencyLimit || DEFAULT_BULK_SYNC_CONCURRENCY
      const results = await runWithConcurrencyLimit(validGames, concurrency, async (game) => {
        const itemResult = await executeGameAchievementSync({
          supabase,
          userId: gameVaultUserId,
          steamId,
          game,
          fetchDefinitions: options.fetchDefinitions || fetchSteamAchievementDefinitions,
          fetchPlayer: options.fetchPlayer || fetchPlayerAchievements,
          fetchOptions: options.fetchOptions,
          acquireLock: options.acquireSyncLock || acquireSyncLock,
          releaseLock: options.releaseSyncLock || releaseSyncLock,
        })
        const cleanResult = { ...itemResult }
        delete cleanResult.httpStatus
        return cleanResult
      })

      const successfulSynchronizations = results.filter((r) => r.status === 'success').length
      const gamesWithNoAchievements = results.filter((r) => r.status === 'no_achievements').length
      const gamesWithUnavailablePlayerData = results.filter((r) => r.status === 'player_data_unavailable').length
      const failedSynchronizations = results.filter((r) => r.status === 'failed' || r.status === 'skipped_locked').length

      return res.status(200).json({
        totalGamesProcessed: results.length,
        totalGames: results.length,
        successfulSynchronizations,
        gamesWithNoAchievements,
        gamesWithUnavailablePlayerData,
        failedSynchronizations,
        results,
      })
    } finally {
      releaseBulkLock(gameVaultUserId)
    }
  } catch {
    return res.status(500).json({
      error: 'Bulk achievement synchronization is temporarily unavailable',
      errorCode: 'BULK_ACHIEVEMENT_SYNC_FAILED',
    })
  }
}

/**
 * Calculates shared achievement statistics for library and summary endpoints.
 * 
 * @param {Array} achievements - List of achievement definitions with game_id.
 * @param {Map} progressMap - Map of achievement_id to user progress records.
 * @param {Array} gameIds - List of game IDs in the user's library.
 * @returns {Object} Calculated statistics.
 */
function calculateAchievementStats(achievements, progressMap, gameIds) {
  const now = new Date()
  const currentMonth = now.getUTCMonth()
  const currentYear = now.getUTCFullYear()

  let totalUnlockedGlobal = 0
  let totalKnownGlobal = 0
  let totalUnknownGlobal = 0
  let unlockedThisMonthCount = 0
  
  // Group by game for perfect game calculation
  const gameStats = new Map()
  gameIds.forEach(gid => gameStats.set(gid, { total: 0, unlocked: 0, unknown: 0 }))

  achievements.forEach(a => {
    const stats = gameStats.get(a.game_id)
    if (!stats) return

    stats.total++
    
    const progress = progressMap.get(a.id)
    if (progress) {
      if (progress.is_unlocked) {
        stats.unlocked++
        totalUnlockedGlobal++
        
        if (progress.unlocked_at) {
          const unlockDate = new Date(progress.unlocked_at)
          if (
            unlockDate.getUTCMonth() === currentMonth &&
            unlockDate.getUTCFullYear() === currentYear
          ) {
            unlockedThisMonthCount += 1
          }
        }
      }
      totalKnownGlobal++
    } else {
      stats.unknown++
      totalUnknownGlobal++
    }
  })

  let perfectGamesCount = 0
  let gamesWithAchievementsCount = 0
  gameStats.forEach(stats => {
    if (stats.total > 0) {
      gamesWithAchievementsCount++
      // Perfect game: at least one achievement, all known, and all unlocked
      if (stats.unknown === 0 && stats.unlocked === stats.total) {
        perfectGamesCount++
      }
    }
  })

  const overallCompletionPercentage = totalKnownGlobal > 0
    ? Number(((totalUnlockedGlobal / totalKnownGlobal) * 100).toFixed(2))
    : null

  return {
    totalUnlocked: totalUnlockedGlobal,
    totalAchievements: totalKnownGlobal,
    totalUnknown: totalUnknownGlobal,
    overallCompletionPercentage,
    perfectGames: perfectGamesCount,
    gamesWithAchievements: gamesWithAchievementsCount,
    unlockedThisMonth: unlockedThisMonthCount,
  }
}

async function getAchievementLibrary(req, res, options = {}) {
  const gameVaultUserId = req.user?.gameVaultUserId || req.user?.id

  if (!gameVaultUserId || gameVaultUserId === 'development-user') {
    return res.status(401).json({
      error: 'A Steam-linked GameVault account is required',
      errorCode: 'STEAM_LINK_REQUIRED',
    })
  }

  try {
    const supabase = options.supabaseClient || getSupabaseServerClient()

    // 1. Retrieve the user's library games and game metadata
    const { data: userGames, error: userGamesError } = await supabase
      .from('user_games')
      .select(`
        game_id,
        achievement_last_synced_at,
        games (
          id,
          steam_app_id,
          title,
          cover_image,
          achievement_schema_state,
          achievement_schema_last_synced_at
        )
      `)
      .eq('user_id', gameVaultUserId)

    if (userGamesError) {
      return res.status(500).json({
        error: 'Unable to retrieve user library',
        errorCode: 'LIBRARY_READ_FAILED',
      })
    }

    if (!userGames || userGames.length === 0) {
      return res.status(200).json({
        games: [],
        achievements: [],
        stats: {
          totalUnlocked: 0,
          totalAchievements: 0,
          totalUnknown: 0,
          overallCompletionPercentage: null,
          perfectGames: 0,
          gamesWithAchievements: 0,
          unlockedThisMonth: 0,
        },
      })
    }

    const gameIds = userGames.map((ug) => ug.game_id)

    // Helper for paginated retrieval
    const fetchAllPages = async (queryBuilder, pageSize = 500) => {
      let allData = []
      let from = 0
      let to = pageSize - 1
      let hasMore = true

      while (hasMore) {
        const { data, error } = await queryBuilder
          .range(from, to)
          .order('id', { ascending: true })

        if (error) throw error
        if (!data || data.length === 0) {
          hasMore = false
        } else {
          allData = allData.concat(data)
          if (data.length < pageSize) {
            hasMore = false
          } else {
            from += pageSize
            to += pageSize
          }
        }
      }
      return allData
    }

    // 2. Retrieve all active achievement definitions for these games using pagination
    let achievements
    try {
      achievements = await fetchAllPages(
        supabase
          .from('achievements')
          .select(`
            id,
            game_id,
            achievement_api_name,
            title,
            description,
            icon_url,
            icon_gray_url,
            hidden,
            is_active,
            games ( steam_app_id )
          `)
          .in('game_id', gameIds)
          .eq('is_active', true)
      )
    } catch (achievementsError) {
      return res.status(500).json({
        error: 'Unable to retrieve achievement definitions',
        errorCode: 'ACHIEVEMENTS_READ_FAILED',
      })
    }

    // 3. Retrieve all of the user's achievement progress using pagination
    // Filtered by user_id for strict isolation, avoiding massive .in() queries
    let userAchievements
    try {
      userAchievements = await fetchAllPages(
        supabase
          .from('user_achievements')
          .select('achievement_id, is_unlocked, unlocked_at')
          .eq('user_id', gameVaultUserId)
      )
    } catch (userAchievementsError) {
      return res.status(500).json({
        error: 'Unable to retrieve achievement progress',
        errorCode: 'ACHIEVEMENT_PROGRESS_READ_FAILED',
      })
    }

    // Map progress for efficient lookup
    const progressMap = new Map(
      (userAchievements || []).map((ua) => [ua.achievement_id, ua])
    )

    // Calculate shared global statistics
    const stats = calculateAchievementStats(achievements, progressMap, gameIds)

    // Process achievements and build the response array
    const achievementResponse = achievements.map((a) => {
      const progress = progressMap.get(a.id)
      let progressState = 'unknown'
      let isUnlocked = false
      let unlockedAt = null

      if (progress) {
        isUnlocked = progress.is_unlocked === true
        unlockedAt = progress.unlocked_at
        progressState = isUnlocked ? 'unlocked' : 'locked'
      }

      return {
        id: a.id,
        gameId: a.game_id,
        steamAppId: Number(a.games?.steam_app_id),
        apiName: a.achievement_api_name,
        title: a.title,
        description: a.description,
        iconUrl: a.icon_url,
        iconGrayUrl: a.icon_gray_url,
        hidden: a.hidden,
        isActive: a.is_active,
        isUnlocked,
        unlockedAt,
        progressState,
      }
    })

    // Group achievements by game for per-game stats
    const achievementsByGame = new Map()
    achievementResponse.forEach((a) => {
      if (!achievementsByGame.has(a.gameId)) {
        achievementsByGame.set(a.gameId, [])
      }
      achievementsByGame.get(a.gameId).push(a)
    })

    // Build games response
    const gamesResponse = userGames.map((ug) => {
      const game = ug.games
      const gameAchievements = achievementsByGame.get(ug.game_id) || []
      
      const totalAchievements = gameAchievements.length
      const unlockedAchievements = gameAchievements.filter((a) => a.progressState === 'unlocked').length
      const lockedAchievements = gameAchievements.filter((a) => a.progressState === 'locked').length
      const unknownAchievements = gameAchievements.filter((a) => a.progressState === 'unknown').length

      // Per-game completion percentage
      let completionPercentage = null
      if (totalAchievements > 0) {
        const knownCount = unlockedAchievements + lockedAchievements
        if (knownCount > 0) {
          completionPercentage = Number(((unlockedAchievements / totalAchievements) * 100).toFixed(2))
        } else if (ug.achievement_last_synced_at) {
          // If synced but no progress found, and we have definitions, they are all unknown
          completionPercentage = 0
        }
      } else if (game.achievement_schema_state === 'no_achievements') {
        completionPercentage = 0
      }

      return {
        gameId: ug.game_id,
        steamAppId: Number(game.steam_app_id),
        title: game.title,
        coverImage: game.cover_image,
        schemaState: game.achievement_schema_state,
        schemaLastSyncedAt: game.achievement_schema_last_synced_at,
        achievementLastSyncedAt: ug.achievement_last_synced_at,
        totalAchievements,
        unlockedAchievements,
        lockedAchievements,
        unknownAchievements,
        completionPercentage,
      }
    })

    return res.status(200).json({
      games: gamesResponse,
      achievements: achievementResponse,
      stats,
    })
  } catch (error) {
    return res.status(500).json({
      error: 'An unexpected error occurred while retrieving achievements',
      errorCode: 'ACHIEVEMENT_LIBRARY_FETCH_FAILED',
    })
  }
}

async function getAchievementSummary(req, res, options = {}) {
  const gameVaultUserId = req.user?.gameVaultUserId || req.user?.id

  if (!gameVaultUserId || gameVaultUserId === 'development-user') {
    return res.status(401).json({
      error: 'A Steam-linked GameVault account is required',
      errorCode: 'STEAM_LINK_REQUIRED',
    })
  }

  try {
    const supabase = options.supabaseClient || getSupabaseServerClient()

    // 1. Retrieve the user's library game IDs
    const { data: userGames, error: userGamesError } = await supabase
      .from('user_games')
      .select('game_id')
      .eq('user_id', gameVaultUserId)

    if (userGamesError) {
      return res.status(500).json({
        error: 'Unable to retrieve user library',
        errorCode: 'LIBRARY_READ_FAILED',
      })
    }

    if (!userGames || userGames.length === 0) {
      return res.status(200).json({
        totalUnlocked: 0,
        totalAchievements: 0,
        overallCompletionPercentage: null,
        perfectGames: 0,
        gamesWithAchievements: 0,
        unlockedThisMonth: 0,
      })
    }

    const gameIds = userGames.map((ug) => ug.game_id)

    // Helper for paginated retrieval (copied from getAchievementLibrary for use in summary)
    const fetchAllPages = async (queryBuilder, pageSize = 500) => {
      let allData = []
      let from = 0
      let to = pageSize - 1
      let hasMore = true

      while (hasMore) {
        const { data, error } = await queryBuilder
          .range(from, to)
          .order('id', { ascending: true })

        if (error) throw error
        if (!data || data.length === 0) {
          hasMore = false
        } else {
          allData = allData.concat(data)
          if (data.length < pageSize) {
            hasMore = false
          } else {
            from += pageSize
            to += pageSize
          }
        }
      }
      return allData
    }

    // 2. Retrieve all active achievement definitions for these games using pagination
    let achievements
    try {
      achievements = await fetchAllPages(
        supabase
          .from('achievements')
          .select('id, game_id')
          .in('game_id', gameIds)
          .eq('is_active', true)
      )
    } catch (achievementsError) {
      return res.status(500).json({
        error: 'Unable to retrieve achievement definitions',
        errorCode: 'ACHIEVEMENTS_READ_FAILED',
      })
    }

    if (!achievements || achievements.length === 0) {
      return res.status(200).json({
        totalUnlocked: 0,
        totalAchievements: 0,
        totalUnknown: 0,
        overallCompletionPercentage: null,
        perfectGames: 0,
        gamesWithAchievements: 0,
        unlockedThisMonth: 0,
      })
    }

    // 3. Retrieve all of the user's achievement progress using pagination
    let userAchievements
    try {
      userAchievements = await fetchAllPages(
        supabase
          .from('user_achievements')
          .select('achievement_id, is_unlocked, unlocked_at')
          .eq('user_id', gameVaultUserId)
      )
    } catch (userAchievementsError) {
      return res.status(500).json({
        error: 'Unable to retrieve achievement progress',
        errorCode: 'ACHIEVEMENT_PROGRESS_READ_FAILED',
      })
    }

    // Map progress for efficient lookup
    const progressMap = new Map(
      (userAchievements || []).map((ua) => [ua.achievement_id, ua])
    )

    // Calculate shared global statistics
    const stats = calculateAchievementStats(achievements, progressMap, gameIds)

    return res.status(200).json(stats)
  } catch (error) {
    return res.status(500).json({
      error: 'An unexpected error occurred while retrieving achievement summary',
      errorCode: 'ACHIEVEMENT_SUMMARY_FETCH_FAILED',
    })
  }
}

module.exports = {
  getGameAchievements,
  getAchievementLibrary,
  getAchievementSummary,
  syncGameAchievements,
  syncAllGameAchievements,
  buildAchievementResponse,
  steamAchievementStateForError,
  acquireSyncLock,
  releaseSyncLock,
  clearAllSyncLocks,
  acquireBulkSyncLock,
  releaseBulkSyncLock,
  clearAllBulkSyncLocks,
}
