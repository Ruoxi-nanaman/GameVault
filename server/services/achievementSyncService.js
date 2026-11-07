// Process-local per-user/game synchronization locks.
// NOTE: This lock is process-local and does not coordinate across multiple backend instances.
const activeSyncLocks = new Set()
const activeBulkSyncLocks = new Set()
const DEFAULT_BULK_SYNC_CONCURRENCY = 2

function getSyncLockKey(userId, gameId) {
  return `${userId}:${gameId}`
}

function acquireSyncLock(userId, gameId) {
  if (!userId || !gameId) return false
  const key = getSyncLockKey(userId, gameId)
  if (activeSyncLocks.has(key)) {
    return false
  }
  activeSyncLocks.add(key)
  return true
}

function releaseSyncLock(userId, gameId) {
  if (!userId || !gameId) return
  const key = getSyncLockKey(userId, gameId)
  activeSyncLocks.delete(key)
}

function isSyncLocked(userId, gameId) {
  return activeSyncLocks.has(getSyncLockKey(userId, gameId))
}

function clearAllSyncLocks() {
  activeSyncLocks.clear()
}

function acquireBulkSyncLock(userId) {
  if (!userId) return false
  if (activeBulkSyncLocks.has(userId)) {
    return false
  }
  activeBulkSyncLocks.add(userId)
  return true
}

function releaseBulkSyncLock(userId) {
  if (!userId) return
  activeBulkSyncLocks.delete(userId)
}

function isBulkSyncLocked(userId) {
  return activeBulkSyncLocks.has(userId)
}

function clearAllBulkSyncLocks() {
  activeBulkSyncLocks.clear()
}

function steamAchievementStateForError(error) {
  if (error?.code === 'STEAM_PROFILE_PRIVATE') {
    return {
      status: 200,
      state: 'profile_private',
      errorCode: 'STEAM_PROFILE_PRIVATE',
      message: 'Steam player achievement data is private or inaccessible',
    }
  }
  if (error?.code === 'STEAM_PLAYER_DATA_UNAVAILABLE') {
    return {
      status: 200,
      state: 'player_data_unavailable',
      errorCode: 'STEAM_PLAYER_DATA_UNAVAILABLE',
      message: 'Steam player achievement data is unavailable',
    }
  }
  if (error?.code === 'STEAM_API_INVALID_RESPONSE') {
    return {
      status: 502,
      state: 'invalid_response',
      errorCode: 'STEAM_API_INVALID_RESPONSE',
      message: 'Steam returned an invalid achievement response',
    }
  }
  return {
    status: 503,
    state: 'steam_unavailable',
    errorCode: error?.code || 'STEAM_API_REQUEST_FAILED',
    message: 'Steam achievement data is temporarily unavailable',
  }
}

async function runWithConcurrencyLimit(items, limit, workerFn) {
  const maxConcurrency = Math.max(1, Number(limit) || DEFAULT_BULK_SYNC_CONCURRENCY)
  const results = new Array(items.length)
  let currentIndex = 0

  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex++
      results[index] = await workerFn(items[index], index)
    }
  }

  const workerCount = Math.min(maxConcurrency, items.length)
  const workers = Array.from({ length: workerCount }, () => worker())
  await Promise.all(workers)
  return results
}

