const { COOKIE_NAME, createSession, getSession, destroySession, readCookie } = require('../config/session')

function getSessionState(req, res) {
  const session = getSession(readCookie(req.headers.cookie))
  res.json({ authenticated: Boolean(session), user: session?.user || null })
}

function createDevelopmentSession(req, res) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Development authentication is disabled' })
  }

  const token = createSession({ id: 'development-user', displayName: 'Development User', authType: 'development' })
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000,
  })
  res.json({ authenticated: true, user: { id: 'development-user', displayName: 'Development User', authType: 'development' } })
}

function logout(req, res) {
  destroySession(readCookie(req.headers.cookie))
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' })
  res.json({ authenticated: false, user: null })
}

function steamLogin(req, res) {
  res.status(501).json({ error: 'Steam OpenID authentication is not implemented yet.' })
}

module.exports = { getSessionState, createDevelopmentSession, logout, steamLogin }
