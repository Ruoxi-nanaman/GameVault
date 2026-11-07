const crypto = require('node:crypto')

const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login'
const STATE_COOKIE_NAME = 'gamevault_openid_state'
const STATE_TTL_MS = 10 * 60 * 1000
const pendingStates = new Map()

function validateHttpUrl(value, name) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid absolute URL`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL`)
  }
  return parsed
}

function getSteamOpenIdConfig() {
  const realm = process.env.STEAM_OPENID_REALM || process.env.CLIENT_ORIGIN
  const returnUrl = process.env.STEAM_OPENID_RETURN_URL
  const clientOrigin = process.env.CLIENT_ORIGIN
  if (!realm) throw new Error('STEAM_OPENID_REALM or CLIENT_ORIGIN must be configured')
  if (!returnUrl) throw new Error('STEAM_OPENID_RETURN_URL must be configured')
  if (!clientOrigin) throw new Error('CLIENT_ORIGIN must be configured')

  const realmUrl = validateHttpUrl(realm, 'STEAM_OPENID_REALM')
  const returnUrlObject = validateHttpUrl(returnUrl, 'STEAM_OPENID_RETURN_URL')
  const clientOriginUrl = validateHttpUrl(clientOrigin, 'CLIENT_ORIGIN')

  if (!/^\/api\/auth\/steam\/callback$/.test(returnUrlObject.pathname)) {
    throw new Error('STEAM_OPENID_RETURN_URL must end with /api/auth/steam/callback')
  }
  if (returnUrlObject.search || returnUrlObject.hash) {
    throw new Error('STEAM_OPENID_RETURN_URL must not contain query parameters or a fragment')
  }
  if (clientOriginUrl.search || clientOriginUrl.hash || clientOriginUrl.pathname !== '/') {
    throw new Error('CLIENT_ORIGIN must contain only the frontend origin, without a path, query, or fragment')
  }

  const realmPath = realmUrl.pathname === '/' ? '' : realmUrl.pathname.replace(/\/+$/, '')
  const realmCoversReturnUrl =
    realmUrl.protocol === returnUrlObject.protocol &&
    realmUrl.origin === returnUrlObject.origin &&
    (realmPath === '' || returnUrlObject.pathname.startsWith(`${realmPath}/`) || returnUrlObject.pathname === realmPath) &&
    !realmUrl.search &&
    !realmUrl.hash
  if (!realmCoversReturnUrl) {
    throw new Error('STEAM_OPENID_REALM must cover STEAM_OPENID_RETURN_URL origin and path')
  }
  return { realm, returnUrl }
}

function createPendingState() {
  const state = crypto.randomBytes(32).toString('base64url')
  pendingStates.set(state, { expiresAt: Date.now() + STATE_TTL_MS })
  return state
}

function consumePendingState(state) {
  if (!state) return false
  const pending = pendingStates.get(state)
  pendingStates.delete(state)
  if (!pending) return false
  return pending.expiresAt >= Date.now()
}

function clearExpiredStates() {
  const now = Date.now()
  for (const [state, pending] of pendingStates) {
    if (pending.expiresAt < now) pendingStates.delete(state)
  }
}

function buildSteamLoginUrl(realm, returnUrl, state) {
  const url = new URL(STEAM_OPENID_ENDPOINT)
  const returnUrlObject = new URL(returnUrl)
  if (!/^\/api\/auth\/steam\/callback$/.test(returnUrlObject.pathname)) {
    throw new Error('STEAM_OPENID_RETURN_URL must end with /api/auth/steam/callback')
  }
  returnUrlObject.searchParams.set('state', state)
  url.search = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnUrlObject.toString(),
    'openid.realm': realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  }).toString()
  return url.toString()
}

function readCookie(header, name) {
  const prefix = `${name}=`
  const part = (header || '').split(';').map((value) => value.trim()).find((value) => value.startsWith(prefix))
  if (!part) return null
  try {
    return decodeURIComponent(part.slice(prefix.length))
  } catch {
    return null
  }
}

function extractSteamId(params) {
  const claimedId = params['openid.claimed_id']
  const identity = params['openid.identity']
  if (
    params['openid.ns'] !== 'http://specs.openid.net/auth/2.0' ||
    params['openid.mode'] !== 'id_res' ||
    claimedId !== identity
  ) {
    return null
  }
  const match = /^https:\/\/steamcommunity\.com\/openid\/id\/([0-9]{17})$/.exec(claimedId || '')
  return match ? match[1] : null
}

function validateCallbackReturnUrl(actualReturnUrl, configuredReturnUrl, state) {
  const result = getCallbackReturnUrlValidationResult(actualReturnUrl, configuredReturnUrl, state)
  if (!result.valid) {
    console.warn(
      `Steam OpenID return_to validation failed: ${result.failure}`,
      {
        protocolMatch: result.protocolMatch,
        originMatch: result.originMatch,
        pathMatch: result.pathMatch,
        statePresent: result.statePresent,
        stateMatch: result.stateMatch,
        unexpectedQueryParameters: result.unexpectedQueryParameters,
        malformedUrl: result.malformedUrl,
      },
    )
  }
  return result.valid
}

