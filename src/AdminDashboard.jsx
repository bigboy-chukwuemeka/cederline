import { useCallback, useEffect, useState } from 'react'
import './AdminDashboard.css'
import { ADMIN_BASE_PATH } from './lib/routes.js'
import { supabase } from './lib/supabase.js'

const metrics = [
  { key: 'total_users', label: 'Total users', icon: 'users', description: 'Customer profiles' },
  { key: 'pending_applications', label: 'Pending applications', detail: 'KYC', icon: 'applications', description: 'Awaiting review' },
  { key: 'accounts_on_hold', label: 'Accounts on hold', icon: 'hold', description: 'Restricted for review' },
  { key: 'transactions_today', label: 'Transactions today', icon: 'transactions', description: 'Posted transaction records' },
  { key: 'secure_conversations', label: 'Secure conversations', icon: 'messages', description: 'Customers with admin messages' },
]

const queues = [
  { key: 'pending_applications', label: 'Pending KYC', detail: 'Review identity applications', href: `${ADMIN_BASE_PATH}/applications`, icon: 'applications' },
  { key: 'pending_transfers', label: 'Transfers awaiting review', detail: 'Approve or reject transfer requests', href: `${ADMIN_BASE_PATH}/transactions`, icon: 'transactions' },
  { key: 'pending_external_transfers', label: 'External bank requests', detail: 'Review customer-submitted bank details', href: `${ADMIN_BASE_PATH}/transactions`, icon: 'transactions' },
  { key: 'flagged_transactions', label: 'Flagged transactions', detail: 'Investigate transaction alerts', href: `${ADMIN_BASE_PATH}/transactions`, icon: 'transactions' },
  { key: 'accounts_on_hold', label: 'Accounts on hold', detail: 'Review account restrictions', href: `${ADMIN_BASE_PATH}/accounts`, icon: 'hold' },
]

const iconPaths = {
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20v-1.5a6 6 0 0 1 12 0V20H3Zm12-11a3.5 3.5 0 0 1 0 7m3 4v-1.5a6 6 0 0 0-3-5.2" /></>,
  applications: <><path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" /><path d="M14 4v4h4m-9 5h6m-6 4h6" /></>,
  hold: <><path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z" /><path d="M9.5 9.5v5m5-5v5" /></>,
  transactions: <><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" /></>,
  messages: <><path d="M4 5.5h16v12H9l-5 3v-15Z" /><path d="M8 10h8m-8 4h5" /></>,
  arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
  activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
}

function Icon({ name, size = 20 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {iconPaths[name]}
    </svg>
  )
}

function getFunctionErrorMessage(error) {
  return error?.context?.json?.().then((body) => body?.error || error.message).catch(() => error.message)
    || Promise.resolve(error?.message || 'The admin dashboard request failed.')
}

function formatAction(action) {
  const readable = String(action || 'admin_activity')
    .replace(/^admin_/, '')
    .replaceAll('_', ' ')
  return readable.charAt(0).toUpperCase() + readable.slice(1)
}

function formatDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
}

