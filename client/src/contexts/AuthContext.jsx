import { useEffect, useState } from 'react'
import { getAuthSession, logout as logoutRequest, startDevelopmentLogin } from '../services/authService.js'
import { AuthContext } from './authStore.js'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  async function refreshSession() {
    setIsLoading(true)
    try {
      const session = await getAuthSession()
      setUser(session.authenticated ? session.user : null)
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }

  async function loginForDevelopment() {
    const session = await startDevelopmentLogin()
    setUser(session.authenticated ? session.user : null)
    return session
  }

  async function logout() {
    try {
      await logoutRequest()
    } finally {
      setUser(null)
    }
  }

  useEffect(() => {
    let active = true

    async function restoreSession() {
      try {
        const session = await getAuthSession()
        if (active) setUser(session.authenticated ? session.user : null)
      } catch {
        if (active) setUser(null)
      } finally {
        if (active) setIsLoading(false)
      }
    }

    restoreSession()
    return () => { active = false }
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, refreshSession, loginForDevelopment, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

