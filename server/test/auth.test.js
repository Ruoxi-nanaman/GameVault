const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const app = require('../app')
const {
  extractSteamId,
  verifySteamCallback,
  createPendingState,
  consumePendingState,
  validateCallbackReturnUrl,
} = require('../services/steamOpenId')
const { findOrCreateSteamUser, syncSteamProfile } = require('../controllers/authController')
const {
  fetchSteamProfile,
  fetchOwnedGames,
  fetchFamilySharedGames,
  fetchRecentlyPlayedGames,
  isValidSteamId,
  fetchSteamAchievementDefinitions,
  fetchPlayerAchievements,
  mergeAchievementData,
} = require('../services/steamWebApi')
const {
  mergeSteamRecords,
  chooseCanonicalLifetime,
  chooseCanonicalLastPlayed,
  choosePrimarySourceLabel,
  buildCanonicalOwnershipRow,
  requireSupabaseQuery,
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
} = require('../controllers/steamGamesController')
const {
  getGameAchievements,
  buildAchievementResponse,
  syncGameAchievements,
  syncAllGameAchievements,
  acquireSyncLock,
  releaseSyncLock,
  clearAllSyncLocks,
  acquireBulkSyncLock,
  releaseBulkSyncLock,
  clearAllBulkSyncLocks,
} = require('../controllers/steamAchievementsController')
const {
  validUnlockTimestamp,
  synchronizeAchievementSchema,
  synchronizePlayerProgress,
  runWithConcurrencyLimit,
  executeGameAchievementSync,
} = require('../services/achievementSyncService')

async function withServer(run) {
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  try {
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

test('development authentication is disabled outside explicit development configuration', async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousEnableFlag = process.env.ENABLE_DEVELOPMENT_AUTH
  process.env.NODE_ENV = 'production'
  process.env.ENABLE_DEVELOPMENT_AUTH = 'true'
  process.env.SESSION_SECRET = 'test-session-secret'

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/dev/login`, { method: 'POST' })
      assert.equal(response.status, 404)
      assert.equal((await response.json()).error, 'Development authentication is disabled')
    })
  } finally {
    process.env.NODE_ENV = previousNodeEnv
    process.env.ENABLE_DEVELOPMENT_AUTH = previousEnableFlag
  }
})

test('development authentication works only with NODE_ENV and explicit flag enabled', async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousEnableFlag = process.env.ENABLE_DEVELOPMENT_AUTH
  process.env.NODE_ENV = 'development'
  process.env.ENABLE_DEVELOPMENT_AUTH = 'true'

  try {
    await withServer(async (baseUrl) => {
      const loginResponse = await fetch(`${baseUrl}/api/auth/dev/login`, { method: 'POST' })
      assert.equal(loginResponse.status, 200)
      const loginBody = await loginResponse.json()
      assert.equal(loginBody.authenticated, true)
      assert.equal(loginBody.user.authType, 'development')
      assert.equal(loginBody.user.steamId, null)
      assert.equal(loginBody.user.gameVaultUserId, null)

      const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0]
      assert.ok(cookie)
      assert.match(loginResponse.headers.get('set-cookie'), /HttpOnly/)

      const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
        headers: { cookie },
      })
      assert.equal(sessionResponse.status, 200)
      assert.equal((await sessionResponse.json()).authenticated, true)
    })
  } finally {
    process.env.NODE_ENV = previousNodeEnv
    process.env.ENABLE_DEVELOPMENT_AUTH = previousEnableFlag
  }
})

test('logout destroys the development session and clears the session cookie', async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousEnableFlag = process.env.ENABLE_DEVELOPMENT_AUTH
  process.env.NODE_ENV = 'development'
  process.env.ENABLE_DEVELOPMENT_AUTH = 'true'

  try {
    await withServer(async (baseUrl) => {
      const loginResponse = await fetch(`${baseUrl}/api/auth/dev/login`, { method: 'POST' })
      assert.equal(loginResponse.status, 200)
      const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0]
      assert.ok(cookie)

      const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { cookie },
      })
      assert.equal(logoutResponse.status, 200)
      assert.deepEqual(await logoutResponse.json(), { authenticated: false, user: null })
      assert.match(logoutResponse.headers.get('set-cookie') || '', /gamevault_session=/)

      const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
        headers: { cookie },
      })
      assert.equal(sessionResponse.status, 200)
      assert.deepEqual(await sessionResponse.json(), { authenticated: false, user: null })
    })
  } finally {
    process.env.NODE_ENV = previousNodeEnv
    process.env.ENABLE_DEVELOPMENT_AUTH = previousEnableFlag
  }
})

test('development authentication is denied when the explicit flag is disabled', async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousEnableFlag = process.env.ENABLE_DEVELOPMENT_AUTH
  process.env.NODE_ENV = 'development'
  process.env.ENABLE_DEVELOPMENT_AUTH = 'false'

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/dev/login`, { method: 'POST' })
      assert.equal(response.status, 404)
    })
  } finally {
    process.env.NODE_ENV = previousNodeEnv
    process.env.ENABLE_DEVELOPMENT_AUTH = previousEnableFlag
  }
})

test('Steam login initiation redirects with OpenID parameters and state cookie', async () => {
  process.env.STEAM_OPENID_REALM = 'http://127.0.0.1:3001'
  process.env.STEAM_OPENID_RETURN_URL = 'http://127.0.0.1:3001/api/auth/steam/callback'

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/steam`, { redirect: 'manual' })
    assert.equal(response.status, 302)
    const location = new URL(response.headers.get('location'))
    assert.equal(location.origin, 'https://steamcommunity.com')
    assert.equal(location.searchParams.get('openid.mode'), 'checkid_setup')
    const returnTo = new URL(location.searchParams.get('openid.return_to'))
    assert.equal(returnTo.origin, 'http://127.0.0.1:3001')
    assert.equal(returnTo.pathname, '/api/auth/steam/callback')
    assert.ok(returnTo.searchParams.get('state'))
    assert.notEqual(returnTo.pathname, '/api/auth/session')
    assert.match(response.headers.get('set-cookie') || '', /gamevault_openid_state=/)
    assert.match(response.headers.get('set-cookie') || '', /HttpOnly/)
  })
})

test('invalid or manipulated Steam callback identity is rejected before verification', async () => {
  const params = {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.claimed_id': 'https://steamcommunity.com/openid/id/not-a-steam-id',
    'openid.identity': 'https://steamcommunity.com/openid/id/not-a-steam-id',
    'openid.return_to': 'http://127.0.0.1:3001/api/auth/steam/callback?state=test',
    'openid.assoc_handle': 'assoc',
    'openid.signed': 'signed',
    'openid.sig': 'sig',
  }
  assert.equal(extractSteamId(params), null)
  assert.equal(await verifySteamCallback(params, params['openid.return_to'], async () => {
    throw new Error('verification should not be reached')
  }), null)
})

test('Steam verification accepts only a Steam is_valid:true response', async () => {
  const steamId = '76561198000000001'
  const returnUrl = 'http://127.0.0.1:3001/api/auth/steam/callback?state=test'
  const params = {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${steamId}`,
    'openid.identity': `https://steamcommunity.com/openid/id/${steamId}`,
    'openid.return_to': returnUrl,
    'openid.assoc_handle': 'assoc',
    'openid.signed': 'signed',
    'openid.sig': 'sig',
  }

  const verified = await verifySteamCallback(params, returnUrl, async () => ({
    ok: true,
    status: 200,
    text: async () => `ns:http://specs.openid.net/auth/2.0\nis_valid:true\n`,
  }))
  assert.equal(verified, steamId)

  const rejected = await verifySteamCallback(params, returnUrl, async () => ({
    ok: true,
    status: 200,
    text: async () => `ns:http://specs.openid.net/auth/2.0\nis_valid:false\n`,
  }))
  assert.equal(rejected, null)
})

test('GameVault recognizes an existing Steam user without creating a duplicate', async () => {
  const user = { id: '00000000-0000-4000-8000-000000000001', steam_id: '76561198000000001', username: 'existing' }
  const supabase = {
    from() {
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        async maybeSingle() {
          return { data: user, error: null }
        },
      }
    },
  }
  assert.deepEqual(await findOrCreateSteamUser(user.steam_id, supabase), user)
})

test('GameVault creates a new Steam user when no UUID mapping exists', async () => {
  const created = { id: '00000000-0000-4000-8000-000000000002', steam_id: '76561198000000002', username: 'steam_000000000002' }
  let lookupCount = 0
  const supabase = {
    from() {
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        async maybeSingle() {
          lookupCount += 1
          return lookupCount === 1 ? { data: null, error: null } : { data: created, error: null }
        },
        insert() {
          return this
        },
        async single() {
          return { data: created, error: null }
        },
      }
    },
  }
  assert.deepEqual(await findOrCreateSteamUser(created.steam_id, supabase), created)
})

test('callback state is one-time use and replayed state is rejected', () => {
  const state = createPendingState()
  assert.equal(consumePendingState(state), true)
  assert.equal(consumePendingState(state), false)
})

test('Steam callback with mismatched state cookie is rejected', async () => {
  process.env.STEAM_OPENID_REALM = 'http://127.0.0.1:3001'
  process.env.STEAM_OPENID_RETURN_URL = 'http://127.0.0.1:3001/api/auth/steam/callback'
  process.env.CLIENT_ORIGIN = 'http://127.0.0.1:5173'

  await withServer(async (baseUrl) => {
    const initiation = await fetch(`${baseUrl}/api/auth/steam`, { redirect: 'manual' })
    const stateCookie = initiation.headers.get('set-cookie')?.split(';')[0]
    const callback = await fetch(
      `${baseUrl}/api/auth/steam/callback?state=manipulated-state&openid.mode=id_res`,
      { redirect: 'manual', headers: stateCookie ? { cookie: stateCookie } : {} },
    )
    assert.equal(callback.status, 302)
    const location = new URL(callback.headers.get('location'))
    assert.equal(location.pathname, '/login')
    assert.match(location.searchParams.get('error') || '', /state/i)
  })
})

