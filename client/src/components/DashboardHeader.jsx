import { Bell, ExternalLink, Search, Wifi } from 'lucide-react'

function DashboardHeader() {
  return (
    <header className="dashboard-header">
      <label className="dashboard-search">
        <Search size={15} />
        <input type="search" aria-label="Search your vault" placeholder="Search your vault...  ⌘K" />
      </label>
      <div className="header-actions">
        <button className="sync-button" type="button"><Wifi size={14} /><span>All changes synced</span></button>
        <button className="icon-button" type="button" aria-label="Notifications"><Bell size={16} /></button>
        <div className="profile-copy"><span className="profile-avatar">AM</span><div><strong>Alex Morgan</strong><small>alexplays · Steam</small></div></div>
        <button className="profile-link" type="button"><ExternalLink size={13} /><span>View Steam profile</span></button>
      </div>
    </header>
  )
}

export default DashboardHeader
