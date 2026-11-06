function StatCard({ label, value, detail, icon: Icon }) {
  return (
    <article className="stat-card">
      <div className="stat-card-top"><span>{label}</span><Icon size={15} strokeWidth={1.5} /></div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

export default StatCard
