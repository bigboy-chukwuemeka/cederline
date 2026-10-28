import { useEffect, useState } from 'react'
import './AdminTransactions.css'
import { supabase } from './lib/supabase.js'
import AdminSelect from './components/AdminSelect.jsx'

const PAGE_SIZE = 10
const statusOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending review' },
  { value: 'posted', label: 'Posted' },
  { value: 'reversed', label: 'Reversed' },
  { value: 'failed', label: 'Failed' },
  { value: 'flagged', label: 'Flagged' },
]

const typeOptions = [
  { value: 'all', label: 'All types' },
  { value: 'debit', label: 'Debit' },
  { value: 'credit', label: 'Credit' },
]

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date)
}

function formatMoney(amount, currency = 'USD') {
  const value = Number(amount)
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.trim() || 'USD' }).format(value)
}

function maskedReference(value) {
  return value || '—'
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

async function functionErrorMessage(error) {
  const response = error?.context
  if (response && typeof response.json === 'function') {
    try {
      const body = await response.json()
      if (typeof body?.error === 'string') return body.error
    } catch {
      return error.message || 'The admin request failed.'
    }
  }
  return error?.message || 'The admin request failed.'
}

function TransactionStatus({ transaction }) {
  const label = transaction.is_flagged
    ? 'Flagged'
    : { pending: 'Pending review', posted: 'Posted', reversed: 'Reversed', failed: 'Failed' }[transaction.status] || transaction.status
  const key = transaction.is_flagged ? 'flagged' : transaction.status
  return <span className={`admin-transactions__status admin-transactions__status--${key}`}><span />{label}</span>
}

function localDateBoundary(date, end = false) {
  if (!date) return null
  const parsed = new Date(`${date}T${end ? '23:59:59.999' : '00:00:00.000'}`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export default function AdminTransactions() {
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('q') || '')
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [page, setPage] = useState(1)
  const [reloadCount, setReloadCount] = useState(0)
  const [transactions, setTransactions] = useState([])
  const [total, setTotal] = useState(0)
  const [flaggedTotal, setFlaggedTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [externalRequests, setExternalRequests] = useState([])
  const [externalRequestsLoading, setExternalRequestsLoading] = useState(true)
  const [externalRequestsError, setExternalRequestsError] = useState('')
  const [externalRequestDetails, setExternalRequestDetails] = useState(null)
  const [externalDetailsLoading, setExternalDetailsLoading] = useState(false)
  const [externalDetailsError, setExternalDetailsError] = useState('')
  const [externalReview, setExternalReview] = useState(null)
  const [externalReviewReason, setExternalReviewReason] = useState('')
  const [includeNumericInput, setIncludeNumericInput] = useState(false)
  const [numericInputLabel, setNumericInputLabel] = useState('')
  const [selectedTransaction, setSelectedTransaction] = useState(null)
  const [details, setDetails] = useState(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [flagTarget, setFlagTarget] = useState(null)
  const [unflagTarget, setUnflagTarget] = useState(null)
  const [transferReview, setTransferReview] = useState(null)
  const [flagReason, setFlagReason] = useState('')
  const [reviewReason, setReviewReason] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')
  const [actionBusy, setActionBusy] = useState(false)

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      if (!supabase) {
        setError('Supabase is not configured. Add the public Supabase URL and key before loading transactions.')
        setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      const { data, error: requestError } = await supabase.functions.invoke('admin-transactions', {
        body: {
          action: 'list',
          search,
          status,
          type,
          from: localDateBoundary(fromDate),
          to: localDateBoundary(toDate, true),
          minAmount,
          maxAmount,
          page,
          pageSize: PAGE_SIZE,
        },
      })
      if (!active) return
      if (requestError) {
        setError(await functionErrorMessage(requestError))
        setTransactions([])
        setTotal(0)
      } else if (data?.error) {
        setError(data.error)
        setTransactions([])
        setTotal(0)
      } else {
        setTransactions(data.transactions || [])
        setTotal(data.total || 0)
        setFlaggedTotal(data.flagged_total || 0)
      }
      setLoading(false)
    }, search.trim() ? 250 : 0)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [search, status, type, fromDate, toDate, minAmount, maxAmount, page, reloadCount])

  useEffect(() => {
    let active = true
    async function loadExternalRequests() {
      if (!supabase) {
        setExternalRequestsError('Supabase is not configured.')
        setExternalRequestsLoading(false)
        return
      }
      setExternalRequestsLoading(true)
      setExternalRequestsError('')
      const { data, error: requestError } = await supabase.functions.invoke('admin-transactions', {
        body: { action: 'list_external_requests' },
      })
      if (!active) return
      if (requestError) {
        setExternalRequestsError(await functionErrorMessage(requestError))
        setExternalRequests([])
      } else if (data?.error) {
        setExternalRequestsError(data.error)
        setExternalRequests([])
      } else {
        setExternalRequests(data.requests || [])
      }
      setExternalRequestsLoading(false)
    }
    void loadExternalRequests()
    const intervalId = window.setInterval(() => void loadExternalRequests(), 30000)
    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [reloadCount])

  function updateFilter(setter, value) {
    setter(value)
    setPage(1)
  }

  async function openDetails(transaction) {
    if (!supabase) return
    setSelectedTransaction(transaction)
    setDetails(null)
    setDetailsError('')
    setDetailsLoading(true)
    const { data, error: requestError } = await supabase.functions.invoke('admin-transactions', {
      body: { action: 'details', transactionId: transaction.id },
    })
    if (requestError) {
      setDetailsError(await functionErrorMessage(requestError))
    } else if (data?.error) {
      setDetailsError(data.error)
    } else {
      setDetails(data)
    }
    setDetailsLoading(false)
  }

  async function submitFlag(event) {
    event.preventDefault()
    if (!flagTarget || !supabase) return
    setActionBusy(true)
    setActionError('')
    setActionSuccess('')
    const { data, error: requestError } = await supabase.functions.invoke('admin-transactions', {
      body: { action: 'flag', transactionId: flagTarget.id, reason: flagReason.trim() },
    })
    if (requestError) {
      setActionError(await functionErrorMessage(requestError))
      setActionBusy(false)
      return
    }
    if (data?.error) {
      setActionError(data.error)
      setActionBusy(false)
      return
    }

    setTransactions((current) => current.map((transaction) => transaction.id === data.id ? { ...transaction, ...data } : transaction))
    setFlaggedTotal((current) => current + 1)
    setFlagTarget(null)
    setFlagReason('')
    setActionSuccess('Transaction flagged and recorded in the audit log.')
    setActionBusy(false)
    if (selectedTransaction?.id === data.id) {
      const { data: updatedDetails, error: detailsRequestError } = await supabase.functions.invoke('admin-transactions', {
        body: { action: 'details', transactionId: data.id },
      })
      if (detailsRequestError) {
        setDetailsError(await functionErrorMessage(detailsRequestError))
      } else if (updatedDetails?.error) {
        setDetailsError(updatedDetails.error)
      } else {
        setDetails(updatedDetails)
      }
    }
    setReloadCount((count) => count + 1)
  }

  async function submitUnflag() {
    if (!unflagTarget || !supabase) return
    setActionBusy(true)
    setActionError('')
    setActionSuccess('')
    const { data, error: requestError } = await supabase.functions.invoke('admin-transactions', {
      body: { action: 'unflag', transactionId: unflagTarget.id },
    })
    if (requestError) {
      setActionError(await functionErrorMessage(requestError))
      setActionBusy(false)
      return
    }
    if (data?.error) {
      setActionError(data.error)
      setActionBusy(false)
      return
    }

    setTransactions((current) => current.map((transaction) => transaction.id === data.id
      ? { ...transaction, ...data }
      : transaction))
    setFlaggedTotal((current) => Math.max(0, current - 1))
    setUnflagTarget(null)
    if (status === 'flagged' && total > 0 && total - 1 <= (page - 1) * PAGE_SIZE) {
      setPage((current) => Math.max(1, current - 1))
    }
    setActionSuccess('Transaction flag removed and recorded in the audit log.')
    setActionBusy(false)
    if (selectedTransaction?.id === data.id) {
      const { data: updatedDetails, error: detailsRequestError } = await supabase.functions.invoke('admin-transactions', {
        body: { action: 'details', transactionId: data.id },
      })
      if (detailsRequestError) {
        setDetailsError(await functionErrorMessage(detailsRequestError))
      } else if (updatedDetails?.error) {
        setDetailsError(updatedDetails.error)
      } else {
        setDetails(updatedDetails)
      }
    }
    setReloadCount((count) => count + 1)
  }

  async function submitTransferReview(event) {
    event.preventDefault()
    if (!transferReview || !supabase) return
    setActionBusy(true)
    setActionError('')
    setActionSuccess('')
    const { data, error: requestError } = await supabase.functions.invoke('admin-transactions', {
      body: {
        action: 'review_transfer',
        transferId: transferReview.transferId,
        decision: transferReview.decision,
        reason: reviewReason.trim(),
      },
    })
    if (requestError) {
      setActionError(await functionErrorMessage(requestError))
      setActionBusy(false)
      return
    }
    if (data?.error) {
      setActionError(data.error)
      setActionBusy(false)
      return
    }

    setTransferReview(null)
    setReviewReason('')
    setActionBusy(false)
    setActionSuccess(data.status === 'completed'
      ? 'Transfer approved and posted to both accounts.'
      : 'Transfer rejected. No funds were moved.')
    setReloadCount((count) => count + 1)

    if (selectedTransaction && details?.transfer?.id === transferReview.transferId) {
      const { data: updatedDetails, error: detailsRequestError } = await supabase.functions.invoke('admin-transactions', {
        body: { action: 'details', transactionId: selectedTransaction.id },
      })
      if (detailsRequestError) {
        setDetailsError(await functionErrorMessage(detailsRequestError))
      } else if (updatedDetails?.error) {
        setDetailsError(updatedDetails.error)
      } else {
        setDetails(updatedDetails)
        setSelectedTransaction((current) => current ? { ...current, status: data.status === 'completed' ? 'posted' : 'failed' } : current)
      }
    }
  }

  async function openExternalRequest(request) {
    if (!supabase) return
    setExternalRequestDetails(null)
    setExternalDetailsError('')
    setExternalDetailsLoading(true)
    const { data, error: requestError } = await supabase.functions.invoke('admin-transactions', {
      body: { action: 'external_request_details', requestId: request.id },
    })
    if (requestError) {
      setExternalDetailsError(await functionErrorMessage(requestError))
    } else if (data?.error) {
      setExternalDetailsError(data.error)
    } else {
      setExternalRequestDetails(data)
    }
    setExternalDetailsLoading(false)
  }

  async function submitExternalReview(event) {
    event.preventDefault()
    if (!externalReview || !supabase) return
    setActionBusy(true)
    setActionError('')
    setActionSuccess('')
    const { data, error: requestError } = await supabase.functions.invoke('admin-transactions', {
      body: {
        action: 'review_external_request',
        requestId: externalReview.requestId,
        decision: externalReview.decision,
        reason: externalReviewReason.trim(),
        responsePrompt: includeNumericInput ? numericInputLabel.trim() : null,
      },
    })
    if (requestError) {
      setActionError(await functionErrorMessage(requestError))
      setActionBusy(false)
      return
    }
    if (data?.error) {
      setActionError(data.error)
      setActionBusy(false)
      return
    }

    const decision = externalReview.decision
    setExternalReview(null)
    setExternalRequestDetails(null)
    setExternalReviewReason('')
    setIncludeNumericInput(false)
    setNumericInputLabel('')
    setActionBusy(false)
    setActionSuccess(decision === 'approve'
      ? 'External transfer request approved.'
      : 'External transfer request rejected. Reserved funds were released.')
    setReloadCount((count) => count + 1)
  }

  function startExternalReview(decision) {
    if (!externalRequestDetails?.id) return
    setActionError('')
    setExternalReviewReason('')
    setIncludeNumericInput(false)
    setNumericInputLabel('')
    setExternalReview({ requestId: externalRequestDetails.id, decision })
  }

  function startTransferReview(decision) {
    if (!details?.transfer?.id) return
    setActionError('')
    setReviewReason('')
    setTransferReview({ transferId: details.transfer.id, decision })
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const validationMessage = minAmount !== '' && maxAmount !== '' && Number(minAmount) > Number(maxAmount)
    ? 'Minimum amount must not exceed maximum amount.'
    : fromDate && toDate && fromDate > toDate
      ? 'Start date must be before the end date.'
      : ''

  return (
    <div className="admin-transactions">
      <div className="admin-transactions__overview">
        <button
          className={`admin-transactions__flagged-summary${status === 'flagged' ? ' admin-transactions__flagged-summary--active' : ''}`}
          onClick={() => updateFilter(setStatus, status === 'flagged' ? 'all' : 'flagged')}
          type="button"
        >
          <span className="admin-transactions__flagged-icon" aria-hidden="true">!</span>
          <span><small>Flagged transactions</small><strong>{flaggedTotal.toLocaleString()}</strong></span>
          <span className="admin-transactions__summary-link">{status === 'flagged' ? 'Show all' : 'Review flagged →'}</span>
        </button>
      </div>

      <section className="admin-transactions__filters" aria-label="Transaction filters">
        <div className="admin-transactions__filter-row">
          <label className="admin-transactions__search">
            <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></svg>
            <input aria-label="Search transactions" onChange={(event) => updateFilter(setSearch, event.target.value)} placeholder="Search user, email, account, reference" value={search} />
          </label>
          <AdminSelect
            ariaLabel="Filter transactions by status"
            label="Status"
            onChange={(value) => updateFilter(setStatus, value)}
            options={statusOptions}
            value={status}
          />
          <AdminSelect
            ariaLabel="Filter transactions by type"
            label="Type"
            onChange={(value) => updateFilter(setType, value)}
            options={typeOptions}
            value={type}
          />
        </div>
        <div className="admin-transactions__filter-row admin-transactions__filter-row--secondary">
          <label className="admin-transactions__date-filter"><span>From</span><input aria-label="Start date" onChange={(event) => updateFilter(setFromDate, event.target.value)} type="date" value={fromDate} /></label>
          <label className="admin-transactions__date-filter"><span>To</span><input aria-label="End date" onChange={(event) => updateFilter(setToDate, event.target.value)} type="date" value={toDate} /></label>
          <label className="admin-transactions__amount-filter"><span>Min amount</span><input aria-label="Minimum amount" min="0" onChange={(event) => updateFilter(setMinAmount, event.target.value)} placeholder="0.00" step="0.01" type="number" value={minAmount} /></label>
          <label className="admin-transactions__amount-filter"><span>Max amount</span><input aria-label="Maximum amount" min="0" onChange={(event) => updateFilter(setMaxAmount, event.target.value)} placeholder="No limit" step="0.01" type="number" value={maxAmount} /></label>
          <span className="admin-transactions__total">{total.toLocaleString()} transactions</span>
        </div>
        {validationMessage && <p className="admin-transactions__validation" role="alert">{validationMessage}</p>}
      </section>

      {actionSuccess && <p className="admin-transactions__success" role="status">{actionSuccess}</p>}

      <section className="admin-transactions__external-queue" aria-labelledby="external-transfer-queue-title">
        <header>
          <div>
            <h2 id="external-transfer-queue-title">External bank requests</h2>
            <p>Pending requests and requests with customer questions appear here.</p>
          </div>
          <button
            className="admin-transactions__external-refresh"
            disabled={externalRequestsLoading}
            onClick={() => setReloadCount((count) => count + 1)}
            type="button"
          >
            {externalRequestsLoading ? 'Updating…' : 'Refresh'}
          </button>
        </header>
        {externalRequestsError ? (
          <p className="admin-transactions__external-error" role="alert">{externalRequestsError}</p>
        ) : externalRequestsLoading && externalRequests.length === 0 ? (
          <p className="admin-transactions__external-empty" role="status">Loading external bank requests…</p>
        ) : externalRequests.length === 0 ? (
          <p className="admin-transactions__external-empty" role="status">No external bank requests need review or a customer response.</p>
        ) : (
          <div className="admin-transactions__table-wrap">
            <table className="admin-transactions__table admin-transactions__external-table">
              <thead>
                <tr>
                  <th scope="col">Submitted</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Sender account</th>
                  <th scope="col">Recipient bank</th>
                  <th scope="col">Recipient account</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col">Customer input</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {externalRequests.map((request) => (
                  <tr key={request.id}>
                    <td className="admin-transactions__date">{formatDateTime(request.created_at)}</td>
                    <td>
                      <div className="admin-transactions__external-customer">
                        <strong>{request.sender_name}</strong>
                        <small>{request.sender_email}</small>
                      </div>
                    </td>
                    <td className="admin-transactions__capitalize">{request.sender_account_type} ···· {request.sender_account_last_four}</td>
                    <td>{request.bank_name}</td>
                    <td>{request.recipient_name} ···· {request.account_last_four}</td>
                    <td className="admin-transactions__amount">{formatMoney(request.amount, request.currency)}</td>
                    <td>
                      {request.status === 'pending'
                        ? 'Awaiting review'
                        : `${request.status === 'approved' ? 'Approved' : 'Declined'} · ${typeof request.customer_response === 'number' ? 'Response received' : 'Awaiting response'}`}
                    </td>
                    <td>
                      {typeof request.customer_response === 'number'
                        ? <><strong>{request.customer_response}</strong><small className="admin-transactions__response-label">{request.response_prompt}</small></>
                        : request.response_prompt
                          ? (request.status === 'pending' ? 'Available after review' : 'No response yet')
                          : '—'}
                    </td>
                    <td>
                      <button className="admin-transactions__view" onClick={() => openExternalRequest(request)} type="button">
                        {request.status === 'pending' ? 'Review' : 'View'} <span aria-hidden="true">→</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {error && (
        <div className="admin-transactions__error" role="alert">
          <strong>Transactions could not be loaded</strong>
          <span>{error}</span>
          <small>Apply the transaction review migration and deploy the <code>admin-transactions</code> Supabase Edge Function.</small>
        </div>
      )}

      <div className="admin-transactions__table-wrap">
        <table className="admin-transactions__table">
          <thead>
            <tr>
              <th scope="col">Date &amp; time (UTC)</th>
              <th scope="col">User</th>
              <th scope="col">Account</th>
              <th scope="col">Type</th>
              <th scope="col" className="admin-transactions__amount-heading">Amount</th>
              <th scope="col">Status</th>
              <th scope="col" className="admin-transactions__actions-heading">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="admin-transactions__empty" colSpan="7" role="status">Loading platform transactions…</td></tr>
            ) : error || validationMessage ? (
              <tr><td className="admin-transactions__empty" colSpan="7">Transaction records are unavailable for these filters.</td></tr>
            ) : transactions.length === 0 ? (
              <tr><td className="admin-transactions__empty" colSpan="7">No transactions match these filters.</td></tr>
            ) : transactions.map((transaction) => (
              <tr key={transaction.id}>
                <td className="admin-transactions__date">{formatDateTime(transaction.occurred_at)}</td>
                <td>
                  <div className="admin-transactions__identity">
                    <span className="admin-transactions__initials">{getInitials(transaction.user_name)}</span>
                    <span><strong>{transaction.user_name || 'Unnamed user'}</strong><small>{transaction.user_email}</small></span>
                  </div>
                </td>
                <td><span className="admin-transactions__account">{transaction.account_name || transaction.account_type}</span><small className="admin-transactions__account-number">•••• {transaction.account_last_four}</small></td>
                <td><span className={`admin-transactions__type admin-transactions__type--${transaction.transaction_type}`}>{transaction.transaction_type}</span></td>
                <td className={`admin-transactions__amount admin-transactions__amount--${transaction.transaction_type}`}>
                  {transaction.transaction_type === 'credit' ? '+' : '−'}{formatMoney(transaction.amount, transaction.currency)}
                </td>
                <td><TransactionStatus transaction={transaction} /></td>
                <td>
                  <div className="admin-transactions__row-actions">
                    <button className="admin-transactions__view" type="button" onClick={() => openDetails(transaction)}>{transaction.status === 'pending' ? 'Review' : 'View'} <span aria-hidden="true">→</span></button>
                    {transaction.status === 'pending' ? null : transaction.is_flagged ? (
                      <button className="admin-transactions__unflag" type="button" onClick={() => { setUnflagTarget(transaction); setActionError('') }}>Remove flag</button>
                    ) : (
                      <button className="admin-transactions__flag" type="button" onClick={() => { setFlagTarget(transaction); setFlagReason(''); setActionError('') }}>Flag</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="admin-transactions__footer">
        <span>{total === 0 ? 'Showing 0 transactions' : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString()} transactions`}</span>
        <div className="admin-transactions__pagination">
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</button>
          <span>{page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next</button>
        </div>
      </footer>

      <p className="admin-transactions__note"><span aria-hidden="true">i</span> New customer transfers remain pending and reserve funds until an administrator approves or rejects them. Flagging applies to posted transactions and does not reverse funds.</p>

      {selectedTransaction && (
        <div className="admin-transactions__overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedTransaction(null)
        }}>
          <section className="admin-transactions__dialog" role="dialog" aria-modal="true" aria-labelledby="admin-transaction-detail-title">
            <header className="admin-transactions__dialog-header">
              <div>
                <p className="admin-transactions__eyebrow">Transaction record</p>
                <h2 id="admin-transaction-detail-title">{details?.description || selectedTransaction.description}</h2>
                <p>{maskedReference(details?.reference || selectedTransaction.reference)}</p>
              </div>
              <button className="admin-transactions__close" type="button" aria-label="Close transaction details" onClick={() => setSelectedTransaction(null)}>×</button>
            </header>
            {detailsLoading ? (
              <p className="admin-transactions__detail-state" role="status">Loading secured transaction details…</p>
            ) : detailsError ? (
              <p className="admin-transactions__detail-error" role="alert">{detailsError}</p>
            ) : details && (
              <div className="admin-transactions__detail-content">
                {details.is_flagged && <aside className="admin-transactions__flag-banner"><strong>Flagged as suspicious</strong><span>{details.flag_reason}</span><small>Flagged {formatDateTime(details.flagged_at)}</small></aside>}
                <section className="admin-transactions__detail-section">
                  <h3>Transaction information</h3>
                  <dl>
                    <div><dt>Transaction ID</dt><dd>{details.id}</dd></div>
                    <div><dt>Date &amp; time (UTC)</dt><dd>{formatDateTime(details.occurred_at)}</dd></div>
                    <div><dt>Type</dt><dd className="admin-transactions__capitalize">{details.transaction_type}</dd></div>
                    <div><dt>Posting status</dt><dd className="admin-transactions__capitalize">{details.status}</dd></div>
                    <div><dt>Amount</dt><dd>{details.transaction_type === 'credit' ? '+' : '−'}{formatMoney(details.amount, details.currency)}</dd></div>
                    <div><dt>Balance after</dt><dd>{details.balance_after == null ? 'Not available' : formatMoney(details.balance_after, details.currency)}</dd></div>
                    <div><dt>Description</dt><dd>{details.description}</dd></div>
                    <div><dt>Reference</dt><dd>{details.reference || 'Not provided'}</dd></div>
                    <div><dt>Counterparty</dt><dd>{details.counterparty_name || 'Not provided'}</dd></div>
                    <div><dt>Counterparty account</dt><dd>{details.counterparty_account_last_four ? `Ending ${details.counterparty_account_last_four}` : 'Not provided'}</dd></div>
                  </dl>
                </section>
                <div className="admin-transactions__detail-columns">
                  <section className="admin-transactions__detail-section">
                    <h3>User</h3>
                    <strong>{details.user.display_name}</strong>
                    <small>{details.user.email}</small>
                  </section>
                  <section className="admin-transactions__detail-section">
                    <h3>Account</h3>
                    <strong>{details.account.name || details.account.account_type}</strong>
                    <small>{details.account.account_type} · ending {details.account.last_four} · {details.account.status}{details.account.is_on_hold ? ' · On Hold' : ''}</small>
                  </section>
                </div>
                {details.transfer && (
                  <section className="admin-transactions__detail-section">
                    <h3>Transfer</h3>
                    <dl><div><dt>Transfer status</dt><dd className="admin-transactions__capitalize">{details.transfer.status === 'pending' ? 'Pending admin review' : details.transfer.status}</dd></div><div><dt>Memo</dt><dd>{details.transfer.memo || 'Not provided'}</dd></div><div><dt>Completed</dt><dd>{formatDateTime(details.transfer.completed_at)}</dd></div></dl>
                  </section>
                )}
              </div>
            )}
            <footer className="admin-transactions__dialog-footer">
              {details?.transfer?.status === 'pending' ? (
                <>
                  <button className="admin-transactions__action admin-transactions__action--unflag" type="button" onClick={() => startTransferReview('approve')}>Approve and post</button>
                  <button className="admin-transactions__action admin-transactions__action--flag" type="button" onClick={() => startTransferReview('reject')}>Reject transfer</button>
                </>
              ) : details?.is_flagged ? (
                <button className="admin-transactions__action admin-transactions__action--secondary" type="button" onClick={() => { setUnflagTarget(selectedTransaction); setActionError('') }}>Remove flag</button>
              ) : (
                <button className="admin-transactions__action admin-transactions__action--flag" type="button" onClick={() => { setFlagTarget(selectedTransaction); setFlagReason(''); setActionError('') }}>Flag as suspicious</button>
              )}
              <button className="admin-transactions__action admin-transactions__action--secondary" type="button" onClick={() => setSelectedTransaction(null)}>Close</button>
            </footer>
          </section>
        </div>
      )}

      {(externalRequestDetails || externalDetailsLoading || externalDetailsError) && (
        <div className="admin-transactions__overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setExternalRequestDetails(null)
        }}>
          <section className="admin-transactions__dialog" role="dialog" aria-modal="true" aria-labelledby="external-transfer-detail-title">
            <header className="admin-transactions__dialog-header">
              <div>
                <p className="admin-transactions__eyebrow">External transfer request</p>
                <h2 id="external-transfer-detail-title">{externalRequestDetails?.reference || 'Loading request'}</h2>
                {externalRequestDetails?.created_at && <p>{formatDateTime(externalRequestDetails.created_at)}</p>}
              </div>
              <button className="admin-transactions__close" type="button" aria-label="Close external transfer details" onClick={() => setExternalRequestDetails(null)}>×</button>
            </header>
            {externalDetailsLoading ? (
              <p className="admin-transactions__detail-state" role="status">Loading secured external transfer details…</p>
            ) : externalDetailsError ? (
              <p className="admin-transactions__detail-error" role="alert">{externalDetailsError}</p>
            ) : (
              <div className="admin-transactions__detail-content">
                <p className="admin-transactions__external-security-note">Full recipient account details are shown only in this audited administrator view. Do not copy them into messages or notes.</p>
                <section className="admin-transactions__detail-section">
                  <h3>Customer and funding</h3>
                  <dl>
                    <div><dt>Customer</dt><dd>{externalRequestDetails.sender_name} · {externalRequestDetails.sender_email}</dd></div>
                    <div><dt>From account</dt><dd>{externalRequestDetails.sender_account_name} · {externalRequestDetails.sender_account_type} ending {externalRequestDetails.sender_account_last_four}</dd></div>
                    <div><dt>Requested amount</dt><dd>{formatMoney(externalRequestDetails.amount, externalRequestDetails.currency)}</dd></div>
                    <div><dt>Request status</dt><dd className="admin-transactions__capitalize">{externalRequestDetails.status}</dd></div>
                    <div><dt>Memo</dt><dd>{externalRequestDetails.memo || 'Not provided'}</dd></div>
                    {externalRequestDetails.response_prompt && (
                      <>
                        <div><dt>Customer input</dt><dd>{externalRequestDetails.response_prompt}</dd></div>
                        <div><dt>Customer response</dt><dd>{typeof externalRequestDetails.customer_response === 'number' ? externalRequestDetails.customer_response : 'Not answered'}</dd></div>
                      </>
                    )}
                  </dl>
                </section>
                <section className="admin-transactions__detail-section">
                  <h3>Recipient bank details</h3>
                  <dl>
                    <div><dt>Recipient</dt><dd>{externalRequestDetails.recipient_name}</dd></div>
                    <div><dt>Bank</dt><dd>{externalRequestDetails.bank_name}</dd></div>
                    <div><dt>Account type</dt><dd className="admin-transactions__capitalize">{externalRequestDetails.account_type}</dd></div>
                    <div><dt>Routing number</dt><dd>{externalRequestDetails.routing_number}</dd></div>
                    <div><dt>Account number</dt><dd>{externalRequestDetails.account_number}</dd></div>
                  </dl>
                </section>
              </div>
            )}
            <footer className="admin-transactions__dialog-footer">
              {externalRequestDetails?.status === 'pending' && !externalDetailsError && (
                <>
                  <button className="admin-transactions__action admin-transactions__action--unflag" onClick={() => startExternalReview('approve')} type="button">Approve for processing</button>
                  <button className="admin-transactions__action admin-transactions__action--flag" onClick={() => startExternalReview('reject')} type="button">Reject request</button>
                </>
              )}
              <button className="admin-transactions__action admin-transactions__action--secondary" onClick={() => setExternalRequestDetails(null)} type="button">Close</button>
            </footer>
          </section>
        </div>
      )}

      {flagTarget && (
        <div className="admin-transactions__overlay admin-transactions__overlay--confirm">
          <form className="admin-transactions__confirm" onSubmit={submitFlag} role="dialog" aria-modal="true" aria-labelledby="admin-transaction-flag-title">
            <span className="admin-transactions__confirm-mark" aria-hidden="true">!</span>
            <p className="admin-transactions__eyebrow">Sensitive transaction action</p>
            <h2 id="admin-transaction-flag-title">Flag as suspicious?</h2>
            <p className="admin-transactions__confirm-copy">This adds the transaction to the flagged review queue and records the reason in the audit log. It does not reverse or block the transaction.</p>
            <label className="admin-transactions__reason">
              Flag reason
              <textarea autoFocus maxLength={500} minLength={5} onChange={(event) => setFlagReason(event.target.value)} placeholder="Describe the suspicious activity..." required rows="3" value={flagReason} />
            </label>
            {actionError && <p className="admin-transactions__action-error" role="alert">{actionError}</p>}
            <div className="admin-transactions__confirm-actions">
              <button className="admin-transactions__action admin-transactions__action--secondary" disabled={actionBusy} onClick={() => setFlagTarget(null)} type="button">Cancel</button>
              <button className="admin-transactions__action admin-transactions__action--flag" disabled={actionBusy || flagReason.trim().length < 5} type="submit">{actionBusy ? 'Recording…' : 'Confirm flag'}</button>
            </div>
          </form>
        </div>
      )}

      {unflagTarget && (
        <div className="admin-transactions__overlay admin-transactions__overlay--confirm">
          <section className="admin-transactions__confirm" role="dialog" aria-modal="true" aria-labelledby="admin-transaction-unflag-title">
            <span className="admin-transactions__confirm-mark admin-transactions__confirm-mark--neutral" aria-hidden="true">✓</span>
            <p className="admin-transactions__eyebrow">Transaction review</p>
            <h2 id="admin-transaction-unflag-title">Remove suspicious flag?</h2>
            <p className="admin-transactions__confirm-copy">The transaction will leave the flagged queue. The original flag reason and administrator will remain in the audit log.</p>
            {actionError && <p className="admin-transactions__action-error" role="alert">{actionError}</p>}
            <div className="admin-transactions__confirm-actions">
              <button className="admin-transactions__action admin-transactions__action--secondary" disabled={actionBusy} onClick={() => setUnflagTarget(null)} type="button">Cancel</button>
              <button className="admin-transactions__action admin-transactions__action--unflag" disabled={actionBusy} onClick={submitUnflag} type="button">{actionBusy ? 'Removing…' : 'Confirm removal'}</button>
            </div>
          </section>
        </div>
      )}

      {transferReview && (
        <div className="admin-transactions__overlay admin-transactions__overlay--confirm">
          <form className="admin-transactions__confirm" onSubmit={submitTransferReview} role="dialog" aria-modal="true" aria-labelledby="admin-transfer-review-title">
            <span className={`admin-transactions__confirm-mark${transferReview.decision === 'approve' ? ' admin-transactions__confirm-mark--neutral' : ''}`} aria-hidden="true">
              {transferReview.decision === 'approve' ? '✓' : '!'}
            </span>
            <p className="admin-transactions__eyebrow">Pending transfer review</p>
            <h2 id="admin-transfer-review-title">{transferReview.decision === 'approve' ? 'Approve and post transfer?' : 'Reject transfer request?'}</h2>
            <p className="admin-transactions__confirm-copy">
              {transferReview.decision === 'approve'
                ? 'Approval will debit the sender and credit the recipient atomically. Both customers will be notified.'
                : 'Rejection will release the reserved amount and leave both account balances unchanged.'}
            </p>
            {transferReview.decision === 'reject' && (
              <label className="admin-transactions__reason">
                Rejection reason
                <textarea autoFocus maxLength={500} minLength={5} onChange={(event) => setReviewReason(event.target.value)} placeholder="Enter the reason for rejecting this transfer..." required rows="3" value={reviewReason} />
              </label>
            )}
            {actionError && <p className="admin-transactions__action-error" role="alert">{actionError}</p>}
            <div className="admin-transactions__confirm-actions">
              <button className="admin-transactions__action admin-transactions__action--secondary" disabled={actionBusy} onClick={() => setTransferReview(null)} type="button">Cancel</button>
              <button className={`admin-transactions__action${transferReview.decision === 'approve' ? ' admin-transactions__action--unflag' : ' admin-transactions__action--flag'}`} disabled={actionBusy || (transferReview.decision === 'reject' && reviewReason.trim().length < 5)} type="submit">
                {actionBusy ? 'Processing…' : transferReview.decision === 'approve' ? 'Confirm approval' : 'Confirm rejection'}
              </button>
            </div>
          </form>
        </div>
      )}

      {externalReview && (
        <div className="admin-transactions__overlay admin-transactions__overlay--confirm">
          <form className="admin-transactions__confirm" onSubmit={submitExternalReview} role="dialog" aria-modal="true" aria-labelledby="admin-external-transfer-review-title">
            <span className={`admin-transactions__confirm-mark${externalReview.decision === 'approve' ? ' admin-transactions__confirm-mark--neutral' : ''}`} aria-hidden="true">
              {externalReview.decision === 'approve' ? '✓' : '!'}
            </span>
            <p className="admin-transactions__eyebrow">External transfer request</p>
            <h2 id="admin-external-transfer-review-title">{externalReview.decision === 'approve' ? 'Approve transfer request?' : 'Reject this request?'}</h2>
            <p className="admin-transactions__confirm-copy">
              {externalReview.decision === 'approve'
                ? 'The request will be approved and the customer will be notified. The reserved amount will be released.'
                : 'This rejects the request, notifies the customer, and releases the reserved funds.'}
            </p>
            <label className="admin-transactions__reason">
              Customer message or review note{externalReview.decision === 'reject' ? ' (required)' : ' (optional)'}
              <textarea
                autoFocus
                maxLength={500}
                minLength={externalReview.decision === 'reject' ? 5 : undefined}
                onChange={(event) => setExternalReviewReason(event.target.value)}
                placeholder={externalReview.decision === 'reject' ? 'Explain why this request is being declined...' : 'Add a message for the customer...'}
                required={externalReview.decision === 'reject'}
                rows="3"
                value={externalReviewReason}
              />
            </label>
            <label className="admin-transactions__numeric-toggle">
              <input
                checked={includeNumericInput}
                onChange={(event) => {
                  setIncludeNumericInput(event.target.checked)
                  if (!event.target.checked) setNumericInputLabel('')
                }}
                type="checkbox"
              />
              <span>Add a number input for the customer</span>
            </label>
            {includeNumericInput && (
              <label className="admin-transactions__reason admin-transactions__numeric-prompt">
                Number input label
                <input
                  autoComplete="off"
                  maxLength={160}
                  onChange={(event) => setNumericInputLabel(event.target.value)}
                  placeholder="For example: Enter the amount"
                  required
                  value={numericInputLabel}
                />
              </label>
            )}
            {actionError && <p className="admin-transactions__action-error" role="alert">{actionError}</p>}
            <div className="admin-transactions__confirm-actions">
              <button className="admin-transactions__action admin-transactions__action--secondary" disabled={actionBusy} onClick={() => setExternalReview(null)} type="button">Cancel</button>
              <button
                className={`admin-transactions__action${externalReview.decision === 'approve' ? ' admin-transactions__action--unflag' : ' admin-transactions__action--flag'}`}
                disabled={actionBusy || (externalReview.decision === 'reject' && externalReviewReason.trim().length < 5) || (includeNumericInput && !numericInputLabel.trim())}
                type="submit"
              >
                {actionBusy ? 'Recording…' : externalReview.decision === 'approve' ? 'Confirm approval' : 'Confirm rejection'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
