const { getSupabaseServerClient } = require('../config/supabase')
const {
  fetchOwnedGames,
  fetchFamilySharedGames,
  fetchRecentlyPlayedGames,
} = require('../services/steamWebApi')

const synchronizationLocks = new Set()
const STALE_RUNNING_SYNC_MS = 15 * 60 * 1000
const SYNCHRONIZATION_COOLDOWN_MS = 30 * 1000
// Development-stage process-local protection. It is not shared across backend instances.
const synchronizationCooldowns = new Map()

function getSynchronizationCooldownRemaining(userId, now = Date.now()) {
  const cooldownExpiresAt = synchronizationCooldowns.get(userId)
  if (!cooldownExpiresAt) return 0
  const remainingMs = cooldownExpiresAt - now
  if (remainingMs <= 0) {
    synchronizationCooldowns.delete(userId)
    return 0
  }
  return remainingMs
}

function activateSynchronizationCooldown(userId, now = Date.now()) {
  synchronizationCooldowns.set(userId, now + SYNCHRONIZATION_COOLDOWN_MS)
}

function clearSynchronizationCooldown(userId) {
  synchronizationCooldowns.delete(userId)
}

function tryAcquireSynchronizationLock(userId) {
  if (synchronizationLocks.has(userId)) return false
  synchronizationLocks.add(userId)
  return true
}

function releaseSynchronizationLock(userId) {
  synchronizationLocks.delete(userId)
}

function hasSynchronizationLock(userId) {
  return synchronizationLocks.has(userId)
}

