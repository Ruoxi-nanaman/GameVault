import { Gamepad2, CheckCircle2, Archive, CircleOff } from 'lucide-react'

const statuses = [
  ['Playing', 'Currently playing', Gamepad2],
  ['Completed', 'Completed', CheckCircle2],
  ['Backlog', 'Backlog', Archive],
  ['Abandoned', 'Abandoned', CircleOff],
]

function GameProgress({ status, onChange }) {
  return (
    <section className="game-panel progress-panel">
      <h2>Your progress</h2>
      <div className="status-options">
        {statuses.map(([value, label, Icon]) => (
          <button key={value} type="button" className={status === value ? 'active' : ''} onClick={() => onChange(value)}>
            <Icon size={13} /><span>{label}</span>
          </button>
        ))}
      </div>
      <div className="progress-divider" />
      <p className="progress-stat">Started October 14, 2024 · 14 sessions played</p>
    </section>
  )
}

export default GameProgress