test('local development allows separate frontend origin and callback realm origin', () => {
  process.env.NODE_ENV = 'development'
  process.env.STEAM_OPENID_REALM = 'http://127.0.0.1:3001'
  process.env.STEAM_OPENID_RETURN_URL = 'http://127.0.0.1:3001/api/auth/steam/callback'
  process.env.CLIENT_ORIGIN = 'http://127.0.0.1:5173'

  const { getSteamOpenIdConfig, buildSteamLoginUrl } = require('../services/steamOpenId')
  const config = getSteamOpenIdConfig()
  const state = 'consistent-local-state'
  const loginUrl = new URL(buildSteamLoginUrl(config.realm, config.returnUrl, state))
  const returnTo = new URL(loginUrl.searchParams.get('openid.return_to'))

  assert.equal(loginUrl.hostname, 'steamcommunity.com')
  assert.equal(returnTo.hostname, '127.0.0.1')
  assert.equal(returnTo.port, '3001')
  assert.equal(returnTo.pathname, '/api/auth/steam/callback')
  assert.equal(returnTo.searchParams.get('state'), state)
})

test('Steam configuration rejects a realm that does not cover the callback URL', () => {
  process.env.NODE_ENV = 'development'
  process.env.CLIENT_ORIGIN = 'http://127.0.0.1:5173'
  process.env.STEAM_OPENID_REALM = 'http://127.0.0.1:5173'
  process.env.STEAM_OPENID_RETURN_URL = 'http://127.0.0.1:3001/api/auth/steam/callback'

  const { getSteamOpenIdConfig } = require('../services/steamOpenId')
  assert.throws(
    () => getSteamOpenIdConfig(),
    /must cover STEAM_OPENID_RETURN_URL/,
  )
})

test('Steam configuration rejects mismatched callback hosts and arbitrary frontend origins', () => {
  process.env.NODE_ENV = 'production'

  const { getSteamOpenIdConfig } = require('../services/steamOpenId')

  process.env.CLIENT_ORIGIN = 'https://frontend.example.com'
  process.env.STEAM_OPENID_REALM = 'https://frontend.example.com'
  process.env.STEAM_OPENID_RETURN_URL = 'https://backend.example.com/api/auth/steam/callback'
  assert.throws(
    () => getSteamOpenIdConfig(),
    /must cover STEAM_OPENID_RETURN_URL/,
  )

  process.env.CLIENT_ORIGIN = 'https://frontend.example.com/not-an-origin'
  process.env.STEAM_OPENID_REALM = 'https://backend.example.com'
  process.env.STEAM_OPENID_RETURN_URL = 'https://backend.example.com/api/auth/steam/callback'
  assert.throws(
    () => getSteamOpenIdConfig(),
    /CLIENT_ORIGIN must contain only the frontend origin/,
  )
})

test('malformed Steam verification response is rejected', async () => {
  const returnUrl = 'http://127.0.0.1:3001/api/auth/steam/callback?state=test'
  const params = {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198000000003',
    'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000003',
    'openid.return_to': returnUrl,
    'openid.assoc_handle': 'assoc',
    'openid.signed': 'signed',
    'openid.sig': 'sig',
  }
  const result = await verifySteamCallback(params, returnUrl, async () => ({
    ok: true,
    status: 200,
    text: async () => 'unexpected-response-body',
  }))
  assert.equal(result, null)
})

test('missing OpenID parameters are rejected before verification', async () => {
  let called = false
  const result = await verifySteamCallback({}, 'http://127.0.0.1:3001/api/auth/steam/callback?state=test', async () => {
    called = true
    return { ok: true, status: 200, text: async () => 'is_valid:true' }
  })
  assert.equal(result, null)
  assert.equal(called, false)
})

test('claimed identity mismatch is rejected before network verification', async () => {
  const returnUrl = 'http://127.0.0.1:3001/api/auth/steam/callback?state=test'
  const params = {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198000000004',
    'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000005',
    'openid.return_to': returnUrl,
    'openid.assoc_handle': 'assoc',
    'openid.signed': 'signed',
    'openid.sig': 'sig',
  }
  let called = false
  const result = await verifySteamCallback(params, returnUrl, async () => {
    called = true
    return { ok: true, status: 200, text: async () => 'is_valid:true' }
  })
  assert.equal(result, null)
  assert.equal(called, false)
})

test('Steam verification network failure is handled safely', async () => {
  const returnUrl = 'http://127.0.0.1:3001/api/auth/steam/callback?state=test'
  const params = {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198000000006',
    'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000006',
    'openid.return_to': returnUrl,
    'openid.assoc_handle': 'assoc',
    'openid.signed': 'signed',
    'openid.sig': 'sig',
  }
  const result = await verifySteamCallback(params, returnUrl, async () => {
    throw new Error('network unavailable')
  })
  assert.equal(result, null)
})

test('Steam verification timeout is handled safely', async () => {
  const returnUrl = 'http://127.0.0.1:3001/api/auth/steam/callback?state=test'
  const params = {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198000000007',
    'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000007',
    'openid.return_to': returnUrl,
    'openid.assoc_handle': 'assoc',
    'openid.signed': 'signed',
    'openid.sig': 'sig',
  }
  const result = await verifySteamCallback(params, returnUrl, async () => {
    const error = new Error('aborted')
    error.name = 'AbortError'
    throw error
  })
  assert.equal(result, null)
})

test('callback return_to must match configured origin, path, and state', () => {
  const configured = 'http://127.0.0.1:3001/api/auth/steam/callback'
  const state = 'valid-local-state'
  assert.equal(
    validateCallbackReturnUrl(`${configured}?state=${state}`, configured, state),
    true,
  )
  assert.equal(
    validateCallbackReturnUrl(`${configured}?state=wrong-state`, configured, state),
    false,
  )
  assert.equal(
    validateCallbackReturnUrl('http://evil.example/api/auth/steam/callback?state=' + state, configured, state),
    false,
  )
})

test('callback return_to rejects mismatched protocols and callback paths', () => {
  const configured = 'http://127.0.0.1:3001/api/auth/steam/callback'
  const state = 'valid-local-state'

  assert.equal(
    validateCallbackReturnUrl(`https://127.0.0.1:3001/api/auth/steam/callback?state=${state}`, configured, state),
    false,
  )
  assert.equal(
    validateCallbackReturnUrl(`http://127.0.0.1:3001/api/auth/session?state=${state}`, configured, state),
    false,
  )
})

test('callback return_to rejects missing, extra, or malformed state parameters', () => {
  const configured = 'http://127.0.0.1:3001/api/auth/steam/callback'
  const state = 'valid-local-state'

  assert.equal(
    validateCallbackReturnUrl(configured, configured, state),
    false,
  )
  assert.equal(
    validateCallbackReturnUrl(`${configured}?next=dashboard&state=${state}`, configured, state),
    false,
  )
  assert.equal(
    validateCallbackReturnUrl(`${configured}?state=${state}&unexpected=true`, configured, state),
    false,
  )
  assert.equal(
    validateCallbackReturnUrl('not a URL', configured, state),
    false,
  )
})

test('Steam Web API retrieves a valid player summary', async () => {
  const steamId = '76561198000000001'
  const profile = await fetchSteamProfile(steamId, {
    apiKey: 'test-server-key',
    fetchImpl: async (url) => {
      assert.equal(url.hostname, 'api.steampowered.com')
      assert.equal(url.searchParams.get('key'), 'test-server-key')
      assert.equal(url.searchParams.get('steamids'), steamId)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            players: [{
              steamid: steamId,
              personaname: 'Actual Steam Name',
              avatarfull: 'https://avatars.steamstatic.com/test_full.jpg',
              profileurl: 'https://steamcommunity.com/profiles/' + steamId,
            }],
          },
        }),
      }
    },
  })

  assert.equal(profile.steamId, steamId)
  assert.equal(profile.displayName, 'Actual Steam Name')
  assert.equal(profile.avatarUrl, 'https://avatars.steamstatic.com/test_full.jpg')
  assert.equal(isValidSteamId(steamId), true)
})

test('Steam Web API rejects missing keys, request failures, and invalid responses', async () => {
  await assert.rejects(
    () => fetchSteamProfile('76561198000000001', { apiKey: '', fetchImpl: async () => ({}) }),
    (error) => error.code === 'STEAM_API_KEY_MISSING',
  )

  await assert.rejects(
    () => fetchSteamProfile('76561198000000001', {
      apiKey: 'test-server-key',
      fetchImpl: async () => { throw new Error('network failure') },
    }),
    (error) => error.code === 'STEAM_API_REQUEST_FAILED',
  )

  await assert.rejects(
    () => fetchSteamProfile('76561198000000001', {
      apiKey: 'test-server-key',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ response: { players: [] } }),
      }),
    }),
    (error) => error.code === 'STEAM_API_INVALID_RESPONSE',
  )
})

test('Steam profile endpoint requires authentication', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/steam/profile`)
    assert.equal(response.status, 401)
    assert.equal((await response.json()).error, 'Authentication required')
  })
})

test('Steam profile synchronization updates only the authenticated GameVault user', async () => {
  const gameVaultUserId = '00000000-0000-4000-8000-000000000101'
  const steamId = '76561198000000001'
  const lookupFilters = []
  const updateFilters = []
  let updatePayload = null

  const supabase = {
    from(table) {
      assert.equal(table, 'users')
      return {
        update(payload) {
          updatePayload = payload
          this.isUpdate = true
          return this
        },
        select() {
          return this
        },
        eq(field, value) {
          if (this.isUpdate) updateFilters.push([field, value])
          else lookupFilters.push([field, value])
          return this
        },
        maybeSingle() {
          if (this.isUpdate) {
            return Promise.resolve({
              data: {
                id: gameVaultUserId,
                steam_id: steamId,
                username: `steam_${steamId.slice(-12)}`,
                display_name: 'Actual Steam Name',
                avatar_url: 'https://avatars.steamstatic.com/test_full.jpg',
              },
              error: null,
            })
          }
          return Promise.resolve({
            data: {
              id: gameVaultUserId,
              steam_id: steamId,
              username: `steam_${steamId.slice(-12)}`,
              display_name: null,
              avatar_url: null,
            },
            error: null,
          })
        },
      }
    },
  }

  const req = {
    user: { gameVaultUserId, steamId, displayName: 'Old Name', authType: 'steam' },
  }
  let statusCode = 200
  let body = null
  const res = {
    status(code) {
      statusCode = code
      return this
    },
    json(value) {
      body = value
      return this
    },
  }

  await syncSteamProfile(req, res, {
    supabaseClient: supabase,
    fetchSteamProfile: async (requestedSteamId) => {
      assert.equal(requestedSteamId, steamId)
      return {
        steamId,
        displayName: 'Actual Steam Name',
        avatarUrl: 'https://avatars.steamstatic.com/test_full.jpg',
        profileUrl: `https://steamcommunity.com/profiles/${steamId}`,
      }
    },
  })

  assert.equal(statusCode, 200)
  assert.equal(body.displayName, 'Actual Steam Name')
  assert.deepEqual(lookupFilters, [['id', gameVaultUserId], ['steam_id', steamId]])
  assert.deepEqual(updateFilters, [['id', gameVaultUserId], ['steam_id', steamId]])
  assert.deepEqual(updatePayload, {
    display_name: 'Actual Steam Name',
    avatar_url: 'https://avatars.steamstatic.com/test_full.jpg',
  })
})

