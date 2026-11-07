import { useRef, useState } from 'react'
import { LogOut, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import DashboardHeader from '../components/DashboardHeader.jsx'
import { useAuth } from '../contexts/useAuth.js'
import './Settings.css'

function Settings() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const logoutInProgress = useRef(false)

  async function handleLogout() {
    if (logoutInProgress.current) return

    logoutInProgress.current = true
    setIsLoggingOut(true)
    setLogoutError('')
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch (error) {
      setLogoutError(error.message || 'GameVault could not log you out. Please try again.')
    } finally {
      logoutInProgress.current = false
      setIsLoggingOut(false)
      setShowLogoutDialog(false)
    }
  }

  const rawDisplayName = typeof user?.displayName === 'string'
    ? user.displayName
    : typeof user?.username === 'string'
      ? user.username
      : 'GameVault user'
  const displayName = rawDisplayName.trim() || 'GameVault user'
  const steamId = user?.steamId || null
  const avatarUrl = user?.avatarUrl || null
  const accountType = user?.authType === 'steam' ? 'Steam account' : user?.authType === 'development' ? 'Development account' : 'GameVault account'

  return (
    <div className="dashboard-shell settings-shell">
      <Sidebar />
      <div className="dashboard-main">
        <DashboardHeader />
        <main className="settings-content">
          <div className="settings-heading">
            <div>
              <h1>Settings</h1>
              <p>Manage your GameVault account and session.</p>
            </div>
          </div>

          <section className="settings-panel account-panel" aria-labelledby="account-heading">
            <div className="settings-panel-heading">
              <div className="settings-panel-icon">
                {avatarUrl
                  ? <img className="account-avatar-image" src={avatarUrl} alt={`${displayName} Steam avatar`} />
                  : <UserRound size={18} />}
              </div>
              <div>
                <h2 id="account-heading">Account</h2>
                <p>Your current GameVault session.</p>
              </div>
            </div>

            <dl className="account-details">
              <div>
                <dt>Display name</dt>
                <dd>{displayName}</dd>
              </div>
              <div>
                <dt>Steam account</dt>
                <dd>{steamId || 'Not connected'}</dd>
              </div>
              <div>
                <dt>Sign-in method</dt>
                <dd>{accountType}</dd>
              </div>
            </dl>

            {logoutError && (
              <p className="logout-error" role="alert" aria-live="polite">{logoutError}</p>
            )}

            <div className="account-actions">
              <button
                className="logout-button"
                type="button"
                onClick={() => setShowLogoutDialog(true)}
                disabled={isLoggingOut}
              >
                <LogOut size={16} />
                <span>Log out</span>
              </button>
            </div>
          </section>
        </main>
      </div>

      {showLogoutDialog && (
        <div className="logout-dialog-backdrop" role="presentation">
          <section
            className="logout-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-dialog-title"
            aria-describedby="logout-dialog-message"
          >
            <h2 id="logout-dialog-title">Log out of GameVault?</h2>
            <p id="logout-dialog-message">Are you sure you want to log out of your account?</p>
            <div className="logout-dialog-actions">
              <button
                className="logout-cancel-button"
                type="button"
                onClick={() => setShowLogoutDialog(false)}
                disabled={isLoggingOut}
              >
                Cancel
              </button>
              <button
                className="logout-confirm-button"
                type="button"
                onClick={handleLogout}
                disabled={isLoggingOut}
              >
                {isLoggingOut ? 'Logging out…' : 'Log out'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default Settings
