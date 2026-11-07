const { COOKIE_NAME, createSession, getSession, destroySession, readCookie } = require('../config/session')
const { rotateSession } = require('../config/session')
const { getSupabaseServerClient } = require('../config/supabase')
const { fetchSteamProfile } = require('../services/steamWebApi')
const {
  STATE_COOKIE_NAME,
  STATE_TTL_MS,
  getSteamOpenIdConfig,
  createPendingState,
  consumePendingState,
  clearExpiredStates,
  buildSteamLoginUrl,
  readCookie: readNamedCookie,
  validateCallbackReturnUrl,
  verifySteamCallback,
} = require('../services/steamOpenId')

function isDevelopmentAuthenticationEnabled() {
  return process.env.NODE_ENV === 'development' && process.env.ENABLE_DEVELOPMENT_AUTH === 'true'
}

function developmentCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || process.env.SESSION_COOKIE_SECURE === 'true',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  }
}

function authenticationCookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || process.env.SESSION_COOKIE_SECURE === 'true',
    maxAge,
    path: '/',
  }
}

function getSessionState(req, res) {
  const session = getSession(readCookie(req.headers.cookie))
  res.json({ authenticated: Boolean(session), user: session?.user || null })
}

function createDevelopmentSession(req, res) {
  if (!isDevelopmentAuthenticationEnabled()) {
    return res.status(404).json({ error: 'Development authentication is disabled' })
  }

  const token = createSession({
    id: 'development-user',
    gameVaultUserId: null,
    steamId: null,
    displayName: 'Development User',
    authType: 'development',
  })
  res.cookie(COOKIE_NAME, token, developmentCookieOptions())
  res.json({
    authenticated: true,
    user: {
      id: 'development-user',
      gameVaultUserId: null,
      steamId: null,
      displayName: 'Development User',
      authType: 'development',
    },
  })
}

function logout(req, res) {
  destroySession(readCookie(req.headers.cookie))
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || process.env.SESSION_COOKIE_SECURE === 'true',
    path: '/',
  })
  res.json({ authenticated: false, user: null })
}

function steamLogin(req, res) {
  try {
    const { realm, returnUrl } = getSteamOpenIdConfig()
    clearExpiredStates()
    const state = createPendingState()
    res.cookie(STATE_COOKIE_NAME, state, authenticationCookieOptions(STATE_TTL_MS))
    res.redirect(buildSteamLoginUrl(realm, returnUrl, state))
  } catch (error) {
    res.status(500).json({ error: error.message || 'Steam OpenID configuration is invalid' })
  }
}

async function findOrCreateSteamUser(steamId, supabaseClient = getSupabaseServerClient()) {
  const supabase = supabaseClient
  const { data: existing, error: lookupError } = await supabase
    .from('users')
    .select('id, steam_id, username, display_name, avatar_url')
    .eq('steam_id', steamId)
    .maybeSingle()

  if (lookupError) throw new Error('Unable to look up the Steam identity')
  if (existing) return existing

  const { data: created, error: insertError } = await supabase
    .from('users')
    .insert({
      steam_id: steamId,
      username: `steam_${steamId.slice(-12)}`,
      display_name: `Steam ${steamId}`,
    })
    .select('id, steam_id, username, display_name, avatar_url')
    .single()

  if (!insertError) return created
  if (insertError.code === '23505') {
    const { data: raced, error: racedError } = await supabase
      .from('users')
      .select('id, steam_id, username, display_name, avatar_url')
      .eq('steam_id', steamId)
      .maybeSingle()
    if (!racedError && raced) return raced
  }
  throw new Error('Unable to create the GameVault user')
}

async function syncSteamProfile(req, res, options = {}) {
  const gameVaultUserId = req.user?.gameVaultUserId || req.user?.id
  const steamId = req.user?.steamId

  if (!steamId) {
    return res.status(400).json({ error: 'SteamID is missing from the authenticated session' })
  }
  if (!gameVaultUserId || gameVaultUserId === 'development-user') {
    return res.status(400).json({ error: 'A Steam-linked GameVault account is required' })
  }

  try {
    const supabase = options.supabaseClient || getSupabaseServerClient()
    const { data: user, error: lookupError } = await supabase
      .from('users')
      .select('id, steam_id, username, display_name, avatar_url')
      .eq('id', gameVaultUserId)
      .eq('steam_id', steamId)
      .maybeSingle()

    if (lookupError) {
      return res.status(500).json({ error: 'Unable to verify the authenticated user' })
    }
    if (!user) {
      return res.status(404).json({ error: 'Authenticated Steam user record was not found' })
    }

    let profile
    try {
      profile = await (options.fetchSteamProfile || fetchSteamProfile)(steamId, options.fetchOptions)
    } catch (error) {
      const status = error.code === 'STEAM_API_KEY_MISSING' ? 503
        : error.code === 'STEAM_API_INVALID_RESPONSE' ? 502
          : 502
      return res.status(status).json({ error: error.message })
    }

    const { data: updated, error: updateError } = await supabase
      .from('users')
      .update({
        display_name: profile.displayName,
        avatar_url: profile.avatarUrl,
      })
      .eq('id', gameVaultUserId)
      .eq('steam_id', steamId)
      .select('id, steam_id, username, display_name, avatar_url')
      .maybeSingle()

    if (updateError || !updated) {
      return res.status(500).json({ error: 'Unable to update the Steam profile' })
    }

    req.user.gameVaultUserId = updated.id
    req.user.steamId = updated.steam_id
    req.user.displayName = updated.display_name || profile.displayName
    req.user.avatarUrl = updated.avatar_url || profile.avatarUrl
    req.user.profileUrl = profile.profileUrl

    return res.json({
      steamId: updated.steam_id,
      gameVaultUserId: updated.id,
      displayName: updated.display_name,
      avatarUrl: updated.avatar_url,
      profileUrl: profile.profileUrl,
    })
  } catch (error) {
    return res.status(500).json({ error: 'Unable to synchronize the Steam profile' })
  }
}