test('Steam profile synchronization refuses a mismatched user record', async () => {
  const supabase = {
    from() {
      return {
        select() { return this },
        eq() { return this },
        maybeSingle() { return Promise.resolve({ data: null, error: null }) },
      }
    },
  }
  const req = {
    user: {
      gameVaultUserId: '00000000-0000-4000-8000-000000000102',
      steamId: '76561198000000002',
      authType: 'steam',
    },
  }
  let statusCode = 200
  let body = null
  const res = {
    status(code) { statusCode = code; return this },
    json(value) { body = value; return this },
  }

  await syncSteamProfile(req, res, {
    supabaseClient: supabase,
    fetchSteamProfile: async () => {
      throw new Error('Steam API should not be called for a mismatched user record')
    },
  })

  assert.equal(statusCode, 404)
  assert.equal(body.error, 'Authenticated Steam user record was not found')
})

test('Steam owned-games retrieval normalizes, deduplicates, and maps session game data', async () => {
  const steamId = '76561198000000001'
  const games = await fetchOwnedGames(steamId, {
    apiKey: 'test-server-key',
    fetchImpl: async (url, options) => {
      assert.equal(url.hostname, 'api.steampowered.com')
      assert.equal(url.pathname, '/IPlayerService/GetOwnedGames/v1/')
      assert.equal(url.searchParams.get('steamid'), steamId)
      assert.equal(url.searchParams.get('include_appinfo'), 'true')
      assert.equal(url.searchParams.get('include_played_free_games'), 'true')
      assert.equal(options.method, 'GET')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            game_count: 2,
            games: [
              { appid: 620, name: 'Portal 2', playtime_forever: 125, playtime_2weeks: 30, rtime_last_played: 1700000000 },
              { appid: 620, name: 'Portal 2 duplicate', playtime_forever: 999 },
            ],
          },
        }),
      }
    },
  })

  assert.equal(games.length, 1)
  assert.equal(games[0].steamAppId, 620)
  assert.equal(games[0].title, 'Portal 2')
  assert.equal(games[0].playtimeMinutes, 125)
  assert.equal(games[0].recentPlaytimeMinutes, 30)
  assert.match(games[0].coverImage, /steam\/apps\/620\/header\.jpg/)
  assert.ok(games[0].lastPlayedAt)
})

test('Steam owned-games retrieval rejects missing API keys and handles API failures', async () => {
  await assert.rejects(
    () => fetchOwnedGames('76561198000000001', { apiKey: '', fetchImpl: async () => ({}) }),
    (error) => error.code === 'STEAM_API_KEY_MISSING',
  )

  await assert.rejects(
    () => fetchOwnedGames('76561198000000001', {
      apiKey: 'test-server-key',
      fetchImpl: async () => {
        throw new Error('network failure')
      },
    }),
    (error) => error.code === 'STEAM_API_REQUEST_FAILED',
  )

  await assert.rejects(
    () => fetchOwnedGames('76561198000000001', {
      apiKey: 'test-server-key',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    }),
    (error) => error.code === 'STEAM_API_INVALID_RESPONSE',
  )
})

test('Steam owned-games retrieval treats an empty response as an empty library', async () => {
  const games = await fetchOwnedGames('76561198000000001', {
    apiKey: 'test-server-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ response: { game_count: 0 } }),
    }),
  })
  assert.deepEqual(games, [])
})

test('Steam library endpoints require authentication', async () => {
  await withServer(async (baseUrl) => {
    const libraryResponse = await fetch(`${baseUrl}/api/steam/games`)
    assert.equal(libraryResponse.status, 401)

    const syncResponse = await fetch(`${baseUrl}/api/steam/sync/games`, { method: 'POST' })
    assert.equal(syncResponse.status, 401)
  })
})

test('family-enabled Steam retrieval preserves the explicit family_shared evidence flag', async () => {
  const games = await fetchFamilySharedGames('76561198000000001', {
    apiKey: 'test-server-key',
    fetchImpl: async (url) => {
      assert.equal(url.searchParams.get('include_family_licenses'), 'true')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            games: [
              { appid: 620, name: 'Portal 2', family_shared: true, playtime_forever: 125 },
              { appid: 730, name: 'Counter-Strike 2', family_shared: false, playtime_forever: 300 },
            ],
          },
        }),
      }
    },
  })

  assert.equal(games.length, 2)
  assert.equal(games.find((game) => game.steamAppId === 620).familyShared, true)
  assert.equal(games.find((game) => game.steamAppId === 730).familyShared, false)
})

test('recently played Steam retrieval normalizes two-week and lifetime playtime separately', async () => {
  const games = await fetchRecentlyPlayedGames('76561198000000001', {
    apiKey: 'test-server-key',
    fetchImpl: async (url) => {
      assert.equal(url.pathname, '/IPlayerService/GetRecentlyPlayedGames/v1/')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            total_count: 1,
            games: [
              { appid: 570, name: 'Dota 2', playtime_forever: 53174, playtime_2weeks: 1423 },
            ],
          },
        }),
      }
    },
  })

  assert.equal(games.length, 1)
  assert.equal(games[0].playtimeMinutes, 53174)
  assert.equal(games[0].recentPlaytimeMinutes, 1423)
})

test('three-source merge creates one App ID and preserves independent source records', () => {
  const owned = [{ steamAppId: 620, title: 'Portal 2', playtimeMinutes: 125, coverImage: 'owned-cover' }]
  const family = [{ steamAppId: 620, title: 'Portal 2', familyShared: true, playtimeMinutes: 120, coverImage: 'family-cover' }]
  const recent = [{ steamAppId: 620, title: 'Portal 2', playtimeMinutes: 130, recentPlaytimeMinutes: 30, coverImage: 'recent-cover' }]
  const merged = mergeSteamRecords(owned, family, recent)

  assert.equal(merged.size, 1)
  assert.equal(merged.get(620).owned.playtimeMinutes, 125)
  assert.equal(merged.get(620).family.familyShared, true)
  assert.equal(merged.get(620).recent.recentPlaytimeMinutes, 30)
  assert.equal(chooseCanonicalLifetime(merged.get(620)), 125)
})

test('canonical lifetime playtime uses owned, family, then recent precedence without summing', () => {
  const ownedAndFamily = { owned: { playtimeMinutes: 125 }, family: { playtimeMinutes: 999 }, recent: { playtimeMinutes: 130 } }
  assert.equal(chooseCanonicalLifetime(ownedAndFamily, null), 125)
  assert.equal(chooseCanonicalLifetime({ family: { playtimeMinutes: 900 }, recent: { playtimeMinutes: 130 } }, null), 900)
  assert.equal(chooseCanonicalLifetime({ recent: { playtimeMinutes: 130 } }, null), 130)
  assert.equal(chooseCanonicalLifetime({}, { playtime_minutes: 44 }), 44)
})

test('last-played timestamp is selected from Steam data and never fabricated', () => {
  assert.equal(chooseCanonicalLastPlayed(
    { owned: { lastPlayedAt: '2026-01-01T00:00:00.000Z' }, recent: { lastPlayedAt: null } },
    { recentSuccessful: true, existingLastPlayedAt: '2025-01-01T00:00:00.000Z' }
  ), null)
  assert.equal(chooseCanonicalLastPlayed(
    { owned: { lastPlayedAt: null }, family: { lastPlayedAt: null }, recent: { lastPlayedAt: null } },
    { recentSuccessful: true, existingLastPlayedAt: null }
  ), null)
})

test('unverified and stale mappings never produce confirmed primary source labels', () => {
  assert.equal(choosePrimarySourceLabel({
    owned: { freshness_status: 'unverified' },
    family_shared: { freshness_status: 'stale' },
  }), 'ownership_unconfirmed')
  assert.equal(choosePrimarySourceLabel({
    owned: { freshness_status: 'stale' },
    recently_played: { freshness_status: 'unverified' },
  }), 'ownership_unconfirmed')
})

test('confirmed primary source precedence is owned, family shared, then recently played', () => {
  assert.equal(choosePrimarySourceLabel({
    owned: { freshness_status: 'confirmed' },
    family_shared: { freshness_status: 'confirmed' },
    recently_played: { freshness_status: 'confirmed' },
  }), 'owned')
  assert.equal(choosePrimarySourceLabel({
    owned: { freshness_status: 'stale' },
    family_shared: { freshness_status: 'confirmed' },
  }), 'family_shared')
  assert.equal(choosePrimarySourceLabel({
    recently_played: { freshness_status: 'confirmed' },
  }), 'recently_played_unknown')
})

test('last-played timestamp stores valid recent data and clears invalid recent records', () => {
  assert.equal(chooseCanonicalLastPlayed(
    { recent: { lastPlayedAt: '2026-02-02T00:00:00.000Z' } },
    { recentSuccessful: true, existingLastPlayedAt: '2026-01-01T00:00:00.000Z' }
  ), '2026-02-02T00:00:00.000Z')
  assert.equal(chooseCanonicalLastPlayed(
    { recent: { lastPlayedAt: null } },
    { recentSuccessful: true, existingLastPlayedAt: '2026-01-01T00:00:00.000Z' }
  ), null)
})

test('successful recent snapshot without an App ID preserves existing timestamp', () => {
  assert.equal(chooseCanonicalLastPlayed(
    { owned: { lastPlayedAt: null } },
    { recentSuccessful: true, existingLastPlayedAt: '2026-01-01T00:00:00.000Z' }
  ), '2026-01-01T00:00:00.000Z')
})

test('failed recent-play request preserves existing timestamp', () => {
  assert.equal(chooseCanonicalLastPlayed(
    {
      owned: { lastPlayedAt: '2026-02-01T00:00:00.000Z' },
      family: { lastPlayedAt: '2026-03-01T00:00:00.000Z' },
      recent: { lastPlayedAt: '2026-04-01T00:00:00.000Z' },
    },
    { recentSuccessful: false, existingLastPlayedAt: '2026-01-01T00:00:00.000Z' }
  ), '2026-01-01T00:00:00.000Z')
})

