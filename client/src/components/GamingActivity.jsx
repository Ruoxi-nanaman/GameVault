import { useState } from 'react'

function GamingActivity() {
  const [period, setPeriod] = useState('This week')
  const bars = [5, 7, 4, 8, 12, 26, 8]
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <section className="activity-card dashboard-panel">
      <div className="panel-heading"><div><strong>Gaming activity</strong><span>{period.toLowerCase()}</span></div></div>
      <div className="activity-total"><strong>24.5</strong><span>hours this week</span></div>
      <div className="activity-chart" role="img" aria-label="Gaming activity chart showing Saturday with the highest activity">
        <div className="chart-lines" aria-hidden="true"><i /><i /><i /><i /></div>
        {bars.map((height, index) => (
          <button
            type="button"
            key={days[index]}
            className={`chart-column ${index === 5 ? 'highlight' : ''}`}
            aria-label={`${days[index]}: ${height === 26 ? 11 : height / 2} hours`}
            onClick={() => setPeriod(index === 5 ? 'Saturday' : days[index])}
          ><span style={{ height: `${height}px` }} /></button>
        ))}
      </div>
      <div className="chart-days"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
    </section>
  )
}

export default GamingActivity
