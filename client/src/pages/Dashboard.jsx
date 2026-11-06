import { CheckCircle2, Clock3, Gamepad2, Trophy } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import DashboardHeader from '../components/DashboardHeader.jsx'
import StatCard from '../components/StatCard.jsx'
import GameCard from '../components/GameCard.jsx'
import GamingActivity from '../components/GamingActivity.jsx'
import { recentGames, backlogGames } from '../data/dashboardData.js'
import { libraryGames } from '../data/libraryData.js'

function Dashboard() {
  const navigate = useNavigate()
  const openGame = (game) => {
    const match = libraryGames.find((item) => item.title.toLowerCase() === game.title.toLowerCase())
    navigate(match ? `/games/${match.id}` : `/games/${game.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
  }

  const stats = [
    { label: 'Total games', value: '248', detail: '+5 this month', icon: Gamepad2 },
    { label: 'Total playtime', value: '1,284', detail: 'hours across your library', icon: Clock3 },
    { label: 'Achievements unlocked', value: '1,842', detail: 'of 3,240 achievements', icon: Trophy },
    { label: 'Games completed', value: '42', detail: '17% of your library', icon: CheckCircle2 },
  ]

  return (
    <div className="dashboard-shell">
      <Sidebar />
      <div className="dashboard-main">
        <DashboardHeader />
        <main className="dashboard-content">
          <div className="dashboard-welcome">
            <div>
              <h1>Welcome back, Ruoxi</h1>
              <p>Your next adventure is right where you left it</p>
            </div>
            <button className="steam-profile-button" type="button">View Steam profile</button>
          </div>

          <div className="profile-status">
            <span className="profile-avatar">AM</span>
            <div><strong>Ruo xi</strong><small>Steam level 42 · Member since 2016</small></div>
            <span className="online-status"><i />Online</span>
          </div>

          <section className="stats-grid" aria-label="Gaming statistics">
            {stats.map((stat) => <StatCard key={stat.label} {...stat} />)}
          </section>

          <section className="recent-section">
            <div className="section-heading"><h2>Recently played</h2><button type="button">View library →</button></div>
            <div className="recent-games-grid">{recentGames.map((game) => <GameCard key={game.title} game={game} onOpen={openGame} />)}</div>
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
