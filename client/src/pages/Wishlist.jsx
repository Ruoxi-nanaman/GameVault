import { useMemo, useState } from 'react'
import { ChevronDown, Heart, RefreshCw, Search, Sparkles, Tag, TrendingDown } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import DashboardHeader from '../components/DashboardHeader.jsx'
import StatCard from '../components/StatCard.jsx'
import WishlistGameCard from '../components/WishlistGameCard.jsx'
import { wishlistGames } from '../data/wishlistData.js'
import './Wishlist.css'

function Wishlist() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('Recently added')
  const [discountedOnly, setDiscountedOnly] = useState(false)
  const [upcomingOnly, setUpcomingOnly] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const discountedCount = wishlistGames.filter((game) => game.discount > 0).length
  const upcomingCount = wishlistGames.filter((game) => game.upcoming).length

  const filteredGames = useMemo(() => {
    let games = wishlistGames.filter((game) => game.title.toLowerCase().includes(search.toLowerCase()))
    if (discountedOnly) games = games.filter((game) => game.discount > 0)
    if (upcomingOnly) games = games.filter((game) => game.upcoming)

    games = [...games]
    if (sort === 'Price: Low to high') games.sort((a, b) => (a.currentPrice ?? Number.MAX_VALUE) - (b.currentPrice ?? Number.MAX_VALUE))
    if (sort === 'Price: High to low') games.sort((a, b) => (b.currentPrice ?? -1) - (a.currentPrice ?? -1))
    if (sort === 'Highest discount') games.sort((a, b) => b.discount - a.discount)
    if (sort === 'Recently added') games.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
    return games
  }, [search, discountedOnly, upcomingOnly, sort])

  const handleSync = () => {
    if (syncing) return
    setSyncing(true)
    window.setTimeout(() => setSyncing(false), 900)
  }

  const openGame = (game) => navigate(`/games/${game.libraryId ?? game.slug ?? game.steamAppId}`)

  const overviewCards = [
    { label: 'Total Wishlisted Games', value: String(wishlistGames.length), detail: 'Synced from Steam wishlist', icon: Heart },
    { label: 'Upcoming Releases', value: String(upcomingCount), detail: 'Not released yet', icon: Sparkles },
    { label: 'Discounted Games', value: String(discountedCount), detail: 'Special prices available', icon: Tag },
    { label: 'Games on Sale', value: String(discountedCount), detail: 'Currently reduced on Steam', icon: TrendingDown },
  ]

  return (
    <div className="dashboard-shell wishlist-shell">
      <Sidebar />
      <div className="dashboard-main">
        <DashboardHeader />
        <main className="wishlist-content">
          <div className="wishlist-heading">
            <div><h1>Wishlist</h1><p>Your next adventures, saved for later.</p></div>
            <div className="wishlist-sync-actions">
              <span>Placeholder sync · Last checked 2 min ago</span>
              <button type="button" onClick={handleSync} disabled={syncing}><RefreshCw size={14} className={syncing ? 'spinning' : ''} />{syncing ? 'Checking...' : 'Refresh'}</button>
            </div>
          </div>

          <section className="wishlist-overview" aria-label="Wishlist overview">
            {overviewCards.map((card) => <StatCard key={card.label} {...card} />)}
          </section>

          <div className="wishlist-controls">
            <label className="wishlist-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your wishlist..." aria-label="Search wishlist games" /></label>
            <div className="wishlist-filter-toggles" aria-label="Wishlist filters">
              <button type="button" className={discountedOnly ? 'active' : ''} aria-pressed={discountedOnly} onClick={() => setDiscountedOnly((value) => !value)}><Tag size={13} />Discounted</button>
              <button type="button" className={upcomingOnly ? 'active' : ''} aria-pressed={upcomingOnly} onClick={() => setUpcomingOnly((value) => !value)}><Sparkles size={13} />Upcoming</button>
            </div>
            <label className="wishlist-sort"><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort wishlist games"><option>Recently added</option><option>Price: Low to high</option><option>Price: High to low</option><option>Highest discount</option></select><ChevronDown size={13} /></label>
          </div>

          <div className="wishlist-results"><span>Showing {filteredGames.length} of {wishlistGames.length} games</span><small>{search ? `Matching “${search}”` : 'Steam wishlist'}</small></div>

          <section className="wishlist-grid" aria-label="Wishlist games">
            {filteredGames.map((game) => <WishlistGameCard key={game.id} game={game} onOpen={() => openGame(game)} />)}
          </section>

          {filteredGames.length === 0 && <div className="wishlist-empty"><Search size={22} /><strong>No wishlist games found</strong><span>Try changing your search or filters.</span></div>}
        </main>
      </div>
    </div>
  )
}

export default Wishlist
