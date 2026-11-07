import { useMemo, useState, useEffect, useCallback } from 'react'
import { ChevronDown, Search, Trophy, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import DashboardHeader from '../components/DashboardHeader.jsx'
import AchievementCard from '../components/AchievementCard.jsx'
import { getLibraryAchievements, syncAllAchievements } from '../services/authService.js'
import './Achievements.css'

function Achievements() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('All')
  const [sortOrder, setSortOrder] = useState('Recently unlocked')
  const [selectedGameId, setSelectedGameId] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [currentGamePage, setCurrentGamePage] = useState(1)
  const pageSize = 20
  const gamePageSize = 18
  
  const [data, setData] = useState({ games: [], achievements: [], stats: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [syncing, setSyncing] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getLibraryAchievements()
      setData(result)
    } catch (err) {
      setError(err.message || 'Failed to retrieve achievements')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData()
  }, [fetchData])

  const handleSync = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      await syncAllAchievements()
      await fetchData()
    } catch (err) {
      setError(err.message || 'Synchronization failed')
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentPage(1)
  }, [search, selectedGameId, filterStatus, sortOrder])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentGamePage(1)
  }, [search])

  const sortedGames = useMemo(() => {
    const filtered = data.games.filter(g => 
      g.title?.toLowerCase().includes(search.toLowerCase())
    )
    return [...filtered].sort((a, b) => 
      (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase())
    )
  }, [data.games, search])

  const paginatedGames = useMemo(() => {
    const startIndex = (currentGamePage - 1) * gamePageSize
    return sortedGames.slice(startIndex, startIndex + gamePageSize)
  }, [sortedGames, currentGamePage, gamePageSize])

  const totalGamePages = Math.ceil(sortedGames.length / gamePageSize) || 1

  const visibleAchievements = useMemo(() => {
    let result = data.achievements.filter((item) => {
      const matchesSearch = `${item.title} ${item.description}`.toLowerCase().includes(search.toLowerCase())
      const matchesGame = selectedGameId === 'all' || item.gameId === selectedGameId
      
      let matchesStatus = true
      if (filterStatus === 'Unlocked') matchesStatus = item.progressState === 'unlocked'
      if (filterStatus === 'Locked') matchesStatus = item.progressState === 'locked'
      
      return matchesSearch && matchesGame && matchesStatus
    })

    if (sortOrder === 'Title') {
      result = [...result].sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    } else if (sortOrder === 'Recently unlocked') {
      result = [...result].sort((a, b) => {
        if (!a.unlockedAt) return 1
        if (!b.unlockedAt) return -1
        return new Date(b.unlockedAt) - new Date(a.unlockedAt)
      })
    }
    return result
  }, [data.achievements, search, selectedGameId, filterStatus, sortOrder])

  const paginatedAchievements = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize
    return visibleAchievements.slice(startIndex, startIndex + pageSize)
  }, [visibleAchievements, currentPage, pageSize])

  const totalPages = Math.ceil(visibleAchievements.length / pageSize) || 1

  // Function to render pagination controls
  const renderPagination = (currentPage, totalPages, onPageChange) => {
    if (totalPages <= 1) return null

    return (
      <div className="achievement-pagination">
        <button 
          type="button" 
          disabled={currentPage === 1} 
          onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
        >
          Previous
        </button>
        <div className="pagination-pages">
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(page => {
              return page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1
            })
            .map((page, index, array) => (
              <span key={page} style={{ display: 'flex', alignItems: 'center' }}>
                {index > 0 && array[index - 1] !== page - 1 && (
                  <span className="pagination-ellipsis">...</span>
                )}
                <button 
                  type="button" 
                  className={currentPage === page ? 'active' : ''} 
                  onClick={() => onPageChange(page)}
                >
                  {page}
                </button>
              </span>
            ))}
        </div>
        <button 
          type="button" 
          disabled={currentPage === totalPages} 
          onClick={() => onPageChange(Math.min(currentPage + 1, totalPages))}
        >
          Next
        </button>
      </div>
    )
  }

  const selectedGame = useMemo(() => {
    if (selectedGameId === 'all') return null
    return data.games.find((g) => g.gameId === selectedGameId)
  }, [data.games, selectedGameId])

  const stats = data.stats || {}
  
  if (loading && !data.games.length) {
    return (
      <div className="dashboard-shell achievements-shell">
        <Sidebar />
        <div className="dashboard-main">
          <DashboardHeader />
          <div className="achievement-empty" style={{ height: '80vh' }}>
            <Loader2 className="animate-spin" size={32} />
            <p style={{ marginTop: 16 }}>Retrieving your legendary milestones...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error && !data.games.length) {
    return (
      <div className="dashboard-shell achievements-shell">
        <Sidebar />
        <div className="dashboard-main">
          <DashboardHeader />
          <div className="achievement-empty" style={{ height: '80vh' }}>
            <AlertCircle size={32} color="#e06c75" />
            <p style={{ marginTop: 16 }}>{error}</p>
            <button className="recent-unlocked" style={{ marginTop: 16 }} onClick={fetchData}>Retry</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard-shell achievements-shell">
      <Sidebar />
      <div className="dashboard-main">
        <DashboardHeader />
        <main className="achievements-content">
          <div className="achievements-heading">
            <div>
              <h1>Achievements</h1>
              <p>Small victories. Legendary milestones.</p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button 
                type="button" 
                className="recent-unlocked" 
                onClick={handleSync}
                disabled={syncing}
              >
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Syncing...' : 'Sync Achievements'}
              </button>
            </div>
          </div>

          <section className="achievement-stats" aria-label="Achievement statistics">
            <article>
              <div><span>Achievements unlocked</span><Trophy size={15} /></div>
              <strong>{stats.totalUnlocked?.toLocaleString() || 0}</strong>
              <small>{stats.gamesWithAchievements || 0} games with achievements</small>
            </article>
            <article>
              <div><span>Overall completion</span><Trophy size={15} /></div>
              <strong>{stats.overallCompletionPercentage != null ? `${stats.overallCompletionPercentage}%` : '--'}</strong>
              <small>Across {stats.totalAchievements || 0} known achievements</small>
            </article>
            <article>
              <div><span>Perfect games</span><Trophy size={15} /></div>
              <strong>{stats.perfectGames || 0}</strong>
              <small>100% completion verified</small>
            </article>
            <article>
              <div><span>Unlocked this month</span><Trophy size={15} /></div>
              <strong>{stats.unlockedThisMonth || 0}</strong>
              <small>Confirmed in current UTC month</small>
            </article>
          </section>

          <div className="achievements-layout">
            <aside className="achievement-games-panel">
              <h2>Your games</h2>
              <label className="achievement-game-search">
                <Search size={13} />
                <input 
                  value={search} 
                  onChange={(event) => setSearch(event.target.value)} 
                  placeholder="Find a game" 
                  aria-label="Search achievements or games" 
                />
              </label>
              <div className="achievement-game-list">
                <button 
                  type="button" 
                  className={selectedGameId === 'all' ? 'active' : ''} 
                  onClick={() => setSelectedGameId('all')}
                >
                  <div className="achievement-row-icon" style={{ borderRadius: 4 }}>
                    <Trophy size={20} />
                  </div>
                  <span>
                    <strong>All Games</strong>
                    <small>{data.achievements.length} total achievements</small>
                  </span>
                </button>
                {paginatedGames.map((game) => (
                  <button 
                    key={game.gameId} 
                    type="button" 
                    className={selectedGameId === game.gameId ? 'active' : ''} 
                    onClick={() => setSelectedGameId(game.gameId)}
                  >
                    <img src={game.coverImage} alt="" onError={(e) => { e.target.src = '/favicon.svg' }} />
                    <span>
                      <strong>{game.title}</strong>
                      <small>
                        {game.schemaState === 'no_achievements' ? 'No achievements' :
                         game.schemaState === null ? 'Sync required' :
                         `${game.unlockedAchievements} of ${game.totalAchievements}`}
                      </small>
                    </span>
                  </button>
                ))}
                {sortedGames.length === 0 && (
                  <div className="achievement-empty">
                    No games match your search.
                  </div>
                )}
              </div>
              
              {renderPagination(currentGamePage, totalGamePages, setCurrentGamePage)}
              
              <div className="achievement-results">
                Page {currentGamePage} of {totalGamePages}
              </div>
            </aside>

            <section className="achievement-list-panel">
              {selectedGame && (
                <div className="selected-game-summary">
                  <img src={selectedGame.coverImage} alt="" onError={(e) => { e.target.src = '/favicon.svg' }} />
                  <div>
                    <strong>{selectedGame.title}</strong>
                    <small>
                      {selectedGame.schemaState === 'no_achievements' ? 'This game does not support achievements.' :
                       selectedGame.schemaState === null ? 'Achievement data hasn\'t been synchronized for this game yet.' :
                       `${selectedGame.unlockedAchievements} of ${selectedGame.totalAchievements} unlocked`}
                    </small>
                    {selectedGame.totalAchievements > 0 && (
                      <div className="selected-game-progress">
                        <span style={{ width: `${selectedGame.completionPercentage || 0}%` }} />
                      </div>
                    )}
                  </div>
                  <strong className="selected-game-percent">
                    {selectedGame.completionPercentage != null ? `${selectedGame.completionPercentage}%` : '--'}
                  </strong>
                </div>
              )}
              
              <div className="achievement-controls">
                {['All', 'Unlocked', 'Locked'].map((item) => (
                  <button 
                    key={item} 
                    type="button" 
                    className={filterStatus === item ? 'active' : ''} 
                    onClick={() => setFilterStatus(item)}
                  >
                    {item}
                  </button>
                ))}
                <label style={{ display: 'flex' }}>
                  <select 
                    value={sortOrder} 
                    onChange={(event) => setSortOrder(event.target.value)} 
                    aria-label="Sort achievements"
                  >
                    <option>Recently unlocked</option>
                    <option>Title</option>
                  </select>
                  <ChevronDown size={12} />
                </label>
              </div>

              <div className="achievement-list">
                {paginatedAchievements.map((achievement) => (
                  <AchievementCard 
                    key={achievement.id} 
                    achievement={achievement} 
                    onOpen={(id) => navigate(`/games/${id}`)} 
                  />
                ))}
                {visibleAchievements.length === 0 && (
                  <div className="achievement-empty">
                    {selectedGame?.schemaState === null ? 'Sync required to view achievements.' : 
                     selectedGame?.schemaState === 'no_achievements' ? 'No achievements found for this game.' :
                     'No achievements match your filters.'}
                  </div>
                )}
              </div>

              {renderPagination(currentPage, totalPages, setCurrentPage)}

              <div className="achievement-results">
                {visibleAchievements.length > 0 && (
                  <span>
                    Showing {Math.min((currentPage - 1) * pageSize + 1, visibleAchievements.length)}–
                    {Math.min(currentPage * pageSize, visibleAchievements.length)} of {visibleAchievements.length} achievements
                  </span>
                )}
                {visibleAchievements.length === 0 && <span>No achievements match your filters.</span>}
                {' '}· Page {currentPage} of {totalPages} · Progress syncs with Steam on request
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}

export default Achievements