test('stale-mapping update failures are detected and returned as source evidence failures', async () => {
  const supabase = {
    from(table) {
      if (table !== 'user_game_sources') throw new Error('unexpected table')
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return Promise.resolve({
                    data: [{ game_id: 'game-1', source_type: 'owned', freshness_status: 'confirmed', games: { steam_app_id: 620 } }],
                  })
                },
              }
            },
          }
        },
        update() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    eq() {
                      return Promise.resolve({ error: { message: 'update failed' } })
                    },
                  }
                },
              }
            },
          }
        },
      }
    },
  }

  await assert.rejects(
    updateSourceMappings({
      supabase,
      userId: 'user-1',
      runId: 'run-1',
      syncedAt: '2026-03-01T00:00:00.000Z',
      ownedRecords: [],
      familyRecords: [],
      recentRecords: [],
      sourceResults: { owned: { status: 'success_empty' } },
      gameIdByAppId: new Map(),
      existingMappingsByKey: new Map(),
    }),
    (error) => error.code === 'SOURCE_FRESHNESS_UPDATE_FAILED' && error.sourceType === 'owned'
  )
})

test('parent run completion failures are detected', async () => {
  const supabase = {
    from() {
      return {
        update() {
          return {
            eq() {
              return Promise.resolve({ error: { message: 'completion update failed' } })
            },
          }
        },
      }
    },
  }

  await assert.rejects(
    finishSteamSyncRun(supabase, 'run-1', 'success', '2026-03-01T00:00:00.000Z'),
    (error) => error.code === 'SYNC_RUN_COMPLETION_FAILED'
  )
})

test('ownership and source-mapping query failures prevent incomplete library data from being used', () => {
  assert.throws(
    () => requireSupabaseQuery({ data: null, error: { message: 'ownership read failed' } }, 'ownership query failed'),
    /ownership query failed/
  )
  assert.throws(
    () => requireSupabaseQuery({ data: null, error: { message: 'mapping read failed' } }, 'mapping query failed'),
    /mapping query failed/
  )
  assert.deepEqual(requireSupabaseQuery({ data: [], error: null }, 'unused'), [])
})

test('canonical ownership writes omit manual status and preserve canonical playtime fields', () => {
  const row = buildCanonicalOwnershipRow({
    userId: 'user-1',
    gameId: 'game-1',
    playtimeMinutes: 53174,
    lastPlayedAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T01:00:00.000Z',
  })

  assert.equal(row.user_id, 'user-1')
  assert.equal(row.game_id, 'game-1')
  assert.equal(row.playtime_minutes, 53174)
  assert.equal(row.last_played_at, '2026-03-01T00:00:00.000Z')
  assert.equal(Object.hasOwn(row, 'status'), false)
  assert.equal(Object.hasOwn(row, 'rating'), false)
  assert.equal(Object.hasOwn(row, 'review'), false)
})

test('synchronization concurrency lock is user-scoped and released reliably', () => {
  assert.equal(tryAcquireSynchronizationLock('user-a'), true)
  assert.equal(hasSynchronizationLock('user-a'), true)
  assert.equal(tryAcquireSynchronizationLock('user-a'), false)
  assert.equal(tryAcquireSynchronizationLock('user-b'), true)
  assert.equal(tryAcquireSynchronizationLock('user-b'), false)

  releaseSynchronizationLock('user-a')
  assert.equal(hasSynchronizationLock('user-a'), false)
  assert.equal(tryAcquireSynchronizationLock('user-a'), true)

  releaseSynchronizationLock('user-a')
  releaseSynchronizationLock('user-b')
  assert.equal(hasSynchronizationLock('user-a'), false)
  assert.equal(hasSynchronizationLock('user-b'), false)
})

test('backend synchronization cooldown rejects the same user for 30 seconds', () => {
  const now = 1_800_000_000_000
  clearSynchronizationCooldown('user-a')
  activateSynchronizationCooldown('user-a', now)

  assert.equal(
    getSynchronizationCooldownRemaining('user-a', now + 1_000),
    SYNCHRONIZATION_COOLDOWN_MS - 1_000
  )
  assert.equal(
    getSynchronizationCooldownRemaining('user-a', now + SYNCHRONIZATION_COOLDOWN_MS - 1),
    1
  )
  assert.equal(
    getSynchronizationCooldownRemaining('user-a', now + SYNCHRONIZATION_COOLDOWN_MS),
    0
  )
  clearSynchronizationCooldown('user-a')
})

test('backend synchronization cooldowns are user-scoped and independent', () => {
  const now = 1_800_000_000_000
  clearSynchronizationCooldown('user-a')
  clearSynchronizationCooldown('user-b')

  activateSynchronizationCooldown('user-a', now)
  assert.ok(getSynchronizationCooldownRemaining('user-a', now + 1_000) > 0)
  assert.equal(getSynchronizationCooldownRemaining('user-b', now + 1_000), 0)

  clearSynchronizationCooldown('user-a')
  clearSynchronizationCooldown('user-b')
})

test('backend synchronization requests after cooldown expiration are allowed', () => {
  const now = 1_800_000_000_000
  clearSynchronizationCooldown('user-a')
  activateSynchronizationCooldown('user-a', now)
  assert.equal(getSynchronizationCooldownRemaining('user-a', now + SYNCHRONIZATION_COOLDOWN_MS), 0)
  clearSynchronizationCooldown('user-a')
})

test('authentication session code contains no automatic Steam synchronization trigger', () => {
  const authContext = fs.readFileSync(
    path.resolve(__dirname, '../../client/src/contexts/AuthContext.jsx'),
    'utf8'
  )
  assert.doesNotMatch(authContext, /syncSteamGames/)
  assert.doesNotMatch(authContext, /synchronizeSteamLibrary/)
  assert.doesNotMatch(authContext, /await\s+syncSteamGames/)
})

test('Library sync UI retains an explicit loading guard and one sync action', () => {
  const library = fs.readFileSync(
    path.resolve(__dirname, '../../client/src/pages/Library.jsx'),
    'utf8'
  )
  assert.match(library, /useRef/)
  assert.match(library, /syncSubmissionGuard/)
  assert.match(library, /syncSubmissionGuard\.current\s+=\s+true/)
  assert.match(library, /syncSubmissionGuard\.current\s+=\s+false/)
  assert.match(library, /if \(syncSubmissionGuard\.current \|\| isSyncing\) return/)
  assert.match(library, /Sync library/)
  assert.match(library, /await syncSteamGames\(\)/)
})

test('Library submission guard is set before the sync await and released in finally', () => {
  const library = fs.readFileSync(
    path.resolve(__dirname, '../../client/src/pages/Library.jsx'),
    'utf8'
  )
  const setGuard = library.indexOf('syncSubmissionGuard.current = true')
  const syncCall = library.indexOf('await syncSteamGames()')
  const releaseGuard = library.indexOf('syncSubmissionGuard.current = false')
  assert.ok(setGuard >= 0)
  assert.ok(syncCall > setGuard)
  assert.ok(releaseGuard > syncCall)
})

test('applied Stage 3C migration uses original comment and README documents production status', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20261107000001_stage3c_unified_steam_library.sql'),
    'utf8'
  )
  assert.match(migration, /-- This migration is additive and has not been applied to Supabase\./)
  assert.doesNotMatch(migration, /has been applied to the linked production/)

  const readme = fs.readFileSync(path.resolve(__dirname, '../../README.md'), 'utf8')
  assert.match(readme, /20261107000001_stage3c_unified_steam_library\.sql/)
  assert.match(readme, /has been applied to the production Supabase project/)
})

test('rollback failures are detected and surfaced', async () => {
  const supabase = {
    from(table) {
      assert.equal(table, 'user_game_sources')
      return {
        update() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    eq() {
                      return Promise.resolve({ error: { message: 'rollback failed' } })
                    },
                  }
                },
              }
            },
          }
        },
      }
    },
  }

  await assert.rejects(
    rollbackStaleSourceMappings(
      supabase,
      'user-1',
      'owned',
      [{ game_id: 'game-1' }]
    ),
    (error) => error.code === 'SOURCE_FRESHNESS_ROLLBACK_FAILED'
  )
})

test('Steam achievement definitions are retrieved and normalized safely', async () => {
  const definitions = await fetchSteamAchievementDefinitions(570, {
    apiKey: 'test-server-key',
    fetchImpl: async (url) => {
      assert.equal(url.pathname, '/ISteamUserStats/GetSchemaForGame/v2/')
      assert.equal(url.searchParams.get('appid'), '570')
      assert.equal(url.searchParams.get('l'), 'english')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          game: {
            availableGameStats: {
              achievements: [
                { name: 'WIN_ONE', displayName: 'First Win', description: 'Win once', icon: 'icon.png', icongray: 'gray.png', hidden: 0 },
                { name: 'SECRET_WIN', displayName: 'Secret Winner', hidden: 1 },
              ],
            },
          },
        }),
      }
    },
  })

  assert.equal(definitions.length, 2)
  assert.equal(definitions[0].apiName, 'WIN_ONE')
  assert.equal(definitions[0].description, 'Win once')
  assert.equal(definitions[0].hidden, false)
  assert.equal(definitions[1].description, null)
  assert.equal(definitions[1].icon, null)
  assert.equal(definitions[1].iconGray, null)
  assert.equal(definitions[1].hidden, true)
})

test('Steam player achievement retrieval normalizes unlocked and locked timestamps', async () => {
  const playerAchievements = await fetchPlayerAchievements('76561198000000001', 570, {
    apiKey: 'test-server-key',
    fetchImpl: async (url) => {
      assert.equal(url.pathname, '/ISteamUserStats/GetPlayerAchievements/v1/')
      assert.equal(url.searchParams.get('steamid'), '76561198000000001')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          playerstats: {
            success: true,
            achievements: [
              { apiname: 'WIN_ONE', achieved: 1, unlocktime: 1700000000 },
              { apiname: 'SECRET_WIN', achieved: 0, unlocktime: 0 },
            ],
          },
        }),
      }
    },
  })

  assert.equal(playerAchievements[0].achieved, true)
  assert.equal(playerAchievements[0].unlockedAt, new Date(1700000000 * 1000).toISOString())
  assert.equal(playerAchievements[1].achieved, false)
  assert.equal(playerAchievements[1].unlockedAt, null)
})

test('achievement definitions and player data merge by API name', () => {
  const merged = mergeAchievementData(
    [
      { apiName: 'WIN_ONE', displayName: 'First Win', description: null, hidden: false },
      { apiName: 'SECRET_WIN', displayName: 'Secret Win', hidden: true },
    ],
    [
      { apiName: 'WIN_ONE', achieved: true, unlockedAt: '2023-11-14T22:13:20.000Z' },
      { apiName: 'SECRET_WIN', achieved: false, unlockedAt: null },
    ]
  )

  assert.equal(merged[0].unlocked, true)
  assert.equal(merged[0].status, 'unlocked')
  assert.equal(merged[1].unlocked, false)
  assert.equal(merged[1].status, 'locked')
  assert.equal(merged[1].hidden, true)
})

