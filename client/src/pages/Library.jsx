import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Grid2X2, List, RefreshCw, Search } from 'lucide-react'
import Sidebar from '../components/Sidebar.jsx'
import DashboardHeader from '../components/DashboardHeader.jsx'
import LibraryGameCard from '../components/LibraryGameCard.jsx'
import { getSteamGames, syncSteamGames } from '../services/authService.js'
import './Library.css'

function Library() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All games')
  const [sort, setSort] = useState('Recently played')
  const [platform, setPlatform] = useState('All platforms')
  const [source, setSource] = useState('All sources')
  const [view, setView] = useState('grid')
  const [page, setPage] = useState(1)
  const [games, setGames] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [syncError, setSyncError] = useState('')
  const [libraryCounts, setLibraryCounts] = useState(null)
  const syncSubmissionGuard = useRef(false)

  useEffect(() => {
    let active = true
    getSteamGames()
      .then((library) => {
        if (active) {
          setGames(library.games || [])
          setLibraryCounts(library.counts || null)
        }
      })
      .catch((error) => {
        if (active) setSyncError(error.message || 'Unable to load the synchronized library')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [])

  async function handleSync() {
    if (syncSubmissionGuard.current || isSyncing) return
    syncSubmissionGuard.current = true
    setIsSyncing(true)
    setSyncError('')
    setSyncMessage('')
    try {
      const summary = await syncSteamGames()
      const library = await getSteamGames()
      setGames(library.games || [])
      setLibraryCounts(library.counts || null)
      setSyncMessage(summary.status === 'partial'
        ? `Partial synchronization: imported or updated ${summary.gamesImportedOrUpdated || 0} games`
        : summary.message || `Imported or updated ${summary.gamesImportedOrUpdated || 0} games`)
    } catch (error) {
      setSyncError(error.message || 'Steam library synchronization failed')
    } finally {
      syncSubmissionGuard.current = false
      setIsSyncing(false)
    }
  }

  const filteredGames = useMemo(() => {
    let filtered = games.filter((game) => game.title.toLowerCase().includes(search.toLowerCase()))
    if (source !== 'All sources') {
      const sourceMatches = {
        Owned: 'owned',
        'Family shared': 'family_shared',
        'Recently played': 'recently_played_unknown',
        'Ownership unconfirmed': null,
      }
      filtered = filtered.filter((game) => {
        if (source === 'Ownership unconfirmed') {
          return game.sourceEvidence?.owned?.status !== 'confirmed'
            && game.sourceEvidence?.family_shared?.status !== 'confirmed'
        }
        return game.primaryAccessSource === sourceMatches[source]
      })
    }
    if (status !== 'All games') {
      const normalizedStatus = status === 'Playing' ? 'Currently Playing'
        : status === 'Completed' ? 'Completed'
          : status === 'Backlog' ? 'Backlog'
            : status === 'Abandoned' ? 'Abandoned'
              : status
      filtered = filtered.filter((game) => game.status === normalizedStatus)
    }
    if (sort === 'Playtime') filtered = [...filtered].sort((a, b) => b.playtime - a.playtime)
    if (sort === 'Title') filtered = [...filtered].sort((a, b) => a.title.localeCompare(b.title))
    if (sort === 'Recently played') filtered = [...filtered].sort((a, b) => {
      if (!a.lastPlayedAt) return 1
      if (!b.lastPlayedAt) return -1
      return new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt)
    })
    return filtered
  }, [games, search, status, sort, source])

  const statuses = ['All games', 'Playing', 'Completed', 'Backlog']

  return (
    <div className="dashboard-shell library-shell">
      <Sidebar />
      <div className="dashboard-main">
        <DashboardHeader />
        <main className="library-content">
          <div className="library-heading">
            <div><h1>My Library</h1><p>Every world you own. Every adventure ahead.</p></div>
            <button className="sync-library-button" type="button" onClick={handleSync} disabled={isSyncing}>
              <RefreshCw size={14} className={isSyncing ? 'sync-spinning' : ''} />
              {isSyncing ? 'Syncing…' : 'Sync library'}
            </button>
          </div>
          {syncMessage && <p className="library-sync-message" role="status">{syncMessage}</p>}
          {syncError && <p className="library-sync-error" role="alert">{syncError}</p>}

          <div className="library-tabs" role="tablist" aria-label="Game status">
            {statuses.map((item) => {
              const count = item === 'All games'
                ? games.length
                : games.filter((game) => {
                  if (item === 'Playing') return game.status === 'Currently Playing'
                  return game.status === item
                }).length
              return <button key={item} className={status === item ? 'active' : ''} type="button" role="tab" aria-selected={status === item} onClick={() => { setStatus(item); setPage(1) }}>{item}<span>{count}</span></button>
            })}
          </div>

          <div className="library-controls">
            <label className="library-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search games..." aria-label="Search games" /></label>
            <div className="library-filter-controls">
              <label><select value={status} onChange={(event) => setStatus(event.target.value)}><option>All games</option><option>Playing</option><option>Completed</option><option>Backlog</option><option>Abandoned</option></select><ChevronDown size={12} /></label>
              <label><select value={platform} onChange={(event) => setPlatform(event.target.value)} aria-label="Platform"><option>All platforms</option><option>Steam</option></select><ChevronDown size={12} /></label>
              <label><select value={source} onChange={(event) => setSource(event.target.value)} aria-label="Steam source"><option>All sources</option><option>Owned</option><option>Family shared</option><option>Recently played</option><option>Ownership unconfirmed</option></select><ChevronDown size={12} /></label>
              <label><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort games"><option>Recently played</option><option>Playtime</option><option>Title</option></select><ChevronDown size={12} /></label>
            </div>
            <div className="library-view-switch" aria-label="Library view">
              <button className={view === 'grid' ? 'active' : ''} type="button" aria-label="Grid view" onClick={() => setView('grid')}><Grid2X2 size={15} /></button>
              <button className={view === 'list' ? 'active' : ''} type="button" aria-label="List view" onClick={() => setView('list')}><List size={16} /></button>
            </div>
          </div>

          <div className="library-results-bar">
            <span>Showing {filteredGames.length} of {libraryCounts?.totalUniqueGamesRecorded ?? games.length} games</span>
            <small>Sorted by {sort.toLowerCase()}</small>
          </div>

          <section className={`library-games ${view === 'list' ? 'library-list' : ''}`} aria-label="Game library">
            {isLoading && <p className="library-empty-state">Loading synchronized games…</p>}
            {!isLoading && filteredGames.length === 0 && <p className="library-empty-state">No synchronized games found. Use Sync library to import your Steam games.</p>}
            {filteredGames.map((game) => <LibraryGameCard key={game.id} game={game} listView={view === 'list'} onOpen={(selected) => navigate(`/games/${selected.id}`)} />)}
          </section>

          <nav className="library-pagination" aria-label="Library pagination">
            <button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
            {[1, 2, 3].map((number) => <button key={number} className={page === number ? 'active' : ''} type="button" onClick={() => setPage(number)}>{number}</button>)}
            <button className="pagination-next" type="button" onClick={() => setPage((value) => Math.min(3, value + 1))}>Next</button>
          </nav>
        </main>
      </div>
    </div>
  )
}

export default Library
