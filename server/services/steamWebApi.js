const STEAM_API_TIMEOUT_MS = 8000

function isValidSteamId(value) {
  return typeof value === 'string' && /^7656119\d{10}$/.test(value)
}

function isValidSteamAvatarUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.endsWith('steamstatic.com')
  } catch {
    return false
  }
}

async function fetchSteamGames(steamId, endpoint, options = {}) {
    const apiKey = options.apiKey ?? process.env.STEAM_API_KEY
    const fetchImpl = options.fetchImpl ?? globalThis.fetch
    const timeoutMs = options.timeoutMs ?? STEAM_API_TIMEOUT_MS

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      const error = new Error('Steam Web API key is not configured')
      error.code = 'STEAM_API_KEY_MISSING'
      throw error
    }
    if (!isValidSteamId(steamId)) {
      const error = new Error('A valid SteamID is required')
      error.code = 'STEAM_ID_INVALID'
      throw error
    }

    const url = new URL(`https://api.steampowered.com/${endpoint}`)
    url.searchParams.set('key', apiKey)
    url.searchParams.set('steamid', steamId)
    if (endpoint.includes('GetOwnedGames')) {
      url.searchParams.set('include_appinfo', 'true')
      url.searchParams.set('include_played_free_games', 'true')
      if (options.includeFamilyLicenses) {
        url.searchParams.set('include_family_licenses', 'true')
      }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      let response
      try {
        response = await fetchImpl(url, { method: 'GET', signal: controller.signal })
      } catch (error) {
        if (error.name === 'AbortError') {
          const timeoutError = new Error('Steam library request timed out')
          timeoutError.code = 'STEAM_API_TIMEOUT'
          throw timeoutError
        }
        const requestError = new Error('Steam library request failed')
        requestError.code = 'STEAM_API_REQUEST_FAILED'
        throw requestError
      }

      if (!response?.ok) {
        const status = Number(response?.status)
        const statusError = new Error(`Steam library API returned HTTP ${status || 'unknown'}`)
        if (status === 429) statusError.code = 'STEAM_API_RATE_LIMITED'
        else if (status === 401 || status === 403) statusError.code = 'STEAM_API_UNAUTHORIZED'
        else if (status === 404 || status === 400) statusError.code = 'STEAM_API_UNAVAILABLE'
        else statusError.code = 'STEAM_API_REQUEST_FAILED'
        throw statusError
      }

      let body
      try {
        body = await response.json()
      } catch {
        const invalidError = new Error('Steam library API returned invalid JSON')
        invalidError.code = 'STEAM_API_INVALID_RESPONSE'
        throw invalidError
      }

      const steamResponse = body?.response
      if (!steamResponse || typeof steamResponse !== 'object') {
        const inaccessibleError = new Error('Steam library data is private or unavailable')
        inaccessibleError.code = 'STEAM_API_INVALID_RESPONSE'
        throw inaccessibleError
      }

      const rawGames = steamResponse.games
      if (!Array.isArray(rawGames)) {
        if (steamResponse.game_count === 0 || Object.keys(steamResponse).length === 0) return []
        const inaccessibleError = new Error('Steam library data is unavailable or private')
        inaccessibleError.code = 'STEAM_API_INVALID_RESPONSE'
        throw inaccessibleError
      }

      const seen = new Set()
      return rawGames.flatMap((game) => {
        const appId = Number(game?.appid)
        const title = typeof game?.name === 'string' ? game.name.trim() : ''
        const rawPlaytimeMinutes = game?.playtime_forever
        const rawRecentMinutes = game?.playtime_2weeks
        const lastPlayedSeconds = Number(game?.rtime_last_played)
        if (!Number.isSafeInteger(appId) || appId <= 0 || !title || seen.has(appId)) return []
        seen.add(appId)
        const playtimeMinutes = typeof rawPlaytimeMinutes === 'number'
          && Number.isSafeInteger(rawPlaytimeMinutes)
          && rawPlaytimeMinutes >= 0
          ? rawPlaytimeMinutes
          : null
        const recentMinutes = typeof rawRecentMinutes === 'number'
          && Number.isSafeInteger(rawRecentMinutes)
          && rawRecentMinutes >= 0
          ? rawRecentMinutes
          : null
        const lastPlayedAt = Number.isSafeInteger(lastPlayedSeconds)
          && lastPlayedSeconds > 0
          && Number.isFinite(new Date(lastPlayedSeconds * 1000).getTime())
          ? new Date(lastPlayedSeconds * 1000).toISOString()
          : null

        return [{
          steamAppId: appId,
          title,
          coverImage: `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
          headerImage: `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
          familyShared: game?.family_shared === true,
          playtimeMinutes,
          recentPlaytimeMinutes: recentMinutes,
          lastPlayedAt,
        }]
      })
    } finally {
      clearTimeout(timer)
    }
  }