function loginErrorRedirect(errorMessage) {
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5173'
  try {
    const url = new URL('/login', clientOrigin)
    url.searchParams.set('error', errorMessage)
    return url.toString()
  } catch {
    return '/login'
  }
}

async function steamCallback(req, res) {
  const returnToValue = req.query?.['openid.return_to']
  const rawUrl = req.originalUrl || req.url || ''
  const queryKeys = Object.keys(req.query || {})
  const queryParserSetting =
    typeof req.app?.get === 'function' ? req.app.get('query parser') : undefined
  console.log('Steam OpenID callback query diagnostics', {
    returnToOwnProperty: Object.prototype.hasOwnProperty.call(req.query || {}, 'openid.return_to'),
    returnToType: typeof returnToValue,
    returnToNonEmptyString: typeof returnToValue === 'string' && returnToValue.length > 0,
    openIdQueryKeys: queryKeys.filter((key) => key.startsWith('openid')),
    rawUrlContainsEncodedReturnToName: rawUrl.includes('openid.return_to') || rawUrl.includes('openid%2Ereturn_to') || rawUrl.includes('openid%2ereturn_to'),
    rawUrlContainsLiteralReturnToName: rawUrl.includes('openid.return_to'),
    customQueryParserConfigured:
      typeof queryParserSetting === 'string' &&
      !['simple', 'extended'].includes(queryParserSetting),
  })

  let config
  try {
    config = getSteamOpenIdConfig()
  } catch (error) {
    return res.redirect(loginErrorRedirect(error.message))
  }

  const state = req.query.state
  const cookieState = readNamedCookie(req.headers.cookie, STATE_COOKIE_NAME)
  res.clearCookie(STATE_COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' || process.env.SESSION_COOKIE_SECURE === 'true', path: '/' })

  if (
    typeof state !== 'string' ||
    typeof cookieState !== 'string' ||
    state.length !== cookieState.length ||
    !require('node:crypto').timingSafeEqual(Buffer.from(state), Buffer.from(cookieState)) ||
    !consumePendingState(state)
  ) {
    return res.redirect(loginErrorRedirect('Steam login state is invalid or expired'))
  }

  try {
    const callbackParams = { ...req.query }
    const actualReturnUrl = callbackParams['openid.return_to']

    if (!validateCallbackReturnUrl(actualReturnUrl, config.returnUrl, state)) {
      return res.redirect(loginErrorRedirect('Steam could not verify your identity'))
    }

    const steamId = await verifySteamCallback(callbackParams, actualReturnUrl)
    if (!steamId) {
      return res.redirect(loginErrorRedirect('Steam could not verify your identity'))
    }

    const gameVaultUser = await findOrCreateSteamUser(steamId)
    const oldCookie = readCookie(req.headers.cookie)
    const token = rotateSession(oldCookie, {
      id: gameVaultUser.id,
      gameVaultUserId: gameVaultUser.id,
      steamId,
      displayName: gameVaultUser.display_name || gameVaultUser.username,
      avatarUrl: gameVaultUser.avatar_url || null,
      authType: 'steam',
    })
    res.cookie(COOKIE_NAME, token, authenticationCookieOptions(24 * 60 * 60 * 1000))

    const clientOrigin = new URL(process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5173')
    const dashboardUrl = new URL('/dashboard', clientOrigin)
    return res.redirect(dashboardUrl.toString())
  } catch (error) {
    console.error('Steam authentication failed')
    return res.redirect(loginErrorRedirect('Steam authentication could not be completed'))
  }
}

module.exports = {
  getSessionState,
  createDevelopmentSession,
  logout,
  steamLogin,
  steamCallback,
  findOrCreateSteamUser,
  syncSteamProfile,
}
