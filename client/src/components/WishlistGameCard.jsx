import { CalendarDays, ExternalLink } from 'lucide-react'

function WishlistGameCard({ game, onOpen }) {
  return (
    <article className="wishlist-game-card">
      <div className="wishlist-artwork">
        <button type="button" className="wishlist-artwork-button" onClick={onOpen} aria-label={`View details for ${game.title}`}>
          {game.cover ? <img src={game.cover} alt={`${game.title} cover`} /> : <span className="wishlist-artwork-placeholder">Artwork unavailable</span>}
        </button>
        {game.discount > 0 && <span className="discount-badge">-{game.discount}%</span>}
        {game.upcoming && <span className="upcoming-badge">Upcoming</span>}
      </div>
      <div className="wishlist-card-body">
        <button type="button" className="wishlist-title-button" onClick={onOpen}><h2>{game.title}</h2></button>
        <div className="wishlist-release"><CalendarDays size={12} /><span>{game.upcoming ? game.releaseDate || 'Release date unavailable' : game.releaseDate || 'Release date unavailable'}</span></div>
        <div className="wishlist-price-row">
          {game.currentPrice == null ? (
            <span className="wishlist-price unavailable">Price unavailable</span>
          ) : (
            <>
              {game.originalPrice != null && <span className="wishlist-original-price">${game.originalPrice.toFixed(2)}</span>}
              <strong className={game.discount > 0 ? 'wishlist-discounted-price' : 'wishlist-price'}>${game.currentPrice.toFixed(2)}</strong>
            </>
          )}
        </div>
        <div className="wishlist-card-footer">
          <span>Added {new Date(`${game.addedAt}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          <div>
            <button type="button" className="wishlist-details-button" onClick={onOpen}>View details</button>
            <a className="wishlist-store-button" href={game.storeUrl} target="_blank" rel="noreferrer" aria-label={`Visit Steam Store for ${game.title}`}><ExternalLink size={13} /></a>
          </div>
        </div>
      </div>
    </article>
  )
}

export default WishlistGameCard