async function fetchOwnedGames(steamId, options = {}) {
  return fetchSteamGames(steamId, 'IPlayerService/GetOwnedGames/v1/', options)
}

async function fetchFamilySharedGames(steamId, options = {}) {
  return fetchSteamGames(steamId, 'IPlayerService/GetOwnedGames/v1/', {
    ...options,
    includeFamilyLicenses: true,
  })
}

async function fetchRecentlyPlayedGames(steamId, options = {}) {
  return fetchSteamGames(steamId, 'IPlayerService/GetRecentlyPlayedGames/v1/', options)
}

async function fetchSteamAchievementDefinitions(appId, options = {}) {
  const apiKey = options.apiKey ?? process.env.STEAM_API_KEY
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? STEAM_API_TIMEOUT_MS

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    const error = new Error('Steam Web API key is not configured')
    error.code = 'STEAM_API_KEY_MISSING'
    throw error
  }
  if (!Number.isSafeInteger(appId) || appId <= 0) {
    const error = new Error('A valid Steam App ID is required')
    error.code = 'STEAM_APP_ID_INVALID'
    throw error
  }
  if (typeof fetchImpl !== 'function') {
    const error = new Error('Steam Web API client is unavailable')
    error.code = 'STEAM_API_REQUEST_FAILED'
    throw error
  }

  const url = new URL('https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/')
  url.searchParams.set('key', apiKey)
  url.searchParams.set('appid', String(appId))
  url.searchParams.set('l', 'english')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let response
    try {
      response = await fetchImpl(url, { method: 'GET', signal: controller.signal })
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error('Steam achievement definitions request timed out')
        timeoutError.code = 'STEAM_API_TIMEOUT'
        throw timeoutError
      }
      const requestError = new Error('Steam achievement definitions request failed')
      requestError.code = 'STEAM_API_REQUEST_FAILED'
      throw requestError
    }

    if (!response?.ok) {
      const status = Number(response?.status)
      const statusError = new Error(`Steam achievement definitions API returned HTTP ${status || 'unknown'}`)
      if (status === 429) statusError.code = 'STEAM_API_RATE_LIMITED'
      else if (status === 401 || status === 403) statusError.code = 'STEAM_API_UNAUTHORIZED'
      else if (status === 404 || status === 400) statusError.code = 'STEAM_API_UNAVAILABLE'
      else statusError.code = 'STEAM_API_REQUEST_FAILED'
      throw statusError
    }

    let body
    try {
      body = await response.json()
    } catch {
      const invalidError = new Error('Steam achievement definitions API returned invalid JSON')
      invalidError.code = 'STEAM_API_INVALID_RESPONSE'
      throw invalidError
    }

    if (!body || typeof body !== 'object' || !body.game || typeof body.game !== 'object') {
      const invalidError = new Error('Steam achievement definitions response is malformed')
      invalidError.code = 'STEAM_API_INVALID_RESPONSE'
      throw invalidError
    }

    const availableStats = body.game.availableGameStats

    // Steam legitimately omits availableGameStats entirely for games with no achievement definitions.
    // This is a valid schema response — treat it as a confirmed zero-achievement game.
    if (availableStats === undefined || availableStats === null) {
      return []
    }

    if (typeof availableStats !== 'object' || Array.isArray(availableStats)) {
      const invalidError = new Error('Steam achievement definitions response is malformed: availableGameStats is not an object')
      invalidError.code = 'STEAM_API_INVALID_RESPONSE'
      throw invalidError
    }

    if (!('achievements' in availableStats)) {
      return []
    }

    if (!Array.isArray(availableStats.achievements)) {
      const invalidError = new Error('Steam achievement definitions response is malformed: achievements is not an array')
      invalidError.code = 'STEAM_API_INVALID_RESPONSE'
      throw invalidError
    }

    const rawAchievements = availableStats.achievements
    if (rawAchievements.length === 0) {
      return []
    }

    const seen = new Set()
    const definitions = []
    for (const achievement of rawAchievements) {
      if (!achievement || typeof achievement !== 'object' || Array.isArray(achievement)) {
        const invalidError = new Error('Steam achievement definitions response contains invalid entry')
        invalidError.code = 'STEAM_API_INVALID_RESPONSE'
        throw invalidError
      }
      const apiName = typeof achievement.name === 'string' ? achievement.name.trim() : ''
      if (!apiName) {
        const invalidError = new Error('Steam achievement definitions response contains entry without valid api name')
        invalidError.code = 'STEAM_API_INVALID_RESPONSE'
        throw invalidError
      }
      if (seen.has(apiName)) continue
      seen.add(apiName)
      definitions.push({
        apiName,
        displayName: typeof achievement.displayName === 'string' && achievement.displayName.trim()
          ? achievement.displayName.trim()
          : apiName,
        description: typeof achievement.description === 'string' && achievement.description.trim()
          ? achievement.description.trim()
          : null,
        icon: typeof achievement.icon === 'string' && achievement.icon.trim()
          ? achievement.icon.trim()
          : null,
        iconGray: typeof achievement.icongray === 'string' && achievement.icongray.trim()
          ? achievement.icongray.trim()
          : null,
        hidden: typeof achievement.hidden === 'number'
          ? achievement.hidden === 1
          : typeof achievement.hidden === 'boolean'
            ? achievement.hidden
            : false,
      })
    }
    return definitions
  } finally {
    clearTimeout(timer)
  }
}

