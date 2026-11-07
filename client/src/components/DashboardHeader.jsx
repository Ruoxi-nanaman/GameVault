import { Bell, ExternalLink, Search, Wifi } from 'lucide-react'
import { useAuth } from '../contexts/useAuth.js'

function DashboardHeader() {
  const { user } = useAuth()
  const rawDisplayName = typeof user?.displayName === 'string'
    ? user.displayName
    : typeof user?.username === 'string'
      ? user.username
      : 'GameVault user'
  const displayName = rawDisplayName.trim() || 'GameVault user'
  const avatarUrl = user?.avatarUrl || null
  const steamProfileUrl = user?.profileUrl || (user?.steamId ? `https://steamcommunity.com/profiles/${user.steamId}` : null)

  return (
    <header className="dashboard-header">
      <label className="dashboard-search">
        <Search size={15} />
        <input type="search" aria-label="Search your vault" placeholder="Search your vault...  ⌘K" />
      </label>
      <div className="header-actions">
        <button className="sync-button" type="button"><Wifi size={14} /><span>All changes synced</span></button>
        <button className="icon-button" type="button" aria-label="Notifications"><Bell size={16} /></button>
        <div className="profile-copy">
          {avatarUrl
            ? <img className="profile-avatar profile-avatar-image" src={avatarUrl} alt="" />
            : <span className="profile-avatar">{displayName.slice(0, 2).toUpperCase()}</span>}
          <div><strong>{displayName}</strong><small>{user?.steamId ? `${user.steamId} · Steam` : 'GameVault'}</small></div>
        </div>
        {steamProfileUrl && (
          <a className="profile-link" href={steamProfileUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /><span>View Steam profile</span>
          </a>
        )}
      </div>
    </header>
  )
}

export default DashboardHeader
