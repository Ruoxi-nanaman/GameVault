require('dotenv').config()
const express = require('express')
const cors = require('cors')
const authRoutes = require('./routes/authRoutes')
const { notFound, errorHandler } = require('./middleware/errorMiddleware')

const app = express()
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5173', credentials: true }))
app.use(express.json())
app.use('/api/auth', authRoutes)
app.use(notFound)
app.use(errorHandler)

module.exports = app
