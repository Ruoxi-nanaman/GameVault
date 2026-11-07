import { useEffect, useState } from 'react'
import { getAuthSession, getSteamProfile, logout as logoutRequest, startDevelopmentLogin } from '../services/authService.js'
import { AuthContext } from './authStore.js'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  async function refreshSession() {
    setIsLoading(true)
    try {
      const session = await getAuthSession()
      if (!session.authenticated) {
        setUser(null)
      } else if (session.user.authType === 'steam') {
        await refreshSteamProfile(session.user)
      } else {
        setUser(session.user)
      }
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }

  async function refreshSteamProfile(currentUser = user) {
    try {
      const profile = await getSteamProfile()
      setUser({
        ...currentUser,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        profileUrl: profile.profileUrl,
      })
    } catch {
      setUser(currentUser)
    }
  }

  async function loginForDevelopment() {
    const session = await startDevelopmentLogin()
    setUser(session.authenticated ? session.user : null)
    return session
  }

  async function logout() {
    await logoutRequest()
    setUser(null)
  }

  useEffect(() => {
    let active = true

    async function restoreSession() {
      try {
        const session = await getAuthSession()
        if (!active) return
        if (!session.authenticated) {
          setUser(null)
        } else if (session.user.authType === 'steam') {
          try {
            const profile = await getSteamProfile()
            setUser({
              ...session.user,
              displayName: profile.displayName,
              avatarUrl: profile.avatarUrl,
              profileUrl: profile.profileUrl,
            })
          } catch {
            setUser(session.user)
          }
        } else {
          setUser(session.user)
        }
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
