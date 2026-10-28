import { useEffect, useState } from 'react'
import './AdminUsers.css'
import { supabase } from './lib/supabase.js'
import AdminSelect from './components/AdminSelect.jsx'

const PAGE_SIZE = 8
const joinedFilters = [
  { value: 'all', label: 'Any time' },
  { value: '30-days', label: 'Last 30 days' },
  { value: 'year', label: 'Last year' },
]

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

function getInitials(name) {
  return (name || 'U')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function getFunctionErrorMessage(error) {
  return error?.context?.json?.().then((body) => body?.error || error.message).catch(() => error.message) || Promise.resolve(error?.message || 'The admin request failed.')
}

function StatusBadge({ active }) {
  const label = active ? 'Active' : 'Locked'
  return <span className={`admin-users__status admin-users__status--${active ? 'active' : 'locked'}`}><span />{label}</span>
}

export default function AdminUsers() {
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('q') || '')
  const [statusFilter, setStatusFilter] = useState('all')
  const [joinedFilter, setJoinedFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedUser, setSelectedUser] = useState(null)
  const [details, setDetails] = useState(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [userToToggle, setUserToToggle] = useState(null)
  const [actionBusy, setActionBusy] = useState(false)

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      if (!supabase) {
        setError('Supabase is not configured. Add the public Supabase URL and key before loading users.')
        setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      const joinedAfter = joinedFilter === '30-days'
        ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        : joinedFilter === 'year'
          ? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
          : null
      const { data, error: requestError } = await supabase.functions.invoke('admin-users', {
        body: {
          action: 'list',
          search,
          status: statusFilter,
          joinedAfter,
          page,
          pageSize: PAGE_SIZE,
        },
      })
      if (!active) return
      if (requestError) {
        setError(await getFunctionErrorMessage(requestError))
        setUsers([])
        setTotal(0)
      } else if (data?.error) {
        setError(data.error)
        setUsers([])
        setTotal(0)
      } else {
        setUsers(data.users || [])
        setTotal(data.total || 0)
      }
      setLoading(false)
    }, search.trim() ? 250 : 0)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [search, statusFilter, joinedFilter, page])

  function updateFilter(setter, value) {
    setter(value)
    setPage(1)
  }

  async function openDetails(user) {
    setSelectedUser(user)
    setDetails(null)
    setDetailsError('')
    setDetailsLoading(true)
    const { data, error: requestError } = await supabase.functions.invoke('admin-users', {
      body: { action: 'details', userId: user.id },
    })
    if (requestError) {
      setDetailsError(await getFunctionErrorMessage(requestError))
    } else if (data?.error) {
      setDetailsError(data.error)
    } else {
      setDetails(data)
    }
    setDetailsLoading(false)
  }

  async function confirmToggle() {
    if (!userToToggle) return
    setActionBusy(true)
    setError('')
    const { data, error: requestError } = await supabase.functions.invoke('admin-users', {
      body: {
        action: userToToggle.is_active ? 'lock' : 'unlock',
        userId: userToToggle.id,
      },
    })
    if (requestError || data?.error) {
      setError(requestError ? await getFunctionErrorMessage(requestError) : data.error)
      setActionBusy(false)
      return
    }

    const isActive = data.is_active
    const updateUser = (user) => user.id === userToToggle.id ? { ...user, is_active: isActive } : user
    setUsers((currentUsers) => currentUsers.map(updateUser))
    setSelectedUser((currentUser) => currentUser?.id === userToToggle.id ? { ...currentUser, is_active: isActive } : currentUser)
    setDetails((currentDetails) => currentDetails ? { ...currentDetails, user: { ...currentDetails.user, is_active: isActive } } : currentDetails)
    setUserToToggle(null)
    setActionBusy(false)
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="admin-users">
      <div className="admin-users__toolbar">
        <label className="admin-users__search">
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></svg>
          <input
            aria-label="Search users"
            onChange={(event) => updateFilter(setSearch, event.target.value)}
            placeholder="Search name or email"
            value={search}
          />
        </label>
        <AdminSelect
          ariaLabel="Filter users by status"
          label="Status"
          onChange={(value) => updateFilter(setStatusFilter, value)}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'locked', label: 'Locked' },
          ]}
          value={statusFilter}
        />
        <AdminSelect
          ariaLabel="Filter users by join date"
          label="Date joined"
          onChange={(value) => updateFilter(setJoinedFilter, value)}
          options={joinedFilters}
          value={joinedFilter}
        />
        <span className="admin-users__result-total">{total.toLocaleString()} users</span>
      </div>

      {error && (
        <div className="admin-users__error" role="alert">
          <strong>Users could not be loaded</strong>
          <span>{error}</span>
          <small>Deploy the <code>admin-users</code> Supabase Edge Function and confirm this account has the admin app-metadata role.</small>
        </div>
      )}

      <div className="admin-users__table-wrap">
        <table className="admin-users__table">
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col">Email</th>
              <th scope="col">Status</th>
              <th scope="col">Date joined</th>
              <th scope="col" className="admin-users__actions-heading">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="admin-users__empty" colSpan="5" role="status">Loading user directory…</td></tr>
            ) : error ? (
              <tr><td className="admin-users__empty" colSpan="5">User records are unavailable.</td></tr>
            ) : users.length === 0 ? (
              <tr><td className="admin-users__empty" colSpan="5">No users match these filters.</td></tr>
            ) : users.map((user) => (
              <tr key={user.id}>
                <td>
                  <div className="admin-users__identity">
                    <span className="admin-users__initials">{getInitials(user.display_name)}</span>
                    <span>{user.display_name || 'Unnamed user'}</span>
                  </div>
                </td>
                <td className="admin-users__email">{user.email}</td>
                <td><StatusBadge active={user.is_active} /></td>
                <td className="admin-users__date">{formatDate(user.created_at)}</td>
                <td>
                  <div className="admin-users__row-actions">
                    <button className="admin-users__view-button" type="button" onClick={() => openDetails(user)}>View details <span aria-hidden="true">→</span></button>
                    <button
                      className={`admin-users__lock-button${user.is_active ? ' admin-users__lock-button--lock' : ''}`}
                      type="button"
                      onClick={() => setUserToToggle(user)}
                    >
                      {user.is_active ? 'Lock' : 'Unlock'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="admin-users__table-footer">
        <span>
          {total === 0 ? 'Showing 0 users' : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString()} users`}
        </span>
        <div className="admin-users__pagination">
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</button>
          <span>{page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next</button>
        </div>
      </footer>

      {selectedUser && (
        <div className="admin-users__overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedUser(null)
        }}>
          <section className="admin-users__dialog" role="dialog" aria-modal="true" aria-labelledby="admin-user-detail-title">
            <header className="admin-users__dialog-header">
              <div>
                <p className="admin-users__dialog-eyebrow">User record</p>
                <h2 id="admin-user-detail-title">{selectedUser.display_name || 'Unnamed user'}</h2>
                <span>{selectedUser.email}</span>
              </div>
              <button className="admin-users__close" type="button" aria-label="Close user details" onClick={() => setSelectedUser(null)}>×</button>
            </header>
            {detailsLoading ? (
              <p className="admin-users__dialog-state" role="status">Loading secured user details…</p>
            ) : detailsError ? (
              <p className="admin-users__dialog-error" role="alert">{detailsError}</p>
            ) : details && (
              <div className="admin-users__detail-content">
                <section className="admin-users__detail-section">
                  <h3>Profile</h3>
                  <dl>
                    <div><dt>Full legal name</dt><dd>{[details.profile?.legal_first_name, details.profile?.legal_middle_name, details.profile?.legal_last_name].filter(Boolean).join(' ') || details.user.display_name || 'Not provided'}</dd></div>
                    <div><dt>Email</dt><dd>{details.user.email || 'Not provided'}</dd></div>
                    <div><dt>Phone</dt><dd>{details.user.phone_e164 || 'Not provided'}</dd></div>
                    <div><dt>Date joined</dt><dd>{formatDate(details.user.created_at)}</dd></div>
                    <div><dt>Login status</dt><dd><StatusBadge active={details.user.is_active} /></dd></div>
                  </dl>
                  <p className="admin-users__privacy-note">Sensitive identity and tax information is not displayed in this view.</p>
                </section>
                <section className="admin-users__detail-section">
                  <h3>Identity documents <span>{details.documents.length}</span></h3>
                  {details.documents.length ? (
                    <div className="admin-users__detail-list">
                      {details.documents.map((document) => (
                        <div className="admin-users__detail-row" key={document.id}>
                          <span><strong>{document.document_type.replaceAll('_', ' ')}</strong><small>Submitted {formatDate(document.submitted_at)}</small></span>
                          <span className={`admin-users__kyc-badge admin-users__kyc-badge--${document.status}`}>{document.status.replaceAll('_', ' ')}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="admin-users__no-records">No identity documents on record.</p>}
                </section>
                <section className="admin-users__detail-section">
                  <h3>Accounts <span>{details.accounts.length}</span></h3>
                  {details.accounts.length ? (
                    <div className="admin-users__detail-list">
                      {details.accounts.map((account) => (
                        <div className="admin-users__detail-row" key={account.id}>
                          <span><strong>{account.name || account.account_type}</strong><small>{account.account_type} · ending {account.last_four}</small></span>
                          <span className={`admin-users__account-status admin-users__account-status--${account.status}`}>{account.status}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="admin-users__no-records">No accounts on record.</p>}
                </section>
              </div>
            )}
            <footer className="admin-users__dialog-footer">
              <button type="button" className="admin-users__secondary-button" onClick={() => setSelectedUser(null)}>Close</button>
              <button
                type="button"
                className={`admin-users__dialog-lock${selectedUser.is_active ? ' admin-users__dialog-lock--lock' : ''}`}
                onClick={() => setUserToToggle(selectedUser)}
              >
                {selectedUser.is_active ? 'Lock login' : 'Unlock login'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {userToToggle && (
        <div className="admin-users__overlay admin-users__overlay--confirm">
          <section className="admin-users__confirm" role="dialog" aria-modal="true" aria-labelledby="admin-lock-title">
            <span className={`admin-users__confirm-icon${userToToggle.is_active ? '' : ' admin-users__confirm-icon--unlock'}`} aria-hidden="true">{userToToggle.is_active ? '!' : '✓'}</span>
            <h2 id="admin-lock-title">{userToToggle.is_active ? 'Lock this user’s login?' : 'Unlock this user’s login?'}</h2>
            <p>{userToToggle.is_active
              ? `${userToToggle.display_name || userToToggle.email} will no longer be able to sign in until an administrator unlocks the account.`
              : `${userToToggle.display_name || userToToggle.email} will be able to sign in again.`}</p>
            <div className="admin-users__confirm-actions">
              <button type="button" className="admin-users__secondary-button" disabled={actionBusy} onClick={() => setUserToToggle(null)}>Cancel</button>
              <button type="button" className={`admin-users__dialog-lock${userToToggle.is_active ? ' admin-users__dialog-lock--lock' : ''}`} disabled={actionBusy} onClick={confirmToggle}>
                {actionBusy ? 'Updating…' : userToToggle.is_active ? 'Lock login' : 'Unlock login'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
