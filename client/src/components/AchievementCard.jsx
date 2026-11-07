import { LockKeyhole, EyeOff, HelpCircle } from 'lucide-react'

function AchievementCard({ achievement, onOpen }) {
  const isUnlocked = achievement.progressState === 'unlocked'
  const isUnknown = achievement.progressState === 'unknown'
  const isHidden = achievement.hidden === true

  // Icon logic
  const iconUrl = isUnlocked ? achievement.iconUrl : (achievement.iconGrayUrl || achievement.iconUrl)
  
  // Hidden achievement logic
  const displayTitle = (isHidden && !isUnlocked) ? 'Hidden Achievement' : achievement.title
  const displayDescription = (isHidden && !isUnlocked) 
    ? 'Continue playing to discover this achievement.' 
    : achievement.description

  // Date formatting
  const formatDate = (dateStr) => {
    if (!dateStr) return null
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString(undefined, { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      })
    } catch {
      return null
    }
  }

  const unlockDate = isUnlocked ? formatDate(achievement.unlockedAt) : null

  return (
    <button 
      className={`achievement-row ${isUnlocked ? 'unlocked' : ''} ${isUnknown ? 'unknown' : ''}`} 
      type="button" 
      onClick={() => onOpen(achievement.gameId)}
    >
      <span className="achievement-row-icon">
        {iconUrl ? (
          <img 
            src={iconUrl} 
            alt="" 
            onError={(event) => {
              event.target.style.display = 'none'
              event.target.nextSibling.style.display = 'block'
            }}
          />
        ) : null}
        <span style={{ display: iconUrl ? 'none' : 'block' }}>
          {isUnlocked ? <HelpCircle size={16} strokeWidth={1.7} /> : 
           isHidden ? <EyeOff size={16} strokeWidth={1.7} /> : 
           <LockKeyhole size={16} strokeWidth={1.7} />}
        </span>
      </span>
      <span className="achievement-row-copy">
        <strong>{displayTitle}</strong>
        <small title={displayDescription}>{displayDescription}</small>
      </span>
      <span className="achievement-rarity">
        {isUnlocked ? (
          <>
            <strong>Unlocked</strong>
            {unlockDate && <small>{unlockDate}</small>}
          </>
        ) : isUnknown ? (
          <>
            <strong>Unknown</strong>
            <small>Not synced</small>
          </>
        ) : (
          <>
            <strong>Locked</strong>
            <small>In progress</small>
          </>
        )}
      </span>
    </button>
  )
}

export default AchievementCard
