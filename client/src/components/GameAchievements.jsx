import AchievementCard from './AchievementCard.jsx'
import { AlertCircle, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

function GameAchievements({ 
  gameData, 
  achievements, 
  loading, 
  error, 
  onRetry 
}) {
  const navigate = useNavigate()
  
  if (loading) {
    return (
      <section className="game-panel achievements-panel">
        <div className="game-panel-heading"><h2>Achievements</h2></div>
        <div className="achievement-empty" style={{ minHeight: '200px' }}>
          <Loader2 className="animate-spin" size={24} />
          <p style={{ marginTop: 12, fontSize: '13px' }}>Loading achievements...</p>
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="game-panel achievements-panel">
        <div className="game-panel-heading"><h2>Achievements</h2></div>
        <div className="achievement-empty" style={{ minHeight: '200px' }}>
          <AlertCircle size={24} color="#e06c75" />
          <p style={{ marginTop: 12, fontSize: '13px' }}>{error}</p>
          <button className="recent-unlocked" style={{ marginTop: 12 }} onClick={onRetry}>Retry</button>
        </div>
      </section>
    )
  }

  const {
    schemaState,
    totalAchievements,
    unlockedAchievements,
    completionPercentage
  } = gameData || {}

  const percent = completionPercentage ?? 0
  const hasAchievements = totalAchievements > 0

  return (
    <section className="game-panel achievements-panel">
      <div className="game-panel-heading">
        <h2>Achievements</h2>
        <button type="button" onClick={() => navigate('/achievements')}>View all →</button>
      </div>

      {schemaState === 'no_achievements' ? (
        <div className="achievement-empty" style={{ minHeight: '100px' }}>
          <p>This game does not support achievements.</p>
        </div>
      ) : schemaState === null ? (
        <div className="achievement-empty" style={{ minHeight: '100px' }}>
          <p>Achievement data hasn't been synchronized yet.</p>
        </div>
      ) : (
        <>
          <div className="achievement-summary">
            <strong>{unlockedAchievements || 0} of {totalAchievements || 0} unlocked</strong>
            <span>{completionPercentage != null ? `${completionPercentage}%` : '--'}</span>
          </div>
          {hasAchievements && (
            <div className="achievement-bar">
              <span style={{ width: `${percent}%` }} />
            </div>
          )}
          <div className="achievement-list" style={{ marginTop: '16px' }}>
            {achievements.slice(0, 5).map((achievement) => (
              <AchievementCard 
                key={achievement.id} 
                achievement={achievement} 
                onOpen={() => {}} 
              />
            ))}
            {achievements.length > 5 && (
              <button 
                className="achievement-show-more" 
                style={{ width: '100%', textAlign: 'center', marginTop: '8px' }}
                onClick={() => navigate('/achievements')}
              >
                Show all {achievements.length} achievements →
              </button>
            )}
            {achievements.length === 0 && hasAchievements && (
              <div className="achievement-empty">
                <p>Achievement progress is currently unavailable.</p>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

export default GameAchievements