test('achievement response summary counts only known player states as unlocked or locked', () => {
  const response = buildAchievementResponse(
    [
      { apiName: 'KNOWN_UNLOCKED', displayName: 'Known' },
      { apiName: 'KNOWN_LOCKED', displayName: 'Locked' },
      { apiName: 'UNKNOWN_STATUS', displayName: 'Unknown' },
    ],
    [
      { apiName: 'KNOWN_UNLOCKED', achieved: true },
      { apiName: 'KNOWN_LOCKED', achieved: false },
    ]
  )

  assert.equal(response.totalAchievements, 3)
  assert.equal(response.unlockedAchievements, 1)
  assert.equal(response.lockedAchievements, 1)
  assert.equal(response.unknownAchievements, 1)
  assert.equal(response.isCompleteSnapshot, false)
  assert.equal(response.completionPercentage, null)
  assert.equal(response.achievements[2].playerDataAvailable, false)
  assert.equal(response.achievements[2].status, 'unknown')
})

test('games with no achievement definitions are reported honestly', async () => {
  const definitions = await fetchSteamAchievementDefinitions(570, {
    apiKey: 'test-server-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ game: { availableGameStats: { achievements: [] } } }),
    }),
  })
  assert.deepEqual(definitions, [])
})

test('unavailable and private player achievement responses are classified', async () => {
  await assert.rejects(
    fetchPlayerAchievements('76561198000000001', 570, {
      apiKey: 'test-server-key',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          playerstats: { success: false, error: 'Profile is not public' },
        }),
      }),
    }),
    (error) => error.code === 'STEAM_PROFILE_PRIVATE'
  )

  await assert.rejects(
    fetchPlayerAchievements('76561198000000001', 570, {
      apiKey: 'test-server-key',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ playerstats: { success: true } }),
      }),
    }),
    (error) => error.code === 'STEAM_PLAYER_DATA_UNAVAILABLE'
  )
})

test('Steam achievement timeout and malformed responses are classified', async () => {
  await assert.rejects(
    fetchSteamAchievementDefinitions(570, {
      apiKey: 'test-server-key',
      fetchImpl: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) },
    }),
    (error) => error.code === 'STEAM_API_TIMEOUT'
  )

  await assert.rejects(
    fetchSteamAchievementDefinitions(570, {
      apiKey: 'test-server-key',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ unexpected: true }),
      }),
    }),
    (error) => error.code === 'STEAM_API_INVALID_RESPONSE'
  )
})

test('achievement endpoint rejects invalid App IDs and unauthenticated Steam sessions', async () => {
  const invalidResponse = {
    statusCode: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
  await getGameAchievements(
    { params: { appId: 'not-an-id' } },
    invalidResponse
  )
  assert.equal(invalidResponse.statusCode, 400)

  const unauthenticatedResponse = {
    statusCode: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
  await getGameAchievements(
    { params: { appId: '570' }, user: { gameVaultUserId: 'development-user', steamId: '76561198000000001' } },
    unauthenticatedResponse
  )
  assert.equal(unauthenticatedResponse.statusCode, 400)
})

test('achievement endpoint verifies library ownership before Steam requests', async () => {
  let steamCalled = false
  const supabase = {
    from(table) {
      return {
        select() {
          return {
            eq() {
              const result = table === 'games'
                ? { data: { id: 'game-570', steam_app_id: 570, title: 'Dota 2' }, error: null }
                : { data: null, error: null }
              return {
                eq() {
                  return { maybeSingle: async () => result }
                },
                maybeSingle: async () => result,
              }
            },
          }
        },
      }
    },
  }

  const response = {
    statusCode: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
  await getGameAchievements(
    { params: { appId: '570' }, user: { gameVaultUserId: 'user-1', steamId: '76561198000000001' } },
    response,
    {
      supabaseClient: supabase,
      fetchDefinitions: async () => { steamCalled = true; return [] },
    }
  )
  assert.equal(response.statusCode, 404)
  assert.equal(response.payload.errorCode, 'GAME_NOT_IN_LIBRARY')
  assert.equal(steamCalled, false)
})

test('achievement endpoint uses session SteamID and returns merged data without secrets', async () => {
  let receivedSteamId = null
  const supabase = {
    from(table) {
      return {
        select() {
          return {
            eq() {
              const gameResult = { data: { id: 'game-570', steam_app_id: 570, title: 'Dota 2' }, error: null }
              const userResult = { data: { game_id: 'game-570' }, error: null }
              const value = table === 'games' ? gameResult : userResult
              return {
                eq() {
                  return { maybeSingle: async () => value }
                },
                maybeSingle: async () => value,
              }
            },
          }
        },
      }
    },
  }

  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
  await getGameAchievements(
    {
      params: { appId: '570' },
      query: { steamId: '76561199999999999' },
      body: { steamId: '76561199999999999' },
      user: { gameVaultUserId: 'user-1', steamId: '76561198000000001' },
    },
    response,
    {
      supabaseClient: supabase,
      fetchDefinitions: async () => [{ apiName: 'WIN_ONE', displayName: 'Win One', hidden: false }],
      fetchPlayer: async (steamId) => {
        receivedSteamId = steamId
        return [{ apiName: 'WIN_ONE', achieved: true, unlockTimestamp: 1700000000, unlockedAt: '2023-11-14T22:13:20.000Z' }]
      },
    }
  )

  assert.equal(receivedSteamId, '76561198000000001')
  assert.equal(response.statusCode, 200)
  assert.equal(response.payload.dataState, 'available')
  assert.equal(response.payload.unlockedAchievements, 1)
  assert.equal(JSON.stringify(response.payload).includes('test-server-key'), false)
  assert.equal(JSON.stringify(response.payload).includes('76561199999999999'), false)
})

test('achievement endpoint requires authentication', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/steam/games/570/achievements`)
    assert.equal(response.status, 401)
  })
})

test('achievement unlock timestamp helper rejects invalid timestamps', () => {
  assert.equal(validUnlockTimestamp({ unlockTimestamp: 1700000000 }), '2023-11-14T22:13:20.000Z')
  assert.equal(validUnlockTimestamp({ unlockTimestamp: 0 }), null)
  assert.equal(validUnlockTimestamp({ unlockTimestamp: -1 }), null)
  assert.equal(validUnlockTimestamp({ unlockTimestamp: 'not-a-date' }), null)
})

test('achievement schema synchronization inserts, updates, and deactivates without deleting', async () => {
  const operations = []
  const supabase = {
    from(table) {
      if (table === 'achievements') {
        return {
          select() {
            return {
              eq: async () => ({
                data: [{ id: 'achievement-existing', achievement_api_name: 'OLD_ONE' }],
                error: null,
              }),
            }
          },
          upsert(rows) {
            operations.push(['upsert', rows])
            return {
              select: async () => ({
                data: rows.map((row) => ({
                  id: row.achievement_api_name === 'NEW_ONE' ? 'achievement-new' : 'achievement-existing',
                  achievement_api_name: row.achievement_api_name,
                })),
                error: null,
              }),
            }
          },
          update(payload) {
            operations.push(['deactivate', payload])
            return {
              eq: async () => ({ error: null }),
            }
          },
        }
      }
      if (table === 'games') {
        return {
          update(payload) {
            operations.push(['games-update', payload])
            return {
              eq: async () => ({ error: null }),
            }
          },
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const result = await synchronizeAchievementSchema(
    supabase,
    'game-1',
    [{ apiName: 'NEW_ONE', displayName: 'New Achievement', description: null, icon: null, iconGray: 'gray.png', hidden: true }]
  )
  assert.equal(result.schemaState, 'available')
  assert.equal(result.metadataInserted, 1)
  assert.equal(result.metadataUpdated, 0)
  assert.equal(operations.filter((operation) => operation[0] === 'deactivate').length, 1)
})

test('achievement player synchronization stores unlocked, clears locked timestamps, and is idempotent', async () => {
  const upserted = []
  const supabase = {
    from(table) {
      if (table === 'achievements') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq: async () => ({
                    data: [
                      { id: 'achievement-unlocked', achievement_api_name: 'WIN_ONE' },
                      { id: 'achievement-locked', achievement_api_name: 'LOCKED_ONE' },
                    ],
                    error: null,
                  }),
                }
              },
            }
          },
        }
      }
      if (table === 'user_achievements') {
        return {
          select() {
            return {
              eq: async () => ({
                data: [{ achievement_id: 'achievement-locked' }],
                error: null,
              }),
            }
          },
          upsert(rows) {
            upserted.push(...rows)
            return Promise.resolve({ error: null })
          },
        }
      }
      if (table === 'user_games') {
        return {
          update(payload) {
            return {
              eq() {
                return {
                  eq: async () => ({ error: null }),
                }
              },
            }
          },
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const result = await synchronizePlayerProgress(
    supabase,
    'user-1',
    'game-1',
    [
      { apiName: 'WIN_ONE' },
      { apiName: 'LOCKED_ONE' },
    ],
    [
      { apiName: 'WIN_ONE', achieved: true, unlockTimestamp: 1700000000, unlockedAt: '2023-11-14T22:13:20.000Z' },
      { apiName: 'LOCKED_ONE', achieved: false, unlockTimestamp: null, unlockedAt: null },
    ]
  )

  assert.equal(result.playerProgressSynced, true)
  assert.equal(result.unlockedAchievements, 1)
  assert.equal(result.lockedAchievements, 1)
  assert.equal(result.unknownAchievements, 0)
  assert.equal(result.isCompleteSnapshot, true)
  assert.equal(result.completionPercentage, 50)
  assert.equal(upserted.length, 2)
  assert.equal(upserted[0].unlocked_at, '2023-11-14T22:13:20.000Z')
  assert.equal(upserted[1].unlocked_at, null)
  assert.equal(result.playerRecordsInserted, 1)
  assert.equal(result.playerRecordsUpdated, 1)
})

test('achievement synchronization POST requires authentication', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/steam/games/570/achievements/sync`, {
      method: 'POST',
    })
    assert.equal(response.status, 401)
  })
})

test('achievement synchronization rejects invalid app IDs and never uses body identity', async () => {
  let statusCode = 200
  let body = null
  const response = {
    status(code) { statusCode = code; return this },
    json(payload) { body = payload; return this },
  }
  await syncGameAchievements(
    {
      params: { appId: 'invalid' },
      body: { steamId: '76561199999999999', userId: 'attacker-user' },
      user: { gameVaultUserId: 'session-user', steamId: '76561198000000001' },
    },
    response,
    { fetchDefinitions: async () => { throw new Error('Steam should not be called') } }
  )
  assert.equal(statusCode, 400)
  assert.equal(body.errorCode, 'STEAM_APP_ID_INVALID')
})

