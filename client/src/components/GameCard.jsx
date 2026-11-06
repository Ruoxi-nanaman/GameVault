function GameCard({ game, compact = false, onOpen }) {
  if (compact) {
    return (
      <button className="backlog-game" type="button" onClick={() => onOpen?.(game)}>
        <img src={game.cover} alt="" />
        <span><strong>{game.title}</strong><small>{game.subtitle}</small></span>
        <span className="backlog-arrow">›</span>
      </button>
    )
  }

  return (
    <article className="recent-game" role="button" tabIndex={0} onClick={() => onOpen?.(game)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen?.(game) }}>
      <img src={game.cover} alt={`${game.title} cover`} />
      <strong>{game.title}</strong>
      <div><span>{game.subtitle}</span><span>{game.lastPlayed}</span></div>
    </article>
  )
}

export default GameCard
