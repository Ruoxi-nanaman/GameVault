import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Clock3, ExternalLink, LockKeyhole, Star, Trophy } from 'lucide-react'
import Sidebar from '../components/Sidebar.jsx'
import DashboardHeader from '../components/DashboardHeader.jsx'
import GameProgress from '../components/GameProgress.jsx'
import GameAchievements from '../components/GameAchievements.jsx'
import { libraryGames } from '../data/libraryData.js'
import './GameDetails.css'

function GameDetails() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const selected = libraryGames.find((game) => String(game.id) === gameId || String(game.steamAppId) === gameId)
  const game = selected ?? {
    id: gameId,
    steamAppId: 1245620,
    title: gameId.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    playtime: 0,
    status: 'Backlog',
    achievements: 0,
    achievementTotal: 42,
    rating: 0,
    developer: 'Unknown developer', publisher: 'Unknown publisher', releaseDate: 'Release date unavailable',
    cover: 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1245620/header.jpg',
    header: 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1245620/library_hero.jpg',
    description: 'Game information will appear here when Steam and Supabase data are connected.',
  }
  const [status, setStatus] = useState(game.status === 'Playing' ? 'Playing' : game.status ?? 'Backlog')
  const [rating, setRating] = useState(game.rating ?? 9)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [review, setReview] = useState(game.id === 1 ? 'Getting lost has never felt this good.' : '')
  const [reviewDraft, setReviewDraft] = useState(review)

  const saveReview = () => {
    setReview(reviewDraft.trim())
    setReviewOpen(false)
  }

  const steamAppIds = {
    'ELDEN RING': 1245620, 'Cyberpunk 2077': 1091500, Hades: 1145360,
    "Baldur's Gate 3": 1086940, 'Hollow Knight': 367520,
    'Red Dead Redemption 2': 1174180, 'Stardew Valley': 413150,
    'The Witcher 3: Wild Hunt': 292030, 'Divinity: Original Sin 2': 435150,
    'Sea of Stars': 1244090, 'DARK SOULS III': 374320, 'Portal 2': 620,
  }
  const steamAppId = game.steamAppId ?? steamAppIds[game.title] ?? 1245620

  return (
    <div className="dashboard-shell details-shell">
      <Sidebar />
      <div className="dashboard-main">
        <DashboardHeader />
        <main className="game-details-content">
          <div className="details-breadcrumb"><button type="button" onClick={() => navigate(-1)}><ArrowLeft size={13} /> My Library</button><span>/</span><strong>{game.title}</strong></div>

          <section className="game-hero">
            <img src={game.header ?? game.cover} alt="" className="game-hero-art" onError={(event) => { event.currentTarget.src = game.cover }} />
            <div className="game-hero-shade" />
            <div className="game-hero-info">
              <h1>{game.title}</h1>
              <p>{game.developer ?? 'Steam developer information unavailable'}, {game.genres ?? 'Steam genres unavailable'} · Released {game.releaseDate ?? 'Release date unavailable'}</p>
              <a href={`https://store.steampowered.com/app/${steamAppId}`} target="_blank" rel="noreferrer"><ExternalLink size={12} />View on Steam</a>
            </div>
          </section>

          <section className="game-summary-grid" aria-label="Game summary">
            <div><Clock3 size={17} /><span><strong>{game.playtime ?? 128.4} hrs</strong><small>Total playtime</small></span></div>
            <div><Trophy size={17} /><span><strong>{game.achievements ?? 28} / {game.achievementTotal ?? 42}</strong><small>Achievements unlocked</small></span></div>
            <div><Clock3 size={17} /><span><strong>{game.id === 1 ? '2 hours ago' : 'Not played recently'}</strong><small>Last played</small></span></div>
            <div><Star size={17} /><span><strong>{rating ? `${rating} / 10` : 'Not rated'}</strong><small>Your rating</small></span></div>
          </section>

          <div className="game-details-grid">
            <div className="game-details-left">
              <GameProgress status={status} onChange={setStatus} />
              <section className="game-panel review-panel">
                <div className="game-panel-heading"><h2>Your review</h2>{!reviewOpen && <button type="button" onClick={() => { setReviewDraft(review); setReviewOpen(true) }}>Edit review →</button>}</div>
                {!reviewOpen ? (
                  <>
                    <div className="review-stars">{[1,2,3,4,5,6,7,8,9,10].map((value) => <button key={value} type="button" className={value <= rating ? 'filled' : ''} onClick={() => setRating(value)} aria-label={`Rate ${value}`}><Star size={13} fill="currentColor" /></button>)}<strong>{rating}/10</strong><small>{game.id === 1 ? '· May 3, 2025' : '· Not reviewed'}</small></div>
                    <h3>{review || 'Write your first review'}</h3>
                    {review ? <p>{game.id === 1 ? 'The Lands Between rewards every detour, incredible exploration, unforgettable boss fights, and a world that keeps surprising me. This is one of the best 100-hour journeys of my life.' : 'This review has not been written yet.'}</p> : <p>Add a personal review for this game.</p>}
                    <small className="private-review"><LockKeyhole size={11} />Private review · Only visible to you</small>
                  </>
                ) : (
                  <div className="review-editor">
                    <textarea value={reviewDraft} onChange={(event) => setReviewDraft(event.target.value)} placeholder="Write your review..." rows={5} />
                    <div><button type="button" className="review-cancel" onClick={() => setReviewOpen(false)}>Cancel</button><button type="button" className="review-save" onClick={saveReview}>Save review</button></div>
                  </div>
                )}
              </section>
            </div>
            <GameAchievements unlocked={game.achievements ?? 28} total={game.achievementTotal ?? 42} />
          </div>
        </main>
      </div>
    </div>
  )
}

export default GameDetails