test('Stage 4B migration preserves data and adds achievement synchronization fields', () => {
  const migrationPath = path.join(
    __dirname,
    '..',
    '..',
    'supabase',
    'migrations',
    '20261107000002_stage4b_achievement_database_sync.sql'
  )
  const sql = fs.readFileSync(migrationPath, 'utf8')
  assert.match(sql, /icon_gray_url/)
  assert.match(sql, /is_active/)
  assert.match(sql, /achievement_schema_last_synced_at/)
  assert.match(sql, /achievement_last_synced_at/)
  assert.match(sql, /user_achievements_locked_timestamp_check/)
})

test('Stage 4B migration replaces only the original unlock constraint and leaves unrelated constraints', () => {
  const migrationPath = path.join(
    __dirname,
    '..',
    '..',
    'supabase',
    'migrations',
    '20261107000002_stage4b_achievement_database_sync.sql'
  )
  const sql = fs.readFileSync(migrationPath, 'utf8')
  // Targets exact canonical expression of original unlock constraint
  assert.match(sql, /CHECKNOTIS_UNLOCKEDORUNLOCKED_ATISNOTNULL/)
  // Ensures it does NOT drop by overly broad pattern
  assert.doesNotMatch(sql, /pg_get_constraintdef\(oid\)\s+like\s+'%is_unlocked%'/)
  // Explicitly excludes the replacement constraint from drop candidates
  assert.match(sql, /user_achievements_locked_timestamp_check/)
  // Replacement constraint creation is idempotent
  assert.match(sql, /user_achievements_locked_timestamp_check/)
  // Guard against ambiguous matches with exception
  assert.match(sql, /Ambiguous check constraints found matching original unlock definition/)
  // Fail-closed safeguard: raises exception if original cannot be identified and replacement is absent
  assert.match(sql, /candidate_count = 0 and not exists/)
  assert.match(sql, /Original unlock timestamp constraint on public\.user_achievements could not be identified safely/)
})

test('schema synchronization deactivates previous definitions on explicit empty schema while preserving progress', async () => {
  const deactivated = []
  const updatedGames = []
  let deleteCalled = false
  const supabase = {
    from(table) {
      if (table === 'achievements') {
        return {
          select() {
            return {
              eq: async () => ({
                data: [
                  { id: 'ach-1', achievement_api_name: 'OLD_1', is_active: true },
                  { id: 'ach-2', achievement_api_name: 'OLD_2', is_active: false },
                ],
                error: null,
              }),
            }
          },
          update(payload) {
            deactivated.push(payload)
            return {
              eq: async () => ({ error: null }),
            }
          },
          delete() {
            deleteCalled = true
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      if (table === 'user_achievements') {
        return {
          delete() {
            deleteCalled = true
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      if (table === 'games') {
        return {
          update(payload) {
            updatedGames.push(payload)
            return {
              eq: async () => ({ error: null }),
            }
          },
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const result = await synchronizeAchievementSchema(supabase, 'game-empty', [])
  assert.equal(result.schemaState, 'no_achievements')
  assert.equal(result.metadataInserted, 0)
  assert.equal(result.metadataUpdated, 0)
  assert.equal(deactivated.length, 1) // only the active definition ach-1 is deactivated
  assert.equal(deactivated[0].is_active, false)
  assert.equal(updatedGames.length, 1)
  assert.equal(updatedGames[0].achievement_schema_state, 'no_achievements')
  assert.ok(updatedGames[0].achievement_schema_last_synced_at)
  assert.equal(deleteCalled, false)
})

test('schema retrieval treats malformed achievement entries as invalid', async () => {
  // Malformed entry inside achievements array (no valid name field)
  await assert.rejects(
    fetchSteamAchievementDefinitions(570, {
      apiKey: 'test-server-key',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ game: { availableGameStats: { achievements: [{ invalid: true }] } } }),
      }),
    }),
    (error) => error.code === 'STEAM_API_INVALID_RESPONSE'
  )
})

test('schema retrieval returns empty array when availableGameStats is absent', async () => {
  // Steam omits availableGameStats entirely for games with no achievement definitions
  const result = await fetchSteamAchievementDefinitions(570, {
    apiKey: 'test-server-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ game: {} }),
    }),
  })
  assert.deepEqual(result, [])
})

test('schema retrieval returns empty array when availableGameStats is null', async () => {
  const result = await fetchSteamAchievementDefinitions(570, {
    apiKey: 'test-server-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ game: { availableGameStats: null } }),
    }),
  })
  assert.deepEqual(result, [])
})

test('schema retrieval returns empty array when availableGameStats has no achievements key', async () => {
  // availableGameStats exists as a valid object but contains no achievements property
  const result = await fetchSteamAchievementDefinitions(570, {
    apiKey: 'test-server-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ game: { availableGameStats: {} } }),
    }),
  })
  assert.deepEqual(result, [])
})

test('schema retrieval returns empty array when achievements array is explicitly empty', async () => {
  const result = await fetchSteamAchievementDefinitions(570, {
    apiKey: 'test-server-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ game: { availableGameStats: { achievements: [] } } }),
    }),
  })
  assert.deepEqual(result, [])
})

test('schema retrieval rejects availableGameStats of invalid type', async () => {
  // availableGameStats as a string is malformed
  await assert.rejects(
    fetchSteamAchievementDefinitions(570, {
      apiKey: 'test-server-key',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ game: { availableGameStats: 'invalid' } }),
      }),
    }),
    (error) => error.code === 'STEAM_API_INVALID_RESPONSE'
  )

  // availableGameStats as an array is malformed
  await assert.rejects(
    fetchSteamAchievementDefinitions(570, {
      apiKey: 'test-server-key',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ game: { availableGameStats: [] } }),
      }),
    }),
    (error) => error.code === 'STEAM_API_INVALID_RESPONSE'
  )

  // availableGameStats as a number is malformed
  await assert.rejects(
    fetchSteamAchievementDefinitions(570, {
      apiKey: 'test-server-key',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ game: { availableGameStats: 42 } }),
      }),
    }),
    (error) => error.code === 'STEAM_API_INVALID_RESPONSE'
  )
})

test('schema retrieval rejects achievements of non-array type', async () => {
  await assert.rejects(
    fetchSteamAchievementDefinitions(570, {
      apiKey: 'test-server-key',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ game: { availableGameStats: { achievements: {} } } }),
      }),
    }),
    (error) => error.code === 'STEAM_API_INVALID_RESPONSE'
  )
})

test('schema retrieval rejects response with missing or invalid body.game', async () => {
  // No game key
  await assert.rejects(
    fetchSteamAchievementDefinitions(570, {
      apiKey: 'test-server-key',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ unexpected: true }),
      }),
    }),
    (error) => error.code === 'STEAM_API_INVALID_RESPONSE'
  )

  // game is null
  await assert.rejects(
    fetchSteamAchievementDefinitions(570, {
      apiKey: 'test-server-key',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ game: null }),
      }),
    }),
    (error) => error.code === 'STEAM_API_INVALID_RESPONSE'
  )

  // game is a string
  await assert.rejects(
    fetchSteamAchievementDefinitions(570, {
      apiKey: 'test-server-key',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ game: 'Dota 2' }),
      }),
    }),
    (error) => error.code === 'STEAM_API_INVALID_RESPONSE'
  )
})

test('invalid schema does not update timestamps or deactivate definitions', async () => {
  const supabase = {
    from() {
      throw new Error('Database should not be accessed on invalid schema')
    },
  }
  await assert.rejects(
    synchronizeAchievementSchema(supabase, 'game-1', null),
    /valid achievement schema definition array is required/
  )
})

test('player progress synchronizes only recognized valid entries and preserves progress on unrecognized entries', async () => {
  const upserted = []
  let userGamesUpdated = false
  const supabase = {
    from(table) {
      if (table === 'achievements') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq: async () => ({
                    data: [{ id: 'ach-win', achievement_api_name: 'WIN_ONE' }],
                    error: null,
                  }),
                }
              },
            }
          },
        }
      }
      if (table === 'user_achievements') {
        return {
          select() {
            return {
              eq: async () => ({ data: [], error: null }),
            }
          },
          upsert(rows) {
            upserted.push(...rows)
            return Promise.resolve({ error: null })
          },
        }
      }
      if (table === 'user_games') {
        return {
          update() {
            userGamesUpdated = true
            return {
              eq() {
                return { eq: async () => ({ error: null }) }
              },
            }
          },
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  // Mixed valid, unrecognized, and invalid entries
  const result = await synchronizePlayerProgress(
    supabase,
    'user-1',
    'game-1',
    [{ apiName: 'WIN_ONE' }, { apiName: 'NOT_IN_RESPONSE' }],
    [
      { apiName: 'WIN_ONE', achieved: true, unlockTimestamp: 1700000000 },
      { apiName: 'UNKNOWN_STEAM_ACH', achieved: true },
      { apiName: 'MALFORMED', achieved: 'yes' },
    ]
  )

  assert.equal(result.playerProgressSynced, true)
  assert.equal(result.playerRecordsInserted, 1)
  assert.equal(upserted.length, 1)
  assert.equal(upserted[0].achievement_id, 'ach-win')
  assert.equal(upserted[0].is_unlocked, true)
  assert.equal(result.unlockedAchievements, 1)
  assert.equal(result.lockedAchievements, 0)
  assert.equal(result.unknownAchievements, 1) // NOT_IN_RESPONSE is unknown
  assert.equal(result.isCompleteSnapshot, false)
  assert.equal(result.completionPercentage, null)
  assert.equal(userGamesUpdated, true)
})

test('an array with no recognized player entries does not count as success and does not update user_games', async () => {
  let userGamesUpdated = false
  let upsertCalled = false
  const supabase = {
    from(table) {
      if (table === 'achievements') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq: async () => ({
                    data: [{ id: 'ach-win', achievement_api_name: 'WIN_ONE' }],
                    error: null,
                  }),
                }
              },
            }
          },
        }
      }
      if (table === 'user_achievements') {
        return {
          upsert() {
            upsertCalled = true
            return Promise.resolve({ error: null })
          },
        }
      }
      if (table === 'user_games') {
        return {
          update() {
            userGamesUpdated = true
            return { eq: () => ({ eq: async () => ({ error: null }) }) }
          },
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const result = await synchronizePlayerProgress(
    supabase,
    'user-1',
    'game-1',
    [{ apiName: 'WIN_ONE' }],
    [{ apiName: 'TOTALLY_DIFFERENT', achieved: true }]
  )

  assert.equal(result.playerProgressSynced, false)
  assert.equal(result.playerDataState, 'player_data_unavailable')
  assert.equal(upsertCalled, false)
  assert.equal(userGamesUpdated, false)
  assert.equal(result.unknownAchievements, 1)
  assert.equal(result.isCompleteSnapshot, false)
  assert.equal(result.completionPercentage, null)
})

