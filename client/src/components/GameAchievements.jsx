import { Crown, Flame, Shield, Swords } from 'lucide-react'

function GameAchievements({ unlocked, total }) {
  const achievements = [
    { title: 'Shardbearer Godrick', detail: 'Defeat Godrick the Grafted', icon: Swords, locked: false },
    { title: 'Roundtable Hold', detail: 'Arrive at Roundtable Hold', icon: Shield, locked: false },
    { title: 'Great Rune', detail: 'Restore the power of a Great Rune', icon: Flame, locked: false },
    { title: 'Elden Lord', detail: 'Become an Elden Lord', icon: Crown, locked: true },
  ]
  const percent = total ? Math.round((unlocked / total) * 100) : 0

  return (
    <section className="game-panel achievements-panel">
      <div className="game-panel-heading"><h2>Achievements</h2><button type="button">View all →</button></div>
      <div className="achievement-summary"><strong>{unlocked} of {total} unlocked</strong><span>{percent}%</span></div>
      <div className="achievement-bar"><span style={{ width: `${percent}%` }} /></div>
      <div className="achievement-list">
        {achievements.map(({ title, detail, icon: Icon, locked }) => (
          <div className={locked ? 'achievement-item locked' : 'achievement-item'} key={title}>
            <span className="achievement-icon"><Icon size={14} /></span>
            <span><strong>{title}</strong><small>{detail}</small></span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default GameAchievements