async function fetchPlayerAchievements(steamId, appId, options = {}) {
  const apiKey = options.apiKey ?? process.env.STEAM_API_KEY
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? STEAM_API_TIMEOUT_MS

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    const error = new Error('Steam Web API key is not configured')
    error.code = 'STEAM_API_KEY_MISSING'
    throw error
  }
  if (!isValidSteamId(steamId)) {
    const error = new Error('A valid SteamID is required')
    error.code = 'STEAM_ID_INVALID'
    throw error
  }
  if (!Number.isSafeInteger(appId) || appId <= 0) {
    const error = new Error('A valid Steam App ID is required')
    error.code = 'STEAM_APP_ID_INVALID'
    throw error
  }

  const url = new URL('https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/')
  url.searchParams.set('key', apiKey)
  url.searchParams.set('steamid', steamId)
  url.searchParams.set('appid', String(appId))
  url.searchParams.set('l', 'english')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let response
    try {
      response = await fetchImpl(url, { method: 'GET', signal: controller.signal })
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error('Steam player achievements request timed out')
        timeoutError.code = 'STEAM_API_TIMEOUT'
        throw timeoutError
      }
      const requestError = new Error('Steam player achievements request failed')
      requestError.code = 'STEAM_API_REQUEST_FAILED'
      throw requestError
    }

    if (!response?.ok) {
      const status = Number(response?.status)
      const statusError = new Error(`Steam player achievements API returned HTTP ${status || 'unknown'}`)
      if (status === 429) statusError.code = 'STEAM_API_RATE_LIMITED'
      else if (status === 401 || status === 403) statusError.code = 'STEAM_API_UNAUTHORIZED'
      else if (status === 404 || status === 400) statusError.code = 'STEAM_API_UNAVAILABLE'
      else statusError.code = 'STEAM_API_REQUEST_FAILED'
      throw statusError
    }

    let body
    try {
      body = await response.json()
    } catch {
      const invalidError = new Error('Steam player achievements API returned invalid JSON')
      invalidError.code = 'STEAM_API_INVALID_RESPONSE'
      throw invalidError
    }

    const playerStats = body?.playerstats
    if (!playerStats || typeof playerStats !== 'object') {
      const invalidError = new Error('Steam player achievements response is malformed')
      invalidError.code = 'STEAM_API_INVALID_RESPONSE'
      throw invalidError
    }

    if (playerStats.success === false) {
      const message = typeof playerStats.error === 'string' ? playerStats.error.toLowerCase() : ''
      const privacyError = new Error('Steam player achievement data is private or inaccessible')
      privacyError.code = message.includes('private') || message.includes('profile') || message.includes('inaccessible')
        ? 'STEAM_PROFILE_PRIVATE'
        : 'STEAM_PLAYER_DATA_UNAVAILABLE'
      throw privacyError
    }
    if (playerStats.success !== true || !Array.isArray(playerStats.achievements)) {
      const unavailableError = new Error('Steam player achievement data is unavailable')
      unavailableError.code = 'STEAM_PLAYER_DATA_UNAVAILABLE'
      throw unavailableError
    }

    const seen = new Set()
    return playerStats.achievements.flatMap((achievement) => {
      const apiName = typeof achievement?.apiname === 'string' ? achievement.apiname.trim() : ''
      if (!apiName || seen.has(apiName)) return []
      if (achievement.achieved !== 0 && achievement.achieved !== 1) return []
      seen.add(apiName)
      const achieved = achievement.achieved === 1
      const unlockSeconds = Number(achievement.unlocktime)
      const unlockedAt = achieved && Number.isSafeInteger(unlockSeconds)
        && unlockSeconds > 0
        && Number.isFinite(new Date(unlockSeconds * 1000).getTime())
        ? new Date(unlockSeconds * 1000).toISOString()
        : null
      return [{
        apiName,
        achieved,
        unlockTimestamp: achieved && unlockSeconds > 0 ? unlockSeconds : null,
        unlockedAt,
      }]
    })
  } finally {
    clearTimeout(timer)
  }
}