test('zero-achievement games are handled correctly without pretending progress was synchronized', async () => {
  let dbCalled = false
  const supabase = {
    from() {
      dbCalled = true
      return {}
    },
  }

  const result = await synchronizePlayerProgress(supabase, 'user-1', 'game-1', [], [{ apiName: 'NONE', achieved: true }])
  assert.equal(result.playerDataState, 'not_applicable')
  assert.equal(result.playerProgressSynced, false)
  assert.equal(result.totalAchievements, 0)
  assert.equal(result.isCompleteSnapshot, true)
  assert.equal(result.completionPercentage, null)
  assert.equal(dbCalled, false)
})

test('syncGameAchievements verifies session identity consistency against public.users', async () => {
  let queriedUser = false
  let queriedGame = false
  const supabase = {
    from(table) {
      if (table === 'users') {
        return {
          select() {
            return {
              eq(col1, val1) {
                return {
                  eq(col2, val2) {
                    queriedUser = true
                    const match = val1 === 'valid-user' && val2 === '76561198000000001'
                    return { maybeSingle: async () => ({ data: match ? { id: val1, steam_id: val2 } : null, error: null }) }
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'games') {
        return {
          select() {
            return {
              eq: () => ({
                maybeSingle: async () => {
                  queriedGame = true
                  return { data: { id: 'game-1', steam_app_id: 570 }, error: null }
                },
              }),
            }
          },
          update() {
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      if (table === 'achievements') {
        return {
          select() {
            return {
              eq: async () => ({ data: [], error: null }),
            }
          },
          update() {
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      if (table === 'user_games') {
        return {
          select() {
            return {
              eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { game_id: 'game-1' }, error: null }) }) }),
            }
          },
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  // Mismatched session pair rejected with 401
  const mismatchedResponse = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.payload = body; return this },
  }
  await syncGameAchievements(
    {
      params: { appId: '570' },
      body: { steamId: '76561198000000001', userId: 'valid-user' }, // ignored
      user: { gameVaultUserId: 'imposter-user', steamId: '76561198000000001' },
    },
    mismatchedResponse,
    { supabaseClient: supabase }
  )
  assert.equal(mismatchedResponse.statusCode, 401)
  assert.equal(mismatchedResponse.payload.errorCode, 'SESSION_IDENTITY_MISMATCH')
  assert.equal(queriedGame, false) // Stopped before game check

  // Valid session pair passes user check
  const validResponse = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.payload = body; return this },
  }
  await syncGameAchievements(
    {
      params: { appId: '570' },
      body: { steamId: 'attacker-steam', userId: 'attacker-uuid' }, // ignored
      user: { gameVaultUserId: 'valid-user', steamId: '76561198000000001' },
    },
    validResponse,
    {
      supabaseClient: supabase,
      fetchDefinitions: async () => [],
    }
  )
  assert.equal(validResponse.statusCode, 200)
  assert.equal(validResponse.payload.schemaState, 'no_achievements')
  assert.equal(queriedUser, true)
  assert.equal(queriedGame, true)
})

test('concurrency lock rejects simultaneous sync for same user/game and allows different games or users', async () => {
  clearAllSyncLocks()

  assert.equal(acquireSyncLock('user-1', 'game-1'), true)
  // Simultaneous request for same user and game is rejected
  assert.equal(acquireSyncLock('user-1', 'game-1'), false)

  // Different game for same user succeeds
  assert.equal(acquireSyncLock('user-1', 'game-2'), true)
  // Different user for same game succeeds
  assert.equal(acquireSyncLock('user-2', 'game-1'), true)

  // Release and re-acquire
  releaseSyncLock('user-1', 'game-1')
  assert.equal(acquireSyncLock('user-1', 'game-1'), true)
  releaseSyncLock('user-1', 'game-1')
  releaseSyncLock('user-1', 'game-2')
  releaseSyncLock('user-2', 'game-1')
})

test('syncGameAchievements releases concurrency lock even when synchronization fails', async () => {
  clearAllSyncLocks()
  const supabase = {
    from(table) {
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1', steam_id: 's1' }, error: null }) }) }) }),
        }
      }
      if (table === 'games') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'g1', steam_app_id: 570 }, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'achievements') {
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'user_games') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { game_id: 'g1' }, error: null }) }) }) }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const response1 = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.payload = body; return this },
  }

  // Trigger a failure during fetchDefinitions
  await syncGameAchievements(
    {
      params: { appId: '570' },
      user: { gameVaultUserId: 'u1', steamId: 's1' },
    },
    response1,
    {
      supabaseClient: supabase,
      fetchDefinitions: async () => { throw new Error('Network failure') },
    }
  )

  assert.equal(response1.statusCode, 503)

  // The lock must be released, so a subsequent request succeeds without 409
  const response2 = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.payload = body; return this },
  }

  await syncGameAchievements(
    {
      params: { appId: '570' },
      user: { gameVaultUserId: 'u1', steamId: 's1' },
    },
    response2,
    {
      supabaseClient: supabase,
      fetchDefinitions: async () => [],
    }
  )

  assert.equal(response2.statusCode, 200)
})

