const { getSession, readCookie } = require('../config/session')

function requireAuth(req, res, next) {
  const session = getSession(readCookie(req.headers.cookie))
  if (!session) return res.status(401).json({ error: 'Authentication required' })
  req.user = session.user
  next()
}

module.exports = { requireAuth }