async function createSyncLog(supabase, userId) {
  const { data, error } = await supabase
    .from('sync_logs')
    .insert({
      user_id: userId,
      sync_status: 'Running',
      games_synced: 0,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) throw new Error('Unable to start the library synchronization log')
  return data.id
}

async function createSteamSyncRun(supabase, userId) {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('steam_sync_runs')
    .insert({ user_id: userId, overall_status: 'running', started_at: now })
    .select('id')
    .single()
  if (error) throw new Error('Unable to start the unified Steam synchronization')
  return { id: data.id, startedAt: now }
}

async function createSourceResults(supabase, runId) {
  const now = new Date().toISOString()
  const rows = ['owned', 'family_shared', 'recently_played'].map((sourceType) => ({
    run_id: runId,
    source_type: sourceType,
    status: 'pending',
    returned_count: 0,
    started_at: now,
  }))
  const { error } = await supabase.from('steam_sync_source_results').insert(rows)
  if (error) throw new Error('Unable to initialize Steam synchronization source results')
}

async function updateSourceResult(supabase, runId, sourceType, result) {
  const { error } = await supabase
    .from('steam_sync_source_results')
    .update({
      status: result.status,
      returned_count: result.returnedCount,
      completed_at: result.completedAt,
      error_code: result.errorCode || null,
      error_message: result.errorMessage || null,
    })
    .eq('run_id', runId)
    .eq('source_type', sourceType)
  if (error) throw new Error(`Unable to update ${sourceType} synchronization result`)
}

async function finishSteamSyncRun(supabase, runId, overallStatus, completedAt) {
  const { error } = await supabase
    .from('steam_sync_runs')
    .update({ overall_status: overallStatus, completed_at: completedAt })
    .eq('id', runId)
  if (error) {
    const completionError = new Error('Unable to finalize the Steam synchronization run')
    completionError.code = 'SYNC_RUN_COMPLETION_FAILED'
    throw completionError
  }
}

function classifySourceFailure(error) {
  if (error?.code === 'STEAM_API_RATE_LIMITED') return 'rate_limited'
  if (error?.code === 'STEAM_API_UNAUTHORIZED') return 'unauthorized'
  if (error?.code === 'STEAM_API_KEY_MISSING') return 'unauthorized'
  if (error?.code === 'STEAM_API_UNAVAILABLE') return 'unavailable'
  if (error?.code === 'STEAM_API_INVALID_RESPONSE') return 'invalid_response'
  return 'request_failed'
}

function requireSupabaseQuery(result, message) {
  if (result?.error) throw new Error(message)
  return result?.data
}

function mergeSteamRecords(ownedRecords, familyRecords, recentRecords) {
  const merged = new Map()

  function addRecord(record, sourceType) {
    if (!record || !Number.isSafeInteger(record.steamAppId) || record.steamAppId <= 0) return
    const appId = record.steamAppId
    const existing = merged.get(appId) || {
      steamAppId: appId,
      title: null,
      coverImage: null,
      headerImage: null,
      owned: null,
      family: null,
      recent: null,
    }
    existing.title = existing.title || record.title || null
    existing.coverImage = existing.coverImage || record.coverImage || null
    existing.headerImage = existing.headerImage || record.headerImage || null
    existing[sourceType] = record
    merged.set(appId, existing)
  }

  for (const record of ownedRecords) addRecord(record, 'owned')
  for (const record of familyRecords) {
    if (record.familyShared === true) addRecord(record, 'family')
  }
  for (const record of recentRecords) addRecord(record, 'recent')
  return merged
}

function chooseCanonicalLifetime(merged, existing) {
  if (merged.owned?.playtimeMinutes != null) return merged.owned.playtimeMinutes
  if (merged.family?.playtimeMinutes != null) return merged.family.playtimeMinutes
  if (merged.recent?.playtimeMinutes != null) return merged.recent.playtimeMinutes
  return existing?.playtime_minutes ?? 0
}

function chooseCanonicalLastPlayed(merged, options = {}) {
  if (options.recentSuccessful === false) {
    return options.existingLastPlayedAt || null
  }
  if (options.recentSuccessful === true) {
    if (merged.recent) return merged.recent.lastPlayedAt || null
    return options.existingLastPlayedAt || null
  }
  return options.existingLastPlayedAt || null
}

function choosePrimarySourceLabel(gameMappings) {
  for (const sourceType of ['owned', 'family_shared', 'recently_played']) {
    if (gameMappings[sourceType]?.freshness_status === 'confirmed') {
      return sourceType === 'recently_played' ? 'recently_played_unknown' : sourceType
    }
  }
  return 'ownership_unconfirmed'
}

function buildCanonicalOwnershipRow({ userId, gameId, playtimeMinutes, lastPlayedAt, updatedAt }) {
  return {
    user_id: userId,
    game_id: gameId,
    playtime_minutes: playtimeMinutes,
    updated_at: updatedAt,
    last_played_at: lastPlayedAt,
  }
}

function countMergedAppIds(sourceRecords) {
  const appIds = new Set()
  for (const records of Object.values(sourceRecords)) {
    if (!Array.isArray(records)) continue
    for (const record of records) {
      if (Number.isSafeInteger(record?.steamAppId) && record.steamAppId > 0) {
        appIds.add(record.steamAppId)
      }
    }
  }
  return appIds.size
}

async function rollbackStaleSourceMappings(supabase, userId, sourceType, mappings) {
  for (const appliedMapping of [...mappings].reverse()) {
    const { error: rollbackError } = await supabase
      .from('user_game_sources')
      .update({ freshness_status: 'confirmed' })
      .eq('user_id', userId)
      .eq('game_id', appliedMapping.game_id)
      .eq('source_type', sourceType)
    if (rollbackError) {
      const rollbackFailure = new Error('Unable to roll back stale Steam source evidence updates')
      rollbackFailure.code = 'SOURCE_FRESHNESS_ROLLBACK_FAILED'
      rollbackFailure.sourceType = sourceType
      throw rollbackFailure
    }
  }
}

async function updateSourceMappings({
  supabase,
  userId,
  runId,
  syncedAt,
  ownedRecords,
  familyRecords,
  recentRecords,
  sourceResults,
  gameIdByAppId,
  existingMappingsByKey,
}) {
  const sourceInputs = {
    owned: ownedRecords.map((record) => [record.steamAppId, record]),
    family_shared: familyRecords.filter((record) => record.familyShared === true).map((record) => [record.steamAppId, record]),
    recently_played: recentRecords.map((record) => [record.steamAppId, record]),
  }

  for (const [sourceType, entries] of Object.entries(sourceInputs)) {
    const result = sourceResults[sourceType]
    if (!result || (result.status !== 'success_records' && result.status !== 'success_empty')) continue

    const includedAppIds = new Set(entries.map(([appId]) => appId))
    const { data: existingMappings, error: mappingReadError } = await supabase
      .from('user_game_sources')
      .select('game_id, source_type, evidence_provenance, freshness_status, first_seen_at, games(steam_app_id)')
      .eq('user_id', userId)
      .eq('source_type', sourceType)
    if (mappingReadError) {
      const readError = new Error(`Unable to read ${sourceType} source evidence`)
      readError.code = 'SOURCE_MAPPING_READ_FAILED'
      readError.sourceType = sourceType
      throw readError
    }

    const staleUpdatesApplied = []
    for (const mapping of existingMappings || []) {
      const appId = Number(mapping.games?.steam_app_id)
      if (!Number.isSafeInteger(appId) || appId <= 0 || includedAppIds.has(appId)) continue
      if (mapping.freshness_status === 'confirmed') {
        const { error: staleError } = await supabase
          .from('user_game_sources')
          .update({ freshness_status: 'stale' })
          .eq('user_id', userId)
          .eq('game_id', mapping.game_id)
          .eq('source_type', sourceType)
        if (staleError) {
          await rollbackStaleSourceMappings(supabase, userId, sourceType, staleUpdatesApplied)
          const staleErrorWithSource = new Error('Unable to update stale Steam source evidence')
          staleErrorWithSource.code = 'SOURCE_FRESHNESS_UPDATE_FAILED'
          staleErrorWithSource.sourceType = sourceType
          throw staleErrorWithSource
        }
        staleUpdatesApplied.push(mapping)
      }
    }

    for (const [appId, record] of entries) {
      const gameId = gameIdByAppId.get(String(appId))
      if (!gameId) continue
      const key = `${gameId}:${sourceType}`
      const existing = existingMappingsByKey.get(key)
      const row = {
        user_id: userId,
        game_id: gameId,
        source_type: sourceType,
        evidence_provenance: existing?.evidence_provenance || 'steam_sync',
        freshness_status: 'confirmed',
        first_seen_at: existing?.first_seen_at || syncedAt,
        last_observed_at: syncedAt,
        last_confirmed_at: syncedAt,
        last_confirmation_run_id: runId,
      }
      if (sourceType === 'recently_played') {
        if (record.recentPlaytimeMinutes != null) {
          row.recent_playtime_minutes = record.recentPlaytimeMinutes
          row.recent_playtime_last_observed_at = syncedAt
        }
      }
      const { error: mappingError } = await supabase
        .from('user_game_sources')
        .upsert(row, { onConflict: 'user_id,game_id,source_type' })
      if (mappingError) {
        await rollbackStaleSourceMappings(supabase, userId, sourceType, staleUpdatesApplied)
        const evidenceError = new Error(`Unable to update ${sourceType} source evidence`)
        evidenceError.code = 'SOURCE_EVIDENCE_UPDATE_FAILED'
        evidenceError.sourceType = sourceType
        throw evidenceError
      }
    }
  }
}

async function finishSyncLog(supabase, logId, syncStatus, gamesSynced, errorMessage = null) {
  await supabase
    .from('sync_logs')
    .update({
      sync_status: syncStatus,
      games_synced: gamesSynced,
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq('id', logId)
}

function normalizeLibraryRow(row, sourceInformation = null) {
  const game = row.games || {}
  return {
    id: game.id || row.game_id,
    steamAppId: game.steam_app_id,
    title: game.title,
    description: game.description || null,
    cover: game.cover_image || null,
    header: game.header_image || null,
    developer: game.developer || null,
    publisher: game.publisher || null,
    releaseDate: game.release_date || null,
    playtime: Number.isFinite(row.playtime_minutes / 60) ? row.playtime_minutes / 60 : 0,
    playtimeMinutes: row.playtime_minutes || 0,
    status: row.status || 'Backlog',
    lastPlayedAt: row.last_played_at || null,
    rating: null,
    achievements: 0,
    achievementTotal: 0,
    ...(sourceInformation || {}),
  }
}

async function syncOwnedGames(req, res, options = {}) {
  const gameVaultUserId = req.user?.gameVaultUserId || req.user?.id
  const steamId = req.user?.steamId

  if (!steamId) {
    return res.status(400).json({ error: 'SteamID is missing from the authenticated session' })
  }
  if (!gameVaultUserId || gameVaultUserId === 'development-user') {
    return res.status(400).json({ error: 'A Steam-linked GameVault account is required' })
  }

  let supabase
  let syncLogId = null
  let steamSyncRunId = null
  let lockAcquired = false
  try {
    supabase = options.supabaseClient || getSupabaseServerClient()

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, steam_id')
      .eq('id', gameVaultUserId)
      .eq('steam_id', steamId)
      .maybeSingle()
    if (userError) return res.status(500).json({ error: 'Unable to verify the authenticated user' })
    if (!user) return res.status(404).json({ error: 'Authenticated Steam user record was not found' })

    if (!tryAcquireSynchronizationLock(gameVaultUserId)) {
      return res.status(409).json({ error: 'A Steam library synchronization is already running for this account' })
    }
    lockAcquired = true

    const cooldownRemainingMs = getSynchronizationCooldownRemaining(gameVaultUserId)
    if (cooldownRemainingMs > 0) {
      return res.status(429).json({
        error: 'Steam library synchronization is cooling down',
        retryAfterSeconds: Math.ceil(cooldownRemainingMs / 1000),
        retryAfterMs: cooldownRemainingMs,
      })
    }

    const { data: runningRuns, error: runningRunError } = await supabase
      .from('steam_sync_runs')
      .select('id, started_at')
      .eq('user_id', gameVaultUserId)
      .eq('overall_status', 'running')
      .order('started_at', { ascending: false })
      .limit(1)
    if (runningRunError) throw new Error('Unable to check for an existing Steam synchronization run')
    const runningRun = Array.isArray(runningRuns) ? runningRuns[0] : null
    if (runningRun) {
      const runAgeMs = Date.now() - new Date(runningRun.started_at).getTime()
      if (!Number.isFinite(runAgeMs) || runAgeMs < STALE_RUNNING_SYNC_MS) {
        return res.status(409).json({ error: 'A Steam library synchronization is already running for this account' })
      }
      const { error: staleRunError } = await supabase
        .from('steam_sync_runs')
        .update({ overall_status: 'failed', completed_at: new Date().toISOString() })
        .eq('id', runningRun.id)
        .eq('user_id', gameVaultUserId)
        .eq('overall_status', 'running')
      if (staleRunError) throw new Error('Unable to finalize an abandoned Steam synchronization run')
    }

    syncLogId = await createSyncLog(supabase, gameVaultUserId)
    const run = await createSteamSyncRun(supabase, gameVaultUserId)
    steamSyncRunId = run.id
    await createSourceResults(supabase, run.id)

    const sourceRequests = [
      {
        sourceType: 'owned',
        fetch: options.fetchOwnedGames || fetchOwnedGames,
      },
      {
        sourceType: 'family_shared',
        fetch: options.fetchFamilySharedGames || fetchFamilySharedGames,
      },
      {
        sourceType: 'recently_played',
        fetch: options.fetchRecentlyPlayedGames || fetchRecentlyPlayedGames,
      },
    ]

    const sourceResults = {}
    const sourceRecords = {}
    await Promise.all(sourceRequests.map(async (source) => {
      const startedAt = new Date().toISOString()
      try {
        const records = await source.fetch(steamId, options.fetchOptions)
        const validRecords = Array.isArray(records) ? records : []
        const status = validRecords.length > 0 ? 'success_records' : 'success_empty'
        sourceRecords[source.sourceType] = validRecords
        sourceResults[source.sourceType] = {
          status,
          returnedCount: validRecords.length,
          startedAt,
          completedAt: new Date().toISOString(),
        }
      } catch (error) {
        sourceRecords[source.sourceType] = null
        const status = classifySourceFailure(error)
        sourceResults[source.sourceType] = {
          status,
          returnedCount: 0,
          startedAt,
          completedAt: new Date().toISOString(),
          errorCode: error.code || 'STEAM_API_REQUEST_FAILED',
          errorMessage: error.message || 'Steam source request failed',
        }
      }
      await updateSourceResult(supabase, run.id, source.sourceType, sourceResults[source.sourceType])
    }))

    const successfulSources = Object.values(sourceResults).filter((result) =>
      result.status === 'success_records' || result.status === 'success_empty'
    ).length
    const syncedAt = new Date().toISOString()
    const overallStatus = successfulSources === 0
      ? 'failed'
      : successfulSources === 3 ? 'success' : 'partial'

    if (successfulSources > 0) {
      const ownedRecords = sourceRecords.owned || []
      const familyRecords = sourceResults.family_shared.status === 'success_records' ||
        sourceResults.family_shared.status === 'success_empty'
        ? sourceRecords.family_shared || []
        : []
      const recentRecords = sourceResults.recently_played.status === 'success_records' ||
        sourceResults.recently_played.status === 'success_empty'
        ? sourceRecords.recently_played || []
        : []

      const mergedByAppId = mergeSteamRecords(ownedRecords, familyRecords, recentRecords)
      const gameRows = [...mergedByAppId.values()].map((game) => ({
        steam_app_id: game.steamAppId,
        title: game.title,
        cover_image: game.coverImage,
        header_image: game.headerImage,
      }))

      let upsertedGames = []
      if (gameRows.length > 0) {
        const { data, error: gamesError } = await supabase
          .from('games')
          .upsert(gameRows, { onConflict: 'steam_app_id' })
          .select('id, steam_app_id')
        if (gamesError || !Array.isArray(data)) {
          throw new Error('Unable to upsert Steam game records')
        }
        upsertedGames = data
      }

      const gameIdByAppId = new Map(upsertedGames.map((game) => [String(game.steam_app_id), game.id]))
      const appIds = [...mergedByAppId.keys()]

      const ownershipQuery = appIds.length > 0
        ? await supabase
          .from('user_games')
          .select('game_id, playtime_minutes, status, last_played_at')
          .eq('user_id', gameVaultUserId)
          .in('game_id', upsertedGames.map((game) => game.id))
        : { data: [] }
      const existingOwnershipRows = requireSupabaseQuery(
        ownershipQuery,
        'Unable to read existing ownership state for synchronization'
      )
      const existingOwnershipByGameId = new Map((existingOwnershipRows || []).map((row) => [row.game_id, row]))

      const { data: existingMappings, error: existingMappingsError } = await supabase
        .from('user_game_sources')
        .select('game_id, source_type, evidence_provenance, freshness_status, first_seen_at')
        .eq('user_id', gameVaultUserId)
      requireSupabaseQuery(
        { data: existingMappings, error: existingMappingsError },
        'Unable to read existing source evidence for synchronization'
      )
      const existingMappingsByKey = new Map(
        (existingMappings || []).map((mapping) => [`${mapping.game_id}:${mapping.source_type}`, mapping])
      )

      const ownershipRows = []
      for (const appId of appIds) {
        const gameId = gameIdByAppId.get(String(appId))
        const merged = mergedByAppId.get(appId)
        if (!gameId || !merged) continue

        const existing = existingOwnershipByGameId.get(gameId)
        const canonicalLifetime = chooseCanonicalLifetime(merged, existing)
        const canonicalLastPlayed = chooseCanonicalLastPlayed(merged, {
          recentSuccessful: sourceResults.recently_played?.status === 'success_records'
            || sourceResults.recently_played?.status === 'success_empty',
          existingLastPlayedAt: existing?.last_played_at || null,
        })
        const row = buildCanonicalOwnershipRow({
          userId: gameVaultUserId,
          gameId,
          playtimeMinutes: canonicalLifetime,
          lastPlayedAt: canonicalLastPlayed,
          updatedAt: syncedAt,
        })

        ownershipRows.push(row)
      }

      if (ownershipRows.length > 0) {
        const { error: ownershipError } = await supabase
          .from('user_games')
          .upsert(ownershipRows, { onConflict: 'user_id,game_id' })
        if (ownershipError) throw new Error('Unable to update unified user-game records')
      }

      try {
        await updateSourceMappings({
          supabase,
          userId: gameVaultUserId,
          runId: run.id,
          syncedAt,
          ownedRecords,
          familyRecords,
          recentRecords,
          sourceResults,
          gameIdByAppId,
          existingMappingsByKey,
        })
      } catch (evidenceError) {
        const affectedSource = evidenceError.sourceType || 'owned'
        const failedResult = {
          status: 'request_failed',
          returnedCount: 0,
          startedAt: sourceResults[affectedSource]?.startedAt || syncedAt,
          completedAt: new Date().toISOString(),
          errorCode: evidenceError.code || 'SOURCE_EVIDENCE_UPDATE_FAILED',
          errorMessage: evidenceError.message || 'Steam source evidence update failed',
        }
        sourceResults[affectedSource] = failedResult
        await updateSourceResult(supabase, run.id, affectedSource, failedResult)
        throw evidenceError
      }
    }

    await finishSteamSyncRun(supabase, run.id, overallStatus, syncedAt)
    await finishSyncLog(
      supabase,
      syncLogId,
      overallStatus === 'failed' ? 'Failed' : 'Succeeded',
      countMergedAppIds(sourceRecords),
      overallStatus === 'failed' ? 'All Steam library sources failed' : null
    )

    const allFailed = successfulSources === 0
    const gamesReceived = countMergedAppIds(sourceRecords)
    const statusCode = allFailed ? 502 : 200
    return res.status(statusCode).json({
      success: !allFailed,
      status: overallStatus,
      gamesReceived,
      gamesImportedOrUpdated: successfulSources > 0 ? countMergedAppIds(sourceRecords) : 0,
      syncedAt,
      sourceResults,
      message: allFailed
        ? 'Steam library synchronization failed'
        : overallStatus === 'partial'
          ? 'Steam library synchronization completed with partial source results'
          : 'Steam library synchronization completed',
    })
  } catch (error) {
    if (syncLogId && supabase) {
      await finishSyncLog(supabase, syncLogId, 'Failed', 0, 'Library synchronization failed')
    }
    if (steamSyncRunId && supabase) {
      try {
        await finishSteamSyncRun(supabase, steamSyncRunId, 'failed', new Date().toISOString())
      } catch (completionError) {
        return res.status(500).json({
          error: completionError.message || 'Unable to finalize the failed Steam synchronization run',
        })
      }
    }
    return res.status(500).json({ error: 'Unable to synchronize the Steam library' })
  } finally {
    if (lockAcquired) releaseSynchronizationLock(gameVaultUserId)
    if (steamSyncRunId) activateSynchronizationCooldown(gameVaultUserId)
  }
}

async function getOwnedGames(req, res, options = {}) {
  const gameVaultUserId = req.user?.gameVaultUserId || req.user?.id
  if (!gameVaultUserId || gameVaultUserId === 'development-user') {
    return res.status(400).json({ error: 'A Steam-linked GameVault account is required' })
  }

  try {
    const supabase = options.supabaseClient || getSupabaseServerClient()
    const { data: ownershipRows, error: ownershipError } = await supabase
      .from('user_games')
      .select('game_id, playtime_minutes, status, last_played_at, updated_at')
      .eq('user_id', gameVaultUserId)

    if (ownershipError) return res.status(500).json({ error: 'Unable to load the synchronized library' })
    const ownershipGameIds = (ownershipRows || []).map((row) => row.game_id)

    const { data: sourceMappings, error: sourceMappingsError } = await supabase
      .from('user_game_sources')
      .select('game_id, source_type, evidence_provenance, first_seen_at, last_observed_at, last_confirmed_at, last_confirmation_run_id, freshness_status, recent_playtime_minutes, recent_playtime_last_observed_at')
      .eq('user_id', gameVaultUserId)
    if (sourceMappingsError) return res.status(500).json({ error: 'Unable to load synchronized source evidence' })
    const mappings = sourceMappings || []

    const linkedGameIds = [...new Set([
      ...ownershipGameIds,
      ...mappings.map((mapping) => mapping.game_id),
    ])]

    let gameRows = []
    if (linkedGameIds.length > 0) {
      const { data, error: gamesError } = await supabase
        .from('games')
        .select('id, steam_app_id, title, description, cover_image, header_image, developer, publisher, release_date')
        .in('id', linkedGameIds)
      if (gamesError) return res.status(500).json({ error: 'Unable to load synchronized game metadata' })
      gameRows = data || []
    }

    const { data: latestRuns, error: latestRunsError } = await supabase
      .from('steam_sync_runs')
      .select('id, started_at')
      .eq('user_id', gameVaultUserId)
      .order('started_at', { ascending: false })
      .limit(20)
    if (latestRunsError) return res.status(500).json({ error: 'Unable to load synchronization freshness' })
    const runIds = (latestRuns || []).map((run) => run.id)
    let sourceResults = []
    if (runIds.length > 0) {
      const { data, error: sourceResultsError } = await supabase
        .from('steam_sync_source_results')
        .select('run_id, source_type, status, returned_count, started_at, completed_at, error_code, error_message')
        .in('run_id', runIds)
      if (sourceResultsError) return res.status(500).json({ error: 'Unable to load source synchronization status' })
      sourceResults = data || []
    }

    const runOrder = new Map((latestRuns || []).map((run, index) => [run.id, index]))
    const latestAttempts = {}
    const latestSuccessful = {}
    for (const result of sourceResults) {
      const attempts = result.source_type === 'owned' || result.source_type === 'family_shared' || result.source_type === 'recently_played'
        ? result
        : null
      if (!attempts) continue
      const resultIndex = runOrder.get(result.run_id) ?? Number.MAX_SAFE_INTEGER
      const currentAttempt = latestAttempts[result.source_type]
      if (!currentAttempt || resultIndex < (runOrder.get(currentAttempt.run_id) ?? Number.MAX_SAFE_INTEGER)) {
        latestAttempts[result.source_type] = result
      }
      if (result.status === 'success_records' || result.status === 'success_empty') {
        const currentSuccess = latestSuccessful[result.source_type]
        if (!currentSuccess || resultIndex < (runOrder.get(currentSuccess.run_id) ?? Number.MAX_SAFE_INTEGER)) {
          latestSuccessful[result.source_type] = result
        }
      }
    }

    const ownershipByGameId = new Map((ownershipRows || []).map((row) => [row.game_id, row]))
    const mappingsByGameId = new Map()
    for (const mapping of mappings) {
      if (!mappingsByGameId.has(mapping.game_id)) mappingsByGameId.set(mapping.game_id, {})
      mappingsByGameId.get(mapping.game_id)[mapping.source_type] = mapping
    }

    const gameById = new Map(gameRows.map((game) => [game.id, game]))
    const games = [...linkedGameIds]
      .map((gameId) => {
        const ownership = ownershipByGameId.get(gameId) || { game_id: gameId, playtime_minutes: 0, status: 'Backlog', last_played_at: null, updated_at: null }
        const gameMappings = mappingsByGameId.get(gameId) || {}
        const sourceEvidence = {}
        for (const sourceType of ['owned', 'family_shared', 'recently_played']) {
          const mapping = gameMappings[sourceType]
          if (mapping) {
            sourceEvidence[sourceType] = {
              status: mapping.freshness_status,
              evidenceProvenance: mapping.evidence_provenance,
              firstSeenAt: mapping.first_seen_at,
              lastObservedAt: mapping.last_observed_at,
              lastConfirmedAt: mapping.last_confirmed_at,
              lastConfirmationRunId: mapping.last_confirmation_run_id,
              recentPlaytimeMinutes: sourceType === 'recently_played' ? mapping.recent_playtime_minutes : undefined,
              recentPlaytimeLastObservedAt: sourceType === 'recently_played' ? mapping.recent_playtime_last_observed_at : undefined,
            }
          } else {
            sourceEvidence[sourceType] = {
              status: latestSuccessful[sourceType] ? 'not_observed' : 'never_observed',
            }
          }
        }

        const primaryAccessSource = choosePrimarySourceLabel(gameMappings)

        const sourceAttempts = {}
        for (const sourceType of ['owned', 'family_shared', 'recently_played']) {
          const attempt = latestAttempts[sourceType]
          if (attempt) {
            sourceAttempts[sourceType] = {
              status: attempt.status,
              returnedCount: attempt.returned_count,
              completedAt: attempt.completed_at,
              errorCode: attempt.error_code,
              errorMessage: attempt.error_message,
            }
          }
        }

        return normalizeLibraryRow(
          { ...ownership, games: gameById.get(gameId) },
          { primaryAccessSource, sourceEvidence, sourceAttempts }
        )
      })
      .filter((game) => game.title)
      .sort((a, b) => {
        if (b.playtimeMinutes !== a.playtimeMinutes) return b.playtimeMinutes - a.playtimeMinutes
        return a.title.localeCompare(b.title)
      })

    const gameIdsSet = new Set(linkedGameIds)
    const ownedConfirmedLatest = new Set(
      mappings.filter((mapping) => mapping.source_type === 'owned' && mapping.freshness_status === 'confirmed').map((mapping) => mapping.game_id)
    )
    const familyConfirmedLatest = new Set(
      mappings.filter((mapping) => mapping.source_type === 'family_shared' && mapping.freshness_status === 'confirmed').map((mapping) => mapping.game_id)
    )
    const recentConfirmedLatest = new Set(
      mappings.filter((mapping) => mapping.source_type === 'recently_played' && mapping.freshness_status === 'confirmed').map((mapping) => mapping.game_id)
    )
    const familyHistoricalEvidence = new Set(
      mappings.filter((mapping) => mapping.source_type === 'family_shared').map((mapping) => mapping.game_id)
    )
    const recentlyPlayedHistoricalEvidence = new Set(
      mappings.filter((mapping) => mapping.source_type === 'recently_played').map((mapping) => mapping.game_id)
    )
    const recentWithoutConfirmedOwnership = [...recentConfirmedLatest].filter((gameId) =>
      !ownedConfirmedLatest.has(gameId) && !familyConfirmedLatest.has(gameId)
    ).length

    const mappingsByGame = new Map()
    for (const mapping of mappings) {
      if (!mappingsByGame.has(mapping.game_id)) mappingsByGame.set(mapping.game_id, [])
      mappingsByGame.get(mapping.game_id).push(mapping)
    }
    let currentSourceStatusUnverified = 0
    for (const gameMappings of mappingsByGame.values()) {
      if (gameMappings.length > 0 && gameMappings.every((mapping) => mapping.freshness_status === 'unverified')) {
        currentSourceStatusUnverified += 1
      }
    }

    const latestOwnership = (ownershipRows || [])
      .map((row) => row.updated_at)
      .filter(Boolean)
      .sort()
      .at(-1) || null
    const sourceAttempts = {}
    for (const sourceType of ['owned', 'family_shared', 'recently_played']) {
      const attempt = latestAttempts[sourceType]
      if (attempt) {
        sourceAttempts[sourceType] = {
          status: attempt.status,
          returnedCount: attempt.returned_count,
          completedAt: attempt.completed_at,
          errorCode: attempt.error_code,
          errorMessage: attempt.error_message,
        }
      }
    }

    return res.json({
      games,
      count: games.length,
      lastSyncedAt: latestOwnership,
      totalPlaytimeMinutes: games.reduce((sum, game) => sum + (game.playtimeMinutes || 0), 0),
      sourceAttempts,
      counts: {
        totalUniqueGamesRecorded: gameIdsSet.size,
        ownedConfirmedLatest: ownedConfirmedLatest.size,
        familySharedConfirmedLatest: familyConfirmedLatest.size,
        familySharedHistoricalEvidence: familyHistoricalEvidence.size,
        recentlyPlayedConfirmedLatest: recentConfirmedLatest.size,
        recentlyPlayedHistoricalEvidence: recentlyPlayedHistoricalEvidence.size,
        recentlyPlayedWithoutConfirmedOwnership: recentWithoutConfirmedOwnership,
        currentSourceStatusUnverified,
      },
    })
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load the synchronized library' })
  }
}

module.exports = {
  syncOwnedGames,
  getOwnedGames,
  normalizeLibraryRow,
  mergeSteamRecords,
  chooseCanonicalLifetime,
  chooseCanonicalLastPlayed,
  choosePrimarySourceLabel,
  buildCanonicalOwnershipRow,
  requireSupabaseQuery,
  classifySourceFailure,
  updateSourceMappings,
  rollbackStaleSourceMappings,
  finishSteamSyncRun,
  tryAcquireSynchronizationLock,
  releaseSynchronizationLock,
  hasSynchronizationLock,
  SYNCHRONIZATION_COOLDOWN_MS,
  getSynchronizationCooldownRemaining,
  activateSynchronizationCooldown,
  clearSynchronizationCooldown,
}