function getCallbackReturnUrlValidationResult(actualReturnUrl, configuredReturnUrl, state) {
  const result = {
    valid: false,
    failure: 'malformed_url',
    protocolMatch: false,
    originMatch: false,
    pathMatch: false,
    statePresent: false,
    stateMatch: false,
    unexpectedQueryParameters: false,
    malformedUrl: true,
  }

  try {
    const actual = new URL(actualReturnUrl)
    const configured = new URL(configuredReturnUrl)

    result.malformedUrl = false
    if (!['http:', 'https:'].includes(actual.protocol) || !['http:', 'https:'].includes(configured.protocol)) {
      result.failure = 'protocol_mismatch'
      return result
    }

    result.protocolMatch = actual.protocol === configured.protocol
    if (!result.protocolMatch) {
      result.failure = 'protocol_mismatch'
      return result
    }

    result.originMatch =
      actual.origin === configured.origin &&
      !actual.username &&
      !actual.password &&
      !actual.hash
    if (!result.originMatch) {
      result.failure = 'origin_mismatch'
      return result
    }

    result.pathMatch = actual.pathname === configured.pathname &&
      /^\/api\/auth\/steam\/callback$/.test(actual.pathname)
    if (!result.pathMatch) {
      result.failure = 'path_mismatch'
      return result
    }

    const entries = Array.from(actual.searchParams.entries())
    result.unexpectedQueryParameters =
      entries.length !== 1 ||
      entries[0][0] !== 'state'
    if (result.unexpectedQueryParameters) {
      result.failure = entries.length === 0 ? 'missing_state' : 'unexpected_query_parameters'
      return result
    }

    result.statePresent = typeof entries[0][1] === 'string' && entries[0][1].length > 0
    if (!result.statePresent || typeof state !== 'string') {
      result.failure = 'missing_state'
      return result
    }

    const actualState = entries[0][1]
    result.stateMatch =
      actualState.length === state.length &&
      crypto.timingSafeEqual(Buffer.from(actualState), Buffer.from(state))
    if (!result.stateMatch) {
      result.failure = 'state_mismatch'
      return result
    }

    result.valid = true
    result.failure = null
    return result
  } catch {
    return result
  }
}

async function verifySteamCallback(params, expectedReturnUrl, fetchImpl = global.fetch) {
  if (!fetchImpl) throw new Error('This Node.js runtime does not support fetch')

  const missing = [
    'openid.ns',
    'openid.mode',
    'openid.return_to',
    'openid.signed',
    'openid.sig',
    'openid.assoc_handle',
  ].filter((key) => typeof params[key] !== 'string' || params[key].length === 0)
  if (missing.length > 0) {
    console.warn('Steam OpenID callback validation failed: missing required fields')
    return null
  }

  if (params['openid.mode'] !== 'id_res') {
    console.warn('Steam OpenID callback validation failed: unexpected mode')
    return null
  }

  if (params['openid.return_to'] !== expectedReturnUrl) {
    console.warn('Steam OpenID callback validation failed: return_to mismatch')
    return null
  }

  const steamId = extractSteamId(params)
  if (!steamId) {
    console.warn('Steam OpenID callback validation failed: claimed identity mismatch or invalid SteamID')
    return null
  }

  const verificationParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith('openid.') && typeof value === 'string') verificationParams.set(key, value)
  }
  verificationParams.set('openid.mode', 'check_authentication')

  let controller
  let timeout
  if (typeof AbortController !== 'undefined') {
    controller = new AbortController()
    timeout = setTimeout(() => controller.abort(), 8000)
  }

  try {
    const response = await fetchImpl(STEAM_OPENID_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: verificationParams.toString(),
      ...(controller ? { signal: controller.signal } : {}),
    })

    const status = response.status
    const text = typeof response.text === 'function' ? await response.text() : ''
    const values = new Map(
      text.split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf(':')
          return separator === -1 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)]
        }),
    )
    const isValid = values.get('is_valid') === 'true'

    console.log(`Steam OpenID verification response: status=${status}, is_valid=${isValid ? 'true' : 'false'}`)

    if (!response.ok || status !== 200) {
      console.warn('Steam OpenID verification failed: non-200 HTTP status')
      return null
    }
    if (values.get('ns') !== 'http://specs.openid.net/auth/2.0') {
      console.warn('Steam OpenID verification failed: unexpected namespace')
      return null
    }
    if (!isValid) {
      console.warn('Steam OpenID verification failed: Steam returned is_valid=false or an empty result')
      return null
    }
    return steamId
  } catch (error) {
    const description = error?.name === 'AbortError' ? 'request timed out' : 'network request failed'
    console.warn(`Steam OpenID verification failed: ${description}`)
    return null
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

module.exports = {
  STATE_COOKIE_NAME,
  STATE_TTL_MS,
  getSteamOpenIdConfig,
  createPendingState,
  consumePendingState,
  clearExpiredStates,
  buildSteamLoginUrl,
  readCookie,
  extractSteamId,
  validateCallbackReturnUrl,
  verifySteamCallback,
}