async function executeGameAchievementSync({
  supabase,
  userId,
  steamId,
  game,
  fetchDefinitions,
  fetchPlayer,
  fetchOptions,
  acquireLock = acquireSyncLock,
  releaseLock = releaseSyncLock,
}) {
  const gameId = game.id
  const appId = Number(game.steam_app_id)
  const title = game.title || ''

  if (!acquireLock(userId, gameId)) {
    return {
      gameId,
      appId,
      title,
      status: 'skipped_locked',
      schemaState: 'unchanged',
      playerDataState: 'not_attempted',
      schemaSynced: false,
      playerProgressSynced: false,
      totalAchievements: 0,
      unlockedAchievements: 0,
      lockedAchievements: 0,
      unknownAchievements: 0,
      isCompleteSnapshot: false,
      completionPercentage: null,
      metadataInserted: 0,
      metadataUpdated: 0,
      playerRecordsInserted: 0,
      playerRecordsUpdated: 0,
      httpStatus: 409,
      errorCode: 'SYNC_IN_PROGRESS',
      error: 'Achievement synchronization is already in progress for this game',
    }
  }

  try {
    let definitions
    try {
      definitions = await fetchDefinitions(appId, fetchOptions)
    } catch (error) {
      const stateInfo = steamAchievementStateForError(error)
      return {
        gameId,
        appId,
        title,
        status: 'failed',
        schemaState: 'unchanged',
        playerDataState: 'not_attempted',
        schemaSynced: false,
        playerProgressSynced: false,
        totalAchievements: 0,
        unlockedAchievements: 0,
        lockedAchievements: 0,
        unknownAchievements: 0,
        isCompleteSnapshot: false,
        completionPercentage: null,
        metadataInserted: 0,
        metadataUpdated: 0,
        playerRecordsInserted: 0,
        playerRecordsUpdated: 0,
        httpStatus: stateInfo.status,
        errorCode: stateInfo.errorCode,
        error: stateInfo.message,
      }
    }

    if (!Array.isArray(definitions)) {
      return {
        gameId,
        appId,
        title,
        status: 'failed',
        schemaState: 'unchanged',
        playerDataState: 'not_attempted',
        schemaSynced: false,
        playerProgressSynced: false,
        totalAchievements: 0,
        unlockedAchievements: 0,
        lockedAchievements: 0,
        unknownAchievements: 0,
        isCompleteSnapshot: false,
        completionPercentage: null,
        metadataInserted: 0,
        metadataUpdated: 0,
        playerRecordsInserted: 0,
        playerRecordsUpdated: 0,
        httpStatus: 502,
        errorCode: 'STEAM_API_INVALID_RESPONSE',
        error: 'Steam returned an invalid achievement schema response',
      }
    }

    let schemaResult
    try {
      schemaResult = await synchronizeAchievementSchema(supabase, gameId, definitions)
    } catch (error) {
      return {
        gameId,
        appId,
        title,
        status: 'failed',
        schemaState: 'unchanged',
        playerDataState: 'not_attempted',
        schemaSynced: false,
        playerProgressSynced: false,
        totalAchievements: 0,
        unlockedAchievements: 0,
        lockedAchievements: 0,
        unknownAchievements: 0,
        isCompleteSnapshot: false,
        completionPercentage: null,
        metadataInserted: 0,
        metadataUpdated: 0,
        playerRecordsInserted: 0,
        playerRecordsUpdated: 0,
        httpStatus: 500,
        errorCode: 'ACHIEVEMENT_METADATA_SYNC_FAILED',
        error: error.message,
      }
    }

    if (schemaResult.schemaState === 'no_achievements') {
      return {
        gameId,
        appId,
        title,
        status: 'no_achievements',
        schemaState: 'no_achievements',
        playerDataState: 'not_applicable',
        schemaSynced: true,
        playerProgressSynced: false,
        totalAchievements: 0,
        unlockedAchievements: 0,
        lockedAchievements: 0,
        unknownAchievements: 0,
        isCompleteSnapshot: true,
        completionPercentage: null,
        metadataInserted: schemaResult.metadataInserted,
        metadataUpdated: schemaResult.metadataUpdated,
        playerRecordsInserted: 0,
        playerRecordsUpdated: 0,
        httpStatus: 200,
      }
    }

    let playerAchievements
    try {
      playerAchievements = await fetchPlayer(steamId, appId, fetchOptions)
    } catch (error) {
      const stateInfo = steamAchievementStateForError(error)
      const isUnavailable = stateInfo.state === 'profile_private' || stateInfo.state === 'player_data_unavailable'
      return {
        gameId,
        appId,
        title,
        status: isUnavailable ? 'player_data_unavailable' : 'failed',
        schemaState: schemaResult.schemaState,
        playerDataState: stateInfo.state,
        schemaSynced: true,
        playerProgressSynced: false,
        totalAchievements: definitions.length,
        unlockedAchievements: 0,
        lockedAchievements: 0,
        unknownAchievements: definitions.length,
        isCompleteSnapshot: false,
        completionPercentage: null,
        metadataInserted: schemaResult.metadataInserted,
        metadataUpdated: schemaResult.metadataUpdated,
        playerRecordsInserted: 0,
        playerRecordsUpdated: 0,
        httpStatus: isUnavailable ? 200 : stateInfo.status,
        errorCode: stateInfo.errorCode,
        error: stateInfo.message,
      }
    }

    if (!Array.isArray(playerAchievements) || playerAchievements.length === 0) {
      return {
        gameId,
        appId,
        title,
        status: 'player_data_unavailable',
        schemaState: schemaResult.schemaState,
        playerDataState: 'player_data_unavailable',
        schemaSynced: true,
        playerProgressSynced: false,
        totalAchievements: definitions.length,
        unlockedAchievements: 0,
        lockedAchievements: 0,
        unknownAchievements: definitions.length,
        isCompleteSnapshot: false,
        completionPercentage: null,
        metadataInserted: schemaResult.metadataInserted,
        metadataUpdated: schemaResult.metadataUpdated,
        playerRecordsInserted: 0,
        playerRecordsUpdated: 0,
        httpStatus: 200,
        errorCode: 'STEAM_PLAYER_DATA_UNAVAILABLE',
        error: 'Steam player achievement data is unavailable',
      }
    }

    try {
      const playerResult = await synchronizePlayerProgress(
        supabase,
        userId,
        gameId,
        definitions,
        playerAchievements
      )
      const isUnavailable = playerResult.playerProgressSynced === false
      return {
        gameId,
        appId,
        title,
        status: isUnavailable ? 'player_data_unavailable' : 'success',
        schemaState: schemaResult.schemaState,
        ...playerResult,
        schemaSynced: true,
        metadataInserted: schemaResult.metadataInserted,
        metadataUpdated: schemaResult.metadataUpdated,
        httpStatus: 200,
      }
    } catch (error) {
      return {
        gameId,
        appId,
        title,
        status: 'failed',
        schemaState: schemaResult.schemaState,
        playerDataState: 'unchanged',
        schemaSynced: true,
        playerProgressSynced: false,
        totalAchievements: definitions.length,
        unlockedAchievements: 0,
        lockedAchievements: 0,
        unknownAchievements: definitions.length,
        isCompleteSnapshot: false,
        completionPercentage: null,
        metadataInserted: schemaResult.metadataInserted,
        metadataUpdated: schemaResult.metadataUpdated,
        playerRecordsInserted: 0,
        playerRecordsUpdated: 0,
        httpStatus: 500,
        errorCode: 'ACHIEVEMENT_PROGRESS_SYNC_FAILED',
        error: error.message,
      }
    }
  } catch (error) {
    return {
      gameId,
      appId,
      title,
      status: 'failed',
      schemaState: 'unchanged',
      playerDataState: 'unchanged',
      schemaSynced: false,
      playerProgressSynced: false,
      totalAchievements: 0,
      unlockedAchievements: 0,
      lockedAchievements: 0,
      unknownAchievements: 0,
      isCompleteSnapshot: false,
      completionPercentage: null,
      metadataInserted: 0,
      metadataUpdated: 0,
      playerRecordsInserted: 0,
      playerRecordsUpdated: 0,
      httpStatus: 500,
      errorCode: 'ACHIEVEMENT_SYNC_FAILED',
      error: error.message || 'Achievement synchronization is temporarily unavailable',
    }
  } finally {
    releaseLock(userId, gameId)
  }
}

