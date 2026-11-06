import { useMemo, useState } from 'react'
import { ChevronDown, Search, Trophy } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import DashboardHeader from '../components/DashboardHeader.jsx'
import AchievementCard from '../components/AchievementCard.jsx'
import { achievementGames, achievements } from '../data/achievementData.js'
import './Achievements.css'

function Achievements() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [gameId, setGameId] = useState('all')
  const [status, setStatus] = useState('All')
  const [sort, setSort] = useState('Recently unlocked')
  const [selectedGameId, setSelectedGameId] = useState(1)

  const visibleAchievements = useMemo(() => {
    let result = achievements.filter((item) => {
      const matchesSearch = `${item.title} ${item.description}`.toLowerCase().includes(search.toLowerCase())
      const matchesGame = gameId === 'all' || String(item.gameId) === gameId
      const matchesStatus = status === 'All' || (status === 'Unlocked' ? item.unlocked : !item.unlocked)
      return matchesSearch && matchesGame && matchesStatus
    })
    if (sort === 'Rarity') result = [...result].sort((a, b) => b.rarity - a.rarity)
    if (sort === 'Title') result = [...result].sort((a, b) => a.title.localeCompare(b.title))
    return result
  }, [search, gameId, status, sort])

  const selectedGame = achievementGames.find((game) => game.id === selectedGameId) ?? achievementGames[0]
  const completion = selectedGame.total ? Math.round((selectedGame.achievements / selectedGame.total) * 100) : 0
  const unlockedCount = achievements.filter((item) => item.unlocked).length

  return (
    <div className="dashboard-shell achievements-shell">
      <Sidebar />
      <div className="dashboard-main">
        <DashboardHeader />
        <main className="achievements-content">
          <div className="achievements-heading"><div><h1>Achievements</h1><p>Small victories. Legendary milestones.</p></div><button type="button" className="recent-unlocked"><span />Recently unlocked</button></div>

          <section className="achievement-stats" aria-label="Achievement statistics">
            <article><div><span>Achievements unlocked</span><Trophy size={15} /></div><strong>1,842</strong><small>42.0% of 4,391 games</small></article>
            <article><div><span>Overall completion</span><Trophy size={15} /></div><strong>55.5%</strong><small>Based on 3,240 achievements</small></article>
            <article><div><span>Perfect games</span><Trophy size={15} /></div><strong>18</strong><small>100% completion in games</small></article>
            <article><div><span>Unlocked this month</span><Trophy size={15} /></div><strong>36</strong><small>8 more than last month</small></article>
          </section>

          <div className="achievements-layout">
            <aside className="achievement-games-panel">
              <h2>Your games</h2>
              <label className="achievement-game-search"><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a game" aria-label="Search achievements or games" /></label>
              <div className="achievement-game-list">
                {achievementGames.map((game) => (
                  <button key={game.id} type="button" className={selectedGameId === game.id ? 'active' : ''} onClick={() => { setSelectedGameId(game.id); setGameId(String(game.id)) }}>
                    <img src={game.cover} alt="" /><span><strong>{game.title}</strong><small>{Math.round((game.achievements / game.total) * 100)}% complete</small></span>
                  </button>
                ))}
              </div>
              <button className="achievement-show-more" type="button" onClick={() => setGameId('all')}>Show all 248 games →</button>
            </aside>

            <section className="achievement-list-panel">
              <div className="selected-game-summary">
                <img src={selectedGame.cover} alt="" />
                <div><strong>{selectedGame.title}</strong><small>{selectedGame.achievements} of {selectedGame.total} achievements unlocked</small><div className="selected-game-progress"><span style={{ width: `${completion}%` }} /></div></div>
                <strong className="selected-game-percent">{completion}%</strong>
              </div>
              <div className="achievement-controls">
                {['All', 'Unlocked', 'Locked'].map((item) => <button key={item} type="button" className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{item === 'All' ? `All ${achievements.length * 30}` : item === 'Unlocked' ? `Unlocked ${unlockedCount}` : `Locked ${achievements.length - unlockedCount}`}</button>)}
                <label><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort achievements"><option>Recently unlocked</option><option>Rarity</option><option>Title</option></select><ChevronDown size={12} /></label>
              </div>
              <div className="achievement-list">
                {visibleAchievements.map((achievement) => <AchievementCard key={achievement.id} achievement={achievement} onOpen={(id) => navigate(`/games/${id}`)} />)}
                {visibleAchievements.length === 0 && <div className="achievement-empty">No achievements match your filters.</div>}
              </div>
              <div className="achievement-results">Showing 6 of 42 achievements · Progress syncs automatically with Steam</div>
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}

export default Achievements