export default function AdminDashboard() {
  const [dashboardData, setDashboardData] = useState(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [error, setError] = useState(supabase ? '' : 'Supabase is not configured. Add the public Supabase URL and key before loading the dashboard.')

  const loadDashboard = useCallback(async (active = () => true) => {
    if (!supabase) {
      setError('Supabase is not configured. Add the public Supabase URL and key before loading the dashboard.')
      setDashboardData(null)
      setLoading(false)
      return
    }
    const { data, error: requestError } = await supabase.functions.invoke('admin-dashboard', {
      body: { action: 'summary' },
    })
    if (!active()) return
    if (requestError) {
      const message = await getFunctionErrorMessage(requestError)
      if (!active()) return
      setError(message)
      setDashboardData(null)
    } else if (data?.error) {
      setError(data.error)
      setDashboardData(null)
    } else {
      setDashboardData(data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!supabase) return undefined
    let active = true
    const timer = window.setTimeout(() => {
      void loadDashboard(() => active)
    }, 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [loadDashboard])

  function refreshDashboard() {
    setLoading(true)
    setError('')
    void loadDashboard()
  }

  return (
    <div className="admin-dashboard">
      {error && (
        <div className="admin-dashboard__error" role="alert">
          <p>{error}</p>
          <button disabled={loading} onClick={refreshDashboard} type="button">
            {loading ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      <section className="admin-dashboard__metrics" aria-label="Operations metrics" aria-busy={loading}>
        {metrics.map((metric) => (
          <article className="admin-dashboard__metric" key={metric.key}>
            <div className="admin-dashboard__metric-heading">
              <span>{metric.label}{metric.detail && <span className="admin-dashboard__metric-detail"> ({metric.detail})</span>}</span>
              <span className={`admin-dashboard__metric-icon admin-dashboard__metric-icon--${metric.icon}`}>
                <Icon name={metric.icon} size={18} />
              </span>
            </div>
            <p className="admin-dashboard__metric-value">
              {loading ? '…' : dashboardData ? Number(dashboardData.metrics[metric.key]).toLocaleString('en-US') : '—'}
            </p>
            <p className="admin-dashboard__metric-description">{metric.description}</p>
            {loading && <span className="admin-dashboard__metric-unavailable">Updating securely</span>}
          </article>
        ))}
      </section>

      <div className="admin-dashboard__sections">
        <section className="admin-dashboard__panel admin-dashboard__activity" aria-labelledby="admin-activity-title" aria-busy={loading}>
          <header className="admin-dashboard__panel-header">
            <div>
              <h2 id="admin-activity-title">Recent activity</h2>
              <p>Latest recorded administrative actions</p>
            </div>
            <button
              aria-label="Refresh dashboard data"
              className="admin-dashboard__refresh"
              disabled={loading}
              onClick={refreshDashboard}
              type="button"
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </header>
          {loading ? (
            <div className="admin-dashboard__empty-activity" role="status">Loading recent activity…</div>
          ) : dashboardData?.activity?.length ? (
            <ol className="admin-dashboard__activity-list">
              {dashboardData.activity.map((item) => (
                <li className="admin-dashboard__activity-item" key={item.id}>
                  <span className="admin-dashboard__activity-icon"><Icon name="activity" size={17} /></span>
                  <div className="admin-dashboard__activity-copy">
                    <strong>{formatAction(item.action)}</strong>
                    <small>
                      {item.subject_name ? `Customer: ${item.subject_name}` : `By ${item.admin_name || 'Administrator'}`}
                      {item.resource_type ? ` · ${item.resource_type}` : ''}
                    </small>
                  </div>
                  <time dateTime={item.created_at}>{formatDate(item.created_at)}</time>
                </li>
              ))}
            </ol>
          ) : (
            <div className="admin-dashboard__empty-activity" role="status">
              <span className="admin-dashboard__empty-icon"><Icon name="activity" size={22} /></span>
              <strong>No administrative activity yet</strong>
              <p>Recorded actions will appear here when administrators work in the dashboard.</p>
            </div>
          )}
        </section>

        <section className="admin-dashboard__panel admin-dashboard__queues" aria-labelledby="admin-queues-title" aria-busy={loading}>
          <header className="admin-dashboard__panel-header">
            <div>
              <h2 id="admin-queues-title">Action queues</h2>
              <p>Items that may need your attention</p>
            </div>
          </header>
          <div className="admin-dashboard__queue-list">
            {queues.map((queue) => (
              <a className="admin-dashboard__queue" href={queue.href} key={queue.key}>
                <span className={`admin-dashboard__queue-icon admin-dashboard__queue-icon--${queue.icon}`}>
                  <Icon name={queue.icon} size={18} />
                </span>
                <span className="admin-dashboard__queue-copy">
                  <strong>{queue.label}</strong>
                  <small>{queue.detail}</small>
                </span>
                <span className="admin-dashboard__queue-count">
                  {loading ? '…' : dashboardData ? Number(dashboardData.queues[queue.key]).toLocaleString('en-US') : '—'}
                </span>
                <Icon name="arrow" size={16} />
              </a>
            ))}
          </div>
        </section>
      </div>
      <p className="admin-dashboard__data-note">
        <span aria-hidden="true">i</span>
        Counts are loaded from secured Supabase admin data. Transaction totals include posted records in UTC for today.
      </p>
    </div>
  )
}
