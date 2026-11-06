import { useMemo, useState } from 'react'
import { CalendarDays, Clock3, Gamepad2, Timer, Trophy } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import DashboardHeader from '../components/DashboardHeader.jsx'
import StatCard from '../components/StatCard.jsx'
import ActivityChart from '../components/ActivityChart.jsx'
import { monthlyPlaytime, yearlyPlaytime, mostPlayedGames, favoriteGenres, novemberSnapshot, statisticsOverview } from '../data/statisticsData.js'
import { formatHours } from '../utils/statisticsCalculations.js'
import './Statistics.css'

function Statistics() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState('Monthly')
  const [year, setYear] = useState('2026')
  const chartData = period === 'Monthly' ? monthlyPlaytime : yearlyPlaytime
  const displayedPlaytime = useMemo(() => year === '2026' ? statisticsOverview.playedThisYear : statisticsOverview.playedThisYear, [year])

  const cards = [
    { label: 'Lifetime playtime', value: formatHours(statisticsOverview.totalPlaytime), detail: 'Across 248 games', icon: Clock3 },
    { label: 'Played this year', value: formatHours(statisticsOverview.playedThisYear), detail: 'For 2025 to this point', icon: Gamepad2 },
    { label: 'Games played this year', value: String(statisticsOverview.gamesPlayed), detail: 'Games in 2025', icon: Trophy },
    { label: 'Average session', value: `${statisticsOverview.averageSession.toFixed(1)} hrs`, detail: 'Across completed sessions', icon: Timer },
  ]

  return (
    <div className="dashboard-shell statistics-shell">
      <Sidebar />
      <div className="dashboard-main">
        <DashboardHeader />
        <main className="statistics-content">
          <div className="statistics-heading">
            <div><h1>Your gaming, in perspective</h1><p>A little insight into the time well spent.</p></div>
            <label className="year-select"><CalendarDays size={14} /><select value={year} onChange={(event) => setYear(event.target.value)} aria-label="Statistics year"><option>2026</option><option>2025</option><option>2024</option></select></label>
          </div>

          <section className="statistics-cards" aria-label="Gaming statistics">
            {cards.map((card) => <StatCard key={card.label} {...card} />)}
          </section>

          <section className="statistics-middle">
            <article className="statistics-panel activity-panel">
              <div className="statistics-panel-heading"><div><h2>Playtime activity</h2><strong>{displayedPlaytime.toFixed(1)} <small>hours this year</small></strong></div><div className="period-toggle"><button type="button" className={period === 'Monthly' ? 'active' : ''} onClick={() => setPeriod('Monthly')}>Monthly</button><button type="button" className={period === 'Yearly' ? 'active' : ''} onClick={() => setPeriod('Yearly')}>Yearly</button></div></div>
              <ActivityChart data={chartData} />
            </article>

            <article className="statistics-panel november-panel">
              <h2>November so far</h2>
              <strong>{novemberSnapshot.playtime.toFixed(1)} hrs</strong>
              <small>▲ {novemberSnapshot.change.toFixed(1)} hrs vs. this time last month</small>
              <dl><div><dt>Achievements unlocked</dt><dd>{novemberSnapshot.achievementsUnlocked}</dd></div><div><dt>Games completed</dt><dd>{novemberSnapshot.gamesCompleted}</dd></div><div><dt>Most active day</dt><dd>{novemberSnapshot.activeDay}</dd></div></dl>
            </article>
          </section>

          <section className="statistics-bottom">
            <article className="statistics-panel most-played-panel">
              <div className="statistics-panel-heading"><h2>Most played games <span>All time</span></h2></div>
              <div className="most-played-table">
                <div className="most-played-head"><span>Game</span><span>Playtime</span><span>Status</span></div>
                {mostPlayedGames.map((game, index) => (
                  <button key={game.id} type="button" className="most-played-row" onClick={() => navigate(`/games/${game.id}`)}>
                    <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                    <img src={game.cover} alt="" />
                    <span className="played-game-copy"><strong>{game.title}</strong><small>Action RPG</small></span>
                    <span className="played-time">{formatHours(game.playtime)}</span>
                    <span className={`played-status ${game.status.toLowerCase()}`}><i />{game.status}</span>
                  </button>
                ))}
              </div>
            </article>

            <article className="statistics-panel genres-panel">
              <h2>Your favorite genres <span>By hours played</span></h2>
              <div className="genre-list">
                {favoriteGenres.map((genre) => (
                  <div className="genre-row" key={genre.name}><div><span>{genre.name}</span><strong>{genre.percentage}%</strong></div><div className="genre-track"><span style={{ width: `${genre.percentage}%` }} /></div></div>
                ))}
              </div>
              <div className="genre-footer"><span>ⓘ</span>View explore or browse genre list.</div>
            </article>
          </section>
        </main>
      </div>
    </div>
  )
}

export default Statistics
