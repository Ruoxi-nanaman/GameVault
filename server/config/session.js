const crypto = require('node:crypto')

const sessionSecret = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? null : 'gamevault-development-secret')

if (!sessionSecret) throw new Error('SESSION_SECRET is required in production')

const COOKIE_NAME = 'gamevault_session'
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const sessions = new Map()

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url')
}

function createSession(user) {
  const id = crypto.randomBytes(32).toString('base64url')
  sessions.set(id, { user, expiresAt: Date.now() + SESSION_TTL_MS })
  return `${id}.${sign(id)}`
}

function getSession(token) {
  if (!token || !token.includes('.')) return null
  const [id, signature] = token.split('.')
  const expected = sign(id)
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  const session = sessions.get(id)
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(id)
    return null
  }
  return session
}

function destroySession(token) {
  if (!token) return
  const [id] = token.split('.')
  sessions.delete(id)
}

function readCookie(header = '') {
  return header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1) || null
}

module.exports = { COOKIE_NAME, createSession, getSession, destroySession, readCookie }
