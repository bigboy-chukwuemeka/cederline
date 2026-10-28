import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase.js'
import './AdminAuditLogs.css'
import AdminSelect from './components/AdminSelect.jsx'

const PAGE_SIZE = 20

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date)
}

function dateBoundary(date, end = false) {
  if (!date) return null
  const parsed = new Date(`${date}T${end ? '23:59:59.999' : '00:00:00.000'}Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function metadataDetails(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return []
  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => {
      let readable
      if (typeof value === 'boolean') readable = value ? 'Yes' : 'No'
      else if (typeof value === 'object') readable = JSON.stringify(value)
      else readable = String(value)
      return `${titleCase(key)}: ${readable}`
    })
}

async function getRequestError(error) {
  if (error?.context && typeof error.context.json === 'function') {
    try {
      const body = await error.context.json()
      if (typeof body?.error === 'string') return body.error
    } catch {
      return error.message || 'The audit-log request failed.'
    }
  }
  return error?.message || 'The audit-log request failed.'
}

function AuditTarget({ log }) {
  if (log.subject_name || log.subject_email) {
    return (
      <div className="admin-audit-logs__target">
        <strong>{log.subject_name || 'Customer'}</strong>
        <small>{log.subject_email || log.subject_user_id}</small>
        {log.account_last_four && <small>{log.account_name || 'Account'} · ending {log.account_last_four}</small>}
      </div>
    )
  }
  if (log.account_last_four) {
    return (
      <div className="admin-audit-logs__target">
        <strong>{log.account_name || 'Account'}</strong>
        <small>Account ending {log.account_last_four}</small>
      </div>
    )
  }
  return (
    <div className="admin-audit-logs__target">
      <strong>{log.resource_type ? titleCase(log.resource_type) : 'System'}</strong>
      <small>{log.resource_id || 'No resource ID'}</small>
    </div>
  )
}

export default function AdminAuditLogs() {
  const [adminSearch, setAdminSearch] = useState('')
  const [actionType, setActionType] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)
  const [reloadCount, setReloadCount] = useState(0)
  const [logs, setLogs] = useState([])
  const [actions, setActions] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      if (!supabase) {
        setError('Supabase is not configured. Add the public Supabase URL and key before loading audit records.')
        setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      const { data, error: requestError } = await supabase.functions.invoke('admin-audit-logs', {
        body: {
          action: 'list',
          adminSearch,
          actionType,
          from: dateBoundary(fromDate),
          to: dateBoundary(toDate, true),
          page,
          pageSize: PAGE_SIZE,
        },
      })
      if (!active) return
      if (requestError) {
        setError(await getRequestError(requestError))
        setLogs([])
        setTotal(0)
      } else if (data?.error) {
        setError(data.error)
        setLogs([])
        setTotal(0)
      } else {
        setLogs(data.logs || [])
        setActions(data.actions || [])
        setTotal(data.total || 0)
      }
      setLoading(false)
    }, adminSearch.trim() ? 250 : 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [adminSearch, actionType, fromDate, toDate, page, reloadCount])

  function updateFilter(setter, value) {
    setter(value)
    setPage(1)
  }

  function resetFilters() {
    setAdminSearch('')
    setActionType('all')
    setFromDate('')
    setToDate('')
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const dateError = fromDate && toDate && fromDate > toDate
    ? 'Start date must be before the end date.'
    : ''

  return (
    <section className="admin-audit-logs" aria-label="Administrator audit logs">
      <div className="admin-audit-logs__summary">
        <div className="admin-audit-logs__summary-icon" aria-hidden="true">◷</div>
        <div className="admin-audit-logs__summary-copy">
          <span>Recorded audit events</span>
          <strong>{total.toLocaleString()}</strong>
          <small>Matching your current filters</small>
        </div>
        <div className="admin-audit-logs__integrity"><span /> Sensitive actions are recorded</div>
      </div>

      <section className="admin-audit-logs__filters" aria-label="Filter audit records">
        <div className="admin-audit-logs__filter-row">
          <label className="admin-audit-logs__search">
            <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></svg>
            <input
              aria-label="Filter by administrator"
              onChange={(event) => updateFilter(setAdminSearch, event.target.value)}
              placeholder="Filter by admin name or email"
              value={adminSearch}
            />
          </label>
          <AdminSelect
            ariaLabel="Filter by action type"
            label="Action type"
            onChange={(value) => updateFilter(setActionType, value)}
            options={[{ value: 'all', label: 'All actions' }, ...actions.map((action) => ({ value: action, label: titleCase(action) }))]}
            value={actionType}
          />
          <button className="admin-audit-logs__refresh" disabled={loading} type="button" onClick={() => setReloadCount((count) => count + 1)}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="admin-audit-logs__reset" type="button" onClick={resetFilters}>Reset filters</button>
        </div>
        <div className="admin-audit-logs__filter-row admin-audit-logs__filter-row--dates">
          <label className="admin-audit-logs__date-filter"><span>From</span><input aria-label="Start date" onChange={(event) => updateFilter(setFromDate, event.target.value)} type="date" value={fromDate} /></label>
          <label className="admin-audit-logs__date-filter"><span>To</span><input aria-label="End date" onChange={(event) => updateFilter(setToDate, event.target.value)} type="date" value={toDate} /></label>
          <span className="admin-audit-logs__filter-hint">Times shown in UTC</span>
        </div>
        {dateError && <p className="admin-audit-logs__validation" role="alert">{dateError}</p>}
      </section>

      {error && (
        <div className="admin-audit-logs__error" role="alert">
          <strong>Audit records could not be loaded</strong>
          <span>{error}</span>
          <small>Apply the admin audit-log migration and deploy the <code>admin-audit-logs</code> Supabase Edge Function.</small>
        </div>
      )}

      <div className="admin-audit-logs__table-wrap">
        <table className="admin-audit-logs__table">
          <thead>
            <tr>
              <th scope="col">Date &amp; Time</th>
              <th scope="col">Admin</th>
              <th scope="col">Action</th>
              <th scope="col">Target (User / Account)</th>
              <th scope="col">Details</th>
              <th scope="col">IP Address</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="admin-audit-logs__empty" colSpan="6" role="status">Loading audit records…</td></tr>
            ) : error || dateError ? (
              <tr><td className="admin-audit-logs__empty" colSpan="6">Audit records are unavailable for these filters.</td></tr>
            ) : logs.length === 0 ? (
              <tr><td className="admin-audit-logs__empty" colSpan="6">No audit events match these filters.</td></tr>
            ) : logs.map((log) => {
              const details = metadataDetails(log.metadata)
              return (
                <tr key={log.id}>
                  <td className="admin-audit-logs__date">
                    <time dateTime={log.created_at}>{formatDateTime(log.created_at)}</time>
                  </td>
                  <td>
                    <div className="admin-audit-logs__admin">
                      <strong>{log.admin_name || (log.actor_user_id ? 'Administrator' : 'System')}</strong>
                      <small>{log.admin_email || (log.actor_user_id ? log.actor_user_id : 'Automated event')}</small>
                    </div>
                  </td>
                  <td><span className="admin-audit-logs__action">{titleCase(log.action)}</span><small className="admin-audit-logs__action-code">{log.action}</small></td>
                  <td><AuditTarget log={log} /></td>
                  <td>
                    <div className="admin-audit-logs__details">
                      {details.length
                        ? details.slice(0, 3).map((detail) => <span key={detail}>{detail}</span>)
                        : <span>{log.resource_type ? `${titleCase(log.resource_type)} event` : 'Administrative event'}</span>}
                      {details.length > 3 && <small>+{details.length - 3} more details</small>}
                    </div>
                  </td>
                  <td className="admin-audit-logs__ip">{log.ip_address || 'Not recorded'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <footer className="admin-audit-logs__footer">
        <span>{total === 0 ? 'Showing 0 audit events' : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString()} audit events`}</span>
        <div className="admin-audit-logs__pagination">
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</button>
          <span>{page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next</button>
        </div>
      </footer>
      <p className="admin-audit-logs__note"><span aria-hidden="true">i</span> Audit events are retained as recorded. The IP address is shown only when it was captured by the originating operation.</p>
    </section>
  )
}