test('bulk achievement synchronization POST requires authentication', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/steam/achievements/sync-all`, {
      method: 'POST',
    })
    assert.equal(response.status, 401)
  })
})

test('bulk achievement synchronization handles empty user game library', async () => {
  clearAllBulkSyncLocks()
  clearAllSyncLocks()

  const supabase = {
    from(table) {
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1', steam_id: 's1' }, error: null }) }) }) }),
        }
      }
      if (table === 'user_games') {
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const response = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.payload = body; return this },
  }

  await syncAllGameAchievements(
    { user: { gameVaultUserId: 'u1', steamId: 's1' } },
    response,
    { supabaseClient: supabase }
  )

  assert.equal(response.statusCode, 200)
  assert.equal(response.payload.totalGamesProcessed, 0)
  assert.equal(response.payload.successfulSynchronizations, 0)
  assert.deepEqual(response.payload.results, [])
})

test('successful bulk achievement synchronization processes all games and returns summary', async () => {
  clearAllBulkSyncLocks()
  clearAllSyncLocks()

  const games = [
    { id: 'g1', steam_app_id: 100, title: 'Game 1' },
    { id: 'g2', steam_app_id: 200, title: 'Game 2' },
  ]

  const supabase = {
    from(table) {
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1', steam_id: 's1' }, error: null }) }) }) }),
        }
      }
      if (table === 'user_games') {
        return {
          select: () => ({ eq: async () => ({ data: [{ game_id: 'g1' }, { game_id: 'g2' }], error: null }) }),
          update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        }
      }
      if (table === 'games') {
        return {
          select: () => ({ in: async () => ({ data: games, error: null }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'achievements') {
        return {
          select: () => ({
            eq: () => {
              const res = { data: [{ id: 'ach-1', achievement_api_name: 'WIN' }], error: null }
              return {
                then: (resolve) => resolve(res),
                eq: async () => res,
              }
            },
          }),
          upsert: (rows) => ({
            select: async () => ({
              data: rows.map((r) => ({ id: `ach-${r.achievement_api_name}`, achievement_api_name: r.achievement_api_name })),
              error: null,
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'user_achievements') {
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
          upsert: async () => ({ error: null }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const response = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.payload = body; return this },
  }

  await syncAllGameAchievements(
    { user: { gameVaultUserId: 'u1', steamId: 's1' } },
    response,
    {
      supabaseClient: supabase,
      fetchDefinitions: async () => [{ apiName: 'WIN', displayName: 'Winner' }],
      fetchPlayer: async () => [{ apiName: 'WIN', achieved: true }],
    }
  )

  assert.equal(response.statusCode, 200)
  assert.equal(response.payload.totalGamesProcessed, 2)
  assert.equal(response.payload.successfulSynchronizations, 2)
  assert.equal(response.payload.gamesWithNoAchievements, 0)
  assert.equal(response.payload.failedSynchronizations, 0)
  assert.equal(response.payload.results.length, 2)
  assert.equal(response.payload.results[0].status, 'success')
  assert.equal(response.payload.results[0].unlockedAchievements, 1)
  assert.equal(response.payload.results[1].status, 'success')
})

test('bulk achievement synchronization handles mixed successful, zero-achievement, and failed games', async () => {
  clearAllBulkSyncLocks()
  clearAllSyncLocks()

  const games = [
    { id: 'g1', steam_app_id: 101, title: 'Success Game' },
    { id: 'g2', steam_app_id: 102, title: 'No Achievements Game' },
    { id: 'g3', steam_app_id: 103, title: 'Failed Game' },
  ]

  const supabase = {
    from(table) {
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1', steam_id: 's1' }, error: null }) }) }) }),
        }
      }
      if (table === 'user_games') {
        return {
          select: () => ({ eq: async () => ({ data: games.map((g) => ({ game_id: g.id })), error: null }) }),
          update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        }
      }
      if (table === 'games') {
        return {
          select: () => ({ in: async () => ({ data: games, error: null }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'achievements') {
        return {
          select: () => ({
            eq: () => {
              const res = { data: [{ id: 'ach-win', achievement_api_name: 'WIN' }], error: null }
              return {
                then: (resolve) => resolve(res),
                eq: async () => res,
              }
            },
          }),
          upsert: (rows) => ({
            select: async () => ({
              data: rows.map((r) => ({ id: `ach-${r.achievement_api_name}`, achievement_api_name: r.achievement_api_name })),
              error: null,
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'user_achievements') {
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
          upsert: async () => ({ error: null }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const response = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.payload = body; return this },
  }

  await syncAllGameAchievements(
    { user: { gameVaultUserId: 'u1', steamId: 's1' } },
    response,
    {
      supabaseClient: supabase,
      fetchDefinitions: async (appId) => {
        if (appId === 101) return [{ apiName: 'WIN', displayName: 'Win' }]
        if (appId === 102) return [] // no achievements
        throw new Error('Steam definitions network failure')
      },
      fetchPlayer: async () => [{ apiName: 'WIN', achieved: true }],
    }
  )

  assert.equal(response.statusCode, 200)
  assert.equal(response.payload.totalGamesProcessed, 3)
  assert.equal(response.payload.successfulSynchronizations, 1)
  assert.equal(response.payload.gamesWithNoAchievements, 1)
  assert.equal(response.payload.failedSynchronizations, 1)
  assert.equal(response.payload.results[0].status, 'success')
  assert.equal(response.payload.results[1].status, 'no_achievements')
  assert.equal(response.payload.results[2].status, 'failed')
})

test('bulk achievement synchronization handles unavailable player data without failing the batch', async () => {
  clearAllBulkSyncLocks()
  clearAllSyncLocks()

  const games = [
    { id: 'g1', steam_app_id: 201, title: 'Private Profile Game' },
    { id: 'g2', steam_app_id: 202, title: 'Unavailable Data Game' },
  ]

  const supabase = {
    from(table) {
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1', steam_id: 's1' }, error: null }) }) }) }),
        }
      }
      if (table === 'user_games') {
        return {
          select: () => ({ eq: async () => ({ data: games.map((g) => ({ game_id: g.id })), error: null }) }),
          update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        }
      }
      if (table === 'games') {
        return {
          select: () => ({ in: async () => ({ data: games, error: null }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'achievements') {
        return {
          select: () => ({
            eq: () => {
              const res = { data: [{ id: 'ach-1', achievement_api_name: 'ACH' }], error: null }
              return {
                then: (resolve) => resolve(res),
                eq: async () => res,
              }
            },
          }),
          upsert: (rows) => ({
            select: async () => ({
              data: rows.map((r) => ({ id: `ach-${r.achievement_api_name}`, achievement_api_name: r.achievement_api_name })),
              error: null,
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'user_achievements') {
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
          upsert: async () => ({ error: null }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const response = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.payload = body; return this },
  }

  await syncAllGameAchievements(
    { user: { gameVaultUserId: 'u1', steamId: 's1' } },
    response,
    {
      supabaseClient: supabase,
      fetchDefinitions: async () => [{ apiName: 'ACH', displayName: 'Ach' }],
      fetchPlayer: async (steamId, appId) => {
        if (appId === 201) {
          const err = new Error('Private')
          err.code = 'STEAM_PROFILE_PRIVATE'
          throw err
        }
        const err = new Error('Unavailable')
        err.code = 'STEAM_PLAYER_DATA_UNAVAILABLE'
        throw err
      },
    }
  )

  assert.equal(response.statusCode, 200)
  assert.equal(response.payload.totalGamesProcessed, 2)
  assert.equal(response.payload.successfulSynchronizations, 0)
  assert.equal(response.payload.gamesWithUnavailablePlayerData, 2)
  assert.equal(response.payload.failedSynchronizations, 0)
  assert.equal(response.payload.results[0].status, 'player_data_unavailable')
  assert.equal(response.payload.results[0].playerDataState, 'profile_private')
  assert.equal(response.payload.results[1].status, 'player_data_unavailable')
  assert.equal(response.payload.results[1].playerDataState, 'player_data_unavailable')
})

test('duplicate bulk achievement requests for the same user are rejected with 409', async () => {
  clearAllBulkSyncLocks()

  assert.equal(acquireBulkSyncLock('user-bulk'), true)
  assert.equal(acquireBulkSyncLock('user-bulk'), false) // rejected

  const supabase = {
    from(table) {
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'user-bulk', steam_id: 's1' }, error: null }) }) }) }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const response = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.payload = body; return this },
  }

  await syncAllGameAchievements(
    { user: { gameVaultUserId: 'user-bulk', steamId: 's1' } },
    response,
    { supabaseClient: supabase }
  )

  assert.equal(response.statusCode, 409)
  assert.equal(response.payload.errorCode, 'BULK_SYNC_IN_PROGRESS')

  releaseBulkSyncLock('user-bulk')
})

test('bulk achievement synchronization skips already locked games and processes others', async () => {
  clearAllBulkSyncLocks()
  clearAllSyncLocks()

  const games = [
    { id: 'g-locked', steam_app_id: 301, title: 'Locked Game' },
    { id: 'g-free', steam_app_id: 302, title: 'Free Game' },
  ]

  // Pre-acquire per-game lock on g-locked
  assert.equal(acquireSyncLock('u1', 'g-locked'), true)

  const supabase = {
    from(table) {
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1', steam_id: 's1' }, error: null }) }) }) }),
        }
      }
      if (table === 'user_games') {
        return {
          select: () => ({ eq: async () => ({ data: games.map((g) => ({ game_id: g.id })), error: null }) }),
          update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        }
      }
      if (table === 'games') {
        return {
          select: () => ({ in: async () => ({ data: games, error: null }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'achievements') {
        return {
          select: () => ({
            eq: () => {
              const res = { data: [{ id: 'ach-1', achievement_api_name: 'WIN' }], error: null }
              return {
                then: (resolve) => resolve(res),
                eq: async () => res,
              }
            },
          }),
          upsert: (rows) => ({
            select: async () => ({
              data: rows.map((r) => ({ id: `ach-${r.achievement_api_name}`, achievement_api_name: r.achievement_api_name })),
              error: null,
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'user_achievements') {
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
          upsert: async () => ({ error: null }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const response = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.payload = body; return this },
  }

  await syncAllGameAchievements(
    { user: { gameVaultUserId: 'u1', steamId: 's1' } },
    response,
    {
      supabaseClient: supabase,
      fetchDefinitions: async () => [{ apiName: 'WIN', displayName: 'Win' }],
      fetchPlayer: async () => [{ apiName: 'WIN', achieved: true }],
    }
  )

  assert.equal(response.statusCode, 200)
  assert.equal(response.payload.totalGamesProcessed, 2)
  assert.equal(response.payload.successfulSynchronizations, 1)
  assert.equal(response.payload.failedSynchronizations, 1) // skipped_locked counted in failed
  assert.equal(response.payload.results[0].status, 'skipped_locked')
  assert.equal(response.payload.results[0].errorCode, 'SYNC_IN_PROGRESS')
  assert.equal(response.payload.results[1].status, 'success')

  releaseSyncLock('u1', 'g-locked')
})

test('bulk achievement synchronization is idempotent on repeat runs', async () => {
  clearAllBulkSyncLocks()
  clearAllSyncLocks()

  const games = [{ id: 'g1', steam_app_id: 100, title: 'Game 1' }]
  let progressQueryCount = 0

  const supabase = {
    from(table) {
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1', steam_id: 's1' }, error: null }) }) }) }),
        }
      }
      if (table === 'user_games') {
        return {
          select: () => ({ eq: async () => ({ data: [{ game_id: 'g1' }], error: null }) }),
          update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        }
      }
      if (table === 'games') {
        return {
          select: () => ({ in: async () => ({ data: games, error: null }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'achievements') {
        return {
          select: () => ({
            eq: () => {
              const res = { data: [{ id: 'ach-1', achievement_api_name: 'WIN' }], error: null }
              return {
                then: (resolve) => resolve(res),
                eq: async () => res,
              }
            },
          }),
          upsert: (rows) => ({
            select: async () => ({
              data: rows.map((r) => ({ id: `ach-${r.achievement_api_name}`, achievement_api_name: r.achievement_api_name })),
              error: null,
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'user_achievements') {
        return {
          select: () => {
            progressQueryCount++
            // First run: empty existing progress. Second run: existing progress exists.
            const existing = progressQueryCount === 1 ? [] : [{ achievement_id: 'ach-1' }]
            return { eq: async () => ({ data: existing, error: null }) }
          },
          upsert: async () => ({ error: null }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  // Run 1: initial insertion
  const response1 = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.payload = body; return this },
  }
  await syncAllGameAchievements(
    { user: { gameVaultUserId: 'u1', steamId: 's1' } },
    response1,
    {
      supabaseClient: supabase,
      fetchDefinitions: async () => [{ apiName: 'WIN', displayName: 'Winner' }],
      fetchPlayer: async () => [{ apiName: 'WIN', achieved: true }],
    }
  )
  assert.equal(response1.statusCode, 200)
  assert.equal(response1.payload.results[0].playerRecordsInserted, 1)
  assert.equal(response1.payload.results[0].playerRecordsUpdated, 0)

  // Run 2: idempotent update
  const response2 = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.payload = body; return this },
  }
  await syncAllGameAchievements(
    { user: { gameVaultUserId: 'u1', steamId: 's1' } },
    response2,
    {
      supabaseClient: supabase,
      fetchDefinitions: async () => [{ apiName: 'WIN', displayName: 'Winner' }],
      fetchPlayer: async () => [{ apiName: 'WIN', achieved: true }],
    }
  )
  assert.equal(response2.statusCode, 200)
  assert.equal(response2.payload.results[0].playerRecordsInserted, 0)
  assert.equal(response2.payload.results[0].playerRecordsUpdated, 1)
})

test('bulk achievement synchronization respects bounded concurrency limit of 2', async () => {
  clearAllBulkSyncLocks()
  clearAllSyncLocks()

  const games = [
    { id: 'g1', steam_app_id: 401, title: 'Game 1' },
    { id: 'g2', steam_app_id: 402, title: 'Game 2' },
    { id: 'g3', steam_app_id: 403, title: 'Game 3' },
    { id: 'g4', steam_app_id: 404, title: 'Game 4' },
  ]

  let activeConcurrent = 0
  let maxConcurrentObserved = 0

  const supabase = {
    from(table) {
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1', steam_id: 's1' }, error: null }) }) }) }),
        }
      }
      if (table === 'user_games') {
        return {
          select: () => ({ eq: async () => ({ data: games.map((g) => ({ game_id: g.id })), error: null }) }),
          update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        }
      }
      if (table === 'games') {
        return {
          select: () => ({ in: async () => ({ data: games, error: null }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'achievements') {
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const response = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.payload = body; return this },
  }

  await syncAllGameAchievements(
    { user: { gameVaultUserId: 'u1', steamId: 's1' } },
    response,
    {
      supabaseClient: supabase,
      concurrencyLimit: 2,
      fetchDefinitions: async () => {
        activeConcurrent++
        maxConcurrentObserved = Math.max(maxConcurrentObserved, activeConcurrent)
        await new Promise((resolve) => setTimeout(resolve, 20))
        activeConcurrent--
        return []
      },
    }
  )

  assert.equal(response.statusCode, 200)
  assert.equal(response.payload.totalGamesProcessed, 4)
  assert.ok(maxConcurrentObserved <= 2, `Expected max concurrency <= 2, got ${maxConcurrentObserved}`)
  assert.equal(maxConcurrentObserved, 2)
})
