import { Clock3 } from 'lucide-react'

function LibraryGameCard({ game, listView, onOpen }) {
  const sourceLabel = game.primaryAccessSource === 'owned'
    ? 'Owned'
    : game.primaryAccessSource === 'family_shared'
      ? 'Family Shared'
      : game.primaryAccessSource === 'recently_played_unknown'
        ? 'Recently Played'
        : game.primaryAccessSource === 'ownership_unconfirmed'
          ? 'Ownership Unconfirmed'
          : null
  const hasStaleEvidence = Object.values(game.sourceEvidence || {}).some((source) => source?.status === 'stale')
  return (
    <article className={`library-game-card ${listView ? 'list-view' : ''}`}>
      <button className="library-game-main" type="button" onClick={() => onOpen(game)} aria-label={`Open ${game.title}`}>
        <img
          src={game.cover || undefined}
          alt={`${game.title} cover`}
          onError={(event) => { event.currentTarget.style.display = 'none' }}
        />
        <div className="library-game-info">
          <strong>{game.title}</strong>
          <div className="library-game-meta">
            <span><Clock3 size={11} />{game.playtime} hrs</span>
            <span>•</span>
            <span className={`library-status ${game.status.toLowerCase()}`}>{game.status}</span>
            {sourceLabel && <span className={`library-source source-${game.primaryAccessSource}`}>{sourceLabel}</span>}
            {hasStaleEvidence && <span className="library-source source-stale">Stale Source Data</span>}
          </div>
        </div>
      </button>
    </article>
  )
}

export default LibraryGameCard