function mergeAchievementData(definitions, playerAchievements) {
  const playerByName = new Map(
    (Array.isArray(playerAchievements) ? playerAchievements : [])
      .filter((achievement) => achievement && typeof achievement.apiName === 'string')
      .map((achievement) => [achievement.apiName.trim(), achievement])
  )
  return (Array.isArray(definitions) ? definitions : []).map((definition) => {
    const player = playerByName.get(definition.apiName)
    const hasPlayerData = Boolean(player && typeof player.achieved === 'boolean')
    const achieved = hasPlayerData ? player.achieved : false
    return {
      ...definition,
      achieved,
      unlocked: achieved,
      unlockedAt: hasPlayerData ? (player.unlockedAt || null) : null,
      unlockTimestamp: hasPlayerData ? (player.unlockTimestamp || null) : null,
      status: hasPlayerData ? (achieved ? 'unlocked' : 'locked') : 'unknown',
      playerDataAvailable: hasPlayerData,
    }
  })
}
async function fetchSteamProfile(steamId, options = {}) {
  const apiKey = options.apiKey ?? process.env.STEAM_API_KEY
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? STEAM_API_TIMEOUT_MS

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    const error = new Error('Steam Web API key is not configured')
    error.code = 'STEAM_API_KEY_MISSING'
    throw error
  }
  if (!isValidSteamId(steamId)) {
    const error = new Error('A valid SteamID is required')
    error.code = 'STEAM_ID_INVALID'
    throw error
  }
  if (typeof fetchImpl !== 'function') {
    const error = new Error('Steam Web API client is unavailable')
    error.code = 'STEAM_API_REQUEST_FAILED'
    throw error
  }

  const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/')
  url.searchParams.set('key', apiKey)
  url.searchParams.set('steamids', steamId)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let response
    try {
      response = await fetchImpl(url, { method: 'GET', signal: controller.signal })
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error('Steam Web API request timed out')
        timeoutError.code = 'STEAM_API_TIMEOUT'
        throw timeoutError
      }
      const requestError = new Error('Steam Web API request failed')
      requestError.code = 'STEAM_API_REQUEST_FAILED'
      throw requestError
    }

    if (!response || !response.ok) {
      const statusError = new Error(`Steam Web API returned HTTP ${response?.status || 'unknown'}`)
      statusError.code = 'STEAM_API_REQUEST_FAILED'
      throw statusError
    }

    let body
    try {
      body = await response.json()
    } catch {
      const invalidError = new Error('Steam Web API returned invalid JSON')
      invalidError.code = 'STEAM_API_INVALID_RESPONSE'
      throw invalidError
    }

    const player = body?.response?.players?.find((candidate) => candidate?.steamid === steamId)
    const displayName = typeof player?.personaname === 'string' ? player.personaname.trim() : ''
    const avatarUrl = [player?.avatarfull, player?.avatarmedium, player?.avatar]
      .find(isValidSteamAvatarUrl)

    if (!displayName || !avatarUrl || typeof player?.steamid !== 'string') {
      const invalidError = new Error('Steam Web API returned an incomplete profile')
      invalidError.code = 'STEAM_API_INVALID_RESPONSE'
      throw invalidError
    }

    let profileUrl = `https://steamcommunity.com/profiles/${steamId}`
    if (typeof player.profileurl === 'string') {
      try {
        const parsedProfileUrl = new URL(player.profileurl)
        if (
          parsedProfileUrl.protocol === 'https:' &&
          parsedProfileUrl.hostname === 'steamcommunity.com' &&
          parsedProfileUrl.pathname.includes(steamId)
        ) {
          profileUrl = parsedProfileUrl.toString()
        }
      } catch {
        // Keep the constructed Steam profile URL when Steam returns a malformed value.
      }
    }

    return {
      steamId: player.steamid,
      displayName,
      avatarUrl,
      profileUrl,
    }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = {
  STEAM_API_TIMEOUT_MS,
  fetchSteamProfile,
  fetchOwnedGames,
  fetchFamilySharedGames,
  fetchRecentlyPlayedGames,
  fetchSteamAchievementDefinitions,
  fetchPlayerAchievements,
  mergeAchievementData,
  isValidSteamId,
  isValidSteamAvatarUrl,
}
