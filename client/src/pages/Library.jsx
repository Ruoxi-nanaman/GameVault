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
  const pageSize = 11
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
    let result = games.filter((game) => game.title.toLowerCase().includes(search.toLowerCase()))
    
    // 1. Filter by Source
    if (source !== 'All sources') {
      const sourceMatches = {
        Owned: 'owned',
        'Family shared': 'family_shared',
        'Recently played': 'recently_played_unknown',
        'Ownership unconfirmed': null,
      }
      result = result.filter((game) => {
        if (source === 'Ownership unconfirmed') {
          return game.sourceEvidence?.owned?.status !== 'confirmed'
            && game.sourceEvidence?.family_shared?.status !== 'confirmed'
        }
        return game.primaryAccessSource === sourceMatches[source]
      })
    }

    // 2. Filter by Status
    if (status !== 'All games') {
      const normalizedStatus = status === 'Playing' ? 'Currently Playing'
        : status === 'Completed' ? 'Completed'
          : status === 'Backlog' ? 'Backlog'
            : status === 'Abandoned' ? 'Abandoned'
              : status
      result = result.filter((game) => game.status === normalizedStatus)
    }

    // 3. Alphabetical Sort (Default / Pre-sort)
    if (sort === 'Playtime') {
      result = [...result].sort((a, b) => (b.playtimeMinutes || 0) - (a.playtimeMinutes || 0))
    } else if (sort === 'Recently played') {
      result = [...result].sort((a, b) => {
        if (!a.lastPlayedAt) return 1
        if (!b.lastPlayedAt) return -1
        return new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt)
      })
    } else {
      // Default to Title (Alphabetical A-Z)
      result = [...result].sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { numeric: true, sensitivity: 'base' }))
    }
    
    return result
  }, [games, search, status, sort, source])

  // Reset page to 1 when search or filters change
  useEffect(() => {
    setPage(1)
  }, [search, status, platform, source, sort])

  const totalPages = Math.ceil(filteredGames.length / pageSize) || 1
  
  // Clamp page to valid range if filtering reduces result set
  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [totalPages, page])

  const paginatedGames = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredGames.slice(start, start + pageSize)
  }, [filteredGames, page, pageSize])

  const renderPagination = () => {
    if (totalPages <= 1) return null

    return (
      <div className="library-pagination-card">
        <div className="pagination-info">
          <strong>Page {page}</strong>
          <span>of {totalPages}</span>
        </div>
        <div className="pagination-pages">
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(p => {
              return p === 1 || p === totalPages || Math.abs(p - page) <= 1
            })
            .map((p, index, array) => (
              <span key={p} style={{ display: 'flex', alignItems: 'center' }}>
                {index > 0 && array[index - 1] !== p - 1 && (
                  <span className="pagination-ellipsis">...</span>
                )}
                <button 
                  type="button" 
                  className={page === p ? 'active' : ''} 
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              </span>
            ))}
        </div>
        <div className="pagination-controls">
          <button 
            type="button" 
            disabled={page === 1} 
            onClick={() => setPage(Math.max(1, page - 1))}
          >
            Previous
          </button>
          <button 
            type="button" 
            disabled={page === totalPages} 
            onClick={() => setPage(Math.min(totalPages, page + 1))}
          >
            Next
          </button>
        </div>
      </div>
    )
  }

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
            <span>
              Showing {filteredGames.length > 0 ? (page - 1) * pageSize + 1 : 0}–
              {Math.min(page * pageSize, filteredGames.length)} of {filteredGames.length} games
            </span>
            <small>Sorted by {sort.toLowerCase()}</small>
          </div>

          <section className={`library-games ${view === 'list' ? 'library-list' : ''}`} aria-label="Game library">
            {isLoading && <p className="library-empty-state">Loading synchronized games…</p>}
            {!isLoading && filteredGames.length === 0 && <p className="library-empty-state">No synchronized games found. Use Sync library to import your Steam games.</p>}
            {paginatedGames.map((game) => <LibraryGameCard key={game.id} game={game} listView={view === 'list'} onOpen={(selected) => navigate(`/games/${selected.id}`)} />)}
            {view === 'grid' && renderPagination()}
          </section>

          {view === 'list' && renderPagination()}
        </main>
      </div>
    </div>
  )
}

export default Library