function validUnlockTimestamp(achievement) {
  const seconds = Number(achievement?.unlockTimestamp ?? achievement?.unlocktime)
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null
  const date = new Date(seconds * 1000)
  if (!Number.isFinite(date.getTime())) return null
  return date.toISOString()
}

async function synchronizeAchievementSchema(supabase, gameId, definitions, now = new Date()) {
  if (!Array.isArray(definitions)) {
    throw new Error('A valid achievement schema definition array is required')
  }

  const syncedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const schemaState = definitions.length > 0 ? 'available' : 'no_achievements'

  const existingResponse = await supabase
    .from('achievements')
    .select('id, achievement_api_name, is_active')
    .eq('game_id', gameId)
  if (existingResponse.error) throw new Error('Unable to read existing achievement metadata')

  const existingRows = existingResponse.data || []
  const existingByName = new Map(existingRows.map((row) => [row.achievement_api_name, row.id]))

  let metadataInserted = 0
  let metadataUpdated = 0

  if (schemaState === 'available') {
    const upsertRows = definitions.map((definition) => ({
      game_id: gameId,
      achievement_api_name: definition.apiName,
      title: definition.displayName || definition.apiName,
      description: definition.description || null,
      icon_url: definition.icon || null,
      icon_gray_url: definition.iconGray || null,
      hidden: definition.hidden === true,
      is_active: true,
      last_seen_at: syncedAt,
    }))

    const upsertResponse = await supabase
      .from('achievements')
      .upsert(upsertRows, { onConflict: 'game_id,achievement_api_name' })
      .select('id, achievement_api_name')
    if (upsertResponse.error) throw new Error('Unable to synchronize achievement metadata')

    const returnedRows = upsertResponse.data || []
    const returnedNames = new Set(returnedRows.map((row) => row.achievement_api_name))
    for (const definition of definitions) {
      if (existingByName.has(definition.apiName)) metadataUpdated += 1
      else metadataInserted += 1
      if (!returnedNames.has(definition.apiName) && !existingByName.has(definition.apiName)) {
        throw new Error('Achievement metadata synchronization returned incomplete results')
      }
    }

    const confirmedNames = new Set(definitions.map((definition) => definition.apiName))
    for (const existing of existingRows) {
      if (confirmedNames.has(existing.achievement_api_name)) continue
      if (existing.is_active === false) continue
      const deactivateResponse = await supabase
        .from('achievements')
        .update({ is_active: false })
        .eq('id', existing.id)
      if (deactivateResponse.error) throw new Error('Unable to deactivate missing achievement metadata')
    }
  } else {
    // schemaState === 'no_achievements' (confirmed valid empty schema: achievements: [])
    // Deactivate all previously active achievement definitions for this game.
    // Preserve definitions and player progress; never delete records.
    for (const existing of existingRows) {
      if (existing.is_active === false) continue
      const deactivateResponse = await supabase
        .from('achievements')
        .update({ is_active: false })
        .eq('id', existing.id)
      if (deactivateResponse.error) throw new Error('Unable to deactivate obsolete achievement metadata')
    }
  }

  const gameUpdateResponse = await supabase
    .from('games')
    .update({
      achievement_schema_state: schemaState,
      achievement_schema_last_synced_at: syncedAt,
    })
    .eq('id', gameId)
  if (gameUpdateResponse.error) throw new Error('Unable to update achievement schema synchronization state')

  return {
    schemaState,
    metadataInserted,
    metadataUpdated,
    syncedAt,
  }
}

