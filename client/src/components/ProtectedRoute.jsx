import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth.js'

function ProtectedRoute({ children }) {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return <p className="auth-loading" role="status">Loading session…</p>
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return children
}

export default ProtectedRoute
