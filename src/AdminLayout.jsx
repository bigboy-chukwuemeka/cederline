import { useEffect, useRef, useState } from 'react'
import './AdminLayout.css'
import AdminDashboard from './AdminDashboard.jsx'
import AdminUsers from './AdminUsers.jsx'
import AdminAccounts from './AdminAccounts.jsx'
import AdminApplications from './AdminApplications.jsx'
import AdminTransactions from './AdminTransactions.jsx'
import AdminMessages from './AdminMessages.jsx'
import AdminAuditLogs from './AdminAuditLogs.jsx'
import './AdminTheme.css'
import { ADMIN_BASE_PATH } from './lib/routes.js'
import { supabase } from './lib/supabase.js'

const navigation = [
  { label: 'Dashboard', href: ADMIN_BASE_PATH, icon: 'dashboard', description: 'Overview of banking operations and activity.' },
  { label: 'Users', href: `${ADMIN_BASE_PATH}/users`, icon: 'users', description: 'Manage customer profiles and identity verification.' },
  { label: 'Accounts', href: `${ADMIN_BASE_PATH}/accounts`, icon: 'accounts', description: 'Monitor account balances and restrictions.' },
  { label: 'Applications', href: `${ADMIN_BASE_PATH}/applications`, icon: 'applications', description: 'Review customer applications and KYC.' },
  { label: 'Transactions', href: `${ADMIN_BASE_PATH}/transactions`, icon: 'transactions', description: 'Review and monitor banking transactions.' },
  { label: 'Messages', href: `${ADMIN_BASE_PATH}/messages`, icon: 'messages', description: 'Send secure in-app messages to customers.' },
  { label: 'Audit Logs', href: `${ADMIN_BASE_PATH}/audit-logs`, icon: 'audit', description: 'Review administrator and account activity.' },
]

const actionAlerts = [
  { key: 'pending_applications', label: 'Pending KYC applications', href: `${ADMIN_BASE_PATH}/applications` },
  { key: 'pending_transfers', label: 'Transfers awaiting review', href: `${ADMIN_BASE_PATH}/transactions` },
  { key: 'pending_external_transfers', label: 'External bank requests awaiting review', href: `${ADMIN_BASE_PATH}/transactions` },
  { key: 'flagged_transactions', label: 'Flagged transactions', href: `${ADMIN_BASE_PATH}/transactions` },
  { key: 'accounts_on_hold', label: 'Accounts on hold', href: `${ADMIN_BASE_PATH}/accounts` },
]

const iconPaths = {
  dashboard: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20v-1.5a6 6 0 0 1 12 0V20H3Zm12-11a3.5 3.5 0 0 1 0 7m3 4v-1.5a6 6 0 0 0-3-5.2" /></>,
  accounts: <><path d="M3 20h18M5 20V9m4 11V9m6 11V9m4 11V9M3 8l9-5 9 5H3Z" /></>,
  applications: <><path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" /><path d="M14 4v4h4m-9 5h6m-6 4h6" /></>,
  transactions: <><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" /></>,
  messages: <><path d="M4 5.5h16v12H9l-5 3v-15Z" /><path d="M8 10h8m-8 4h5" /></>,
  audit: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5" /><path d="M4 4v4.5h4.5M12 7v5l3 2" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
}

function Icon({ name, size = 20 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {iconPaths[name]}
    </svg>
  )
}

function getDisplayName(user) {
  const metadataName = user?.user_metadata?.display_name
  return typeof metadataName === 'string' && metadataName.trim()
    ? metadataName.trim()
    : user?.email || 'Administrator'
}

