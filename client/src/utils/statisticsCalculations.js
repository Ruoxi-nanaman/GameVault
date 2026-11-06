export function calculateAverage(values) {
  if (!Array.isArray(values) || values.length === 0) return 0
  const available = values.filter((value) => Number.isFinite(value))
  if (available.length === 0) return 0
  return available.reduce((sum, value) => sum + value, 0) / available.length
}

export function formatHours(hours) {
  const numericHours = Number(hours)
  if (!Number.isFinite(numericHours)) return '—'
  return `${numericHours.toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs`
}
