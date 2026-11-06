import { LockKeyhole } from 'lucide-react'

function AchievementCard({ achievement, onOpen }) {
  const Icon = achievement.icon ?? LockKeyhole
  return (
    <button className={`achievement-row ${achievement.unlocked ? 'unlocked' : ''}`} type="button" onClick={() => onOpen(achievement.gameId)}>
      <span className="achievement-row-icon"><Icon size={16} strokeWidth={1.7} /></span>
      <span className="achievement-row-copy"><strong>{achievement.title}</strong><small>{achievement.description}</small></span>
      <span className="achievement-rarity"><strong>{achievement.rarity}%</strong><small>{achievement.unlocked ? 'Unlocked' : 'of players'}</small></span>
    </button>
  )
}

export default AchievementCard
