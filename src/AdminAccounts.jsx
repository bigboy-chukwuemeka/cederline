import { useEffect, useState } from 'react'
import './AdminAccounts.css'
import { supabase } from './lib/supabase.js'
import AdminSelect from './components/AdminSelect.jsx'
import ActionToast from './ActionToast.jsx'

const PAGE_SIZE = 8

const filters = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'closed', label: 'Closed' },
]

const accountTypes = [
  { value: 'all', label: 'All types' },
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'loan', label: 'Loan' },
  { value: 'cd', label: 'CD' },
]

const actionDetails = {
  hold: { title: 'Put account on hold', button: 'Place hold', description: 'Outgoing debits and balance adjustments will be blocked until the hold is released.', requiresReason: true },
  release_hold: { title: 'Release investigation hold', button: 'Release hold', description: 'The investigation restriction will be removed. Provide a reason for releasing it.', requiresReason: true },
  freeze: { title: 'Freeze account', button: 'Freeze account', description: 'The account will be frozen and cannot be used until an administrator unfreezes it.', requiresReason: true },
  unfreeze: { title: 'Unfreeze account', button: 'Unfreeze account', description: 'The account will return to open status. Provide a reason for this change.', requiresReason: true },
  adjust_balance: { title: 'Adjust account balance', button: 'Apply adjustment', description: 'A posted administrative transaction will be created and the new balance recorded.', requiresReason: true },
  send_money: { title: 'Send money to account', button: 'Send funds', description: 'Credit this customer account and create a posted incoming transfer with the sender name shown below.', requiresReason: false },
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

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

function accountTitle(account) {
  const typeLabel = { checking: 'Everyday Checking', savings: 'Evergreen Savings', loan: 'Personal Loan', cd: 'Certificate of Deposit' }
  return account.name || typeLabel[account.account_type] || 'Account'
}

function displayStatus(account) {
  if (account.is_on_hold) return 'on_hold'
  return account.status
}

function canReceiveFunds(account) {
  return account.status === 'open'
    && !account.is_on_hold
    && ['checking', 'savings', 'cd'].includes(account.account_type)
    && account.currency === 'USD'
}

function StatusBadge({ account }) {
  const status = displayStatus(account)
  const label = { open: 'Active', on_hold: 'On Hold', frozen: 'Frozen', closed: 'Closed' }[status] || status
  return <span className={`admin-accounts__status admin-accounts__status--${status}`}><span />{label}</span>
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

export default function AdminAccounts() {
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('q') || '')
  const [status, setStatus] = useState('all')
  const [accountType, setAccountType] = useState('all')
  const [page, setPage] = useState(1)
  const [reloadCount, setReloadCount] = useState(0)
  const [accounts, setAccounts] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [details, setDetails] = useState(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [pendingAction, setPendingAction] = useState(null)
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [senderName, setSenderName] = useState('')
  const [memo, setMemo] = useState('')
  const [fundingRequestId, setFundingRequestId] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      if (!supabase) {
        setError('Supabase is not configured. Add the public Supabase URL and key before loading accounts.')
        setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      const { data, error: requestError } = await supabase.functions.invoke('admin-accounts', {
        body: { action: 'list', search, status, accountType, page, pageSize: PAGE_SIZE },
      })
      if (!active) return
      if (requestError) {
        setError(await functionErrorMessage(requestError))
        setAccounts([])
        setTotal(0)
      } else if (data?.error) {
        setError(data.error)
        setAccounts([])
        setTotal(0)
      } else {
        setAccounts(data.accounts || [])
        setTotal(data.total || 0)
      }
      setLoading(false)
    }, search.trim() ? 250 : 0)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [search, status, accountType, page, reloadCount])

  function setFilter(setter, value) {
    setter(value)
    setPage(1)
  }

  async function openDetails(account) {
    if (!supabase) return
    setSelectedAccount(account)
    setDetails(null)
    setDetailsError('')
    setDetailsLoading(true)
    const { data, error: requestError } = await supabase.functions.invoke('admin-accounts', {
      body: { action: 'details', accountId: account.id },
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

  function startAction(action, account) {
    setPendingAction({ action, account })
    setReason('')
    setAmount('')
    setSenderName('')
    setMemo('')
    setFundingRequestId(action === 'send_money' ? crypto.randomUUID() : '')
    setActionError('')
    setSuccessMessage('')
  }

  async function submitAction(event) {
    event.preventDefault()
    if (!pendingAction || !supabase) return
    setActionBusy(true)
    setActionError('')
    const body = {
      action: pendingAction.action,
      accountId: pendingAction.account.id,
      reason: reason.trim(),
    }
    if (pendingAction.action === 'adjust_balance' || pendingAction.action === 'send_money') body.amount = Number(amount)
    if (pendingAction.action === 'send_money') {
      body.senderName = senderName.trim()
      body.memo = memo.trim()
      body.requestId = fundingRequestId
    }

    const { data, error: requestError } = await supabase.functions.invoke('admin-accounts', { body })
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

    setAccounts((currentAccounts) => currentAccounts.map((account) => account.id === data.id ? { ...account, ...data } : account))
    setSelectedAccount((currentAccount) => currentAccount?.id === data.id ? { ...currentAccount, ...data } : currentAccount)
    setPendingAction(null)
    setActionBusy(false)
    setFundingRequestId('')
    setReloadCount((count) => count + 1)
    setSuccessMessage({
      hold: 'Investigation hold placed. The account is now on hold.',
      release_hold: 'Investigation hold released. The account status has been restored.',
      freeze: 'Account frozen successfully.',
      unfreeze: 'Account unfrozen successfully.',
      adjust_balance: 'Account balance adjusted successfully.',
      send_money: `Funds sent successfully. Reference: ${data.reference}`,
    }[pendingAction.action])

    if (selectedAccount?.id === data.id) {
      const { data: updatedDetails, error: detailError } = await supabase.functions.invoke('admin-accounts', {
        body: { action: 'details', accountId: data.id },
      })
      if (detailError) {
        setDetailsError(await functionErrorMessage(detailError))
      } else if (updatedDetails?.error) {
        setDetailsError(updatedDetails.error)
      } else {
        setDetails(updatedDetails)
      }
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="admin-accounts">
      <ActionToast message={successMessage} onDismiss={() => setSuccessMessage('')} />
      <div className="admin-accounts__toolbar">
        <label className="admin-accounts__search">
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></svg>
          <input aria-label="Search account or owner" onChange={(event) => setFilter(setSearch, event.target.value)} placeholder="Search owner, account ID, or last 4" value={search} />
        </label>
        <AdminSelect
          ariaLabel="Filter accounts by status"
          label="Status"
          onChange={(value) => setFilter(setStatus, value)}
          options={filters}
          value={status}
        />
        <AdminSelect
          ariaLabel="Filter accounts by type"
          label="Account type"
          onChange={(value) => setFilter(setAccountType, value)}
          options={accountTypes}
          value={accountType}
        />
        <span className="admin-accounts__total">{total.toLocaleString()} accounts</span>
      </div>

      {error && (
        <div className="admin-accounts__error" role="alert">
          <strong>Accounts could not be loaded</strong>
          <span>{error}</span>
          <small>Apply the latest admin account migration and deploy the <code>admin-accounts</code> Supabase Edge Function.</small>
        </div>
      )}

      <div className="admin-accounts__table-wrap">
        <table className="admin-accounts__table">
          <thead>
            <tr>
              <th scope="col">Account number</th>
              <th scope="col">User</th>
              <th scope="col">Type</th>
              <th scope="col" className="admin-accounts__balance-heading">Ledger balance</th>
              <th scope="col">Status</th>
              <th scope="col" className="admin-accounts__actions-heading">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="admin-accounts__empty" colSpan="6" role="status">Loading account directory…</td></tr>
            ) : error ? (
              <tr><td className="admin-accounts__empty" colSpan="6">Account records are unavailable.</td></tr>
            ) : accounts.length === 0 ? (
              <tr><td className="admin-accounts__empty" colSpan="6">No accounts match these filters.</td></tr>
            ) : accounts.map((account) => (
              <tr key={account.id}>
                <td><span className="admin-accounts__account-name">{accountTitle(account)}</span><small className="admin-accounts__account-number">EV-•••• {account.last_four}</small></td>
                <td><span className="admin-accounts__owner">{account.user_name || 'Unnamed user'}</span><small className="admin-accounts__owner-email">{account.user_email}</small></td>
                <td className="admin-accounts__type">{account.account_type}</td>
                <td className="admin-accounts__balance">{formatMoney(account.balance, account.currency)}</td>
                <td><StatusBadge account={account} /></td>
                <td>
                  <div className="admin-accounts__row-actions">
                    <button className="admin-accounts__view" type="button" onClick={() => openDetails(account)}>View <span aria-hidden="true">→</span></button>
                    {canReceiveFunds(account) && (
                      <button className="admin-accounts__send-link" type="button" onClick={() => startAction('send_money', account)}>Send money</button>
                    )}
                    {account.is_on_hold ? (
                      <button className="admin-accounts__release-link" type="button" onClick={() => startAction('release_hold', account)}>Release</button>
                    ) : account.status === 'open' ? (
                      <>
                        <button className="admin-accounts__hold-link" type="button" onClick={() => startAction('hold', account)}>Hold</button>
                        <button className="admin-accounts__hold-link" type="button" onClick={() => startAction('freeze', account)}>Freeze</button>
                      </>
                    ) : account.status === 'frozen' ? (
                      <button className="admin-accounts__release-link" type="button" onClick={() => startAction('unfreeze', account)}>Unfreeze</button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="admin-accounts__footer">
        <span>{total === 0 ? 'Showing 0 accounts' : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString()} accounts · USD`}</span>
        <div className="admin-accounts__pagination">
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</button>
          <span>{page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next</button>
        </div>
      </footer>

      <p className="admin-accounts__note"><span aria-hidden="true">i</span> Account numbers are masked. Placing an investigation hold blocks account debits and balance adjustments; it does not close or freeze the account.</p>

      {selectedAccount && (
        <div className="admin-accounts__overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedAccount(null)
        }}>
          <section className="admin-accounts__dialog" role="dialog" aria-modal="true" aria-labelledby="admin-account-detail-title">
            <header className="admin-accounts__dialog-header">
              <div>
                <p className="admin-accounts__eyebrow">Account detail · EV-•••• {selectedAccount.last_four}</p>
                <h2 id="admin-account-detail-title">{accountTitle(details || selectedAccount)}</h2>
                <p>{details?.user?.display_name || selectedAccount.user_name} · {details?.account_type || selectedAccount.account_type}</p>
              </div>
              <button className="admin-accounts__close" type="button" aria-label="Close account details" onClick={() => setSelectedAccount(null)}>×</button>
            </header>

            <div className="admin-accounts__dialog-actions">
              {((details || selectedAccount).is_on_hold) ? (
                <button type="button" className="admin-accounts__button admin-accounts__button--primary" onClick={() => startAction('release_hold', details || selectedAccount)}>Release hold</button>
              ) : (
                <button type="button" className="admin-accounts__button admin-accounts__button--warning" disabled={(details || selectedAccount).status === 'closed'} onClick={() => startAction('hold', details || selectedAccount)}>Hold for investigation</button>
              )}
              {(details || selectedAccount).status === 'frozen' ? (
                <button type="button" className="admin-accounts__button admin-accounts__button--secondary" onClick={() => startAction('unfreeze', details || selectedAccount)}>Unfreeze</button>
              ) : (
                <button type="button" className="admin-accounts__button admin-accounts__button--secondary" disabled={(details || selectedAccount).status !== 'open' || (details || selectedAccount).is_on_hold} onClick={() => startAction('freeze', details || selectedAccount)}>Freeze</button>
              )}
              <button type="button" className="admin-accounts__button admin-accounts__button--secondary" disabled={(details || selectedAccount).status !== 'open' || (details || selectedAccount).is_on_hold} onClick={() => startAction('adjust_balance', details || selectedAccount)}>Adjust balance</button>
              <button type="button" className="admin-accounts__button admin-accounts__button--primary" disabled={!canReceiveFunds(details || selectedAccount)} onClick={() => startAction('send_money', details || selectedAccount)}>Send money</button>
            </div>

            {detailsLoading ? (
              <p className="admin-accounts__detail-state" role="status">Loading secured account details…</p>
            ) : detailsError ? (
              <p className="admin-accounts__detail-error" role="alert">{detailsError}</p>
            ) : details && (
              <div className="admin-accounts__detail-content">
                {details.is_on_hold && (
                  <aside className="admin-accounts__hold-banner">
                    <strong>On hold for investigation</strong>
                    <span>{details.hold_reason}</span>
                  </aside>
                )}
                <div className="admin-accounts__summary">
                  <section><span>Ledger balance</span><strong>{formatMoney(details.balance, details.currency)}</strong><small>Posted funds in this account</small></section>
                  <section><span>Account status</span><strong><StatusBadge account={details} /></strong><small>Opened {formatDate(details.opened_at)}</small></section>
                  <section><span>Account owner</span><strong>{details.user.display_name}</strong><small>{details.user.email}</small></section>
                </div>
                <section className="admin-accounts__transactions">
                  <header><div><h3>Recent transactions</h3><p>Latest posted account activity</p></div><span>{details.transactions.length} shown</span></header>
                  {details.transactions.length ? (
                    <div className="admin-accounts__transaction-list">
                      {details.transactions.map((transaction) => (
                        <div className="admin-accounts__transaction" key={transaction.id}>
                          <span className={`admin-accounts__transaction-icon admin-accounts__transaction-icon--${transaction.transaction_type}`}>{transaction.transaction_type === 'credit' ? '↓' : '↑'}</span>
                          <span className="admin-accounts__transaction-copy"><strong>{transaction.description}</strong><small>{formatDateTime(transaction.occurred_at)}{transaction.reference ? ` · ${transaction.reference}` : ''}</small></span>
                          <strong className={`admin-accounts__transaction-amount admin-accounts__transaction-amount--${transaction.transaction_type}`}>{transaction.transaction_type === 'credit' ? '+' : '−'}{formatMoney(transaction.amount, transaction.currency)}</strong>
                        </div>
                      ))}
                    </div>
                  ) : <p className="admin-accounts__no-transactions">No transactions are recorded for this account.</p>}
                </section>
              </div>
            )}
            <footer className="admin-accounts__dialog-footer">
              {details?.user?.is_active === false && <span className="admin-accounts__owner-locked">Owner login is locked</span>}
              <button type="button" className="admin-accounts__button admin-accounts__button--secondary" onClick={() => setSelectedAccount(null)}>Close</button>
            </footer>
          </section>
        </div>
      )}

      {pendingAction && (
        <div className="admin-accounts__overlay admin-accounts__overlay--confirm">
          <form className="admin-accounts__confirm" onSubmit={submitAction} role="dialog" aria-modal="true" aria-labelledby="admin-account-action-title">
            <span className={`admin-accounts__confirm-mark${pendingAction.action === 'release_hold' || pendingAction.action === 'unfreeze' ? ' admin-accounts__confirm-mark--release' : ''}`} aria-hidden="true">
              {pendingAction.action === 'release_hold' || pendingAction.action === 'unfreeze' ? '✓' : '!'}
            </span>
            <p className="admin-accounts__eyebrow">Sensitive account action</p>
            <h2 id="admin-account-action-title">{actionDetails[pendingAction.action].title}</h2>
            <p className="admin-accounts__confirm-description">
              {actionDetails[pendingAction.action].description}
              <strong> {accountTitle(pendingAction.account)} · ending {pendingAction.account.last_four}</strong>
            </p>
            {(pendingAction.action === 'adjust_balance' || pendingAction.action === 'send_money') && (
              <label className="admin-accounts__form-field">
                {pendingAction.action === 'send_money' ? 'Amount to send' : 'Adjustment amount'}
                <span>{pendingAction.action === 'send_money' ? `Funds will be credited to ${pendingAction.account.user_name || 'the selected customer'}’s ${accountTitle(pendingAction.account)} account.` : 'Enter a positive amount to credit or a negative amount to debit.'}</span>
                <input autoFocus={pendingAction.action === 'adjust_balance'} inputMode="decimal" max="1000000000" min={pendingAction.action === 'send_money' ? '0.01' : '-1000000000'} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 125.00" required step="0.01" type="number" value={amount} />
              </label>
            )}
            {pendingAction.action === 'send_money' ? (
              <>
                <label className="admin-accounts__form-field">
                  Sender name shown to customer
                  <span>This name appears as the transfer counterparty. The actual administrator remains recorded in the audit log.</span>
                  <input autoFocus maxLength={80} onChange={(event) => setSenderName(event.target.value)} placeholder="Enter the sender name" required value={senderName} />
                </label>
                <label className="admin-accounts__form-field">
                  Memo <span>Optional · up to 140 characters</span>
                  <textarea maxLength={140} onChange={(event) => setMemo(event.target.value)} placeholder="Add a transfer memo" rows="2" value={memo} />
                </label>
              </>
            ) : (
              <label className="admin-accounts__form-field">
                Reason
                <span>This will be recorded in the audit log.</span>
                <textarea autoFocus={pendingAction.action !== 'adjust_balance'} maxLength={500} minLength={5} onChange={(event) => setReason(event.target.value)} placeholder={pendingAction.action === 'hold' ? 'Describe the investigation reason...' : 'Enter the reason for this account action...'} required rows="3" value={reason} />
              </label>
            )}
            {actionError && <p className="admin-accounts__action-error" role="alert">{actionError}</p>}
            <div className="admin-accounts__confirm-actions">
              <button className="admin-accounts__button admin-accounts__button--secondary" disabled={actionBusy} onClick={() => setPendingAction(null)} type="button">Cancel</button>
              <button className={`admin-accounts__button${pendingAction.action === 'release_hold' || pendingAction.action === 'unfreeze' || pendingAction.action === 'send_money' ? ' admin-accounts__button--primary' : pendingAction.action === 'hold' || pendingAction.action === 'freeze' ? ' admin-accounts__button--warning' : ' admin-accounts__button--danger'}`} disabled={actionBusy || (pendingAction.action === 'send_money' ? (!senderName.trim() || !amount || Number(amount) <= 0 || Number(amount) > 1000000000 || !Number.isFinite(Number(amount)) || Math.round(Number(amount) * 100) !== Number(amount) * 100) : reason.trim().length < 5 || (pendingAction.action === 'adjust_balance' && (!amount || Number(amount) === 0)))} type="submit">
                {actionBusy ? 'Applying…' : actionDetails[pendingAction.action].button}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
