import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Grid2X2, List, RefreshCw, Search } from 'lucide-react'
import Sidebar from '../components/Sidebar.jsx'
import DashboardHeader from '../components/DashboardHeader.jsx'
import LibraryGameCard from '../components/LibraryGameCard.jsx'
import { libraryGames } from '../data/libraryData.js'
import './Library.css'

function Library() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All games')
  const [sort, setSort] = useState('Recently played')
  const [platform, setPlatform] = useState('All platforms')
  const [view, setView] = useState('grid')
  const [page, setPage] = useState(1)

  const filteredGames = useMemo(() => {
    let games = libraryGames.filter((game) => game.title.toLowerCase().includes(search.toLowerCase()))
    if (status !== 'All games') games = games.filter((game) => game.status === status)
    if (sort === 'Playtime') games = [...games].sort((a, b) => b.playtime - a.playtime)
    if (sort === 'Title') games = [...games].sort((a, b) => a.title.localeCompare(b.title))
    return games
  }, [search, status, sort])

  const statuses = ['All games', 'Playing', 'Completed', 'Backlog']

  return (
    <div className="dashboard-shell library-shell">
      <Sidebar />
      <div className="dashboard-main">
        <DashboardHeader />
        <main className="library-content">
          <div className="library-heading">
            <div><h1>My Library</h1><p>Every world you own. Every adventure ahead.</p></div>
            <button className="sync-library-button" type="button"><RefreshCw size={14} />Sync library</button>
          </div>

          <div className="library-tabs" role="tablist" aria-label="Game status">
            {statuses.map((item) => {
              const count = item === 'All games' ? 248 : libraryGames.filter((game) => game.status === item).length
              return <button key={item} className={status === item ? 'active' : ''} type="button" role="tab" aria-selected={status === item} onClick={() => { setStatus(item); setPage(1) }}>{item}<span>{count}</span></button>
            })}
          </div>

          <div className="library-controls">
            <label className="library-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search games..." aria-label="Search games" /></label>
            <div className="library-filter-controls">
              <label><select value={status} onChange={(event) => setStatus(event.target.value)}><option>All games</option><option>Playing</option><option>Completed</option><option>Backlog</option><option>Abandoned</option></select><ChevronDown size={12} /></label>
              <label><select value={platform} onChange={(event) => setPlatform(event.target.value)} aria-label="Platform"><option>All platforms</option><option>Steam</option></select><ChevronDown size={12} /></label>
              <label><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort games"><option>Recently played</option><option>Playtime</option><option>Title</option></select><ChevronDown size={12} /></label>
            </div>
            <div className="library-view-switch" aria-label="Library view">
              <button className={view === 'grid' ? 'active' : ''} type="button" aria-label="Grid view" onClick={() => setView('grid')}><Grid2X2 size={15} /></button>
              <button className={view === 'list' ? 'active' : ''} type="button" aria-label="List view" onClick={() => setView('list')}><List size={16} /></button>
            </div>
          </div>

          <div className="library-results-bar"><span>Showing {filteredGames.length} of 248 games</span><small>Sorted by {sort.toLowerCase()}</small></div>

          <section className={`library-games ${view === 'list' ? 'library-list' : ''}`} aria-label="Game library">
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
