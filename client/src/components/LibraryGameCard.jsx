import { Clock3 } from 'lucide-react'

function LibraryGameCard({ game, listView, onOpen }) {
  return (
    <article className={`library-game-card ${listView ? 'list-view' : ''}`}>
      <button className="library-game-main" type="button" onClick={() => onOpen(game)} aria-label={`Open ${game.title}`}>
        <img src={game.cover} alt={`${game.title} cover`} />
        <div className="library-game-info">
          <strong>{game.title}</strong>
          <div className="library-game-meta">
            <span><Clock3 size={11} />{game.playtime} hrs</span>
            <span>•</span>
            <span>{game.achievements} achievements</span>
            <span className={`library-status ${game.status.toLowerCase()}`}>{game.status}</span>
          </div>
        </div>
      </button>
    </article>
  )
}

export default LibraryGameCard
