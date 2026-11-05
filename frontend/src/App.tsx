import { useState } from 'react'
import { Outlet, NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import { Wrench, LayoutDashboard, Rows3, Users, Wallet, Settings, Search, PanelLeftClose, PanelLeftOpen, Menu, X, ChevronRight, LogOut, ShieldCheck } from 'lucide-react'
import { useWorkspace } from './state/Workspace'
import { useAuth } from './state/Auth'
import { ErrorNotice } from './components/ui'
import { errorMessage } from './api/client'
const navigation = [{ name: 'Overview', path: '/', Icon: LayoutDashboard }, { name: 'Jobs', path: '/jobs', Icon: Rows3 }, { name: 'Customers', path: '/customers', Icon: Users }, { name: 'Payments', path: '/payments/new', Icon: Wallet }]
export default function App() {
  const { workspace, workspaces, jobs, preferences, updatePreferences, selectWorkspace } = useWorkspace()
  const { user, signOut, devLink, resendVerification } = useAuth()
  const [verifyBusy, setVerifyBusy] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [verifySent, setVerifySent] = useState(false)
  const location = useLocation(); const navigate = useNavigate(); const [mobileOpen, setMobileOpen] = useState(false); const [preferenceError, setPreferenceError] = useState<string | null>(null)
  const current = location.pathname.startsWith('/settings') ? 'Settings' : location.pathname.startsWith('/jobs/new') ? 'New job' : location.pathname.startsWith('/jobs/') ? 'Job details' : navigation.find(item => item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path))?.name || 'Workspace'
  const close = () => setMobileOpen(false)
  function toggleSidebar() {
    try { updatePreferences({ ...preferences, collapsed: !preferences.collapsed }); setPreferenceError(null) }
    catch (cause) { setPreferenceError(errorMessage(cause)) }
  }
  async function logout() {
    try { await signOut(); setPreferenceError(null) }
    catch (cause) { setPreferenceError(errorMessage(cause)) }
  }
  async function resendEmail() {
    setVerifyBusy(true); setVerifyError(null)
    try { await resendVerification(); setVerifySent(true) }
    catch (cause) { setVerifyError(errorMessage(cause)) }
    finally { setVerifyBusy(false) }
  }
  return <div className={`app-shell ${preferences.collapsed ? 'is-collapsed' : ''}`}>
    {mobileOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={close} />}
    <aside className={`sidebar ${preferences.collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`} aria-label="Workspace navigation">
      <div className="brand-row"><Link className="brand-mark" to="/" aria-label="FixTrack overview"><Wrench size={18} /></Link><Link className="brand-word" to="/">FixTrack<span>.</span></Link><button className="btn btn-icon sidebar-close" onClick={close} aria-label="Close navigation"><X size={16} /></button></div>
      <div className="sidebar-search"><button onClick={() => { navigate('/jobs?focus=search'); close() }}><Search size={14} />Search jobs</button></div>
      <p className="nav-caption">Workspace</p><nav className="nav-links">{navigation.map(({ name, path, Icon }) => <NavLink key={path} to={path} end={path === '/'} onClick={close} title={name} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={16} /><span className="nav-label">{name}</span>{path === '/jobs' && <span className="nav-count">{jobs.filter(job => job.status !== 'delivered').length}</span>}</NavLink>)}</nav>
      <div className="sidebar-bottom"><NavLink to="/settings" onClick={close} title="Settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Settings size={16} /><span className="nav-label">Settings</span></NavLink><div className="workspace-card"><span className="workspace-avatar">{workspace?.name.slice(0, 2).toUpperCase() || 'FT'}</span><div className="workspace-info"><strong>{workspace?.name || 'Set up your shop'}</strong><small>Signed in</small></div></div><button type="button" className="nav-link" onClick={() => void logout()} title="Sign out"><LogOut size={16} /><span className="nav-label">Sign out</span></button></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="topbar-left"><button className="btn btn-icon mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={17} /></button><button className="btn btn-icon desktop-collapse" onClick={toggleSidebar} aria-label={preferences.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{preferences.collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button><div className="breadcrumb"><span className="workspace-crumb">Workspace</span><ChevronRight size={12} /><strong>{current}</strong></div></div><div className="topbar-right">{workspaces.length > 0 && <select aria-label="Business workspace" className="workspace-select" value={workspace?.id || ''} onChange={event => selectWorkspace(event.target.value)}>{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}<Link to="/settings" className="btn btn-icon" aria-label="Workspace settings"><Settings size={15} /></Link></div></header>
      <main className="content"><ErrorNotice message={preferenceError} />{user && !user.email_verified && <div className="notice"><div><strong>Verify your email address</strong><p>Creating workspaces and inviting members requires a verified email.</p>{verifySent && <p>Verification email sent. Check your inbox.</p>}{devLink && <p><a href={devLink}>Open verification link (development)</a></p>}<div className="form-actions" style={{borderTop:0,paddingTop:10}}><button type="button" className="btn btn-secondary" disabled={verifyBusy} onClick={() => void resendEmail()}>{verifyBusy ? 'Sending…' : 'Resend verification email'}</button></div><ErrorNotice message={verifyError} /></div></div>}<Outlet /><p className="development-note"><ShieldCheck size={12} />Signed in as {user?.email} · Workspaces are private to your account.</p></main>
    </div>
  </div>
}
