async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'include', ...options })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Authentication request failed')
  return data
}

export function getAuthSession() {
  return request('/api/auth/session')
}

export function startDevelopmentLogin() {
  return request('/api/auth/dev/login', { method: 'POST' })
}

export function logout() {
  return request('/api/auth/logout', { method: 'POST' })
}

export function getSteamProfile() {
  return request('/api/auth/steam/profile')
}

export function getSteamGames() {
  return request('/api/steam/games')
}

export function syncSteamGames() {
  return request('/api/steam/sync/games', { method: 'POST' })
}

export function startSteamLogin() {
  window.location.assign('/api/auth/steam')
}
