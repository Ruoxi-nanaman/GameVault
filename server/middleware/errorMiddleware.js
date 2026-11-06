function notFound(req, res) {
  res.status(404).json({ error: 'Route not found' })
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error)
  console.error(error)
  res.status(error.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message })
}

module.exports = { notFound, errorHandler }
