import { BarChart3, Gamepad2, Heart, LayoutDashboard, Library, Settings, Trophy } from 'lucide-react'
import { NavLink } from 'react-router-dom'

const icons = {
  Dashboard: LayoutDashboard,
  'My Library': Library,
  Wishlist: Heart,
  Achievements: Trophy,
  Statistics: BarChart3,
}

function Sidebar() {
  const items = ['Dashboard', 'My Library', 'Wishlist', 'Achievements', 'Statistics']
  const paths = { Dashboard: '/dashboard', 'My Library': '/library', Wishlist: '/wishlist', Achievements: '/achievements', Statistics: '/statistics' }

  return (
    <aside className="dashboard-sidebar">
      <div className="sidebar-brand"><Gamepad2 size={18} /><span>GameVault</span></div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {items.map((item) => {
          const Icon = icons[item]
          return (
            <NavLink key={item} to={paths[item]} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
              <Icon size={15} strokeWidth={1.7} /><span>{item}</span>
            </NavLink>
          )
        })}
      </nav>
      <div className="sidebar-footer">
        <NavLink to="/settings" className="sidebar-link"><Settings size={15} strokeWidth={1.7} /><span>Settings</span></NavLink>
        <div className="sync-status"><span className="sync-dot" /><div><strong>Steam connected</strong><small>Last synced 2 minutes ago</small></div></div>
      </div>
    </aside>
  )
}

export default Sidebar
