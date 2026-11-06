import { useState } from 'react'

function ActivityChart({ data }) {
  const [hovered, setHovered] = useState(null)
  const max = Math.max(...data.map((item) => item.hours), 1)

  return (
    <div className="activity-chart-wrap">
      <div className="chart-y-labels"><span>12h</span><span>8h</span><span>4h</span><span>0h</span></div>
      <div className="chart-bars">
        {[0, 1, 2, 3].map((line) => <span key={line} className="chart-grid-line" style={{ bottom: `${line * 25}%` }} />)}
        {data.map((item, index) => {
          const height = Math.max((item.hours / max) * 78, 4)
          return (
            <button key={item.label} type="button" className={`chart-bar-column ${hovered === index ? 'hovered' : ''}`} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} aria-label={`${item.label}: ${item.hours} hours`}>
              {hovered === index && <span className="chart-tooltip">{item.label}: {item.hours} hrs</span>}
              <span className="chart-bar" style={{ height: `${height}%` }} />
            </button>
          )
        })}
      </div>
      <div className="chart-x-labels">{data.map((item) => <span key={item.label}>{item.label}</span>)}</div>
    </div>
  )
}

export default ActivityChart