export function AdminLayout({ user, onSignOut }) {
  const [signOutError, setSignOutError] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const menuButtonRef = useRef(null)
  const searchInputRef = useRef(null)
  const [globalSearch, setGlobalSearch] = useState('')
  const [searchCategory, setSearchCategory] = useState('users')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationSummary, setNotificationSummary] = useState(null)
  const [notificationLoading, setNotificationLoading] = useState(false)
  const [notificationError, setNotificationError] = useState('')
  const [notificationRefresh, setNotificationRefresh] = useState(0)
  const notificationRef = useRef(null)
  const notificationButtonRef = useRef(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const guideDialogRef = useRef(null)
  const guideButtonRef = useRef(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef(null)
  const profileButtonRef = useRef(null)
  const [currentTime, setCurrentTime] = useState(null)
  const pathname = window.location.pathname.replace(/\/+$/, '') || ADMIN_BASE_PATH
  const activeItem = navigation.find((item) => item.href === pathname)
  const displayName = getDisplayName(user)
  const initials = displayName
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  useEffect(() => {
    function updateTime() {
      setCurrentTime(new Date())
    }

    updateTime()
    const intervalId = window.setInterval(updateTime, 60_000)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    function focusAdminSearch(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }

    window.addEventListener('keydown', focusAdminSearch)
    return () => window.removeEventListener('keydown', focusAdminSearch)
  }, [])

  useEffect(() => {
    let active = true

    async function loadActionAlerts() {
      setNotificationLoading(true)
      setNotificationError('')
      if (!supabase) {
        setNotificationError('Supabase is not configured.')
        setNotificationLoading(false)
        return
      }
      const { data, error } = await supabase.functions.invoke('admin-dashboard', {
        body: { action: 'summary' },
      })
      if (!active) return
      if (error) {
        setNotificationError(error.message || 'Unable to load action alerts.')
      } else if (data?.error) {
        setNotificationError(data.error)
      } else {
        setNotificationSummary(data)
      }
      setNotificationLoading(false)
    }

    function closeOnOutsidePointer(event) {
      if (!notificationRef.current?.contains(event.target)) setNotificationsOpen(false)
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setNotificationsOpen(false)
        notificationButtonRef.current?.focus()
      }
    }

    void loadActionAlerts()
    const intervalId = window.setInterval(() => void loadActionAlerts(), 30000)
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      active = false
      window.clearInterval(intervalId)
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [notificationsOpen, notificationRefresh])

  useEffect(() => {
    const dialog = guideDialogRef.current
    if (guideOpen && dialog && !dialog.open) dialog.showModal()
    if (!guideOpen && dialog?.open) dialog.close()
  }, [guideOpen])

  useEffect(() => {
    if (!profileMenuOpen) return undefined

    function closeOnOutsidePointer(event) {
      if (!profileMenuRef.current?.contains(event.target)) setProfileMenuOpen(false)
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setProfileMenuOpen(false)
        profileButtonRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [profileMenuOpen])

  useEffect(() => {
    if (!mobileMenuOpen) return undefined
    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false)
        menuButtonRef.current?.focus()
      }
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = previousBodyOverflow
    }
  }, [mobileMenuOpen])

  async function signOut() {
    setProfileMenuOpen(false)
    const error = await onSignOut()
    if (error) setSignOutError(error)
  }

  function submitGlobalSearch(event) {
    event.preventDefault()
    const query = globalSearch.trim()
    if (!query) {
      searchInputRef.current?.focus()
      return
    }
    window.location.assign(`${ADMIN_BASE_PATH}/${searchCategory}?q=${encodeURIComponent(query)}`)
  }

  const notificationCount = actionAlerts.reduce(
    (total, alert) => total + Number(notificationSummary?.queues?.[alert.key] || 0),
    0,
  )
  const pendingApplicationCount = Number(notificationSummary?.queues?.pending_applications || 0)
  const adminDataStatus = notificationError
    ? 'unavailable'
    : notificationSummary
      ? 'connected'
      : 'checking'
  const adminDataStatusLabel = notificationError
    ? 'Admin data unavailable'
    : notificationSummary
      ? 'Admin data connected'
      : 'Checking admin data'

  return (
    <div className="admin-panel">
      <aside className={`admin-panel__sidebar${mobileMenuOpen ? ' is-open' : ''}`} id="admin-navigation">
        <a className="admin-panel__brand" href={ADMIN_BASE_PATH} aria-label="Evergreen Admin home">
          <span className="admin-panel__brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>evergreen</span>
        </a>
        <button
          aria-label="Close admin navigation"
          className="admin-panel__drawer-close"
          onClick={() => {
            setMobileMenuOpen(false)
            menuButtonRef.current?.focus()
          }}
          type="button"
        >
          <Icon name="close" size={20} />
        </button>

        <div className="admin-panel__environment" aria-label="Banking operations, production US">
          <span>Banking operations</span>
          <small>PRODUCTION · US</small>
          <span className="admin-panel__environment-chevron" aria-hidden="true">⌄</span>
        </div>

        <nav className="admin-panel__navigation" aria-label="Admin navigation">
          <span className="admin-panel__section-label">Workspace</span>
          {navigation.map((item) => (
            <a
              aria-current={activeItem?.href === item.href ? 'page' : undefined}
              className={`admin-panel__nav-link${activeItem?.href === item.href ? ' admin-panel__nav-link--active' : ''}`}
              href={item.href}
              key={item.href}
              onClick={() => {
                setMobileMenuOpen(false)
                menuButtonRef.current?.focus()
              }}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
              {item.label === 'Applications' && pendingApplicationCount > 0 && (
                <span
                  aria-label={`${pendingApplicationCount} pending KYC applications`}
                  className="admin-panel__nav-count"
                  title="Pending KYC applications"
                >
                  {pendingApplicationCount > 99 ? '99+' : pendingApplicationCount}
                </span>
              )}
            </a>
          ))}
        </nav>

        <div className="admin-panel__sidebar-footer">
          <button className="admin-panel__footer-link" onClick={() => setGuideOpen(true)} ref={guideButtonRef} type="button">
            <span aria-hidden="true">?</span> Operations guide
          </button>
          <span className="admin-panel__security"><span aria-hidden="true">◈</span><span>Secure admin session<small>All actions are audited</small></span></span>
          <span aria-live="polite" className={`admin-panel__system-status admin-panel__system-status--${adminDataStatus}`}>
            <span />{adminDataStatusLabel}
          </span>
        </div>
      </aside>
      {mobileMenuOpen && (
        <button
          aria-label="Close admin navigation"
          className="admin-panel__drawer-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          type="button"
        />
      )}

      <dialog
        aria-labelledby="admin-guide-title"
        className="admin-panel__guide-dialog"
        onClose={() => {
          setGuideOpen(false)
          guideButtonRef.current?.focus()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close()
        }}
        ref={guideDialogRef}
      >
        <header className="admin-panel__guide-header">
          <div>
            <p>Evergreen operations</p>
            <h2 id="admin-guide-title">Operations guide</h2>
          </div>
          <button aria-label="Close operations guide" onClick={() => guideDialogRef.current?.close()} type="button">×</button>
        </header>
        <div className="admin-panel__guide-content">
          <a href={`${ADMIN_BASE_PATH}/applications`}>
            <strong>Review a KYC application</strong>
            <span>Open Pending, inspect submitted details and identity documents, then approve or reject with a reason.</span>
          </a>
          <a href={`${ADMIN_BASE_PATH}/transactions`}>
            <strong>Review a transfer</strong>
            <span>Find pending transfers, verify the parties and amount, and record an approval or rejection.</span>
          </a>
          <a href={`${ADMIN_BASE_PATH}/accounts`}>
            <strong>Manage an account</strong>
            <span>Search the account directory to review status, place or release a hold, or freeze an account.</span>
          </a>
          <a href={`${ADMIN_BASE_PATH}/users`}>
            <strong>Find or secure a user</strong>
            <span>Search by name or email, review permitted profile details, and lock or unlock login access.</span>
          </a>
          <a href={`${ADMIN_BASE_PATH}/messages`}>
            <strong>Contact a customer</strong>
            <span>Send a secure in-app message from the customer conversation workspace.</span>
          </a>
          <a href={`${ADMIN_BASE_PATH}/audit-logs`}>
            <strong>Review recorded actions</strong>
            <span>Filter the audit log by administrator, action, or date to investigate activity.</span>
          </a>
          <p>Identity-document access and administrator actions are audited. Open sensitive records only when needed for your work.</p>
        </div>
      </dialog>

      <div className="admin-panel__workspace">
        <header className="admin-panel__topbar">
          <button
            aria-controls="admin-navigation"
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? 'Close admin navigation' : 'Open admin navigation'}
            className="admin-panel__menu-button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            ref={menuButtonRef}
            type="button"
          >
            <Icon name={mobileMenuOpen ? 'close' : 'menu'} size={21} />
          </button>
          <form className="admin-panel__search" onSubmit={submitGlobalSearch} role="search">
            <Icon name="search" size={16} />
            <input
              aria-label="Search users, accounts, and transactions"
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Search users, accounts, transactions..."
              ref={searchInputRef}
              value={globalSearch}
            />
            <select aria-label="Search category" onChange={(event) => setSearchCategory(event.target.value)} value={searchCategory}>
              <option value="users">Users</option>
              <option value="accounts">Accounts</option>
              <option value="transactions">Transactions</option>
            </select>
            <button aria-label="Search selected category" type="submit"><Icon name="search" size={15} /></button>
            <kbd>Ctrl K</kbd>
          </form>
          <div className="admin-panel__topbar-actions">
            <time className="admin-panel__date" dateTime={currentTime?.toISOString()}>
              {currentTime?.toLocaleString('en-US', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'UTC',
                timeZoneName: 'short',
              }) || ''}
            </time>
            <div className="admin-panel__notification-wrap" ref={notificationRef}>
              <button
                aria-controls="admin-action-alerts"
                aria-expanded={notificationsOpen}
                aria-label={notificationCount ? `Open action alerts, ${notificationCount} queue items` : 'Open action alerts'}
                className="admin-panel__notification-button"
                onClick={() => setNotificationsOpen((open) => !open)}
                ref={notificationButtonRef}
                type="button"
              >
                <Icon name="bell" size={18} />
                {notificationCount > 0 && <span className="admin-panel__notification-count">{notificationCount > 99 ? '99+' : notificationCount}</span>}
              </button>
              {notificationsOpen && (
                <section aria-label="Current admin action alerts" className="admin-panel__notification-popover" id="admin-action-alerts">
                  <header className="admin-panel__notification-heading">
                    <div>
                      <h2>Action alerts</h2>
                      <p>Current items that may need review</p>
                    </div>
                    <button
                      className="admin-panel__notification-refresh"
                      disabled={notificationLoading}
                      onClick={() => setNotificationRefresh((count) => count + 1)}
                      type="button"
                    >
                      {notificationLoading ? 'Updating…' : 'Refresh'}
                    </button>
                  </header>
                  {notificationError ? (
                    <p className="admin-panel__notification-error" role="alert">{notificationError}</p>
                  ) : notificationLoading && !notificationSummary ? (
                    <p className="admin-panel__notification-status" role="status">Loading action alerts…</p>
                  ) : notificationCount === 0 ? (
                    <p className="admin-panel__notification-status" role="status">No items need attention right now.</p>
                  ) : (
                    <ul className="admin-panel__notification-list">
                      {actionAlerts.map((alert) => {
                        const count = Number(notificationSummary?.queues?.[alert.key] || 0)
                        return count > 0 ? (
                          <li key={alert.key}>
                            <a href={alert.href} onClick={() => setNotificationsOpen(false)}>
                              <span>{alert.label}</span>
                              <strong>{count.toLocaleString('en-US')}</strong>
                            </a>
                          </li>
                        ) : null
                      })}
                    </ul>
                  )}
                  <p className="admin-panel__notification-footnote">Live queue counts from the secured admin dashboard.</p>
                </section>
              )}
            </div>
            <div className="admin-panel__profile-wrap" ref={profileMenuRef}>
              <button
                aria-controls="admin-profile-menu"
                aria-expanded={profileMenuOpen}
                aria-label={`${displayName}, administrator account`}
                className="admin-panel__profile"
                onClick={() => setProfileMenuOpen((open) => !open)}
                ref={profileButtonRef}
                type="button"
              >
                <span className="admin-panel__avatar">{initials}</span>
                <span className="admin-panel__profile-copy"><strong>{displayName}</strong><small>Operations admin</small></span>
                <span className="admin-panel__profile-chevron" aria-hidden="true">⌄</span>
              </button>
              {profileMenuOpen && (
                <section aria-label="Administrator account" className="admin-panel__profile-menu" id="admin-profile-menu">
                  <div className="admin-panel__profile-menu-identity">
                    <span>Signed in as</span>
                    <strong>{displayName}</strong>
                    <small>{user?.email || 'Administrator account'}</small>
                  </div>
                  <button onClick={signOut} type="button">Sign out</button>
                </section>
              )}
            </div>
          </div>
        </header>

        <main className="admin-panel__main">
          <div className="admin-panel__breadcrumb">Workspace <span>/</span> {activeItem?.label || 'Page not found'}</div>
          <div className="admin-panel__page-heading">
            <div>
              <h1>{activeItem?.label || 'Page not found'}</h1>
              <p>{activeItem?.description || 'The requested admin page does not exist.'}</p>
            </div>
          </div>
          {signOutError && <p className="admin-panel__error" role="alert">{signOutError}</p>}
          {activeItem?.href === ADMIN_BASE_PATH ? (
            <AdminDashboard />
          ) : activeItem?.href === `${ADMIN_BASE_PATH}/users` ? (
            <AdminUsers />
          ) : activeItem?.href === `${ADMIN_BASE_PATH}/accounts` ? (
            <AdminAccounts />
          ) : activeItem?.href === `${ADMIN_BASE_PATH}/applications` ? (
            <AdminApplications />
          ) : activeItem?.href === `${ADMIN_BASE_PATH}/transactions` ? (
            <AdminTransactions />
          ) : activeItem?.href === `${ADMIN_BASE_PATH}/messages` ? (
            <AdminMessages />
          ) : activeItem?.href === `${ADMIN_BASE_PATH}/audit-logs` ? (
            <AdminAuditLogs />
          ) : (
            <section className="admin-panel__content-placeholder" aria-label={`${activeItem?.label || 'Admin'} content`}>
              <span className="admin-panel__placeholder-mark" aria-hidden="true">
                <Icon name={activeItem?.icon || 'dashboard'} size={24} />
              </span>
              <h2>{activeItem ? `${activeItem.label} workspace` : 'Page unavailable'}</h2>
              <p>{activeItem ? 'The admin workspace is ready for its page content.' : 'Choose a section from the navigation to continue.'}</p>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}

export default function AdminAccessDenied({ onSignOut }) {
  const [signOutError, setSignOutError] = useState('')

  async function signOut() {
    const error = await onSignOut()
    if (error) setSignOutError(error)
  }

  return (
    <main className="admin-access-denied">
      <div className="admin-access-denied__card">
        <span className="admin-access-denied__mark" aria-hidden="true">!</span>
        <p className="admin-access-denied__eyebrow">Evergreen · Admin</p>
        <h1>Administrator access required</h1>
        <p>This account is signed in but is not authorized to access the admin workspace.</p>
        {signOutError && <p className="admin-panel__error" role="alert">{signOutError}</p>}
        <button type="button" onClick={signOut}>Sign out</button>
      </div>
    </main>
  )
}
