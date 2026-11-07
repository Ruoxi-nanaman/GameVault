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

module.exports = {
  getGameAchievements,
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
