import { CheckCircle2, Clock3, Gamepad2, Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import DashboardHeader from '../components/DashboardHeader.jsx'
import StatCard from '../components/StatCard.jsx'
import GameCard from '../components/GameCard.jsx'
import GamingActivity from '../components/GamingActivity.jsx'
import { backlogGames } from '../data/dashboardData.js'
import { libraryGames } from '../data/libraryData.js'
import { useAuth } from '../contexts/useAuth.js'
import { getSteamGames, getAchievementSummary } from '../services/authService.js'

function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [ownedGames, setOwnedGames] = useState([])
  const [gamesLoadError, setGamesLoadError] = useState('')
  const [libraryCounts, setLibraryCounts] = useState(null)
  const [achievementStats, setAchievementStats] = useState(null)
  const [isStatsLoading, setIsStatsLoading] = useState(true)

  useEffect(() => {
    let active = true
    getSteamGames()
      .then((library) => {
        if (active) {
          setOwnedGames(library.games || [])
          setLibraryCounts(library.counts || null)
        }
      })
      .catch((error) => {
        if (active) setGamesLoadError(error.message || 'Unable to load synchronized games')
      })
    
    getAchievementSummary()
      .then((stats) => {
        if (active) {
          setAchievementStats(stats)
        }
      })
      .catch(() => {
        // Silently fail or handle error - stats will remain null
      })
      .finally(() => {
        if (active) setIsStatsLoading(false)
      })

    return () => { active = false }
  }, [])
  const rawDisplayName = typeof user?.displayName === 'string'
    ? user.displayName
    : typeof user?.username === 'string'
      ? user.username
      : 'GameVault user'
  const displayName = rawDisplayName.trim() || 'GameVault user'
  const avatarUrl = typeof user?.avatarUrl === 'string' && user.avatarUrl.trim() ? user.avatarUrl : null
  const steamProfileUrl = typeof user?.profileUrl === 'string'
    ? user.profileUrl
    : user?.steamId
      ? `https://steamcommunity.com/profiles/${user.steamId}`
      : null
  const firstName = displayName.split(/\s+/)[0] || displayName
  const openGame = (game) => {
    const match = libraryGames.find((item) => item.title.toLowerCase() === game.title.toLowerCase())
    navigate(match ? `/games/${match.id}` : `/games/${game.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
  }

  const stats = [
    { label: 'Total games', value: String(libraryCounts?.totalUniqueGamesRecorded ?? ownedGames.length), detail: 'unique games recorded in your library', icon: Gamepad2 },
    { label: 'Total playtime', value: ownedGames.reduce((sum, game) => sum + (game.playtimeMinutes || 0), 0) > 0
      ? (ownedGames.reduce((sum, game) => sum + (game.playtimeMinutes || 0), 0) / 60).toFixed(1)
      : '0', detail: 'hours across your library', icon: Clock3 },
    { 
      label: 'Achievements unlocked', 
      value: isStatsLoading ? '—' : (achievementStats?.totalUnlocked?.toLocaleString() ?? '0'), 
      detail: isStatsLoading ? 'Synchronizing stats...' : 'total achievements unlocked', 
      icon: Trophy 
    },
    { 
      label: 'Perfect Games', 
      value: isStatsLoading ? '—' : (achievementStats?.perfectGames?.toLocaleString() ?? '0'), 
      detail: isStatsLoading ? 'Synchronizing stats...' : '100% achievement completion', 
      icon: CheckCircle2 
    },
  ]

  return (
    <div className="dashboard-shell">
      <Sidebar />
      <div className="dashboard-main">
        <DashboardHeader />
        <main className="dashboard-content">
          <div className="dashboard-welcome">
            <div>
              <h1>Welcome back, {firstName}</h1>
              <p>Your next adventure is right where you left it</p>
            </div>
            {steamProfileUrl && (
              <a className="steam-profile-button" href={steamProfileUrl} target="_blank" rel="noreferrer">View Steam profile</a>
            )}
          </div>

          <div className="profile-status">
            {avatarUrl
              ? <img className="profile-avatar profile-avatar-image" src={avatarUrl} alt="" />
              : <span className="profile-avatar">{displayName.slice(0, 2).toUpperCase()}</span>}
            <div><strong>{displayName}</strong><small>{user?.steamId ? `${user.steamId} · Steam` : 'GameVault'}</small></div>
            <span className="online-status"><i />Online</span>
          </div>

          <section className="stats-grid" aria-label="Gaming statistics">
            {stats.map((stat) => <StatCard key={stat.label} {...stat} />)}
          </section>

          {gamesLoadError && <p className="dashboard-sync-error" role="alert">{gamesLoadError}</p>}
          <section className="recent-section">
            <div className="section-heading"><h2>Recently played</h2><button type="button" onClick={() => navigate('/library')}>View library →</button></div>
            <div className="recent-games-grid">
              {ownedGames
                .filter((game) => game.sourceEvidence?.recently_played?.status === 'confirmed')
                .sort((a, b) => new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt))
                .slice(0, 3)
                .map((game) => (
                  <GameCard
                    key={game.id}
                    game={{ 
                      ...game, 
                      subtitle: game.sourceEvidence?.recently_played?.recentPlaytimeMinutes 
                        ? `${game.sourceEvidence.recently_played.recentPlaytimeMinutes} min recently` 
                        : `${game.playtimeMinutes || 0} min total`, 
                      lastPlayed: game.lastPlayedAt ? new Date(game.lastPlayedAt).toLocaleDateString() : 'Not played' 
                    }}
                    onOpen={(selected) => navigate(`/games/${selected.id}`)}
                  />
                ))}
              {!ownedGames.some((game) => game.sourceEvidence?.recently_played?.status === 'confirmed') && !gamesLoadError && (
                <p className="dashboard-empty-library">No recently played Steam games yet.</p>
              )}
            </div>
          </section>

          <div className="dashboard-bottom">
            <GamingActivity />
            <section className="backlog-card dashboard-panel">
              <div className="panel-heading"><div><strong>Up next</strong><span>2.8 hr backlog</span></div><button type="button">View all</button></div>
              <div className="backlog-list">{backlogGames.map((game) => <GameCard key={game.title} game={game} compact onOpen={openGame} />)}</div>
              <p className="backlog-tip">A new world is waiting. Make time for it.</p>
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}

export default Dashboard