async function synchronizePlayerProgress(supabase, userId, gameId, definitions, playerAchievements, now = new Date()) {
  if (!Array.isArray(definitions)) {
    throw new Error('A valid achievement schema definitions array is required')
  }

  // If the confirmed schema has zero definitions, handle as valid no-achievements case without pretending progress was synced
  if (definitions.length === 0) {
    return {
      playerDataState: 'not_applicable',
      playerProgressSynced: false,
      playerRecordsInserted: 0,
      playerRecordsUpdated: 0,
      totalAchievements: 0,
      unlockedAchievements: 0,
      lockedAchievements: 0,
      unknownAchievements: 0,
      isCompleteSnapshot: true,
      completionPercentage: null,
    }
  }

  if (!Array.isArray(playerAchievements) || playerAchievements.length === 0) {
    return {
      playerDataState: 'player_data_unavailable',
      playerProgressSynced: false,
      playerRecordsInserted: 0,
      playerRecordsUpdated: 0,
      totalAchievements: definitions.length,
      unlockedAchievements: 0,
      lockedAchievements: 0,
      unknownAchievements: definitions.length,
      isCompleteSnapshot: false,
      completionPercentage: null,
    }
  }

  const definitionNames = new Set(definitions.map((definition) => definition.apiName))
  const achievementRowsResponse = await supabase
    .from('achievements')
    .select('id, achievement_api_name')
    .eq('game_id', gameId)
    .eq('is_active', true)
  if (achievementRowsResponse.error) throw new Error('Unable to resolve achievement records for progress synchronization')

  const achievementIdByName = new Map(
    (achievementRowsResponse.data || []).map((row) => [row.achievement_api_name, row.id])
  )

  const progressRows = []
  const seenApiNames = new Set()

  for (const playerAchievement of playerAchievements) {
    if (!playerAchievement || typeof playerAchievement.apiName !== 'string') continue
    const apiName = playerAchievement.apiName.trim()
    if (!apiName || seenApiNames.has(apiName)) continue
    if (!definitionNames.has(apiName)) continue
    const achievementId = achievementIdByName.get(apiName)
    if (!achievementId) continue
    if (typeof playerAchievement.achieved !== 'boolean') continue

    seenApiNames.add(apiName)
    const isUnlocked = playerAchievement.achieved
    const unlockedAt = isUnlocked ? validUnlockTimestamp(playerAchievement) : null
    progressRows.push({
      user_id: userId,
      achievement_id: achievementId,
      is_unlocked: isUnlocked,
      unlocked_at: unlockedAt,
    })
  }

  // If a nonempty player response contains only invalid or unrecognized entries:
  // Do not update player progress.
  // Do not update achievement_last_synced_at.
  // Return an honest unavailable or invalid player-data state.
  // Preserve existing progress.
  if (progressRows.length === 0) {
    return {
      playerDataState: 'player_data_unavailable',
      playerProgressSynced: false,
      playerRecordsInserted: 0,
      playerRecordsUpdated: 0,
      totalAchievements: definitions.length,
      unlockedAchievements: 0,
      lockedAchievements: 0,
      unknownAchievements: definitions.length,
      isCompleteSnapshot: false,
      completionPercentage: null,
    }
  }

  const existingProgressResponse = await supabase
    .from('user_achievements')
    .select('achievement_id')
    .eq('user_id', userId)
  if (existingProgressResponse.error) throw new Error('Unable to read existing player achievement progress')
  const existingAchievementIds = new Set(
    (existingProgressResponse.data || []).map((row) => row.achievement_id)
  )

  let playerRecordsInserted = 0
  let playerRecordsUpdated = 0

  const upsertResponse = await supabase
    .from('user_achievements')
    .upsert(progressRows, { onConflict: 'user_id,achievement_id' })
  if (upsertResponse.error) throw new Error('Unable to synchronize player achievement progress')
  for (const row of progressRows) {
    if (existingAchievementIds.has(row.achievement_id)) playerRecordsUpdated += 1
    else playerRecordsInserted += 1
  }

  const syncedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const userGameResponse = await supabase
    .from('user_games')
    .update({ achievement_last_synced_at: syncedAt })
    .eq('user_id', userId)
    .eq('game_id', gameId)
  if (userGameResponse.error) throw new Error('Unable to update player achievement synchronization state')

  const unlockedAchievements = progressRows.filter((row) => row.is_unlocked).length
  const lockedAchievements = progressRows.filter((row) => !row.is_unlocked).length
  const unknownAchievements = definitions.length - (unlockedAchievements + lockedAchievements)
  const isCompleteSnapshot = definitions.length > 0 && unknownAchievements === 0

  return {
    playerDataState: 'available',
    playerProgressSynced: true,
    playerRecordsInserted,
    playerRecordsUpdated,
    totalAchievements: definitions.length,
    unlockedAchievements,
    lockedAchievements,
    unknownAchievements,
    isCompleteSnapshot,
    completionPercentage: isCompleteSnapshot
      ? Number(((unlockedAchievements / definitions.length) * 100).toFixed(2))
      : null,
  }
}

module.exports = {
  validUnlockTimestamp,
  synchronizeAchievementSchema,
  synchronizePlayerProgress,
  acquireSyncLock,
  releaseSyncLock,
  isSyncLocked,
  clearAllSyncLocks,
  acquireBulkSyncLock,
  releaseBulkSyncLock,
  isBulkSyncLocked,
  clearAllBulkSyncLocks,
  DEFAULT_BULK_SYNC_CONCURRENCY,
  runWithConcurrencyLimit,
  executeGameAchievementSync,
  steamAchievementStateForError,
}
