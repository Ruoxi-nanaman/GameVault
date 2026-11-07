import { useEffect, useState } from 'react'
import GameVaultLogo from '../components/GameVaultLogo.jsx'
import SteamIcon from '../components/SteamIcon.jsx'
import { startSteamLogin } from '../services/authService.js'
import { useAuth } from '../contexts/useAuth.js'
import { useNavigate } from 'react-router-dom'

function LoginPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState(() => new URLSearchParams(window.location.search).get('error') || '')
  const { loginForDevelopment, user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true })
  }, [user, navigate])

  async function handleDevelopmentLogin() {
    setIsLoading(true)
    setMessage('')
    try {
      await loginForDevelopment()
      navigate('/dashboard')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSteamLogin() {
    setIsLoading(true)
    setMessage('')

    try {
      await startSteamLogin()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="login-page">
      <div className="login-glow login-glow-left" aria-hidden="true" />
      <div className="login-glow login-glow-right" aria-hidden="true" />

      <section className="login-card" aria-labelledby="login-title">
        <GameVaultLogo />
        <div className="login-divider" />
        <div className="login-content">
          <h1 id="login-title">Welcome to GameVault</h1>
          <p className="login-subtitle">Your games. Your progress. Your collection.</p>

          <button
            className="steam-button"
            type="button"
            onClick={handleSteamLogin}
            disabled={isLoading}
          >
            <SteamIcon />
            <span>{isLoading ? 'Connecting…' : 'Sign in through Steam'}</span>
          </button>

          {message && (
            <p className="login-message" role="alert" aria-live="polite">
              {message}
            </p>
          )}

          {import.meta.env.DEV && !user && (
            <button
              className="development-login-button"
              type="button"
              onClick={handleDevelopmentLogin}
              disabled={isLoading}
            >
              Development test sign-in (no Steam account)
            </button>
          )}

          <p className="login-support">
            Connect your Steam account to import your library and start tracking your gaming progress.
          </p>
        </div>
      </section>

      <p className="login-disclaimer">
        GameVault is an independent project and is not affiliated with or endorsed by Valve Corporation.
      </p>
    </main>
  )
}

export default LoginPage
