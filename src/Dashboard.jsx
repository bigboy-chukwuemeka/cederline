import { useEffect, useId, useMemo, useRef, useState } from 'react'
import './Dashboard.css'
import ActionToast from './ActionToast.jsx'
import { getAccountAppRedirectUrl } from './lib/routes.js'
import { supabase } from './lib/supabase.js'

const currentDate = new Date()

function getCurrentIsoTimestamp() {
  return new Date().toISOString()
}

const navigation = [
  { label: 'Dashboard', icon: 'dashboard' },
  { label: 'Accounts', icon: 'accounts' },
  { label: 'Pay & Transfer', icon: 'transfer' },
  { label: 'Insights', icon: 'insights' },
  { label: 'Statements', icon: 'statements' },
  { label: 'Alerts', icon: 'alerts' },
  { label: 'Profile', icon: 'profile' },
]

const globalSearchHelp = [
  { title: 'Send money to someone', detail: 'Search recipients and review a transfer', page: 'Pay & Transfer', keywords: 'recipient transfer pay someone account number' },
  { title: 'Understand your spending', detail: 'View cash flow, categories, and budgets', page: 'Insights', keywords: 'analytics spending cash flow budget' },
  { title: 'Find a statement', detail: 'Browse account statements and documents', page: 'Statements', keywords: 'document pdf statement tax records' },
  { title: 'Manage account alerts', detail: 'Choose notifications and security alerts', page: 'Alerts', keywords: 'notifications alert security low balance' },
  { title: 'Update personal details', detail: 'Manage your profile and preferences', page: 'Profile', keywords: 'profile settings email address phone' },
]

const accountDetails = {
  checking: { name: 'Checking', balanceLabel: 'Available balance', description: 'Everyday checking', icon: 'accounts' },
  savings: { name: 'Savings', balanceLabel: 'Available balance', description: 'Rainy day fund', icon: 'savings' },
  loan: { name: 'Loan', balanceLabel: 'Outstanding balance', description: 'Personal loan', icon: 'loan' },
  cd: { name: 'CD', balanceLabel: 'Current balance', description: 'Certificate of deposit', icon: 'cd' },
}

function getAccountDisplay(account) {
  const details = accountDetails[account.account_type] ?? {
    name: account.name || 'Account',
    balanceLabel: 'Balance',
    description: 'Cedarline account',
    icon: 'accounts',
  }
  return {
    ...details,
    ...account,
    name: account.name || details.name,
    balanceLabel: account.status === 'on_hold' ? 'Balance · account on hold' : details.balanceLabel,
    lastFour: account.account_number.slice(-4),
  }
}

function formatAccountBalance(balance, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.trim() || 'USD',
  }).format(Number(balance))
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function searchEditDistance(left, right, cutoff = 2) {
  if (Math.abs(left.length - right.length) > cutoff) return cutoff + 1
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    let rowMinimum = row
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost,
      )
      rowMinimum = Math.min(rowMinimum, current[column])
    }
    if (rowMinimum > cutoff) return cutoff + 1
    previous = current
  }
  return previous[right.length]
}

function getSearchMatchScore(query, searchableText) {
  const normalizedQuery = normalizeSearchText(query)
  const normalizedText = searchableText
  if (!normalizedQuery || !normalizedText) return 0
  if (normalizedText.includes(normalizedQuery)) return normalizedText.startsWith(normalizedQuery) ? 100 : 85

  const queryWords = normalizedQuery.split(' ')
  const textWords = normalizedText.split(' ')
  let score = 0
  for (const queryWord of queryWords) {
    if (queryWord.length < 2) return 0
    const wordScore = Math.max(0, ...textWords.map((textWord) => {
      if (textWord.startsWith(queryWord)) return 75
      const cutoff = queryWord.length >= 7 ? 2 : 1
      const distance = searchEditDistance(queryWord, textWord, cutoff)
      return distance <= cutoff ? 65 - distance * 10 : 0
    }))
    if (!wordScore) return 0
    score += wordScore
  }
  return score / queryWords.length
}

function BankingPageLoader({ page }) {
  return (
    <div className="dashboard__page-loader" role="status" aria-live="polite" aria-label={`Loading ${page}`}>
      <span className="dashboard__loader-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <strong>{page === 'Dashboard' ? 'Getting your account ready' : `Preparing ${page}`}</strong>
      <span className="dashboard__loader-copy">Loading your secure banking view</span>
      <span className="dashboard__loader-skeleton dashboard__loader-skeleton--wide" aria-hidden="true" />
      <span className="dashboard__loader-skeleton" aria-hidden="true" />
    </div>
  )
}

function Icon({ name, size = 22 }) {
  const shared = {
    'aria-hidden': true,
    fill: 'none',
    height: size,
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 1.7,
    viewBox: '0 0 24 24',
    width: size,
  }

  const paths = {
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    dashboard: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
    accounts: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18m-5 5h3" /></>,
    transfer: <><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" /></>,
    insights: <><path d="M4 19V5m0 14h17" /><path d="m7 15 4-4 3 2 6-7" /><path d="M16 6h4v4" /></>,
    statements: <><path d="M6 3.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 20V5a1.5 1.5 0 0 1 2-1.5Z" /><path d="M14 4v4h4M8 12h8m-8 4h8" /></>,
    alerts: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    savings: <><path d="M19.5 10.5a6.5 6.5 0 0 0-6.5-6.5H8a5 5 0 0 0-5 5v5a5 5 0 0 0 5 5h7a4.5 4.5 0 0 0 4.5-4.5v-1.2l2-1.3v-3l-2-1.5Z" /><path d="M8 7.5h.01m3.5 9V19m-2 0h4" /></>,
    loan: <><path d="M3 9h18M5 9v9m4-9v9m6-9v9m4-9v9M3 21h18M12 3 2 8h20L12 3Z" /></>,
    cd: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5.5" /><circle cx="12" cy="12" r="1" /></>,
    send: <><path d="m21 3-7.5 18-3.5-7.5L2 10l19-7Z" /><path d="m21 3-11 10.5" /></>,
    bankTransfer: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18m-13 6h4" /><circle cx="17" cy="14.5" r="1" /></>,
    edit: <><path d="m4 16.5-.8 4.3 4.3-.8L19.6 7.9a2.1 2.1 0 0 0-3-3L4 16.5Z" /><path d="m14.9 6.6 3 3" /></>,
    personTransfer: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0m1-8h5m-2-2 2 2-2 2m-4 4h-5m2-2-2 2 2 2" /></>,
    check: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    plant: <><path d="M12 21v-9m0 3c-5 0-8-3-8-8 5 0 8 3 8 8Zm0-3c0-5 3-8 8-8 0 5-3 8-8 8Zm-7 9h14" /></>,
    receipt: <><path d="M5 3.5 7.3 5 10 3.5l2 1.5 2-1.5L16.7 5 19 3.5v17l-2.3-1.5-2.7 1.5-2-1.5-2 1.5L7.3 19 5 20.5v-17Z" /><path d="M8 9h8m-8 3.5h8M8 16h5" /></>,
  }

  return <svg {...shared}>{paths[name] ?? paths.dashboard}</svg>
}

function BrandedSelect({ label, onChange, options, value }) {
  const id = useId()
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const listRef = useRef(null)
  const [isOpen, setIsOpen] = useState(false)
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!isOpen) return undefined
    const selected = listRef.current?.querySelector('[aria-selected="true"]')
    selected?.focus()
    function closeOnOutsidePointer(event) {
      if (!rootRef.current?.contains(event.target)) setIsOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [isOpen])

  function moveFocus(event, currentIndex) {
    const optionElements = [...(listRef.current?.querySelectorAll('[role="option"]') ?? [])]
    if (!optionElements.length) return
    let nextIndex = currentIndex
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % optionElements.length
    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + optionElements.length) % optionElements.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = optionElements.length - 1
    else if (event.key === 'Escape') {
      setIsOpen(false)
      triggerRef.current?.focus()
      return
    } else {
      return
    }
    event.preventDefault()
    optionElements[nextIndex].focus()
  }

  return (
    <div className={`branded-select${isOpen ? ' is-open' : ''}`} ref={rootRef}>
      <button
        aria-controls={`${id}-options`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={label}
        className="branded-select__trigger"
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setIsOpen(true)
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <span>{selectedOption?.label ?? ''}</span>
        <svg aria-hidden="true" className={isOpen ? 'is-open' : ''} fill="none" viewBox="0 0 20 20">
          <path d="m5.5 7.5 4.5 4.5 4.5-4.5" />
        </svg>
      </button>
      {isOpen && (
        <div
          aria-label={label}
          className="branded-select__menu"
          id={`${id}-options`}
          ref={listRef}
          role="listbox"
        >
          {options.map((option, index) => (
            <div
              aria-selected={option.value === value}
              className="branded-select__option"
              key={option.value}
              onClick={() => {
                onChange(option.value)
                setIsOpen(false)
                triggerRef.current?.focus()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onChange(option.value)
                  setIsOpen(false)
                  triggerRef.current?.focus()
                } else {
                  moveFocus(event, index)
                }
              }}
              role="option"
              tabIndex={option.value === value ? 0 : -1}
            >
              <span>{option.label}</span>
              {option.value === value && <Icon name="check" size={17} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AccountsPage({ accounts, accountsError, accountsLoading, selectedAccount, onSelectAccount }) {
  useEffect(() => {
    if (!selectedAccount) return
    document.getElementById(`account-${selectedAccount.toLowerCase()}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [selectedAccount])

  return (
    <div className="accounts-page">
      <section className="accounts-page__intro" aria-labelledby="accounts-page-title">
        <h1 id="accounts-page-title">Accounts</h1>
        <p>Four accounts. One simple place to manage them.</p>
      </section>

      <section className="accounts-page__totals" aria-label="Account balances">
        <article className="accounts-page__total-card">
          <h2>Total deposit balance</h2>
          <p className="accounts-page__total-amount">{accountsLoading ? 'Loading…' : formatAccountBalance(accounts.filter((account) => ['checking', 'savings', 'cd'].includes(account.account_type) && ['open', 'on_hold'].includes(account.status)).reduce((total, account) => total + Number(account.balance), 0))}</p>
          <p className="accounts-page__total-note">Checking + Savings + CD</p>
        </article>
        <article className="accounts-page__total-card">
          <h2>Total loan balance</h2>
          <p className="accounts-page__total-amount">{accountsLoading ? 'Loading…' : formatAccountBalance(accounts.filter((account) => account.account_type === 'loan' && ['open', 'on_hold'].includes(account.status)).reduce((total, account) => total + Number(account.balance), 0))}</p>
          <p className="accounts-page__total-note">{accounts.some((account) => account.account_type === 'loan') ? 'Outstanding loan balance' : 'No loan account found'}</p>
        </article>
      </section>

      <section className="accounts-page__list" aria-labelledby="accounts-list-title">
        <div className="accounts-page__list-heading">
          <h2 id="accounts-list-title">Your accounts</h2>
          <p>{accountsLoading ? 'Loading accounts…' : 'Balances from your accounts'}</p>
        </div>
        <div className="accounts-page__rows">
          {accountsError ? (
            <p className="dashboard__data-error" role="alert">{accountsError}</p>
          ) : accountsLoading ? (
            <p className="dashboard__data-state" role="status">Loading your accounts…</p>
          ) : accounts.length === 0 ? (
            <p className="dashboard__data-state" role="status">No accounts are available yet.</p>
          ) : accounts.map((account) => {
            const display = getAccountDisplay(account)
            return (
            <article className="accounts-page__row" id={`account-${display.name.toLowerCase()}`} key={account.id}>
              <div className="accounts-page__identity">
                <span className="accounts-page__icon"><Icon name={display.icon} size={21} /></span>
                <div>
                  <h3>{display.name}</h3>
                  <p>{display.description} · •• {display.lastFour}</p>
                  {account.status === 'on_hold' && (
                    <span className="customer-account-hold" role="status">
                      <span aria-hidden="true">!</span> Account on hold
                    </span>
                  )}
                </div>
              </div>
              <div className="accounts-page__amount">
                <p>{formatAccountBalance(account.balance, account.currency)}</p>
                <span>{display.balanceLabel}</span>
              </div>
              <button className="accounts-page__details" onClick={() => onSelectAccount(display.name)} type="button">
                View details
              </button>
            </article>
          )})}
        </div>
      </section>

      <aside className="accounts-page__notice">
        <span aria-hidden="true">i</span>
        <div>
          <h2>Ready when you are</h2>
          <p>Your available balances update from your accounts. Deposit accounts begin at $0.00.</p>
        </div>
      </aside>
    </div>
  )
}

function TransferReviewPage({ draft, availableBalance, transferError, isSubmitting, onConfirm, onEdit, onCancel }) {
  const amount = Number(draft.amount)
  const hasEnoughFunds = amount > 0 && amount <= availableBalance
  const amountText = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
  const dateText = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${draft.date}T12:00:00`))

  return (
    <div className="transfer-flow">
      <section className="dashboard__intro transfer-flow__intro" aria-labelledby="review-transfer-title">
        <h1 id="review-transfer-title">Review transfer</h1>
        <p>Step 2 of 3 · Check the details before you confirm.</p>
      </section>

      <div className="transfer-review-grid">
        <section className="transfer-review-card transfer-review-details" aria-labelledby="transfer-details-title">
          <h2 id="transfer-details-title">Transfer details</h2>
          <div className="transfer-review-badges" aria-label="Review recipient and amount">
            <span className="transfer-review-badge transfer-review-badge--draft">Review</span>
            <span className="transfer-review-badge transfer-review-badge--pending">
              {draft.transferMode === 'external' ? 'External recipient details' : 'Recipient confirmed'}
            </span>
          </div>

          <div className="transfer-review-amount">
            <span>Requested amount</span>
            <strong>{amountText}</strong>
            <small>
              {draft.transferMode === 'external'
                ? 'Your request is held for administrator review.'
                : 'This request will remain pending review; funds will move only if an administrator approves it.'}
            </small>
          </div>

          <dl className="transfer-review-list">
            <div><dt>From</dt><dd>{draft.from} · •• {draft.fromLastFour}</dd></div>
            <div><dt>Recipient</dt><dd>{draft.recipientName}</dd></div>
            <div><dt>To account</dt><dd>{draft.to}</dd></div>
            <div><dt>Date</dt><dd>{dateText}</dd></div>
            {draft.memo && <div><dt>Memo</dt><dd>{draft.memo}</dd></div>}
            <div><dt>Transfer fee</dt><dd>$0.00</dd></div>
          </dl>

          <div className="transfer-review-total">
            <span>Total requested</span>
            <strong>{amountText}</strong>
          </div>
        </section>

        <div className="transfer-review-actions">
          <section className="transfer-review-card transfer-review-funding" aria-labelledby="funding-check-title">
            <h2 id="funding-check-title">Balance check</h2>
            <dl className="transfer-review-funding__balances">
              <div><dt>Available in {draft.from.toLowerCase()}</dt><dd>{formatAccountBalance(availableBalance)}</dd></div>
              <div><dt>Amount needed</dt><dd>{amountText}</dd></div>
            </dl>

            {!hasEnoughFunds && (
              <div className="transfer-review-warning" role="alert">
                <span aria-hidden="true">!</span>
                <div>
                  <strong>Insufficient available funds</strong>
                  <p>This transfer can’t be completed because the selected account does not have enough available funds.</p>
                </div>
              </div>
            )}

            {transferError && <p className="dashboard__data-error" role="alert">{transferError}</p>}
            <p className="transfer-review-note">
              {draft.transferMode === 'external'
                ? 'Your available balance will be checked again when you submit the request.'
                : 'Both accounts are checked again at review. No balance changes until the transfer is approved.'}
            </p>
          </section>

          <section className="transfer-review-card transfer-review-next" aria-labelledby="next-step-title">
            <h2 id="next-step-title">Your next step</h2>
            <button className="transfer-review-confirm" disabled={!hasEnoughFunds || isSubmitting} onClick={onConfirm} type="button">
              <Icon name="send" size={18} />
              {isSubmitting ? 'Submitting securely…' : 'Submit for review'}
            </button>
            <button className="transfer-review-edit" onClick={onEdit} type="button">
              <Icon name="edit" size={17} />
              Edit draft
            </button>
            <button className="transfer-review-cancel" onClick={onCancel} type="button">Cancel transfer</button>
            <p className="transfer-review-note">
              {hasEnoughFunds
                ? 'Review the recipient name, account suffix, and amount before sending.'
                : 'The sender account must have sufficient available funds before you can send.'}
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

function TransferPendingPage({ draft, onActionFeedback, onReturnToDashboard, onAnotherTransfer }) {
  const amount = Number(draft.amount)
  const amountText = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
  const submittedAt = new Date(draft.submittedAt)
  const submittedText = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(submittedAt)
  const receiptReference = draft.receiptReference
  const [copyStatus, setCopyStatus] = useState('')
  const [isCopyingReference, setIsCopyingReference] = useState(false)

  async function copyReceiptReference() {
    setIsCopyingReference(true)
    try {
      await navigator.clipboard.writeText(receiptReference)
      setCopyStatus('Request reference copied.')
      onActionFeedback('Transfer request reference copied.')
    } catch {
      setCopyStatus('Could not copy the request reference.')
      onActionFeedback('Could not copy the request reference.', 'error')
    } finally {
      setIsCopyingReference(false)
    }
  }

  function downloadReceipt() {
    const lines = [
      'Cedarline - Transfer request',
      '',
      `Amount: ${amountText}`,
      `From: ${draft.from} · •• ${draft.fromLastFour}`,
      `To: ${draft.to}`,
      `Submitted for review: ${submittedText}`,
      `Memo: ${draft.memo || 'None'}`,
      'Status: Pending admin review. No funds have been moved.',
      `Request reference: ${receiptReference}`,
    ]
    const receiptBlob = new Blob([lines.join('\r\n')], { type: 'text/plain' })
    const receiptUrl = URL.createObjectURL(receiptBlob)
    const link = document.createElement('a')
    link.href = receiptUrl
    link.download = `${receiptReference}-request.txt`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(receiptUrl), 1000)
    onActionFeedback('Transfer request details downloaded.')
  }

  return (
    <div className="transfer-flow transfer-complete-page">
      <section className="dashboard__intro transfer-flow__intro" aria-labelledby="transfer-pending-title">
        <h1 id="transfer-pending-title">Transfer submitted for review</h1>
        <p>Your request is waiting for an administrator to review it.</p>
      </section>

      <aside className="transfer-complete-page__notice" role="note">
        <span aria-hidden="true">!</span>
        <div>
          <strong>No funds have moved yet</strong>
          <p>The requested amount is reserved while the transfer is reviewed. We’ll notify you when a decision is made.</p>
        </div>
      </aside>

      <div className="transfer-complete-page__grid">
        <section className="transfer-review-card transfer-complete-page__receipt" aria-labelledby="request-title">
          <header className="transfer-complete-page__hero">
            <span className="transfer-complete__icon" aria-hidden="true">
              <Icon name="transfer" size={24} />
            </span>
            <h2 id="request-title">Transfer request received</h2>
            <p>Your request to {draft.recipientName} is pending review.</p>
            <strong className="transfer-complete-page__amount">{amountText}</strong>
            <span className="transfer-review-badge transfer-review-badge--pending">Pending review</span>
          </header>

          <dl className="transfer-complete-page__details">
            <div><dt>From</dt><dd>{draft.from} · •• {draft.fromLastFour}</dd></div>
            <div><dt>To</dt><dd>{draft.to}</dd></div>
            <div><dt>Submitted</dt><dd>{submittedText}</dd></div>
            {draft.memo && <div><dt>Memo</dt><dd>{draft.memo}</dd></div>}
            <div className="transfer-complete-page__reference">
              <dt>Request reference</dt>
              <dd>{receiptReference}</dd>
              <button aria-label="Copy request reference" disabled={isCopyingReference} onClick={copyReceiptReference} type="button">
                <Icon name="copy" size={19} />
              </button>
            </div>
          </dl>
          <p className="transfer-complete-page__copy-status" role={copyStatus.startsWith('Could not') ? 'alert' : 'status'} aria-live="polite">
            {isCopyingReference ? 'Copying receipt reference…' : copyStatus}
          </p>
        </section>

        <div className="transfer-complete-page__aside">
          <section className="transfer-review-card transfer-complete-page__movement" aria-labelledby="balance-movement-title">
            <h2 id="balance-movement-title">Review status</h2>
            <p>Your transfer has not posted.</p>
            {draft.transferMode === 'external' ? (
              <p>An administrator will review this external transfer request. Reserved funds are released when a decision is recorded.</p>
            ) : (
              <p>The sender debit and recipient credit will only be recorded if the request is approved. If it is declined, the reserved funds will be released.</p>
            )}
          </section>

          <section className="transfer-review-card transfer-complete-page__next" aria-labelledby="transfer-complete-next-title">
            <h2 id="transfer-complete-next-title">What’s next?</h2>
            <button className="transfer-review-add-funds" onClick={onReturnToDashboard} type="button">Return to dashboard</button>
            <button className="transfer-review-edit" onClick={onAnotherTransfer} type="button">Make another transfer</button>
            <button className="transfer-complete-page__download" onClick={downloadReceipt} type="button">
              <Icon name="download" size={18} />
              Download request summary
            </button>
            <p className="transfer-review-note">Keep the request reference for your records.</p>
          </section>
        </div>
      </div>
    </div>
  )
}

const defaultBudgetTargets = [
  { category: 'Groceries', target: 400 },
  { category: 'Dining', target: 150 },
  { category: 'Transport', target: 100 },
]

function formatLocalDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function RegisteredTransferFlow({ accounts, onActionFeedback, onReturnToDashboard, onTransferCompleted }) {
  const senderAccounts = accounts.filter((account) =>
    ['checking', 'savings'].includes(account.account_type) && account.status === 'open')
  const [senderAccountId, setSenderAccountId] = useState('')
  const [transferMode, setTransferMode] = useState('registered')
  const [pendingReserves, setPendingReserves] = useState(null)
  const [pendingReserveError, setPendingReserveError] = useState('')
  const [recipientQuery, setRecipientQuery] = useState('')
  const [recipientResults, setRecipientResults] = useState([])
  const [selectedRecipient, setSelectedRecipient] = useState(null)
  const [recipientDropdownOpen, setRecipientDropdownOpen] = useState(false)
  const [recipientSearchMessage, setRecipientSearchMessage] = useState('')
  const [externalBankName, setExternalBankName] = useState('')
  const [externalRecipientName, setExternalRecipientName] = useState('')
  const [externalAccountType, setExternalAccountType] = useState('checking')
  const [externalRoutingNumber, setExternalRoutingNumber] = useState('')
  const [externalAccountNumber, setExternalAccountNumber] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [draft, setDraft] = useState(null)
  const [flowStage, setFlowStage] = useState('form')
  const [isSearching, setIsSearching] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const recipientSearchRequest = useRef(0)

  const senderAccount = senderAccounts.find((account) => account.id === senderAccountId)

  useEffect(() => {
    let active = true
    async function loadPendingReserves() {
      if (!supabase) {
        setPendingReserveError('Your secure banking service is unavailable.')
        return
      }
      const { data, error: reserveError } = await supabase.rpc('get_my_pending_transfer_reserves')
      if (!active) return
      if (reserveError) {
        setPendingReserveError(reserveError.message || 'Unable to load funds reserved for pending transfers.')
        setPendingReserves(null)
        return
      }
      setPendingReserves(Object.fromEntries((data || []).map((row) => [row.account_id, Number(row.reserved_amount)])))
      setPendingReserveError('')
    }
    loadPendingReserves()
    return () => {
      active = false
    }
  }, [accounts])

  useEffect(() => {
    const query = recipientQuery.trim()
    const requestId = ++recipientSearchRequest.current
    const isDigitsOnly = /^\d+$/.test(query)
    const minimumLength = isDigitsOnly ? 4 : 3

    if (!query || query.length < minimumLength || selectedRecipient) {
      return () => {
        recipientSearchRequest.current += 1
      }
    }

    const timer = window.setTimeout(async () => {
      if (!supabase) {
        if (requestId === recipientSearchRequest.current) {
          setError('Supabase is not configured. Add the project URL and publishable key to .env.local.')
        }
        return
      }
      setIsSearching(true)
      setRecipientSearchMessage('')
      try {
        const { data, error: searchError } = await supabase.rpc('find_transfer_recipients', {
          p_query: query,
        })
        if (requestId !== recipientSearchRequest.current) return
        if (searchError) throw searchError
        setRecipientResults(data || [])
        setRecipientSearchMessage(data?.length ? '' : 'No matching open accounts found.')
      } catch (searchError) {
        if (requestId === recipientSearchRequest.current) {
          setError(searchError.message || 'Could not search registered accounts. Please try again.')
        }
      } finally {
        if (requestId === recipientSearchRequest.current) setIsSearching(false)
      }
    }, 300)

    return () => {
      window.clearTimeout(timer)
      recipientSearchRequest.current += 1
    }
  }, [recipientQuery, selectedRecipient])

  function reviewTransfer(event) {
    event.preventDefault()
    if (!senderAccount) {
      setError('Choose a sender account first.')
      return
    }
    if (pendingReserves === null) {
      setError(pendingReserveError || 'Wait for your available balance to finish loading.')
      return
    }
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0 || !/^\d+(\.\d{1,2})?$/.test(amount)) {
      setError('Enter an amount greater than $0.00 with no more than two decimal places.')
      return
    }

    if (transferMode === 'external') {
      if (!externalBankName.trim() || !externalRecipientName.trim() || !externalAccountNumber.trim() || !externalRoutingNumber.trim()) {
        setError('Enter the bank name, recipient name, routing number, and account number for the external transfer.')
        return
      }
      if (!/^\d{9}$/.test(externalRoutingNumber.replace(/\s+/g, ''))) {
        setError('US routing numbers must contain exactly 9 digits.')
        return
      }
      if (!/^\d{4,17}$/.test(externalAccountNumber.replace(/\s+/g, ''))) {
        setError('Account number must contain only digits and be 4–17 characters long.')
        return
      }
    } else {
      if (!selectedRecipient) {
        setError('Choose a sender account and confirm a registered recipient first.')
        return
      }
    }

    setError('')
    const normalizedRouting = externalRoutingNumber.replace(/\s+/g, '')
    const normalizedAccountNumber = externalAccountNumber.replace(/\s+/g, '')
    const recipientName = transferMode === 'external' ? externalRecipientName.trim() : selectedRecipient.recipient_name
    const recipientType = transferMode === 'external'
      ? externalAccountType
      : (accountDetails[selectedRecipient.account_type]?.name || selectedRecipient.account_type)
    const toLabel = transferMode === 'external'
      ? `${externalBankName.trim()} · ${recipientType} · •• ${normalizedAccountNumber.slice(-4)}`
      : `${accountDetails[selectedRecipient.account_type]?.name || selectedRecipient.account_type} · •• ${selectedRecipient.account_last_four}`

    setDraft({
      senderAccountId: senderAccount.id,
      senderBalance: Math.max(0, Number(senderAccount.balance) - (pendingReserves[senderAccount.id] || 0)),
      from: senderAccount.name || accountDetails[senderAccount.account_type]?.name || 'Account',
      fromLastFour: senderAccount.account_number.slice(-4),
      recipientAccountId: transferMode === 'external' ? null : selectedRecipient.account_id,
      recipientName,
      recipientType,
      recipientLastFour: transferMode === 'external' ? normalizedAccountNumber.slice(-4) : selectedRecipient.account_last_four,
      bankName: transferMode === 'external' ? externalBankName.trim() : '',
      routingNumber: transferMode === 'external' ? normalizedRouting : '',
      accountNumber: transferMode === 'external' ? normalizedAccountNumber : '',
      to: toLabel,
      amount,
      date: currentDate.toISOString().slice(0, 10),
      memo: memo.trim(),
      transferMode,
      idempotencyKey: crypto.randomUUID(),
    })
    setFlowStage('review')
  }

  async function confirmTransfer() {
    if (!draft || isSubmitting) return
    setIsSubmitting(true)
    setError('')
    try {
      if (draft.transferMode === 'external') {
        if (!supabase) {
          setError('Supabase is not configured. Add the project URL and publishable key to .env.local.')
          return
        }
        const { data, error: requestError } = await supabase.rpc('submit_external_transfer_request', {
          p_sender_account_id: draft.senderAccountId,
          p_amount: draft.amount,
          p_memo: draft.memo,
          p_bank_name: draft.bankName,
          p_recipient_name: draft.recipientName,
          p_account_type: draft.recipientType.toLowerCase(),
          p_routing_number: draft.routingNumber,
          p_account_number: draft.accountNumber,
          p_idempotency_key: draft.idempotencyKey,
        })
        if (requestError) throw requestError
        if (!data?.request_id || !data?.reference || data.status !== 'pending') {
          throw new Error('The external transfer request could not be verified. Check your request activity before retrying.')
        }
        await onTransferCompleted()
        setDraft({
          ...draft,
          submittedAt: data.submitted_at || new Date().toISOString(),
          receiptReference: data.reference,
          externalRequestId: data.request_id,
        })
        setError('')
        setFlowStage('submitted')
        return
      }

      if (!supabase) {
        setError('Supabase is not configured. Add the project URL and publishable key to .env.local.')
        return
      }

      const { data, error: transferError } = await supabase.rpc('complete_registered_transfer', {
        p_sender_account_id: draft.senderAccountId,
        p_recipient_account_id: draft.recipientAccountId,
        p_amount: draft.amount,
        p_memo: draft.memo,
        p_idempotency_key: draft.idempotencyKey,
      })
      if (transferError) throw transferError
      const submittedTransfer = Array.isArray(data) ? data[0] : data
      if (!submittedTransfer?.transfer_id || !submittedTransfer.reference || submittedTransfer.completed_at) {
        throw new Error('The transfer request could not be verified. Check your account activity before retrying.')
      }
      const submittedDraft = {
        ...draft,
        submittedAt: new Date().toISOString(),
        receiptReference: submittedTransfer.reference,
      }
      await onTransferCompleted()
      setDraft(submittedDraft)
      setError('')
      setFlowStage('submitted')
    } catch (transferError) {
      setError(transferError.message || 'The transfer could not be completed. Your balances were not changed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function resetTransfer() {
    setDraft(null)
    setRecipientQuery('')
    setRecipientResults([])
    setSelectedRecipient(null)
    setRecipientSearchMessage('')
    setRecipientDropdownOpen(false)
    setExternalBankName('')
    setExternalRecipientName('')
    setExternalAccountType('checking')
    setExternalRoutingNumber('')
    setExternalAccountNumber('')
    setAmount('')
    setMemo('')
    setError('')
    setFlowStage('form')
  }

  if (flowStage === 'review' && draft) {
    return (
      <TransferReviewPage
        availableBalance={draft.senderBalance}
        draft={draft}
        isSubmitting={isSubmitting}
        onCancel={resetTransfer}
        onConfirm={confirmTransfer}
        onEdit={() => {
          setError('')
          setFlowStage('form')
        }}
        transferError={error}
      />
    )
  }

  if (flowStage === 'submitted' && draft?.submittedAt && draft.receiptReference) {
    return (
      <TransferPendingPage
        draft={draft}
        onActionFeedback={onActionFeedback}
        onAnotherTransfer={resetTransfer}
        onReturnToDashboard={() => {
          resetTransfer()
          onReturnToDashboard()
        }}
      />
    )
  }

  return (
    <div className="pay-transfer-page">
      <section className="dashboard__intro pay-transfer-page__intro" aria-labelledby="pay-transfer-title">
        <h1 id="pay-transfer-title">Send money</h1>
        <p>Send money to a Cedarline customer or submit an external bank request for review.</p>
      </section>

      <aside className="pay-transfer-page__funding" role="note">
        <span aria-hidden="true">i</span>
        <div>
          <strong>Transfer requests are reviewed before processing</strong>
          <p>Choose a registered Cedarline recipient or enter external bank details. External account numbers are encrypted in Supabase and shown only to authorized administrators.</p>
        </div>
      </aside>

      <div className="pay-transfer-page__forms">
        <section className="pay-transfer-card" aria-labelledby="send-money-title">
          <header className="pay-transfer-card__heading">
            <h2 id="send-money-title">Transfer details</h2>
            <p>Transfers are reviewed before funds are posted.</p>
          </header>
          <form className="pay-transfer-form" onSubmit={reviewTransfer}>
            <div className="pay-transfer-field">
              <span>From account</span>
              <BrandedSelect
                label="From account"
                onChange={setSenderAccountId}
                options={[
                  { value: '', label: 'Select a checking or savings account' },
                  ...senderAccounts.map((account) => ({
                    value: account.id,
                    label: `${account.name || accountDetails[account.account_type]?.name} · •• ${account.account_number.slice(-4)} · ${pendingReserves === null ? 'Loading available balance' : `${formatAccountBalance(Math.max(0, Number(account.balance) - (pendingReserves[account.id] || 0)), account.currency)} available`}`,
                  })),
                ]}
                value={senderAccountId}
              />
              {senderAccount && <small>Available balance: {pendingReserves === null ? 'Loading reserved transfers…' : formatAccountBalance(Math.max(0, Number(senderAccount.balance) - (pendingReserves[senderAccount.id] || 0)), senderAccount.currency)}</small>}
              {pendingReserveError && <small className="pay-transfer-field__error">{pendingReserveError}</small>}
              {!senderAccounts.length && <small className="pay-transfer-field__error">No open checking or savings account is available to send from.</small>}
            </div>

            <div className="pay-transfer-field">
              <span>Transfer mode</span>
              <div className="transfer-mode-toggle" role="tablist" aria-label="Transfer type">
                <button
                  className={`transfer-mode-toggle__button${transferMode === 'registered' ? ' is-active' : ''}`}
                  onClick={() => {
                    setTransferMode('registered')
                    setError('')
                  }}
                  type="button"
                  role="tab"
                  aria-selected={transferMode === 'registered'}
                >
                  Cedarline recipient
                </button>
                <button
                  className={`transfer-mode-toggle__button${transferMode === 'external' ? ' is-active' : ''}`}
                  onClick={() => {
                    setTransferMode('external')
                    setError('')
                  }}
                  type="button"
                  role="tab"
                  aria-selected={transferMode === 'external'}
                >
                  Any bank account
                </button>
              </div>
            </div>

            {transferMode === 'registered' ? (
              <>
                <div className="pay-transfer-field">
                  <span>Find recipient</span>
                  <div className="registered-transfer__search">
                    <input
                      autoComplete="off"
                      aria-label="Recipient account number, last four digits, email, or username"
                      aria-autocomplete="list"
                      aria-controls="recipient-results"
                      aria-expanded={recipientDropdownOpen && !selectedRecipient}
                      maxLength={254}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.preventDefault()
                      }}
                      onChange={(event) => {
                        const query = event.target.value.trim()
                        const isDigitsOnly = /^\d+$/.test(query)
                        const minimumLength = isDigitsOnly ? 4 : 3
                        setRecipientQuery(event.target.value)
                        setSelectedRecipient(null)
                        setRecipientResults([])
                        setIsSearching(false)
                        setRecipientSearchMessage(query.length && query.length < minimumLength
                          ? `Type at least ${minimumLength} ${isDigitsOnly ? 'digits' : 'characters'} to search.`
                          : '')
                        setRecipientDropdownOpen(true)
                        setError('')
                      }}
                      onFocus={() => {
                        if (!selectedRecipient) setRecipientDropdownOpen(true)
                      }}
                      placeholder="Account number, last 4, email, or username"
                      role="combobox"
                      aria-haspopup="listbox"
                      value={recipientQuery}
                    />
                    {recipientDropdownOpen && !selectedRecipient && (
                      <div className="registered-transfer__results" id="recipient-results" role="listbox" aria-label="Matching recipient accounts" aria-busy={isSearching}>
                        {isSearching ? (
                          <p className="registered-transfer__search-status" role="status">Searching registered accounts…</p>
                        ) : recipientResults.length ? (
                          recipientResults.map((result) => (
                            <button
                              aria-selected={selectedRecipient?.account_id === result.account_id}
                              className="registered-transfer__result"
                              key={result.account_id}
                              onClick={() => {
                                setSelectedRecipient(result)
                                setRecipientDropdownOpen(false)
                                setRecipientSearchMessage('')
                                setError('')
                              }}
                              role="option"
                              type="button"
                            >
                              <span className="registered-transfer__result-avatar" aria-hidden="true">
                                {(result.recipient_name || 'C').trim().charAt(0).toUpperCase()}
                              </span>
                              <span className="registered-transfer__result-copy">
                                <strong>{result.recipient_name}</strong>
                                <small>{result.account_name || accountDetails[result.account_type]?.name || result.account_type}</small>
                                <small>{result.account_type === 'loan' ? 'Loan account' : 'Deposit account'} · {result.currency || 'USD'} · •• {result.account_last_four}</small>
                              </span>
                              <span className="registered-transfer__result-status">Open</span>
                            </button>
                          ))
                        ) : (
                          <p className="registered-transfer__search-status" role="status">
                            {recipientSearchMessage || 'Enter an account number, last four digits, email, or username.'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <small>Results appear as you type. Choose an open account to confirm its name and masked number.</small>
                </div>

                {selectedRecipient && (
                  <aside className="registered-transfer__confirmation" aria-live="polite">
                    <Icon name="check" size={19} />
                    <span>
                      Recipient confirmed: <strong>{selectedRecipient.recipient_name}</strong>
                      {' · '}
                      {selectedRecipient.account_name || accountDetails[selectedRecipient.account_type]?.name || selectedRecipient.account_type}
                      {' · '}•• {selectedRecipient.account_last_four}
                    </span>
                    <button className="registered-transfer__change-recipient" onClick={() => {
                      setSelectedRecipient(null)
                      setRecipientDropdownOpen(true)
                    }} type="button">Change</button>
                  </aside>
                )}
              </>
            ) : (
              <>
                <label className="pay-transfer-field">
                  <span>Bank name</span>
                  <input
                    maxLength={80}
                    onChange={(event) => setExternalBankName(event.target.value)}
                    placeholder="Bank of America, Chase, etc."
                    value={externalBankName}
                  />
                </label>

                <label className="pay-transfer-field">
                  <span>Recipient full name</span>
                  <input
                    maxLength={120}
                    onChange={(event) => setExternalRecipientName(event.target.value)}
                    placeholder="Full name on the receiving account"
                    value={externalRecipientName}
                  />
                </label>

                <div className="external-transfer-grid">
                  <label className="pay-transfer-field">
                    <span>Account type</span>
                    <select onChange={(event) => setExternalAccountType(event.target.value)} value={externalAccountType}>
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                      <option value="loan">Loan</option>
                    </select>
                  </label>

                  <label className="pay-transfer-field">
                    <span>Routing number</span>
                    <input
                      inputMode="numeric"
                      maxLength={9}
                      onChange={(event) => setExternalRoutingNumber(event.target.value.replace(/\D/g, ''))}
                      placeholder="9 digits"
                      value={externalRoutingNumber}
                    />
                  </label>
                </div>

                <label className="pay-transfer-field">
                  <span>Account number</span>
                  <input
                    inputMode="numeric"
                    maxLength={17}
                    onChange={(event) => setExternalAccountNumber(event.target.value.replace(/\D/g, ''))}
                    placeholder="Bank account number"
                    value={externalAccountNumber}
                  />
                </label>
              </>
            )}

            <label className="pay-transfer-field">
              <span>Amount (USD)</span>
              <input
                inputMode="decimal"
                max="1000000000"
                min="0.01"
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                required
                step="0.01"
                type="number"
                value={amount}
              />
              <small>Enter an amount with up to two decimal places.</small>
            </label>

            <label className="pay-transfer-field">
              <span>Memo (optional)</span>
              <input
                maxLength={140}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="Add a note"
                value={memo}
              />
              <small>Up to 140 characters.</small>
            </label>

            {error && <p className="dashboard__data-error" role="alert">{error}</p>}
            <button className="pay-transfer-form__review" disabled={!senderAccount || (transferMode === 'registered' ? !selectedRecipient : !externalBankName || !externalRecipientName || !externalRoutingNumber || !externalAccountNumber) || !amount || pendingReserves === null} type="submit">
              Review transfer
            </button>
          </form>
        </section>

        <aside className="pay-transfer-card registered-transfer__safety">
          <h2>Before you send</h2>
          <p>Always verify the recipient name, bank name, and account details before continuing.</p>
          <p>Transfers cannot be completed if your available balance is insufficient.</p>
          <p>Any bank transfer is held for administrator review before posting. The review page already explains the pending approval step.</p>
        </aside>
      </div>
    </div>
  )
}

function InsightsPage({
  accounts,
  budgetTargets,
  budgetError,
  budgetLoading,
  onAddMoney,
  onActionFeedback,
  onSaveBudgets,
  onRetryTransactions,
  savedBudgetCategories,
  transactionError,
  transactionLoading,
  transactions,
}) {
  const [period, setPeriod] = useState('month-to-date')
  const [account, setAccount] = useState('all')
  const [isEditingBudgets, setIsEditingBudgets] = useState(false)
  const [isSavingBudgets, setIsSavingBudgets] = useState(false)
  const [budgetSaveError, setBudgetSaveError] = useState('')
  const [budgetDraft, setBudgetDraft] = useState(() => budgetTargets.map((item) => ({ ...item })))
  const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(currentDate)
  const depositAccounts = accounts.filter((item) =>
    ['checking', 'savings', 'cd'].includes(item.account_type) && item.currency === 'USD')
  const selectedAccount = depositAccounts.find((item) => item.id === account)
  const periodStart = period === 'last-month'
    ? new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1)
    : period === 'last-3-months'
      ? new Date(currentDate.getFullYear(), currentDate.getMonth() - 2, 1)
      : new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
  const periodEnd = period === 'last-month'
    ? new Date(currentDate.getFullYear(), currentDate.getMonth(), 0, 23, 59, 59, 999)
    : currentDate
  const periodLabel = period === 'last-month'
    ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(periodStart)
    : period === 'last-3-months'
      ? `Last 3 months · ${new Intl.DateTimeFormat('en-US', { month: 'short' }).format(periodStart)}–${monthName}`
      : `${monthName} ${currentDate.getFullYear()} · Month to date`
  const activityDateLabel = `${dateFormatter.format(periodStart)}–${dateFormatter.format(periodEnd)}`
  const accountLabel = selectedAccount
    ? `${selectedAccount.name || accountDetails[selectedAccount.account_type]?.name || 'Account'} · •• ${selectedAccount.account_number.slice(-4)}`
    : 'All deposit accounts'
  const visibleTransactions = transactions.filter((transaction) => {
    const occurredAt = new Date(transaction.occurred_at)
    const matchesAccount = !selectedAccount || transaction.account_id === selectedAccount.id
    return matchesAccount && occurredAt >= periodStart && occurredAt <= periodEnd
  })
  const postedTransactions = visibleTransactions.filter((transaction) => transaction.status === 'posted')
  const spendingTransactions = postedTransactions.filter((transaction) =>
    transaction.transaction_type === 'debit' && !transaction.transfer_id)
  const moneyInCents = postedTransactions
    .filter((transaction) => transaction.transaction_type === 'credit')
    .reduce((total, transaction) => total + Math.round(Number(transaction.amount) * 100), 0)
  const moneyOutCents = postedTransactions
    .filter((transaction) => transaction.transaction_type === 'debit')
    .reduce((total, transaction) => total + Math.round(Number(transaction.amount) * 100), 0)
  const spendingCents = spendingTransactions
    .reduce((total, transaction) => total + Math.round(Number(transaction.amount) * 100), 0)
  const averagePurchaseCents = spendingTransactions.length
    ? Math.round(spendingCents / spendingTransactions.length)
    : 0
  const spendingByCategory = spendingTransactions.reduce((totals, transaction) => {
    const category = transaction.category_name || 'Uncategorized'
    totals.set(category, (totals.get(category) || 0) + Math.round(Number(transaction.amount) * 100))
    return totals
  }, new Map())
  const categoryRows = [...spendingByCategory.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((left, right) => right.amount - left.amount)
  const chartRows = categoryRows.length > 5
    ? [...categoryRows.slice(0, 4), {
      name: 'Other',
      amount: categoryRows.slice(4).reduce((total, item) => total + item.amount, 0),
    }]
    : categoryRows
  const chartColors = ['var(--account-green)', 'var(--account-teal)', 'var(--account-green-dark)', 'var(--account-teal-dark)', 'var(--dashboard-muted)']
  const chartGradient = chartRows.reduce((chart, item, index) => {
    const end = chart.offset + (spendingCents ? item.amount / spendingCents * 100 : 0)
    return {
      offset: end,
      stops: [...chart.stops, `${chartColors[index % chartColors.length]} ${chart.offset}% ${end}%`],
    }
  }, { offset: 0, stops: [] }).stops.join(', ')
  const trendStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 5, 1)
  const monthlyTrend = Array.from({ length: 6 }, (_, index) => {
    const monthStart = new Date(trendStart.getFullYear(), trendStart.getMonth() + index, 1)
    const monthKey = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`
    const monthTransactions = transactions.filter((transaction) => {
      const occurredAt = new Date(transaction.occurred_at)
      return transaction.status === 'posted'
        && (!selectedAccount || transaction.account_id === selectedAccount.id)
        && `${occurredAt.getFullYear()}-${String(occurredAt.getMonth() + 1).padStart(2, '0')}` === monthKey
    })
    const moneyIn = monthTransactions
      .filter((transaction) => transaction.transaction_type === 'credit')
      .reduce((total, transaction) => total + Math.round(Number(transaction.amount) * 100), 0)
    const moneyOut = monthTransactions
      .filter((transaction) => transaction.transaction_type === 'debit')
      .reduce((total, transaction) => total + Math.round(Number(transaction.amount) * 100), 0)
    return {
      label: new Intl.DateTimeFormat('en-US', { month: 'short' }).format(monthStart),
      moneyIn,
      moneyOut,
    }
  })
  const trendScale = Math.max(1, ...monthlyTrend.flatMap((item) => [item.moneyIn, item.moneyOut]))
  const hasCashFlow = monthlyTrend.some((item) => item.moneyIn || item.moneyOut)
  const budgetPeriodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
  const budgetPeriodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999)
  const budgetSpending = transactions.filter((transaction) => {
    const occurredAt = new Date(transaction.occurred_at)
    return transaction.status === 'posted'
      && transaction.transaction_type === 'debit'
      && !transaction.transfer_id
      && occurredAt >= budgetPeriodStart
      && occurredAt <= budgetPeriodEnd
  }).reduce((totals, transaction) => {
    const category = transaction.category_name || 'Uncategorized'
    totals.set(category, (totals.get(category) || 0) + Math.round(Number(transaction.amount) * 100))
    return totals
  }, new Map())

  function updateBudget(category, value) {
    setBudgetDraft((current) => current.map((item) => (
      item.category === category ? { ...item, target: value } : item
    )))
  }

  function saveBudgets(event) {
    event.preventDefault()
    if (budgetDraft.some((item) => !Number.isFinite(Number(item.target)) || Number(item.target) < 0)) {
      setBudgetSaveError('Enter a valid monthly target of $0.00 or more for each category.')
      return
    }
    const savedBudgets = budgetDraft.map((item) => ({ ...item, target: Number(item.target) }))
    setIsSavingBudgets(true)
    setBudgetSaveError('')
    Promise.resolve(onSaveBudgets(savedBudgets))
      .then(() => {
        setBudgetDraft(savedBudgets)
        setIsEditingBudgets(false)
      })
      .catch((error) => {
        setBudgetSaveError(error.message || 'Your budget targets could not be saved. Please try again.')
      })
      .finally(() => setIsSavingBudgets(false))
  }

  function cancelBudgetEdit() {
    setBudgetDraft(budgetTargets.map((item) => ({ ...item })))
    setIsEditingBudgets(false)
    onActionFeedback('Budget edits discarded.')
  }

  return (
    <div className="insights-page">
      <section className="dashboard__intro insights-page__intro" aria-labelledby="insights-page-title">
        <h1 id="insights-page-title">Insights</h1>
        <p>Build good habits with a clearer picture of your spending.</p>
      </section>

      <section className="insights-page__filters" aria-label="Insight filters">
        <div className="pay-transfer-field">
          <span>Period</span>
          <BrandedSelect
            label="Period"
            onChange={setPeriod}
            options={[
              { value: 'month-to-date', label: `${monthName} ${currentDate.getFullYear()} · Month to date` },
              { value: 'last-month', label: 'Last month' },
              { value: 'last-3-months', label: 'Last 3 months' },
            ]}
            value={period}
          />
        </div>
        <div className="pay-transfer-field">
          <span>Account</span>
          <BrandedSelect
            label="Account"
            onChange={setAccount}
            options={[
              { value: 'all', label: 'All deposit accounts' },
              ...depositAccounts.map((item) => ({
                value: item.id,
                label: `${item.name || accountDetails[item.account_type]?.name || 'Account'} · •• ${item.account_number.slice(-4)}`,
              })),
            ]}
            value={selectedAccount ? account : 'all'}
          />
        </div>
      </section>

      {transactionError && (
        <div className="insights-page__error" role="alert">
          <p>{transactionError}</p>
          <button className="dashboard__button" onClick={onRetryTransactions} type="button">Retry loading insights</button>
        </div>
      )}

      <div className="insights-page__overview">
        <section className="insights-page__spending" aria-labelledby="month-spending-title">
          <h2 id="month-spending-title">{period === 'month-to-date' ? 'Month-to-date spending' : 'Spending overview'}</h2>
          <p className="insights-page__spend-total">{formatAccountBalance(spendingCents / 100)}</p>
          <p className="insights-page__date-range">{activityDateLabel} · {accountLabel}</p>
          {transactionLoading ? (
            <p className="insights-page__status" role="status">Loading your account activity…</p>
          ) : transactionError ? (
            <div className="insights-page__empty">
              <span className="insights-page__empty-icon"><Icon name="insights" size={20} /></span>
              <h3>Spending data is unavailable</h3>
              <p>Retry loading to see your latest account activity and category breakdown.</p>
            </div>
          ) : spendingCents ? (
            <>
              <div
                className="insights-page__chart insights-page__chart--data"
                role="img"
                aria-label={`Spending breakdown for ${accountLabel} during ${periodLabel}: ${chartRows.map((item) => `${item.name} ${formatAccountBalance(item.amount / 100)}`).join(', ')}`}
              >
                <span aria-hidden="true" style={{ background: `conic-gradient(${chartGradient})` }} />
                <small>Spending by category</small>
              </div>
              <ul className="insights-page__category-list">
                {chartRows.map((item, index) => (
                  <li key={item.name}>
                    <span className="insights-page__category-name">
                      <span aria-hidden="true" style={{ backgroundColor: chartColors[index % chartColors.length] }} />
                      {item.name}
                    </span>
                    <strong>{formatAccountBalance(item.amount / 100)}</strong>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="insights-page__empty">
              <div className="insights-page__chart" role="img" aria-label={`No purchases for ${accountLabel} during ${periodLabel}`}>
                <span aria-hidden="true" />
                <small>No purchase activity for this period</small>
              </div>
              <span className="insights-page__empty-icon"><Icon name="insights" size={20} /></span>
              <h3>Your spending story starts here</h3>
              <p>Posted purchases will appear here by category. Transfers are shown in cash flow, not as purchases.</p>
            </div>
          )}
        </section>

        <section className="insights-page__monthly" aria-labelledby="monthly-overview-title">
          <h2 id="monthly-overview-title">Cash-flow overview</h2>
          <dl>
            <div><dt>Money in</dt><dd className={moneyInCents > 0 ? 'is-positive' : 'is-neutral'}>{formatAccountBalance(moneyInCents / 100)}</dd></div>
            <div><dt>Money out</dt><dd className={moneyOutCents > 0 ? 'is-negative' : 'is-neutral'}>{formatAccountBalance(moneyOutCents / 100)}</dd></div>
            <div>
              <dt>Net cash flow</dt>
              <dd className={moneyInCents > moneyOutCents ? 'is-positive' : moneyInCents < moneyOutCents ? 'is-negative' : 'is-neutral'}>
                {formatAccountBalance((moneyInCents - moneyOutCents) / 100)}
              </dd>
            </div>
          </dl>
          <p>Based on posted activity for {accountLabel}. Transfers count toward cash flow, but not purchase spending.</p>
          <button className="dashboard__button" onClick={onAddMoney} type="button">Go to transfers</button>
        </section>
      </div>

      <section className="insights-page__trend" aria-labelledby="cash-flow-trend-title" aria-busy={transactionLoading}>
        <header className="insights-page__trend-heading">
          <div>
            <h2 id="cash-flow-trend-title">Six-month cash flow</h2>
            <p>Posted deposits and withdrawals across {accountLabel.toLowerCase()}.</p>
          </div>
          <div className="insights-page__trend-legend" aria-label="Chart legend">
            <span><i className="is-money-in" />Money in</span>
            <span><i className="is-money-out" />Money out</span>
          </div>
        </header>
        {transactionLoading ? (
          <p className="insights-page__status" role="status">Loading cash-flow trends…</p>
        ) : transactionError ? (
          <p className="insights-page__status">Trend chart is unavailable until account activity loads.</p>
        ) : !hasCashFlow ? (
          <p className="insights-page__trend-empty">Posted deposits and withdrawals will appear here when there is account activity.</p>
        ) : (
          <div className="insights-page__trend-chart" role="img" aria-label={`Six-month cash flow for ${accountLabel}: ${monthlyTrend.map((item) => `${item.label}, money in ${formatAccountBalance(item.moneyIn / 100)}, money out ${formatAccountBalance(item.moneyOut / 100)}`).join('; ')}`}>
            {monthlyTrend.map((item) => (
              <div className="insights-page__trend-month" key={item.label}>
                <div className="insights-page__trend-bars">
                  <span
                    className="is-money-in"
                    style={{ height: `${item.moneyIn ? Math.max(1, item.moneyIn / trendScale * 100) : 0}%` }}
                    title={`${item.label} money in: ${formatAccountBalance(item.moneyIn / 100)}`}
                  />
                  <span
                    className="is-money-out"
                    style={{ height: `${item.moneyOut ? Math.max(1, item.moneyOut / trendScale * 100) : 0}%` }}
                    title={`${item.label} money out: ${formatAccountBalance(item.moneyOut / 100)}`}
                  />
                </div>
                <span className="insights-page__trend-month-label">{item.label}</span>
              </div>
            ))}
          </div>
        )}
        {!transactionLoading && !transactionError && hasCashFlow && (
          <p className="insights-page__trend-note">
            Bars show posted cash flow, including transfers. Purchase spending excludes transfers.
          </p>
        )}
      </section>

      <section className="insights-page__metrics" aria-label="Spending analytics">
        <article className="insights-page__metric">
          <span>Posted purchases</span>
          <strong>{transactionLoading ? 'Loading…' : spendingTransactions.length.toLocaleString('en-US')}</strong>
          <small>{periodLabel}</small>
        </article>
        <article className="insights-page__metric insights-page__metric--money">
          <span>Average purchase</span>
          <strong>{transactionLoading ? 'Loading…' : formatAccountBalance(averagePurchaseCents / 100)}</strong>
          <small>Purchases only · transfers excluded</small>
        </article>
        <article className="insights-page__metric">
          <span>Top spending category</span>
          <strong>{transactionLoading ? 'Loading…' : categoryRows[0]?.name || 'No activity'}</strong>
          <small className={categoryRows[0] ? 'insights-page__money' : undefined}>{categoryRows[0] ? formatAccountBalance(categoryRows[0].amount / 100) : periodLabel}</small>
        </article>
      </section>

      <section className="insights-page__budgets" aria-labelledby="budget-title">
        <header className="insights-page__budget-heading">
          <div>
            <h2 id="budget-title">Monthly budgets</h2>
            <p>Track posted purchase spending against your monthly targets.</p>
          </div>
          {!isEditingBudgets && (
            <button className="dashboard__button" disabled={budgetLoading} onClick={() => {
              setBudgetSaveError('')
              setBudgetDraft(budgetTargets.map((item) => ({ ...item })))
              setIsEditingBudgets(true)
            }} type="button">Edit budgets</button>
          )}
        </header>

        {budgetError && <p className="dashboard__data-error" role="alert">{budgetError}</p>}
        {budgetLoading && <p className="insights-page__status" role="status">Loading your budget targets…</p>}

        {isEditingBudgets && (
          <form className="insights-page__budget-editor" onSubmit={saveBudgets}>
            {budgetDraft.map((item) => (
              <label className="pay-transfer-field" key={item.category}>
                <span>{item.category} monthly target</span>
                <input
                  min="0"
                  required
                  step="0.01"
                  type="number"
                  value={item.target}
                  onChange={(event) => updateBudget(item.category, event.target.value)}
                />
              </label>
            ))}
            {budgetSaveError && <p className="dashboard__data-error" role="alert">{budgetSaveError}</p>}
            <div className="insights-page__budget-editor-actions">
              <button className="dashboard__button dashboard__button--primary" disabled={isSavingBudgets} type="submit">
                {isSavingBudgets ? 'Saving…' : 'Save budgets'}
              </button>
              <button className="dashboard__button" disabled={isSavingBudgets} onClick={cancelBudgetEdit} type="button">Cancel</button>
            </div>
          </form>
        )}

        <div className="insights-page__budget-cards">
          {budgetTargets.map((item) => (
            <article className="insights-page__budget-card" key={item.category}>
              <h3>{item.category}</h3>
              <span className="insights-page__suggested-badge">
                {savedBudgetCategories.includes(item.category) ? 'Monthly budget' : 'Suggested target'}
              </span>
              <p className="insights-page__budget-amount">
                {formatAccountBalance((budgetSpending.get(item.category) || 0) / 100)}
                <span> / {formatAccountBalance(item.target)}</span>
              </p>
              <div
                className="insights-page__budget-track"
                role="progressbar"
                aria-label={`${item.category} budget used`}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={item.target
                  ? Math.min(100, Math.round((budgetSpending.get(item.category) || 0) / 100 / item.target * 100))
                  : (budgetSpending.get(item.category) || 0) > 0 ? 100 : 0}
              >
                <span
                  className={(budgetSpending.get(item.category) || 0) / 100 > item.target ? 'is-over-budget' : ''}
                  style={{ width: `${item.target
                    ? Math.min(100, (budgetSpending.get(item.category) || 0) / 100 / item.target * 100)
                    : (budgetSpending.get(item.category) || 0) > 0 ? 100 : 0}%` }}
                />
              </div>
              <p className="insights-page__budget-remaining">
                {(budgetSpending.get(item.category) || 0) / 100 > item.target
                  ? `${formatAccountBalance(((budgetSpending.get(item.category) || 0) / 100) - item.target)} over budget`
                  : `${item.target ? Math.round((budgetSpending.get(item.category) || 0) / 100 / item.target * 100) : 0}% spent · ${formatAccountBalance(Math.max(0, item.target - (budgetSpending.get(item.category) || 0) / 100))} remaining`}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function StatementsPage({ accounts, accountsError, accountsLoading, authEmail, onActionFeedback, userId }) {
  const [account, setAccount] = useState('all')
  const [year, setYear] = useState(String(currentDate.getFullYear()))
  const [statements, setStatements] = useState([])
  const [statementsLoading, setStatementsLoading] = useState(true)
  const [statementsError, setStatementsError] = useState('')
  const [statementsReload, setStatementsReload] = useState(0)
  const [statementGenerationBusy, setStatementGenerationBusy] = useState(false)
  const [paperless, setPaperless] = useState(true)
  const [deliveryEmail, setDeliveryEmail] = useState(authEmail)
  const [preferencesLoading, setPreferencesLoading] = useState(true)
  const [preferencesSaving, setPreferencesSaving] = useState(false)
  const [downloadingStatementId, setDownloadingStatementId] = useState(null)
  const [preferencesError, setPreferencesError] = useState('')
  const [isEditingPreferences, setIsEditingPreferences] = useState(false)
  const [emailDraft, setEmailDraft] = useState(authEmail)
  const [status, setStatus] = useState('')
  const accountIdsKey = accounts.map((item) => item.id).join(',')
  const accountById = new Map(accounts.map((item) => [item.id, item]))
  const years = [...new Set([
    ...Array.from({ length: 5 }, (_, index) => currentDate.getFullYear() - index),
    ...statements.map((statement) => new Date(`${statement.period_end}T12:00:00`).getFullYear()),
  ])].sort((left, right) => right - left)
  const visibleStatements = statements.filter((statement) => (
    String(new Date(`${statement.period_end}T12:00:00`).getFullYear()) === year
    && accountById.has(statement.account_id)
    && (account === 'all' || statement.account_id === account)
  ))
  const statementDate = (value) => new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`))

  useEffect(() => {
    let isMounted = true
    async function loadStatements() {
      if (accountsLoading) return
      setStatementsLoading(true)
      setStatementsError('')
      if (!supabase || !userId) {
        setStatementsError('Your secure session is unavailable. Sign in again to view statements.')
        setStatementsLoading(false)
        return
      }
      if (accountsError) {
        setStatementsError(accountsError)
        setStatementsLoading(false)
        return
      }
      const ownedAccountIds = accountIdsKey ? accountIdsKey.split(',') : []
      if (!ownedAccountIds.length) {
        setStatements([])
        setStatementsLoading(false)
        return
      }
      try {
        const { data, error } = await supabase
          .from('statements')
          .select('id, account_id, period_start, period_end, storage_path, file_type, generated_at')
          .in('account_id', ownedAccountIds)
          .order('period_end', { ascending: false })
        if (error) throw error
        if (isMounted) setStatements(data || [])
      } catch (error) {
        if (isMounted) setStatementsError(error.message || 'Unable to load statements. Please refresh and try again.')
      } finally {
        if (isMounted) setStatementsLoading(false)
      }
    }
    loadStatements()
    return () => {
      isMounted = false
    }
  }, [accountIdsKey, accountsError, accountsLoading, statementsReload, userId])

  useEffect(() => {
    let isMounted = true
    async function loadDeliveryPreferences() {
      setPreferencesLoading(true)
      setPreferencesError('')
      if (!supabase || !userId) {
        setPreferencesError('Your secure session is unavailable. Sign in again to manage delivery preferences.')
        setPreferencesLoading(false)
        return
      }
      try {
        const { data, error } = await supabase
          .from('statement_delivery_preferences')
          .select('paperless_enabled, delivery_email')
          .eq('user_id', userId)
          .maybeSingle()
        if (error) throw error
        if (isMounted) {
          const initialEmail = data?.delivery_email || authEmail || ''
          setPaperless(data?.paperless_enabled ?? true)
          setDeliveryEmail(initialEmail)
          setEmailDraft(initialEmail)
        }
      } catch (error) {
        if (isMounted) setPreferencesError(error.message || 'Unable to load delivery preferences.')
      } finally {
        if (isMounted) setPreferencesLoading(false)
      }
    }
    loadDeliveryPreferences()
    return () => {
      isMounted = false
    }
  }, [authEmail, userId])

  async function saveDeliveryPreferences(nextPaperless, nextEmail) {
    if (!supabase || !userId) {
      setPreferencesError('Your secure session is unavailable. Sign in again before saving.')
      return false
    }
    setPreferencesSaving(true)
    setPreferencesError('')
    setStatus('Saving statement delivery preferences…')
    try {
      const { error } = await supabase
        .from('statement_delivery_preferences')
        .upsert({
          user_id: userId,
          paperless_enabled: nextPaperless,
          delivery_email: nextEmail,
        })
      if (error) throw error
      setPaperless(nextPaperless)
      setDeliveryEmail(nextEmail)
      setEmailDraft(nextEmail)
      setStatus('Statement delivery preferences saved.')
      onActionFeedback('Statement delivery preferences saved.')
      return true
    } catch (error) {
      setPreferencesError(error.message || 'Unable to save delivery preferences. Please try again.')
      setStatus('')
      return false
    } finally {
      setPreferencesSaving(false)
    }
  }

  async function downloadStatement(statement) {
    setStatus('Preparing statement download…')
    setStatementsError('')
    if (!supabase || statement.file_type !== 'application/pdf') {
      setStatus('')
      setStatementsError('This statement file is unavailable or is not a supported PDF.')
      return
    }
    setDownloadingStatementId(statement.id)
    try {
      const { data, error } = await supabase.storage
        .from('bank-statements')
        .download(statement.storage_path)
      if (error) throw error
      const url = URL.createObjectURL(data)
      const statementAccount = accountById.get(statement.account_id)
      const filename = `cedarline-${(statementAccount?.name || statementAccount?.account_type || 'account').toLowerCase()}-${statement.period_end}.pdf`
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      const message = `Statement for the period ending ${statementDate(statement.period_end)} downloaded.`
      setStatus(message)
      onActionFeedback(message)
    } catch (error) {
      setStatementsError(error.message || 'Unable to download this statement. Please try again.')
    } finally {
      setDownloadingStatementId(null)
    }
  }

  async function generatePreviousMonthStatements() {
    if (!supabase || !userId || !accounts.length || statementGenerationBusy) return
    const accountIds = account === 'all' ? accounts.map((item) => item.id) : [account]
    setStatementGenerationBusy(true)
    setStatementsError('')
    setStatus('Generating statements for the previous completed month…')
    try {
      const { data, error } = await supabase.functions.invoke('customer-statements', {
        body: { accountIds },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      const createdCount = (data.statements || []).filter((statement) => !statement.alreadyExists).length
      setStatementsReload((count) => count + 1)
      const summary = createdCount
        ? `Generated ${createdCount} statement${createdCount === 1 ? '' : 's'} for ${statementDate(data.period_start)} – ${statementDate(data.period_end)}.`
        : 'Statements for the previous completed month are already available.'
      const emailNote = data.emailSent
        ? ' Email notification sent.'
        : ' Email was skipped or unavailable; statements are available in-app.'
      setStatus(`${summary}${emailNote}`)
      onActionFeedback(`${summary}${emailNote}`)
    } catch (error) {
      setStatementsError(error.message || 'Unable to generate statements. Please try again.')
      setStatus('')
    } finally {
      setStatementGenerationBusy(false)
    }
  }

  function savePreferences(event) {
    event.preventDefault()
    const nextEmail = emailDraft.trim()
    if (!nextEmail) {
      setPreferencesError('Enter an email address for statement delivery.')
      return
    }
    saveDeliveryPreferences(paperless, nextEmail).then((saved) => {
      if (saved) setIsEditingPreferences(false)
    })
  }

  if (statementsLoading || preferencesLoading) {
    return <BankingPageLoader page="Statements" />
  }

  return (
    <div className="statements-page">
      <section className="dashboard__intro statements-page__intro" aria-labelledby="statements-title">
        <h1 id="statements-title">Statements</h1>
        <p>Your records, neatly organized and always within reach.</p>
      </section>

      <section className="statements-page__filters" aria-label="Statement filters">
        <div className="pay-transfer-field">
          <span>Account</span>
          <BrandedSelect
            label="Account"
            onChange={setAccount}
            options={[
              { value: 'all', label: 'All accounts' },
              ...accounts.map((item) => ({
                value: item.id,
                label: `${item.name || accountDetails[item.account_type]?.name || 'Account'} · •• ${item.account_number.slice(-4)}`,
              })),
            ]}
            value={account === 'all' || accountById.has(account) ? account : 'all'}
          />
        </div>
        <div className="pay-transfer-field">
          <span>Period</span>
          <BrandedSelect
            label="Statement year"
            onChange={setYear}
            options={years.map((statementYear) => ({ value: String(statementYear), label: String(statementYear) }))}
            value={year}
          />
        </div>
      </section>

      <section className="statements-page__card statements-page__available" aria-labelledby="your-statements-title" aria-busy={statementsLoading}>
        <header className="statements-page__card-heading">
          <div>
            <h2 id="your-statements-title">Your statements</h2>
            <p>Secure documents for your accounts. Generate the previous completed month.</p>
          </div>
          <button
            className="statements-page__generate"
            disabled={accountsLoading || !accounts.length || statementGenerationBusy}
            onClick={generatePreviousMonthStatements}
            type="button"
          >
            <Icon name="statements" size={17} />
            {statementGenerationBusy ? 'Generating…' : 'Generate last month'}
          </button>
        </header>
        {statementsError && <p className="dashboard__data-error" role="alert">{statementsError}</p>}
        {statementsLoading ? (
          <p className="statements-page__loading" role="status">Loading your statements…</p>
        ) : visibleStatements.length ? (
          <div className="statements-page__list" role="table" aria-label="Your account statements">
            <div className="statements-page__list-header" role="row">
              <span role="columnheader">Account</span>
              <span role="columnheader">Statement period</span>
              <span role="columnheader">Download</span>
            </div>
            {visibleStatements.map((statement) => {
              const statementAccount = accountById.get(statement.account_id)
              const accountName = statementAccount?.name
                || accountDetails[statementAccount?.account_type]?.name
                || 'Account'
              return (
                <div className="statements-page__statement-row" key={statement.id} role="row">
                  <div className="statements-page__statement-account" role="cell">
                    <Icon name="statements" size={20} />
                    <span>
                      <strong>{accountName} ·· {statementAccount?.account_number.slice(-4)}</strong>
                      <small>PDF statement · Generated {statementDate(statement.generated_at.slice(0, 10))}</small>
                    </span>
                  </div>
                  <span className="statements-page__statement-period" role="cell">
                    {statementDate(statement.period_start)} – {statementDate(statement.period_end)}
                  </span>
                  <button
                    className="statements-page__download"
                    disabled={statement.file_type !== 'application/pdf' || Boolean(downloadingStatementId)}
                    onClick={() => downloadStatement(statement)}
                    type="button"
                  >
                    <Icon name="download" size={17} />
                    {downloadingStatementId === statement.id ? 'Preparing…' : 'Download PDF'}
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="statements-page__empty">
            <span className="statements-page__empty-icon"><Icon name="statements" size={24} /></span>
            <h3>No statements available for {year}</h3>
            <p>When a statement document is securely published for one of your accounts, it will appear here.</p>
          </div>
        )}
        <p className="statements-page__footnote">Statement files are private and accessible only to the account owner.</p>
      </section>

      <section className="statements-page__card statements-page__delivery" aria-labelledby="paperless-title">
        <h2 id="paperless-title">Paperless delivery</h2>
        <div className="statements-page__paperless-row">
          <div>
            <h3>Paperless statements</h3>
            <p>Receive an email when a new statement is ready.</p>
          </div>
          <button
            aria-checked={paperless}
            aria-label="Paperless statements"
            className="statements-page__switch"
            disabled={preferencesLoading || preferencesSaving}
            onClick={() => saveDeliveryPreferences(!paperless, deliveryEmail)}
            role="switch"
            type="button"
          >
            <span />
          </button>
        </div>
        <p className="statements-page__delivery-email">Delivery email: {deliveryEmail || 'Not set'}</p>
        {preferencesError && <p className="dashboard__data-error" role="alert">{preferencesError}</p>}
        {preferencesLoading && <p className="statements-page__loading" role="status">Loading delivery preferences…</p>}
        {isEditingPreferences ? (
          <form className="statements-page__preferences-form" onSubmit={savePreferences}>
            <label className="pay-transfer-field">
              <span>Delivery email</span>
              <input
                autoComplete="email"
                required
                type="email"
                disabled={preferencesSaving}
                value={emailDraft}
                onChange={(event) => setEmailDraft(event.target.value)}
              />
            </label>
            <div className="statements-page__preferences-actions">
              <button className="dashboard__button dashboard__button--primary" disabled={preferencesSaving} type="submit">
                {preferencesSaving ? 'Saving…' : 'Save preferences'}
              </button>
              <button className="dashboard__button" onClick={() => {
                setEmailDraft(deliveryEmail)
                setIsEditingPreferences(false)
              }} disabled={preferencesSaving} type="button">Cancel</button>
            </div>
          </form>
        ) : (
          <button className="dashboard__button statements-page__preferences-button" disabled={preferencesLoading} onClick={() => {
            setEmailDraft(deliveryEmail)
            setIsEditingPreferences(true)
          }} type="button">
            Update delivery preferences
          </button>
        )}
        <p className="statements-page__footnote">These are saved delivery preferences. Email notifications require a configured notification service.</p>
      </section>

      <p className="statements-page__status" role="status" aria-live="polite">{status}</p>
    </div>
  )
}

const defaultAlertPreferences = {
  lowBalance: true,
  lowBalanceThreshold: '100.00',
  largeTransaction: true,
  largeTransactionThreshold: '500.00',
  transferUpdates: true,
  statementReady: true,
  securityAlerts: true,
  pushNotifications: true,
  emailNotifications: true,
  smsNotifications: false,
  phoneNumber: '',
}

function AlertSwitch({ checked, disabled = false, label, onChange }) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="alerts-page__switch"
      disabled={disabled}
      onClick={onChange}
      role="switch"
      type="button"
    >
      <span />
    </button>
  )
}

function getNotificationCategory(type) {
  const normalized = String(type || '').toLowerCase()
  if (normalized.includes('account_on_hold')) return 'account-hold'
  if (normalized.includes('account_hold_released')) return 'account-release'
  if (normalized.includes('kyc_review')) return 'application-status'
  if (normalized.includes('security') || normalized.includes('login')) return 'security'
  if (normalized.includes('admin_message')) return 'admin-message'
  if (normalized.includes('statement')) return 'statement'
  if (normalized.includes('transfer')) return 'transfer'
  if (normalized.includes('balance')) return 'low-balance'
  if (normalized.includes('transaction')) return 'large-transaction'
  return 'other'
}

function getNotificationPriority(notification) {
  const priority = String(notification?.data?.priority || 'normal').toLowerCase()
  return ['high', 'urgent'].includes(priority) ? priority : 'normal'
}

function getNotificationCategoryName(value) {
  return {
    account_alert: 'Account Alert',
    security: 'Security',
    general: 'General',
    investigation: 'Investigation',
  }[value] || ''
}

function getNotificationCategoryLabel(category) {
  return {
    'admin-message': 'Secure message',
    'account-hold': 'Account restriction',
    'account-release': 'Account update',
    'application-status': 'Application status',
    security: 'Security alert',
    statement: 'Statement update',
    transfer: 'Transfer activity',
    'low-balance': 'Balance alert',
    'large-transaction': 'Transaction alert',
    other: 'Account update',
  }[category] || 'Account update'
}

function getNotificationNextStep(category) {
  return {
    'admin-message': 'This secure message was sent by Evergreen and is available in your in-app Alerts.',
    'account-hold': 'If you have questions about this restriction, contact Evergreen through secure messages in your app.',
    'account-release': 'Review your account status above. If the account remains frozen, contact Evergreen through secure messages.',
    security: 'If you do not recognize this activity, review your security settings and contact Cedarline support.',
    statement: 'Your statement is available in Statements whenever you are ready to review it.',
    transfer: 'Check the amount and recipient details above. You can review the entry in your account activity.',
    'low-balance': 'Review your available balance and recent activity to decide what action is right for you.',
    'large-transaction': 'Confirm this activity looks familiar by checking your recent account transactions.',
    other: 'Visit your Alerts page to review this update alongside your other account notifications.',
  }[category] || 'Visit your Alerts page to review this update alongside your other account notifications.'
}

function CustomerMessageReplyForm({ notification, onReply, onSent }) {
  const [message, setMessage] = useState('')
  const [numericAnswer, setNumericAnswer] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const responsePrompt = notification?.data?.response_prompt
  const customerResponse = notification?.data?.customer_response
  const hasResponse = typeof customerResponse === 'number'

  async function submitReply(event) {
    event.preventDefault()
    if ((!responsePrompt && !message.trim()) || (responsePrompt && !numericAnswer.trim()) || hasResponse || busy) return
    setBusy(true)
    setError('')
    const replyBody = message.trim()
    const result = await onReply(notification, replyBody, responsePrompt ? numericAnswer.trim() : null)
    setBusy(false)
    if (result?.error) {
      setError(result.error)
      return
    }
    setMessage('')
    onSent?.()
  }

  return (
    <form className="customer-message-reply" onSubmit={submitReply}>
      {error && <p className="customer-message-reply__error" role="alert">{error}</p>}
      {responsePrompt && hasResponse ? (
        <p className="customer-message-reply__submitted" role="status">
          Your response: <strong>{customerResponse}</strong>
        </p>
      ) : responsePrompt ? (
        <label htmlFor={`customer-message-number-${notification.id}`}>{responsePrompt}
          <input
            id={`customer-message-number-${notification.id}`}
            inputMode="decimal"
            onChange={(event) => setNumericAnswer(event.target.value)}
            required
            step="any"
            type="number"
            value={numericAnswer}
          />
        </label>
      ) : (
        <>
          <label htmlFor={`customer-message-reply-${notification.id}`}>Reply securely</label>
          <textarea
            id={`customer-message-reply-${notification.id}`}
            maxLength={4000}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Write a reply to the Cedarline team"
            required
            rows={4}
            value={message}
          />
        </>
      )}
      <div className="customer-message-reply__footer">
        <small>{responsePrompt ? (hasResponse ? 'Response submitted' : 'Enter a number') : `${message.length.toLocaleString()} / 4,000`}</small>
        {!hasResponse && (
          <button className="dashboard__button dashboard__button--primary" disabled={busy || (responsePrompt ? !numericAnswer.trim() || !Number.isFinite(Number(numericAnswer)) : !message.trim())} type="submit">
            {busy ? 'Sending…' : responsePrompt ? 'Send response' : 'Send reply'}
          </button>
        )}
      </div>
    </form>
  )
}

function NotificationPopup({ accounts, busy, notification, onClose, onMarkRead, onReply, onViewAlerts }) {
  const [isClosing, setIsClosing] = useState(false)
  const closeTimer = useRef(null)
  const category = getNotificationCategory(notification?.notification_type)
  const categoryLabel = getNotificationCategoryLabel(category)
  const priority = getNotificationPriority(notification)
  const critical = ['account-hold', 'security'].includes(category) || priority !== 'normal'
  const isBankMessage = notification?.notification_type?.includes('admin_message')
  const hasExternalNumericPrompt = typeof notification?.data?.external_transfer_request_id === 'string'
    && typeof notification?.data?.response_prompt === 'string'
  const transferDetails = notification?.notification_type === 'transfer_received'
    && notification.data?.transaction_id
    ? notification.data
    : null
  const notificationDate = notification ? new Date(notification.created_at) : null
  const transferAccount = transferDetails
    ? accounts.find((account) => account.id === transferDetails.account_id)
    : null
  const transferAccountName = transferDetails?.account_name
    || transferAccount?.name
    || accountDetails[transferAccount?.account_type]?.name
    || 'Account'

  useEffect(() => {
    return () => window.clearTimeout(closeTimer.current)
  }, [])

  function closePopup() {
    if (isClosing) return
    setIsClosing(true)
    closeTimer.current = window.setTimeout(onClose, 180)
  }

  if (!notification) return null
  return (
    <div className="notification-popup-backdrop" role="presentation" onClick={(event) => {
      if (event.target === event.currentTarget) closePopup()
    }}>
      <section
        aria-labelledby="notification-popup-title"
        aria-modal="true"
        className={`notification-popup${isBankMessage ? ' notification-popup--bank-message' : ''}${isClosing ? ' is-closing' : ''}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') closePopup()
        }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-describedby={isBankMessage || hasExternalNumericPrompt ? 'notification-popup-body' : 'notification-popup-body notification-popup-next-step'}
      >
        <header className={`notification-popup__header notification-popup__header--${category}${critical ? ' notification-popup__header--critical' : ''}`}>
          <span className="notification-popup__icon"><Icon name={category === 'security' ? 'profile' : category === 'statement' ? 'statements' : category === 'transfer' ? 'transfer' : 'alerts'} size={22} /></span>
          <div className="notification-popup__heading-copy">
            <span className="notification-popup__eyebrow">{categoryLabel}</span>
            {getNotificationCategoryName(notification.data?.category) && (
              <span className="notification-popup__priority">{getNotificationCategoryName(notification.data.category)}</span>
            )}
            {priority !== 'normal' && <span className={`notification-popup__priority notification-popup__priority--${priority}`}>{priority}</span>}
            <span className="notification-popup__unread"><i aria-hidden="true" />New</span>
          </div>
          <button className="notification-popup__close" aria-label="Dismiss notification" onClick={closePopup} type="button">×</button>
        </header>
        <div className="notification-popup__content">
          <h2 id="notification-popup-title">{notification.title}</h2>
          <p className={`notification-popup__body${isBankMessage ? ' notification-popup__body--bank-message' : ''}`} id="notification-popup-body">
            {transferDetails ? 'An incoming credit has been posted to your account. Review the transfer details below.' : notification.body}
          </p>
          {transferDetails && (
            <dl className="notification-popup__transfer-details" aria-label="Transfer details">
              <div><dt>Amount received</dt><dd>{formatAccountBalance(transferDetails.amount, transferDetails.currency)}</dd></div>
              <div><dt>From</dt><dd>{transferDetails.counterparty_name || 'Sender'}</dd></div>
              <div><dt>Credited to</dt><dd>{transferAccountName}{transferDetails.account_last_four || transferAccount?.account_number ? ` ·· ${transferDetails.account_last_four || transferAccount.account_number.slice(-4)}` : ''}</dd></div>
              <div><dt>Posted</dt><dd>{new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(transferDetails.posted_at || notification.created_at))}</dd></div>
              {transferDetails.memo && <div><dt>Memo</dt><dd>{transferDetails.memo}</dd></div>}
              {transferDetails.reference && <div><dt>Reference</dt><dd>{transferDetails.reference}</dd></div>}
            </dl>
          )}
          {((isBankMessage && notification.data?.admin_message_id) || hasExternalNumericPrompt) && (
            <CustomerMessageReplyForm notification={notification} onReply={onReply} />
          )}
          {!isBankMessage && !hasExternalNumericPrompt && (
            <aside className={`notification-popup__next-step notification-popup__next-step--${category}`} id="notification-popup-next-step">
              <strong>What you can do</strong>
              <p>{getNotificationNextStep(category)}</p>
            </aside>
          )}
          <div className="notification-popup__meta">
            <Icon name="statements" size={16} />
            <span>
              Received
              <time dateTime={notification.created_at}>
                {new Intl.DateTimeFormat('en-US', {
                  dateStyle: 'full',
                  timeStyle: 'short',
                }).format(notificationDate)}
              </time>
            </span>
          </div>
        </div>
        <div className="notification-popup__actions">
          <button className="dashboard__button" onClick={() => {
            closePopup()
            window.setTimeout(onViewAlerts, 180)
          }} type="button">View all alerts</button>
          <button className="dashboard__button dashboard__button--primary" disabled={busy} onClick={() => onMarkRead(notification.id)} type="button">
            {busy ? 'Saving…' : 'Mark as read'}
          </button>
        </div>
      </section>
    </div>
  )
}

function AlertsPage({
  authEmail,
  markAllNotificationsBusy,
  notificationError,
  notificationBusyIds,
  notifications,
  notificationsLoading,
  onActionFeedback,
  onMarkAllNotificationsRead,
  onMarkNotificationRead,
  onReply,
  userId,
}) {
  const [preferences, setPreferences] = useState(defaultAlertPreferences)
  const [savedPreferences, setSavedPreferences] = useState(defaultAlertPreferences)
  const [preferencesLoading, setPreferencesLoading] = useState(true)
  const [preferencesError, setPreferencesError] = useState('')
  const [isSavingPreferences, setIsSavingPreferences] = useState(false)
  const [alertType, setAlertType] = useState('all')
  const [isAddingPhone, setIsAddingPhone] = useState(false)
  const [status, setStatus] = useState('')
  const [replyingNotificationId, setReplyingNotificationId] = useState(null)
  useEffect(() => {
    let isMounted = true
    async function loadPreferences() {
      setPreferencesLoading(true)
      setPreferencesError('')
      if (!supabase || !userId) {
        setPreferencesError('Your secure session is unavailable. Sign in again to manage alerts.')
        setPreferencesLoading(false)
        return
      }
      try {
        const { data, error } = await supabase
          .from('alert_preferences')
          .select('email_enabled, push_enabled, low_balance_threshold, low_balance_enabled, large_transaction_enabled, transfer_updates_enabled, statement_ready_enabled, security_alerts, large_transaction_threshold')
          .eq('user_id', userId)
          .maybeSingle()
        if (error) throw error
        if (isMounted && data) {
          const loadedPreferences = {
            ...defaultAlertPreferences,
            lowBalance: data.low_balance_enabled,
            lowBalanceThreshold: data.low_balance_threshold == null ? '100.00' : Number(data.low_balance_threshold).toFixed(2),
            largeTransaction: data.large_transaction_enabled,
            largeTransactionThreshold: data.large_transaction_threshold == null ? '500.00' : Number(data.large_transaction_threshold).toFixed(2),
            transferUpdates: data.transfer_updates_enabled,
            statementReady: data.statement_ready_enabled,
            securityAlerts: data.security_alerts,
            pushNotifications: data.push_enabled,
            emailNotifications: data.email_enabled,
          }
          setPreferences(loadedPreferences)
          setSavedPreferences(loadedPreferences)
        }
      } catch (error) {
        if (isMounted) setPreferencesError(error.message || 'Unable to load alert preferences.')
      } finally {
        if (isMounted) setPreferencesLoading(false)
      }
    }
    loadPreferences()
    return () => {
      isMounted = false
    }
  }, [userId])

  const alertTypes = [
    { value: 'all', label: 'All alerts' },
    { value: 'admin-message', label: 'Secure messages' },
    { value: 'low-balance', label: 'Low balance' },
    { value: 'large-transaction', label: 'Large transaction' },
    { value: 'transfer', label: 'Transfer updates' },
    { value: 'statement', label: 'Statement ready' },
    { value: 'account-hold', label: 'Account restrictions' },
    { value: 'account-release', label: 'Account updates' },
    { value: 'application-status', label: 'Application updates' },
    { value: 'security', label: 'Security alerts' },
  ]
  const visibleNotifications = notifications.filter((notification) => (
    alertType === 'all' || getNotificationCategory(notification.notification_type) === alertType
  ))

  function togglePreference(name) {
    setPreferences((current) => ({ ...current, [name]: !current[name] }))
  }

  function updatePreference(name, value) {
    setPreferences((current) => ({ ...current, [name]: value }))
  }

  function savePreferences() {
    const threshold = Number(preferences.lowBalanceThreshold)
    const transactionThreshold = Number(preferences.largeTransactionThreshold)
    if (preferences.lowBalanceThreshold.trim() === '' || !Number.isFinite(threshold) || threshold < 0
      || preferences.largeTransactionThreshold.trim() === '' || !Number.isFinite(transactionThreshold) || transactionThreshold < 0) {
      setStatus('Enter a valid low-balance threshold of zero or more.')
      return
    }
    if (!supabase || !userId) {
      setPreferencesError('Your secure session is unavailable. Sign in again before saving preferences.')
      return
    }
    setIsSavingPreferences(true)
    setPreferencesError('')
    setStatus('')
    const nextPreferences = { ...preferences, lowBalanceThreshold: threshold.toFixed(2), largeTransactionThreshold: transactionThreshold.toFixed(2) }
    supabase.from('alert_preferences').upsert({
      user_id: userId,
      email_enabled: preferences.emailNotifications,
      sms_enabled: false,
      push_enabled: preferences.pushNotifications,
      low_balance_enabled: preferences.lowBalance,
      low_balance_threshold: threshold.toFixed(2),
      large_transaction_enabled: preferences.largeTransaction,
      large_transaction_threshold: transactionThreshold.toFixed(2),
      transfer_updates_enabled: preferences.transferUpdates,
      statement_ready_enabled: preferences.statementReady,
      transaction_alerts: preferences.largeTransaction || preferences.transferUpdates,
      login_alerts: preferences.securityAlerts,
      security_alerts: preferences.securityAlerts,
    }).then(({ error }) => {
      if (error) throw error
      setPreferences(nextPreferences)
      setSavedPreferences(nextPreferences)
      setStatus('Alert preferences saved. They apply to future activity.')
      onActionFeedback('Alert preferences saved.')
    }).catch((error) => {
      setPreferencesError(error.message || 'Unable to save alert preferences.')
    }).finally(() => setIsSavingPreferences(false))
  }

  function resetPreferences() {
    setPreferences({ ...savedPreferences })
    setIsAddingPhone(false)
    setStatus('Unsaved changes were reset.')
    onActionFeedback('Unsaved alert preference changes were reset.')
  }

  function savePhoneNumber(event) {
    event.preventDefault()
    const digitCount = preferences.phoneNumber.replace(/\D/g, '').length
    if (digitCount < 7 || digitCount > 15) {
      setStatus('Enter a phone number with 7 to 15 digits.')
      return
    }
    setIsAddingPhone(false)
    setStatus('Phone number format checked. Verification is not connected, so the number was not saved and SMS alerts remain off.')
  }

  if (preferencesLoading) {
    return <BankingPageLoader page="Alerts" />
  }

  return (
    <div className="alerts-page">
      <section className="dashboard__intro alerts-page__intro" aria-labelledby="alerts-title">
        <h1 id="alerts-title">Alerts</h1>
        <p>Stay informed about the things that matter to you.</p>
      </section>

      <div className="alerts-page__settings-grid">
        <section className="alerts-page__card alerts-page__account" aria-labelledby="account-alerts-title">
          <header className="alerts-page__card-heading">
            <h2 id="account-alerts-title">Account alerts</h2>
            <p>Choose which in-app alerts you want to receive.</p>
          </header>
          {preferencesError && <p className="dashboard__data-error" role="alert">{preferencesError}</p>}
          {preferencesLoading && <p className="alerts-page__loading" role="status">Loading your alert preferences…</p>}

          <div className="alerts-page__preference">
            <div className="alerts-page__preference-copy">
              <h3>Low balance</h3>
              <p>Notify me when checking falls below my threshold.</p>
            </div>
            <AlertSwitch checked={preferences.lowBalance} disabled={preferencesLoading || isSavingPreferences} label="Low balance alerts" onChange={() => togglePreference('lowBalance')} />
            <label className="pay-transfer-field alerts-page__threshold">
              <span>Low-balance threshold</span>
              <input
                aria-label="Low-balance threshold"
                min="0"
                required
                step="0.01"
                type="number"
                disabled={preferencesLoading || isSavingPreferences}
                value={preferences.lowBalanceThreshold}
                onChange={(event) => updatePreference('lowBalanceThreshold', event.target.value)}
              />
              <small>Applies to future notifications. Current available balance is shown on Accounts.</small>
            </label>
          </div>

          {[
            { key: 'largeTransaction', title: 'Large transaction', description: `Activity of ${formatAccountBalance(preferences.largeTransactionThreshold)} or more.` },
            { key: 'transferUpdates', title: 'Transfer updates', description: 'Confirmations, delays and failed transfers.' },
            { key: 'statementReady', title: 'Statement ready', description: 'A reminder when a new document is available.' },
            { key: 'securityAlerts', title: 'Security alerts', description: 'Sign-ins and changes to your security settings.' },
          ].map((item) => (
            <div className="alerts-page__preference" key={item.key}>
              <div className="alerts-page__preference-copy">
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
              <AlertSwitch
                checked={preferences[item.key]}
                disabled={preferencesLoading || isSavingPreferences}
                label={`${item.title} notifications`}
                onChange={() => togglePreference(item.key)}
              />
              {item.key === 'largeTransaction' && (
                <label className="pay-transfer-field alerts-page__threshold">
                  <span>Large-transaction threshold</span>
                  <input
                    aria-label="Large-transaction threshold"
                    disabled={preferencesLoading || isSavingPreferences}
                    min="0"
                    required
                    step="0.01"
                    type="number"
                    value={preferences.largeTransactionThreshold}
                    onChange={(event) => updatePreference('largeTransactionThreshold', event.target.value)}
                  />
                </label>
              )}
            </div>
          ))}
          <p className="alerts-page__security-note">Important security notices are always sent by email.</p>
        </section>

        <div className="alerts-page__delivery-column">
          <section className="alerts-page__card alerts-page__delivery" aria-labelledby="delivery-channels-title">
            <header className="alerts-page__card-heading">
              <h2 id="delivery-channels-title">Delivery channels</h2>
            </header>
            <div className="alerts-page__channel">
              <div className="alerts-page__preference-copy">
                <h3>Push notifications</h3>
                <p>Send alerts to registered devices.</p>
              </div>
              <AlertSwitch checked={preferences.pushNotifications} disabled={preferencesLoading || isSavingPreferences} label="Push notifications" onChange={() => togglePreference('pushNotifications')} />
            </div>
            <div className="alerts-page__channel">
              <div className="alerts-page__preference-copy">
                <h3>Email</h3>
                <p>{authEmail || 'No sign-in email available'}</p>
              </div>
              <AlertSwitch checked={preferences.emailNotifications} disabled={preferencesLoading || isSavingPreferences} label="Email notifications" onChange={() => togglePreference('emailNotifications')} />
            </div>
            <div className="alerts-page__channel alerts-page__channel--sms">
              <div className="alerts-page__preference-copy">
                <h3>SMS</h3>
                <p>                {preferences.phoneNumber || 'SMS requires verified phone setup, which is not connected yet.'}</p>
              </div>
              <AlertSwitch
                checked={preferences.smsNotifications}
                disabled
                label="SMS notifications unavailable until phone verification is connected"
                onChange={() => {}}
              />
              {isAddingPhone ? (
                <form className="alerts-page__phone-form" onSubmit={savePhoneNumber}>
                  <label className="pay-transfer-field">
                    <span>Phone number</span>
                    <input
                      autoComplete="tel"
                      inputMode="tel"
                      placeholder="(555) 555-0100"
                      required
                      type="tel"
                      value={preferences.phoneNumber}
                      onChange={(event) => updatePreference('phoneNumber', event.target.value)}
                    />
                  </label>
                  <p>Phone verification is not connected. This number will not be saved and SMS will remain off.</p>
                  <div className="alerts-page__phone-actions">
                    <button className="dashboard__button" type="submit">Check number format</button>
                    <button className="alerts-page__text-button" onClick={() => setIsAddingPhone(false)} type="button">Cancel</button>
                  </div>
                </form>
              ) : (
                <button className="dashboard__button alerts-page__verify" onClick={() => setIsAddingPhone(true)} type="button">
                  Verify phone number
                </button>
              )}
            </div>
            <p className="alerts-page__delivery-note">In-app banners and unread notification pop-ups are available now. Email and device push delivery require a configured notification service.</p>
          </section>

          <aside className="alerts-page__control-note" aria-label="Alert preferences information">
            <span aria-hidden="true">i</span>
            <div>
              <strong>You’re in control</strong>
              <p>Your preferences apply to future activity. Setting an alert does not move money or change your account balance.</p>
            </div>
          </aside>
        </div>
      </div>

      <section className="alerts-page__card alerts-page__history" aria-labelledby="alert-history-title" aria-busy={notificationsLoading}>
        <header className="alerts-page__card-heading">
          <h2 id="alert-history-title">Alert history</h2>
          <p>Your latest notifications</p>
        </header>
        <div className="pay-transfer-field alerts-page__history-filter">
          <span>Alert type</span>
          <BrandedSelect
            label="Alert type"
            onChange={setAlertType}
            options={alertTypes}
            value={alertType}
          />
        </div>
        {notificationError && <p className="dashboard__data-error" role="alert">{notificationError}</p>}
        {notificationsLoading ? (
          <p className="alerts-page__loading" role="status">Loading notifications…</p>
        ) : visibleNotifications.length ? (
          <>
            <ul className="alerts-page__notification-list">
              {visibleNotifications.map((notification) => {
                const canReply = (getNotificationCategory(notification.notification_type) === 'admin-message'
                  && typeof notification.data?.admin_message_id === 'string')
                  || (typeof notification.data?.external_transfer_request_id === 'string'
                    && typeof notification.data?.response_prompt === 'string'
                    && typeof notification.data?.customer_response !== 'number')
                return (
                  <li className={`alerts-page__notification alerts-page__notification--${getNotificationCategory(notification.notification_type)}${['account-hold', 'security'].includes(getNotificationCategory(notification.notification_type)) || getNotificationPriority(notification) !== 'normal' ? ' alerts-page__notification--critical' : ''}${notification.read_at ? '' : ' is-unread'}`} key={notification.id}>
                    <span className="alerts-page__notification-icon"><Icon name="alerts" size={18} /></span>
                    <div className="alerts-page__notification-copy">
                      <strong>{notification.title}</strong>
                      {(getNotificationCategoryName(notification.data?.category) || getNotificationPriority(notification) !== 'normal') && (
                        <span className="alerts-page__notification-meta">
                          {getNotificationCategoryName(notification.data?.category)}
                          {getNotificationPriority(notification) !== 'normal' && ` · ${getNotificationPriority(notification)} priority`}
                        </span>
                      )}
                      <p>{notification.body}</p>
                      <time dateTime={notification.created_at}>
                        {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notification.created_at))}
                      </time>
                      {replyingNotificationId === notification.id && canReply && (
                        <CustomerMessageReplyForm
                          notification={notification}
                          onReply={onReply}
                          onSent={() => setReplyingNotificationId(null)}
                        />
                      )}
                    </div>
                    <div className="alerts-page__notification-actions">
                      {canReply && (
                        <button
                          className="alerts-page__text-button"
                          onClick={() => setReplyingNotificationId((current) => current === notification.id ? null : notification.id)}
                          type="button"
                        >
                          {replyingNotificationId === notification.id ? 'Cancel reply' : 'Reply'}
                        </button>
                      )}
                      {!notification.read_at && (
                        <button
                          className="alerts-page__text-button"
                          disabled={markAllNotificationsBusy || notificationBusyIds.has(notification.id)}
                          onClick={() => onMarkNotificationRead(notification.id)}
                          type="button"
                        >
                          {notificationBusyIds.has(notification.id) ? 'Saving…' : 'Mark read'}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            {notifications.some((notification) => !notification.read_at) && (
              <button className="dashboard__button" disabled={markAllNotificationsBusy || notificationBusyIds.size > 0} onClick={onMarkAllNotificationsRead} type="button">
                {markAllNotificationsBusy ? 'Marking…' : 'Mark all as read'}
              </button>
            )}
          </>
        ) : (
          <div className="alerts-page__empty">
            <span className="alerts-page__empty-icon"><Icon name="alerts" size={23} /></span>
            <h3>{alertType === 'all' ? 'You’re all caught up' : 'No matching notifications'}</h3>
            <p>{alertType === 'all'
              ? 'New account notifications will appear here and be announced when you next open the site.'
              : `There are no ${alertTypes.find((item) => item.value === alertType)?.label.toLowerCase()} notifications yet.`}</p>
          </div>
        )}
      </section>

      <div className="alerts-page__actions">
        <button className="dashboard__button dashboard__button--primary" disabled={preferencesLoading || isSavingPreferences} onClick={savePreferences} type="button">
          {isSavingPreferences ? 'Saving…' : 'Save preferences'}
        </button>
        <button className="dashboard__button" disabled={preferencesLoading || isSavingPreferences} onClick={resetPreferences} type="button">Reset changes</button>
        <p className="alerts-page__status" role="status" aria-live="polite">{status}</p>
      </div>
    </div>
  )
}

const defaultProfileSettings = {
  firstName: 'Alex',
  lastName: 'Morgan',
  email: 'alex.morgan@example.com',
  phone: '',
  mailingAddress: '',
  accountUpdates: true,
  productNews: false,
  helpfulTips: false,
  sessionTimeout: '10',
  language: 'en-US',
  timeZone: 'America/New_York',
  paperless: true,
}

function getCurrentDeviceIdentifier(userId) {
  const storageKey = `cedarline-device:${userId}`
  let identifier = window.localStorage.getItem(storageKey)
  if (!identifier) {
    if (!window.crypto?.getRandomValues) {
      throw new Error('This browser cannot securely register a device.')
    }
    identifier = window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : Array.from(window.crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('')
    window.localStorage.setItem(storageKey, identifier)
  }
  return identifier
}

function getCurrentDeviceName() {
  const userAgent = window.navigator.userAgent
  const browser = userAgent.includes('Edg/')
    ? 'Microsoft Edge'
    : userAgent.includes('Firefox/')
      ? 'Firefox'
      : userAgent.includes('Chrome/')
        ? 'Chrome'
        : userAgent.includes('Safari/')
          ? 'Safari'
          : 'Web browser'
  const platform = window.navigator.userAgentData?.platform || window.navigator.platform
  return platform ? `${browser} on ${platform}` : browser
}

async function registerCurrentDevice(userId) {
  if (!supabase) throw new Error('Your secure session is unavailable. Sign in again to manage devices.')
  const deviceIdentifier = getCurrentDeviceIdentifier(userId)
  const { error } = await supabase
    .from('devices')
    .upsert({
      user_id: userId,
      device_identifier: deviceIdentifier,
      device_name: getCurrentDeviceName(),
      platform: 'web',
      last_seen_at: getCurrentIsoTimestamp(),
    }, { onConflict: 'user_id,device_identifier' })
  if (error) throw error
  return deviceIdentifier
}

function ProfilePage({ authEmail, onActionFeedback, onManageAlerts, onSaveSettings, userId }) {
  const [savedSettings, setSavedSettings] = useState(() => ({ ...defaultProfileSettings, email: authEmail || '' }))
  const [settings, setSettings] = useState(() => ({ ...defaultProfileSettings, email: authEmail || '' }))
  const [isChangingEmail, setIsChangingEmail] = useState(false)
  const [emailDraft, setEmailDraft] = useState(authEmail || '')
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [processingAction, setProcessingAction] = useState('')
  const [devicesOpen, setDevicesOpen] = useState(false)
  const [signOutNotice, setSignOutNotice] = useState(false)
  const [registeredDevices, setRegisteredDevices] = useState([])
  const [currentDeviceIdentifier, setCurrentDeviceIdentifier] = useState('')
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [devicesError, setDevicesError] = useState('')
  const [totpFactor, setTotpFactor] = useState(null)
  const [totpEnrollment, setTotpEnrollment] = useState(null)
  const [totpCode, setTotpCode] = useState('')
  const [totpDisableOpen, setTotpDisableOpen] = useState(false)
  const [totpBusy, setTotpBusy] = useState(false)
  const [totpError, setTotpError] = useState('')
  const [totpStatus, setTotpStatus] = useState('')
  const [totpLoading, setTotpLoading] = useState(true)
  const [status, setStatus] = useState('')
  const displayName = `${settings.firstName.trim()} ${settings.lastName.trim()}`.trim() || 'Cedarline customer'
  const initials = `${settings.firstName.trim().charAt(0)}${settings.lastName.trim().charAt(0)}`.toUpperCase() || 'AM'

  useEffect(() => {
    let isMounted = true
    async function loadProfile() {
      setProfileLoading(true)
      setProfileError('')
      if (!supabase || !userId) {
        setProfileError('Your secure session is unavailable. Sign in again to load your profile.')
        setProfileLoading(false)
        return
      }
      try {
        const [userResult, profileResult, preferencesResult, deliveryResult] = await Promise.all([
          supabase.from('users').select('display_name, phone_e164').eq('id', userId).maybeSingle(),
          supabase.from('user_profiles').select('legal_first_name, legal_last_name, mailing_address').eq('user_id', userId).maybeSingle(),
          supabase.from('profile_preferences').select('account_updates_enabled, product_news_enabled, helpful_tips_enabled, language, time_zone, session_timeout_minutes').eq('user_id', userId).maybeSingle(),
          supabase.from('statement_delivery_preferences').select('paperless_enabled').eq('user_id', userId).maybeSingle(),
        ])
        for (const result of [userResult, profileResult, preferencesResult, deliveryResult]) {
          if (result.error) throw result.error
        }
        const nameParts = String(userResult.data?.display_name || authEmail?.split('@')[0] || 'Customer').trim().split(/\s+/)
        const saved = {
          ...defaultProfileSettings,
          firstName: profileResult.data?.legal_first_name || nameParts[0],
          lastName: profileResult.data?.legal_last_name || nameParts.slice(1).join(' '),
          email: authEmail || '',
          phone: userResult.data?.phone_e164 || '',
          mailingAddress: profileResult.data?.mailing_address?.formatted || '',
          accountUpdates: preferencesResult.data?.account_updates_enabled ?? defaultProfileSettings.accountUpdates,
          productNews: preferencesResult.data?.product_news_enabled ?? defaultProfileSettings.productNews,
          helpfulTips: preferencesResult.data?.helpful_tips_enabled ?? defaultProfileSettings.helpfulTips,
          language: preferencesResult.data?.language || defaultProfileSettings.language,
          timeZone: preferencesResult.data?.time_zone || defaultProfileSettings.timeZone,
          sessionTimeout: String(preferencesResult.data?.session_timeout_minutes || defaultProfileSettings.sessionTimeout),
          paperless: deliveryResult.data?.paperless_enabled ?? defaultProfileSettings.paperless,
        }
        if (isMounted) {
          setSettings(saved)
          setSavedSettings(saved)
        }
      } catch (error) {
        if (isMounted) setProfileError(error.message || 'Unable to load your profile. Please refresh and try again.')
      } finally {
        if (isMounted) setProfileLoading(false)
      }
    }
    loadProfile()
    return () => {
      isMounted = false
    }
  }, [authEmail, userId])

  useEffect(() => {
    let isMounted = true
    async function loadTotpFactor() {
      if (!supabase || !userId) {
        setTotpLoading(false)
        return
      }
      try {
        const { data, error } = await supabase.auth.mfa.listFactors()
        if (error) throw error
        if (isMounted) setTotpFactor(data.totp.find((factor) => factor.status === 'verified') || null)
      } catch (error) {
        if (isMounted) setTotpError(error.message || 'Unable to load two-step verification status.')
      } finally {
        if (isMounted) setTotpLoading(false)
      }
    }
    void loadTotpFactor()
    return () => {
      isMounted = false
    }
  }, [userId])

  function updateSetting(name, value) {
    setSettings((current) => ({ ...current, [name]: value }))
  }

  async function toggleDevices() {
    if (devicesOpen) {
      setDevicesOpen(false)
      return
    }
    setDevicesOpen(true)
    setDevicesLoading(true)
    setDevicesError('')
    try {
      const deviceIdentifier = await registerCurrentDevice(userId)
      const { data, error } = await supabase
        .from('devices')
        .select('id, device_identifier, device_name, platform, last_seen_at, trusted_at')
        .eq('user_id', userId)
        .order('last_seen_at', { ascending: false })
      if (error) throw error
      setCurrentDeviceIdentifier(deviceIdentifier)
      setRegisteredDevices(data || [])
    } catch (error) {
      setDevicesError(error.message || 'Unable to load registered devices.')
    } finally {
      setDevicesLoading(false)
    }
  }

  async function saveSettings(event, group) {
    event.preventDefault()
    if (profileLoading || isSaving) return
    const fields = {
      personal: ['firstName', 'lastName', 'email', 'phone', 'mailingAddress'],
      notifications: ['accountUpdates', 'productNews', 'helpfulTips'],
      security: ['sessionTimeout'],
      preferences: ['language', 'timeZone', 'paperless'],
    }[group]
    const nextSettings = { ...savedSettings }
    fields.forEach((field) => { nextSettings[field] = settings[field] })
    if (group === 'personal' && !nextSettings.firstName.trim()) {
      setStatus('Enter your first name before saving.')
      return
    }
    if (group === 'personal' && !nextSettings.lastName.trim()) {
      setStatus('Enter your last name before saving.')
      return
    }
    const phoneDigits = nextSettings.phone.replace(/\D/g, '')
    if (nextSettings.phone.trim() && (!nextSettings.phone.trim().startsWith('+') || phoneDigits.length < 7 || phoneDigits.length > 15)) {
      setStatus('Enter a phone number in international format, such as +15555550100.')
      return
    }
    setIsSaving(true)
    setProfileError('')
    setStatus('')
    setProcessingAction('password-reset')
    try {
      await onSaveSettings(nextSettings)
      setSavedSettings(nextSettings)
      setSettings(nextSettings)
      setStatus(`${group === 'personal' ? 'Personal information' : group === 'preferences' ? 'Account preferences' : group === 'security' ? 'Security preferences' : 'Notification preferences'} saved.`)
    } catch (error) {
      setProfileError(error.message || 'Unable to save your profile. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  function resetSettings() {
    setSettings({ ...savedSettings })
    setStatus('Unsaved profile changes were reset.')
    onActionFeedback('Unsaved profile changes were reset.')
  }

  async function requestPasswordReset() {
    if (!supabase || !authEmail) {
      setStatus('Your secure session or sign-in email is unavailable. Sign in again and try once more.')
      return
    }
    setStatus('')
    setProfileError('')
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(authEmail, {
        redirectTo: getAccountAppRedirectUrl(),
      })
      if (error) {
        setProfileError(error.message || 'Unable to request a password reset.')
        return
      }
      const message = `If an account exists for ${authEmail}, password reset instructions will be sent to that address.`
      setStatus(message)
      onActionFeedback('Password reset instructions have been sent if the account is eligible.')
    } catch (error) {
      setProfileError(error.message || 'Unable to request a password reset.')
    } finally {
      setProcessingAction('')
    }
  }

  async function requestEmailChange() {
    const nextEmail = emailDraft.trim()
    if (!supabase || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      setProfileError('Enter a valid email address before requesting a change.')
      return
    }
    if (nextEmail.toLowerCase() === authEmail.toLowerCase()) {
      setProfileError('Enter a different email address.')
      return
    }
    setProfileError('')
    setStatus('')
    setProcessingAction('email-change')
    try {
      const { error } = await supabase.auth.updateUser({ email: nextEmail })
      if (error) throw error
      setIsChangingEmail(false)
      const message = `A verification link was requested for ${nextEmail}. Your sign-in email changes only after verification.`
      setStatus(message)
      onActionFeedback(`Email verification instructions were requested for ${nextEmail}.`)
    } catch (error) {
      setProfileError(error.message || 'Unable to request an email change.')
    } finally {
      setProcessingAction('')
    }
  }

  async function signOutOtherSessions() {
    if (!supabase) {
      setProfileError('Your secure session is unavailable. Sign in again before managing sessions.')
      return
    }
    setProfileError('')
    setProcessingAction('sign-out-sessions')
    try {
      const deviceIdentifier = currentDeviceIdentifier || await registerCurrentDevice(userId)
      const { error } = await supabase.auth.signOut({ scope: 'others' })
      if (error) {
        setProfileError(error.message || 'Unable to sign out other sessions.')
        return
      }
      const { error: devicesError } = await supabase
        .from('devices')
        .delete()
        .eq('user_id', userId)
        .neq('device_identifier', deviceIdentifier)
      if (devicesError) {
        setProfileError(`Other sessions were signed out, but the device list could not be refreshed: ${devicesError.message}`)
        return
      }
      setCurrentDeviceIdentifier(deviceIdentifier)
      setRegisteredDevices((devices) => devices.filter((device) => device.device_identifier === deviceIdentifier))
      setSignOutNotice(false)
      setStatus('Other sessions have been signed out. This session remains active.')
      onActionFeedback('Other active sessions have been signed out.')
    } catch (error) {
      setProfileError(error.message || 'Unable to sign out other sessions.')
    } finally {
      setProcessingAction('')
    }
  }

  async function startTotpEnrollment() {
    if (!supabase || totpBusy) return
    setTotpBusy(true)
    setTotpError('')
    setTotpStatus('')
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Cedarline authenticator',
        issuer: 'Cedarline',
      })
      if (error) throw error
      setTotpEnrollment({
        id: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      })
      setTotpCode('')
    } catch (error) {
      setTotpError(error.message || 'Unable to start authenticator setup.')
    } finally {
      setTotpBusy(false)
    }
  }

  async function confirmTotpEnrollment(event) {
    event.preventDefault()
    if (!supabase || !totpEnrollment || totpCode.length !== 6 || totpBusy) return
    setTotpBusy(true)
    setTotpError('')
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: totpEnrollment.id })
      if (challengeError) throw challengeError
      const { error } = await supabase.auth.mfa.verify({
        factorId: totpEnrollment.id,
        challengeId: challenge.id,
        code: totpCode,
      })
      if (error) throw error
      setTotpFactor({ id: totpEnrollment.id, factor_type: 'totp', status: 'verified' })
      setTotpEnrollment(null)
      setTotpCode('')
      setTotpStatus('Two-step verification is now enabled for your next sign-in.')
      onActionFeedback('Authenticator app enabled for two-step sign-in.')
    } catch (error) {
      setTotpError(error.message || 'That code could not be verified. Enter the latest code from your authenticator app.')
    } finally {
      setTotpBusy(false)
    }
  }

  async function cancelTotpEnrollment() {
    if (!supabase || !totpEnrollment || totpBusy) return
    setTotpBusy(true)
    setTotpError('')
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: totpEnrollment.id })
      if (error) throw error
      setTotpEnrollment(null)
      setTotpCode('')
      setTotpStatus('Authenticator setup canceled.')
    } catch (error) {
      setTotpError(error.message || 'Unable to cancel authenticator setup.')
    } finally {
      setTotpBusy(false)
    }
  }

  async function disableTotp(event) {
    event.preventDefault()
    if (!supabase || !totpFactor || totpCode.length !== 6 || totpBusy) return
    setTotpBusy(true)
    setTotpError('')
    let factorDisabled = false
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: totpFactor.id })
      if (challengeError) throw challengeError
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: totpFactor.id,
        challengeId: challenge.id,
        code: totpCode,
      })
      if (verifyError) throw verifyError
      const { error } = await supabase.auth.mfa.unenroll({ factorId: totpFactor.id })
      if (error) throw error
      setTotpFactor(null)
      factorDisabled = true
      setTotpDisableOpen(false)
      setTotpCode('')
      const { error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError) throw refreshError
      setTotpStatus('Two-step verification has been turned off.')
      onActionFeedback('Authenticator app removed from two-step sign-in.')
    } catch (error) {
      setTotpError(factorDisabled
        ? 'Two-step verification was turned off, but the session could not refresh. Sign out and sign in again.'
        : error.message || 'The authenticator code could not be verified. Two-step verification remains enabled.')
    } finally {
      setTotpBusy(false)
    }
  }

  if (profileLoading) {
    return <BankingPageLoader page="Profile" />
  }

  return (
    <div className="profile-page">
      <section className="dashboard__intro profile-page__intro" aria-labelledby="profile-settings-title">
        <h1 id="profile-settings-title">Profile &amp; Settings</h1>
        <p>Your details. Your preferences. Your peace of mind.</p>
      </section>

      <aside className="profile-page__demo-note" role="note">
        <span aria-hidden="true">i</span>
        <div>
          <strong>Signed-in account</strong>
          <p>This profile belongs to {authEmail || 'your authenticated account'}.</p>
        </div>
      </aside>
      {profileError && <p className="dashboard__data-error" role="alert">{profileError}</p>}
      {profileLoading && <p className="profile-page__status" role="status">Loading your profile…</p>}

      <div className="profile-page__grid">
        <section className="profile-page__card profile-page__personal" aria-labelledby="personal-information-title">
          <h2 id="personal-information-title">Personal information</h2>
          {profileLoading && <p className="profile-page__setting-help">Loading saved details…</p>}
          <div className="profile-page__identity">
            <span className="profile-page__avatar" aria-hidden="true">{initials}</span>
            <div>
              <h3>{displayName}</h3>
              <p>Personal banking · Verified sign-in</p>
            </div>
          </div>
          <form className="profile-page__personal-form" onSubmit={(event) => saveSettings(event, 'personal')}>
            <div className="profile-page__name-fields">
              <label className="pay-transfer-field">
                <span>First name</span>
                <input autoComplete="given-name" disabled={profileLoading || isSaving} required value={settings.firstName} onChange={(event) => updateSetting('firstName', event.target.value)} />
              </label>
              <label className="pay-transfer-field">
                <span>Last name</span>
                <input autoComplete="family-name" disabled={profileLoading || isSaving} required value={settings.lastName} onChange={(event) => updateSetting('lastName', event.target.value)} />
              </label>
            </div>
            <div className="pay-transfer-field">
              <span>Email address</span>
              <input aria-label="Current sign-in email" autoComplete="email" readOnly type="email" value={settings.email} />
              {isChangingEmail ? (
                <span className="profile-page__email-change">
                  <input
                    autoComplete="email"
                    aria-label="New sign-in email"
                    required
                    type="email"
                    value={emailDraft}
                    onChange={(event) => setEmailDraft(event.target.value)}
                  />
                  <button className="dashboard__button" disabled={processingAction !== ''} onClick={requestEmailChange} type="button">
                    {processingAction === 'email-change' ? 'Sending…' : 'Send verification link'}
                  </button>
                  <button className="profile-page__reset" onClick={() => {
                    setEmailDraft(authEmail)
                    setIsChangingEmail(false)
                  }} type="button">Cancel</button>
                </span>
              ) : (
                <>
                  <small>Changing your sign-in email requires verification.</small>
                  <button className="profile-page__reset" onClick={() => {
                    setEmailDraft(authEmail)
                    setIsChangingEmail(true)
                  }} type="button">Change sign-in email</button>
                </>
              )}
            </div>
            <label className="pay-transfer-field">
              <span>Phone number</span>
              <input autoComplete="tel" disabled={profileLoading || isSaving} inputMode="tel" placeholder="+15555550100" type="tel" value={settings.phone} onChange={(event) => updateSetting('phone', event.target.value)} />
              <small>Use international format, including + and country code. SMS verification is not enabled.</small>
            </label>
            <label className="pay-transfer-field">
              <span>Mailing address</span>
              <input autoComplete="street-address" disabled={profileLoading || isSaving} placeholder="Not added" value={settings.mailingAddress} onChange={(event) => updateSetting('mailingAddress', event.target.value)} />
              <small>An address is required before ordering a physical card.</small>
            </label>
            <button className="dashboard__button dashboard__button--primary" disabled={profileLoading || Boolean(profileError) || isSaving} type="submit">
              {isSaving ? 'Saving…' : 'Save personal information'}
            </button>
          </form>
        </section>

        <section className="profile-page__card profile-page__security" aria-labelledby="security-title">
          <h2 id="security-title">Security</h2>
          <div className="profile-page__security-row">
            <div>
              <span className="profile-page__label">Password</span>
              <strong aria-label="Password hidden">••••••••••••</strong>
            </div>
            <button className="dashboard__button" disabled={processingAction !== ''} onClick={requestPasswordReset} type="button">
              {processingAction === 'password-reset' ? 'Sending…' : 'Send password reset email'}
            </button>
          </div>
          <div className="profile-page__security-row profile-page__security-row--split">
            <div>
              <h3>Two-step verification</h3>
              <p>{totpFactor ? 'An authenticator app is required in addition to your password at sign-in.' : 'Use an authenticator app to add a second sign-in step.'}</p>
              <span className={`profile-page__security-badge${totpFactor ? '' : ' is-off'}`}>{totpLoading ? 'Checking…' : totpFactor ? 'Enabled' : 'Not enabled'}</span>
            </div>
            {totpFactor ? (
              <button className="dashboard__button" disabled={totpLoading || totpBusy} onClick={() => {
                setTotpDisableOpen(true)
                setTotpCode('')
                setTotpError('')
              }} type="button">Turn off</button>
            ) : !totpEnrollment ? (
              <button className="dashboard__button" disabled={totpLoading || totpBusy || Boolean(totpError)} onClick={startTotpEnrollment} type="button">
                {totpBusy ? 'Starting…' : 'Set up authenticator'}
              </button>
            ) : null}
            {totpEnrollment && (
              <div className="profile-page__totp-setup">
                <p>Scan this QR code with an authenticator app, or enter the setup key manually.</p>
                <img alt="Authenticator setup QR code" src={totpEnrollment.qrCode} />
                <p className="profile-page__totp-secret">Setup key: <code>{totpEnrollment.secret}</code></p>
                <form onSubmit={confirmTotpEnrollment}>
                  <label className="pay-transfer-field">
                    <span>6-digit authenticator code</span>
                    <input
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      pattern="[0-9]{6}"
                      required
                      value={totpCode}
                    />
                  </label>
                  <div className="profile-page__totp-actions">
                    <button className="dashboard__button" disabled={totpBusy} onClick={cancelTotpEnrollment} type="button">Cancel setup</button>
                    <button className="dashboard__button dashboard__button--primary" disabled={totpBusy || totpCode.length !== 6} type="submit">{totpBusy ? 'Verifying…' : 'Verify and enable'}</button>
                  </div>
                </form>
              </div>
            )}
            {totpDisableOpen && (
              <form className="profile-page__totp-disable" onSubmit={disableTotp}>
                <p>Enter a current authenticator code to turn off two-step verification.</p>
                <label className="pay-transfer-field">
                  <span>6-digit authenticator code</span>
                  <input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    pattern="[0-9]{6}"
                    required
                    value={totpCode}
                  />
                </label>
                <div className="profile-page__totp-actions">
                  <button className="dashboard__button" disabled={totpBusy} onClick={() => {
                    setTotpDisableOpen(false)
                    setTotpCode('')
                    setTotpError('')
                  }} type="button">Cancel</button>
                  <button className="dashboard__button dashboard__button--primary" disabled={totpBusy || totpCode.length !== 6} type="submit">{totpBusy ? 'Verifying…' : 'Verify and turn off'}</button>
                </div>
              </form>
            )}
            {totpError && <p className="profile-page__totp-error" role="alert">{totpError}</p>}
            {totpStatus && <p className="profile-page__totp-status" role="status">{totpStatus}</p>}
          </div>
          <div className="profile-page__security-row">
            <div>
              <h3>Registered devices</h3>
              <p>Browsers that have opened this device list. You can sign out active sessions on other devices.</p>
            </div>
            <button className="dashboard__button" disabled={profileLoading || devicesLoading} onClick={toggleDevices} type="button">
              {devicesOpen ? 'Hide devices' : 'Manage devices'}
            </button>
            {devicesOpen && (
              <div className="profile-page__device-detail">
                {devicesLoading && <span role="status">Loading devices…</span>}
                {devicesError && <span role="alert">{devicesError}</span>}
                {!devicesLoading && !devicesError && !registeredDevices.length && <span>No registered devices found.</span>}
                {registeredDevices.map((device) => (
                  <span key={device.id}>
                    <strong>{device.device_name || device.platform}</strong>
                    {device.device_identifier === currentDeviceIdentifier ? ' · This device' : ''}
                    {' · Last active '}
                    {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(device.last_seen_at))}
                    {device.trusted_at ? ' · Trusted' : ''}
                  </span>
                ))}
                {!devicesLoading && !devicesError && registeredDevices.length > 0 && (
                  <button className="profile-page__text-button" onClick={() => setSignOutNotice(true)} type="button">
                    Sign out other sessions
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="profile-page__security-row profile-page__session-row">
            <div>
              <h3>Session security</h3>
              <p>Automatic sign-out follows this saved {settings.sessionTimeout}-minute inactivity timeout. You’ll get a one-minute warning first.</p>
              <div className="pay-transfer-field profile-page__timeout">
                <span>Inactivity timeout</span>
                <BrandedSelect
                  label="Inactivity timeout"
                  disabled={profileLoading || Boolean(profileError) || isSaving}
                  onChange={(value) => updateSetting('sessionTimeout', value)}
                  options={[
                    { value: '5', label: '5 minutes' },
                    { value: '10', label: '10 minutes' },
                    { value: '15', label: '15 minutes' },
                    { value: '30', label: '30 minutes' },
                  ]}
                  value={settings.sessionTimeout}
                />
              </div>
            </div>
            <button className="profile-page__text-button" onClick={() => setSignOutNotice(true)} type="button">Sign out of other sessions</button>
          </div>
          <button className="dashboard__button profile-page__full-button" disabled={profileLoading || Boolean(profileError) || isSaving} onClick={(event) => saveSettings(event, 'security')} type="button">
            {isSaving ? 'Saving…' : 'Save security preferences'}
          </button>
        </section>

        <section className="profile-page__card profile-page__notifications" aria-labelledby="notification-preferences-title">
          <h2 id="notification-preferences-title">Notification preferences</h2>
          {[
            { key: 'accountUpdates', title: 'Account updates', description: 'Balances, payments and statement availability.' },
            { key: 'productNews', title: 'Product news', description: 'Optional updates about Cedarline products.' },
            { key: 'helpfulTips', title: 'Helpful tips', description: 'Occasional guidance on managing your money.' },
          ].map((item) => (
            <div className="profile-page__notification-row" key={item.key}>
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
              <AlertSwitch
                checked={settings[item.key]}
                disabled={profileLoading || Boolean(profileError) || isSaving}
                label={item.title}
                onChange={() => updateSetting(item.key, !settings[item.key])}
              />
            </div>
          ))}
          <button className="dashboard__button profile-page__full-button" disabled={profileLoading || Boolean(profileError) || isSaving} onClick={(event) => saveSettings(event, 'notifications')} type="button">
            {isSaving ? 'Saving…' : 'Save notification preferences'}
          </button>
          <p className="profile-page__setting-help">These preferences are saved. Email and push delivery require a notification service.</p>
          <button className="dashboard__button profile-page__full-button" onClick={onManageAlerts} type="button">Manage alert channels</button>
        </section>

        <form className="profile-page__card profile-page__preferences" onSubmit={(event) => saveSettings(event, 'preferences')}>
          <h2>Account preferences</h2>
          <div className="pay-transfer-field">
            <span>Language</span>
            <BrandedSelect
              label="Language"
              disabled={profileLoading || Boolean(profileError) || isSaving}
              onChange={(value) => updateSetting('language', value)}
              options={[
                { value: 'en-US', label: 'English (US)' },
                { value: 'es-US', label: 'Español (US)' },
              ]}
              value={settings.language}
            />
            <small className="profile-page__setting-help">Saved preference; full interface translation is not enabled yet.</small>
          </div>
          <div className="pay-transfer-field">
            <span>Time zone</span>
            <BrandedSelect
              label="Time zone"
              disabled={profileLoading || Boolean(profileError) || isSaving}
              onChange={(value) => updateSetting('timeZone', value)}
              options={[
                { value: 'America/New_York', label: 'Eastern Time (US)' },
                { value: 'America/Chicago', label: 'Central Time (US)' },
                { value: 'America/Denver', label: 'Mountain Time (US)' },
                { value: 'America/Los_Angeles', label: 'Pacific Time (US)' },
              ]}
              value={settings.timeZone}
            />
          </div>
          <div className="profile-page__paperless">
            <div>
              <h3>Paperless statements</h3>
              <p>Email notifications instead of paper delivery.</p>
            </div>
            <AlertSwitch checked={settings.paperless} disabled={profileLoading || Boolean(profileError) || isSaving} label="Paperless statements preference" onChange={() => updateSetting('paperless', !settings.paperless)} />
          </div>
          <p className="profile-page__setting-help">This preference is shared with Statements. Email delivery requires a notification service.</p>
          <button className="dashboard__button profile-page__full-button" disabled={profileLoading || Boolean(profileError) || isSaving} type="submit">
            {isSaving ? 'Saving…' : 'Save preferences'}
          </button>
          <button className="profile-page__reset" disabled={profileLoading || Boolean(profileError) || isSaving} onClick={resetSettings} type="button">Reset unsaved changes</button>
        </form>
      </div>

      <p className="profile-page__status" role="status" aria-live="polite">{status}</p>

      {signOutNotice && (
        <div className="profile-page__dialog-backdrop" role="presentation" onClick={() => {
          setSignOutNotice(false)
        }}>
          <section
            aria-labelledby="profile-dialog-title"
            aria-modal="true"
            className="profile-page__dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h2 id="profile-dialog-title">Sign out other sessions?</h2>
            <p>This will end your other active sessions. Your current session will remain signed in.</p>
            <div className="profile-page__dialog-actions">
              <button className="dashboard__button" onClick={() => setSignOutNotice(false)} type="button">Cancel</button>
              <button className="dashboard__button dashboard__button--primary" disabled={processingAction !== ''} onClick={signOutOtherSessions} type="button">
                {processingAction === 'sign-out-sessions' ? 'Signing out…' : 'Sign out other sessions'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function RecentTransactionsPage({ accounts, error, initialSearch, loading, onRetry, transactions }) {
  const [account, setAccount] = useState('all')
  const [dateRange, setDateRange] = useState('last-90-days')
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState(initialSearch)
  const [page, setPage] = useState(1)
  const pageSize = 10
  const currentMonth = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(currentDate)
  const accountById = new Map(accounts.map((item) => [item.id, item]))
  const dateOptions = [
    { value: 'all-time', label: 'All time' },
    { value: 'current-month', label: currentMonth },
    { value: 'last-30-days', label: 'Last 30 days' },
    { value: 'last-90-days', label: 'Last 90 days' },
    { value: 'previous-month', label: 'Previous month' },
  ]
  const statusLabel = (value) => value.charAt(0).toUpperCase() + value.slice(1)
  const statusOptions = [
    { value: 'all', label: 'All statuses' },
    ...['pending', 'posted', 'reversed', 'failed'].map((value) => ({
      value,
      label: statusLabel(value),
    })),
  ]
  const filteredTransactions = transactions.filter((transaction) => {
    const transactionDate = new Date(transaction.occurred_at)
    const query = search.trim().toLowerCase()
    const transactionAccount = accountById.get(transaction.account_id)
    const accountName = transactionAccount?.name
      || accountDetails[transactionAccount?.account_type]?.name
      || 'Account'
    const searchText = [
      transaction.description,
      transaction.counterparty_name,
      transaction.reference,
      accountName,
      transactionAccount?.account_number.slice(-4),
    ].filter(Boolean).join(' ').toLowerCase()
    const matchesAccount = account === 'all' || transaction.account_id === account
    const matchesStatus = status === 'all' || transaction.status === status
    const matchesSearch = !query || searchText.includes(query)
    let matchesDate = true

    if (dateRange === 'all-time') {
      matchesDate = true
    } else if (dateRange === 'current-month') {
      matchesDate = transactionDate.getFullYear() === currentDate.getFullYear()
        && transactionDate.getMonth() === currentDate.getMonth()
    } else if (dateRange === 'previous-month') {
      const previousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1)
      matchesDate = transactionDate.getFullYear() === previousMonth.getFullYear()
        && transactionDate.getMonth() === previousMonth.getMonth()
    } else {
      const days = dateRange === 'last-30-days' ? 30 : 90
      const earliestDate = new Date(currentDate)
      earliestDate.setDate(earliestDate.getDate() - days)
      matchesDate = transactionDate >= new Date(earliestDate.getFullYear(), earliestDate.getMonth(), earliestDate.getDate())
        && transactionDate <= currentDate
    }
    return matchesAccount && matchesStatus && matchesSearch && matchesDate
  })
  const pageCount = Math.max(1, Math.ceil(filteredTransactions.length / pageSize))
  const pageTransactions = filteredTransactions.slice((page - 1) * pageSize, page * pageSize)
  const startItem = filteredTransactions.length ? (page - 1) * pageSize + 1 : 0
  const endItem = Math.min(page * pageSize, filteredTransactions.length)
  const accountLabel = account === 'all'
    ? 'All accounts'
    : `${accountById.get(account)?.name || accountDetails[accountById.get(account)?.account_type]?.name || 'Account'} account`
  const formattedDate = (value) => new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))

  return (
    <div className="transaction-history">
      <section className="dashboard__intro transaction-history__intro" aria-labelledby="recent-transactions-title">
        <h1 id="recent-transactions-title">Recent transactions</h1>
        <p>Your account activity · {accountLabel}</p>
      </section>

      <section className="transaction-history__card" aria-labelledby="checking-activity-title" aria-busy={loading}>
        <header className="transaction-history__heading">
          <h2 id="checking-activity-title">{account === 'all' ? 'All account activity' : `${accountLabel.split(' account')[0]} activity`}</h2>
          <p>{transactions.length} transactions across your accounts</p>
        </header>

        <div className="transaction-history__filters">
          <div className="pay-transfer-field">
            <span>Account</span>
            <BrandedSelect
              label="Account"
              onChange={(value) => {
                setAccount(value)
                setPage(1)
              }}
              options={[
                { value: 'all', label: 'All accounts' },
                ...accounts.map((item) => {
                  const display = getAccountDisplay(item)
                  return {
                    value: item.id,
                    label: `${display.name} · •• ${display.lastFour}`,
                  }
                }),
              ]}
              value={account}
            />
          </div>
          <div className="pay-transfer-field">
            <span>Date range</span>
            <BrandedSelect label="Date range" onChange={(value) => {
              setDateRange(value)
              setPage(1)
            }} options={dateOptions} value={dateRange} />
          </div>
          <div className="pay-transfer-field">
            <span>Status</span>
            <BrandedSelect label="Status" onChange={(value) => {
              setStatus(value)
              setPage(1)
            }} options={statusOptions} value={status} />
          </div>
          <label className="pay-transfer-field transaction-history__search">
            <span>Search transactions</span>
            <span className="transaction-history__search-input">
              <input
                aria-label="Search merchant, description, or account"
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
                placeholder="Search merchant, description, or account"
                type="search"
                value={search}
              />
              <Icon name="search" size={19} />
            </span>
          </label>
        </div>

        <div className="transaction-history__table" role="table" aria-label="Your account transactions">
          <div className="transaction-history__table-head" role="row">
            <span role="columnheader">Date</span>
            <span role="columnheader">Description</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Amount</span>
          </div>
          {loading ? (
            <div className="transaction-history__empty" role="status">Loading your account activity…</div>
          ) : error ? (
            <div className="transaction-history__empty transaction-history__empty--error" role="alert">
              <span>{error}</span>
              <button className="dashboard__button" onClick={onRetry} type="button">Try again</button>
            </div>
          ) : filteredTransactions.length ? pageTransactions.map((transaction) => {
            const transactionAccount = accountById.get(transaction.account_id)
            const accountName = transactionAccount?.name
              || accountDetails[transactionAccount?.account_type]?.name
              || 'Account'
            const amount = Number(transaction.amount)
            const isCredit = transaction.transaction_type === 'credit'
            const normalizedStatus = ['pending', 'posted', 'reversed', 'failed'].includes(transaction.status)
              ? transaction.status
              : 'pending'
            const secondaryLabel = [
              accountName,
              transaction.counterparty_name,
            ].filter(Boolean).join(' · ')
            return (
            <div className="transaction-history__row" key={transaction.id} role="row">
              <span className="transaction-history__date" role="cell">{formattedDate(transaction.occurred_at)}</span>
              <span className="transaction-history__description" role="cell">
                <strong>{transaction.description}</strong>
                <small>{secondaryLabel}</small>
              </span>
              <span className={`transaction-history__status transaction-history__status--${normalizedStatus}`} role="cell">
                {statusLabel(normalizedStatus)}
              </span>
              <strong className={`transaction-history__amount${isCredit ? ' is-credit' : ' is-debit'}`} role="cell">
                {isCredit ? '+' : '−'}{formatAccountBalance(Math.abs(amount), transaction.currency)}
              </strong>
            </div>
            )
          }) : (
            <div className="transaction-history__empty" role="status">
              {transactions.length
                ? 'No transactions match these filters. Try changing your account, date range, status, or search.'
                : accounts.length
                  ? 'No account activity yet. Posted and pending activity will appear here.'
                  : 'There are no accounts available to display activity for.'}
            </div>
          )}
        </div>

        <footer className="transaction-history__pagination">
          <p>Showing {startItem}–{endItem} of {filteredTransactions.length} transactions</p>
          <div>
            <button className="transaction-history__page-button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">Previous</button>
            <span aria-current="page" className="transaction-history__page-number">{page}</span>
            <button className="transaction-history__page-button" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} type="button">Next</button>
          </div>
        </footer>
      </section>

      <div className="transaction-history__status-guide">
        <section className="transaction-history__card transaction-history__guide-card" aria-labelledby="pending-status-title">
          <h2 id="pending-status-title">Pending</h2>
          <span className="transaction-history__status transaction-history__status--pending">Pending</span>
          <p>Authorized but not yet finalized. The merchant name, date, or final amount may change.</p>
        </section>
        <section className="transaction-history__card transaction-history__guide-card" aria-labelledby="posted-status-title">
          <h2 id="posted-status-title">Posted</h2>
          <span className="transaction-history__status transaction-history__status--posted">Posted</span>
          <p>Completed and recorded in the account history. Green amounts indicate money received; other amounts indicate money sent.</p>
        </section>
        <section className="transaction-history__card transaction-history__guide-card" aria-labelledby="reversed-status-title">
          <h2 id="reversed-status-title">Reversed</h2>
          <span className="transaction-history__status transaction-history__status--reversed">Reversed</span>
          <p>The transaction was reversed and no longer represents a completed payment.</p>
        </section>
        <section className="transaction-history__card transaction-history__guide-card" aria-labelledby="failed-status-title">
          <h2 id="failed-status-title">Failed</h2>
          <span className="transaction-history__status transaction-history__status--failed">Failed</span>
          <p>The transaction was not completed. Check the account activity before retrying.</p>
        </section>
      </div>
    </div>
  )
}

function PayTransferPage({ accounts, onActionFeedback, onReturnToDashboard, onTransferCompleted }) {
  return (
    <RegisteredTransferFlow
      accounts={accounts}
      onActionFeedback={onActionFeedback}
      onReturnToDashboard={onReturnToDashboard}
      onTransferCompleted={onTransferCompleted}
    />
  )
}
function Dashboard({ onSignOut, user }) {
  const [activePage, setActivePage] = useState('Dashboard')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [globalSearchActiveIndex, setGlobalSearchActiveIndex] = useState(0)
  const [initialTransactionSearch, setInitialTransactionSearch] = useState('')
  const [transactionSearchSelectionId, setTransactionSearchSelectionId] = useState(0)
  const globalSearchRef = useRef(null)
  const mobileMenuButtonRef = useRef(null)
  const mobileSearchButtonRef = useRef(null)
  const [pageTransitionLoading, setPageTransitionLoading] = useState(false)
  const pageTransitionTimer = useRef(null)
  const [signOutError, setSignOutError] = useState('')
  const [actionFeedback, setActionFeedback] = useState(null)
  const [selectedAccount, setSelectedAccount] = useState('')
  const [accounts, setAccounts] = useState([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [accountsError, setAccountsError] = useState('')
  const [accountsReloadKey, setAccountsReloadKey] = useState(0)
  const [historyTransactions, setHistoryTransactions] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [historyReloadKey, setHistoryReloadKey] = useState(0)
  const [budgetTargets, setBudgetTargets] = useState(defaultBudgetTargets)
  const [savedBudgetCategories, setSavedBudgetCategories] = useState([])
  const [budgetLoading, setBudgetLoading] = useState(true)
  const [budgetError, setBudgetError] = useState('')
  const [insightTransactions, setInsightTransactions] = useState([])
  const [transactionLoading, setTransactionLoading] = useState(true)
  const [transactionError, setTransactionError] = useState('')
  const [insightReloadKey, setInsightReloadKey] = useState(0)
  const [notifications, setNotifications] = useState([])
  const [notificationsLoading, setNotificationsLoading] = useState(true)
  const [notificationError, setNotificationError] = useState('')
  const [popupNotificationId, setPopupNotificationId] = useState(null)
  const [notificationBusyIds, setNotificationBusyIds] = useState(() => new Set())
  const [markAllNotificationsBusy, setMarkAllNotificationsBusy] = useState(false)
  const [idleWarningOpen, setIdleWarningOpen] = useState(false)
  const [idleWarningSeconds, setIdleWarningSeconds] = useState(60)
  const [idleSignOutError, setIdleSignOutError] = useState('')
  const idleDialogRef = useRef(null)
  const lastActivityRef = useRef(0)
  const signOutAttemptedRef = useRef(false)
  const onSignOutRef = useRef(onSignOut)
  const [profileSettings, setProfileSettings] = useState(() => {
    const metadata = user?.user_metadata ?? {}
    const nameParts = String(metadata.display_name || user?.email?.split('@')[0] || 'Customer')
      .trim()
      .split(/\s+/)
    return {
      ...defaultProfileSettings,
      firstName: metadata.first_name || nameParts[0],
      lastName: metadata.last_name || nameParts.slice(1).join(' '),
      email: user?.email || defaultProfileSettings.email,
      phone: metadata.phone_number || '',
    }
  })
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hourCycle: 'h23',
    timeZone: profileSettings.timeZone,
  }).format(currentDate))
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: profileSettings.timeZone,
  }).format(currentDate)
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
    .format(currentDate)
  const dashboardMonthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
  const dashboardSpendingCents = insightTransactions
    .filter((transaction) => transaction.status === 'posted'
      && transaction.transaction_type === 'debit'
      && !transaction.transfer_id
      && new Date(transaction.occurred_at) >= dashboardMonthStart
      && new Date(transaction.occurred_at) <= currentDate)
    .reduce((total, transaction) => total + Math.round(Number(transaction.amount) * 100), 0)

  const globalSearchIndex = useMemo(() => {
    const entries = []
    const addEntry = (item, searchableText, scoreBoost = 0) => {
      entries.push({ ...item, searchableText: normalizeSearchText(searchableText), scoreBoost })
    }
    navigation.forEach((page) => {
      const help = globalSearchHelp.find((item) => item.page === page.label)
      addEntry({
        key: `page-${page.label}`,
        kind: 'page',
        title: page.label,
        detail: help?.detail || `Open ${page.label.toLowerCase()}`,
        page: page.label,
        icon: page.icon,
      }, `${page.label} ${help?.keywords || ''} ${help?.detail || ''}`, 6)
    })

    accounts.forEach((account) => {
      const display = getAccountDisplay(account)
      addEntry({
        key: `account-${account.id}`,
        kind: 'account',
        title: display.name,
        detail: `${display.description} · •• ${display.lastFour} · ${formatAccountBalance(account.balance, account.currency)}`,
        page: 'Accounts',
        accountName: display.name,
        icon: display.icon,
      }, `${display.name} ${display.description} ${display.lastFour} ${account.status} ${account.currency}`, 12)
    })

    const accountById = new Map(accounts.map((account) => [account.id, account]))
    historyTransactions.forEach((transaction) => {
      const transactionAccount = accountById.get(transaction.account_id)
      const accountName = transactionAccount?.name || accountDetails[transactionAccount?.account_type]?.name || 'Account'
      const title = transaction.description || transaction.counterparty_name || 'Account transaction'
      addEntry({
        key: `transaction-${transaction.id}`,
        kind: 'transaction',
        title,
        detail: `${transaction.counterparty_name ? `${transaction.counterparty_name} · ` : ''}${accountName} · ${formatAccountBalance(transaction.amount, transaction.currency)} · ${transaction.status}`,
        page: 'Recent transactions',
        transactionSearch: title,
        icon: 'receipt',
      }, `${title} ${transaction.counterparty_name} ${transaction.reference} ${accountName} ${transaction.status} ${transaction.amount}`, 8)
    })

    notifications.forEach((notification) => {
      addEntry({
        key: `notification-${notification.id}`,
        kind: 'notification',
        title: notification.title,
        detail: notification.body || 'Account notification',
        page: 'Alerts',
        icon: 'alerts',
      }, `${notification.title} ${notification.body} ${notification.notification_type}`, 4)
    })

    globalSearchHelp.forEach((item) => {
      addEntry({
        key: `help-${item.page}`,
        kind: 'help',
        title: item.title,
        detail: item.detail,
        page: item.page,
        icon: navigation.find((page) => page.label === item.page)?.icon || 'dashboard',
      }, `${item.title} ${item.detail} ${item.keywords}`)
    })

    return entries
  }, [accounts, historyTransactions, notifications])

  const globalSearchResults = useMemo(() => {
    if (globalSearchQuery.trim().length < 2) return []
    return globalSearchIndex
      .map((item) => ({ ...item, score: getSearchMatchScore(globalSearchQuery, item.searchableText) + item.scoreBoost }))
      .filter((item) => item.score > item.scoreBoost)
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
      .slice(0, 8)
  }, [globalSearchIndex, globalSearchQuery])

  useEffect(() => {
    function closeGlobalSearch(event) {
      if (!globalSearchRef.current?.contains(event.target)) {
        setGlobalSearchOpen(false)
        setMobileSearchOpen(false)
      }
    }
    function focusGlobalSearch(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setMobileSearchOpen(true)
        setGlobalSearchOpen(true)
      }
    }
    document.addEventListener('pointerdown', closeGlobalSearch)
    document.addEventListener('keydown', focusGlobalSearch)
    return () => {
      document.removeEventListener('pointerdown', closeGlobalSearch)
      document.removeEventListener('keydown', focusGlobalSearch)
    }
  }, [])

  useEffect(() => {
    if (mobileSearchOpen) globalSearchRef.current?.querySelector('input')?.focus()
  }, [mobileSearchOpen])

  useEffect(() => {
    onSignOutRef.current = onSignOut
  }, [onSignOut])

  useEffect(() => {
    let active = true
    if (!supabase || !user?.id) return undefined

    async function loadSessionTimeout() {
      const { data, error } = await supabase
        .from('profile_preferences')
        .select('session_timeout_minutes')
        .eq('user_id', user.id)
        .maybeSingle()
      if (!active || error || !data) return
      setProfileSettings((current) => ({
        ...current,
        sessionTimeout: String(data.session_timeout_minutes),
      }))
    }

    void loadSessionTimeout()
    return () => {
      active = false
    }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return undefined
    const allowedTimeouts = [5, 10, 15, 30]
    const requestedTimeout = Number(profileSettings.sessionTimeout)
    const timeoutMs = (allowedTimeouts.includes(requestedTimeout) ? requestedTimeout : 10) * 60_000
    const warningWindowMs = 60_000
    lastActivityRef.current = Date.now()

    function recordActivity(event) {
      if (idleDialogRef.current?.contains(event.target)) return
      lastActivityRef.current = Date.now()
      signOutAttemptedRef.current = false
      setIdleWarningOpen(false)
      setIdleSignOutError('')
    }

    async function expireSession() {
      if (signOutAttemptedRef.current) return
      signOutAttemptedRef.current = true
      setIdleSignOutError('')
      setIdleWarningSeconds(0)
      try {
        const error = await onSignOutRef.current()
        if (error) {
          setIdleSignOutError(error)
          setIdleWarningOpen(true)
        }
      } catch (error) {
        setIdleSignOutError(error.message || 'Automatic sign-out failed.')
        setIdleWarningOpen(true)
      }
    }

    function checkIdleTime() {
      const remainingMs = timeoutMs - (Date.now() - lastActivityRef.current)
      if (remainingMs <= 0) {
        void expireSession()
      } else if (remainingMs <= warningWindowMs) {
        setIdleWarningOpen(true)
        setIdleWarningSeconds(Math.ceil(remainingMs / 1000))
      }
    }

    const events = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']
    events.forEach((eventName) => window.addEventListener(eventName, recordActivity, { passive: true }))
    const timer = window.setInterval(checkIdleTime, 1000)
    return () => {
      window.clearInterval(timer)
      events.forEach((eventName) => window.removeEventListener(eventName, recordActivity))
    }
  }, [profileSettings.sessionTimeout, user?.id])

  useEffect(() => {
    const dialog = idleDialogRef.current
    if (idleWarningOpen && dialog && !dialog.open) dialog.showModal()
    if (!idleWarningOpen && dialog?.open) dialog.close()
  }, [idleWarningOpen])

  function continueSession() {
    lastActivityRef.current = Date.now()
    signOutAttemptedRef.current = false
    setIdleWarningOpen(false)
    setIdleWarningSeconds(60)
    setIdleSignOutError('')
    setSignOutError('')
  }

  function signOutFromIdleWarning() {
    signOutAttemptedRef.current = false
    setIdleWarningOpen(false)
    setIdleSignOutError('')
    void handleSignOut()
  }

  useEffect(() => {
    let isMounted = true

    async function loadAccounts() {
      setAccountsLoading(true)
      setAccountsError('')
      if (!supabase || !user?.id) {
        setAccountsError('Your secure session is unavailable. Sign in again to load your accounts.')
        setAccountsLoading(false)
        return
      }
      try {
        const { data, error } = await supabase
          .from('accounts')
          .select('id, account_number, account_type, name, currency, balance, status')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true })
        if (error) throw error
        if (isMounted) setAccounts(data)
      } catch (error) {
        if (isMounted) {
          setAccountsError(error.message || 'Unable to load your accounts. Please refresh and try again.')
        }
      } finally {
        if (isMounted) setAccountsLoading(false)
      }
    }

    loadAccounts()
    return () => {
      isMounted = false
    }
  }, [accountsReloadKey, user?.id])

  useEffect(() => {
    let isMounted = true

    async function loadNotifications() {
      setNotificationsLoading(true)
      setNotificationError('')
      if (!supabase || !user?.id) {
        setNotificationError('Your secure session is unavailable. Sign in again to view notifications.')
        setNotificationsLoading(false)
        return
      }
      try {
        const { data, error } = await supabase
          .from('notifications')
          .select('id, notification_type, title, body, data, read_at, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(100)
        if (error) throw error
        if (isMounted) {
          const loadedNotifications = data || []
          setNotifications(loadedNotifications)
          setPopupNotificationId(loadedNotifications.find((item) => !item.read_at)?.id || null)
        }
      } catch (error) {
        if (isMounted) setNotificationError(error.message || 'Unable to load notifications. Please refresh and try again.')
      } finally {
        if (isMounted) setNotificationsLoading(false)
      }
    }

    loadNotifications()
    if (!supabase || !user?.id) {
      return () => {
        isMounted = false
      }
    }
    const notificationChannel = supabase
      .channel(`customer-notifications-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, ({ new: notification }) => {
        if (!isMounted || !notification?.id) return
        setNotifications((current) => [
          notification,
          ...current.filter((item) => item.id !== notification.id),
        ].slice(0, 100))
        setPopupNotificationId(notification.id)
        if (String(notification.notification_type).includes('transfer')) {
          setAccountsReloadKey((current) => current + 1)
        }
      })
      .subscribe()
    return () => {
      isMounted = false
      supabase.removeChannel(notificationChannel)
    }
  }, [user?.id])

  useEffect(() => {
    let isMounted = true

    async function loadTransactionHistory() {
      if (accountsLoading) return
      setHistoryLoading(true)
      setHistoryError('')
      if (!supabase || !user?.id) {
        setHistoryError('Your secure session is unavailable. Sign in again to view transactions.')
        setHistoryTransactions([])
        setHistoryLoading(false)
        return
      }
      if (accountsError) {
        setHistoryError(accountsError)
        setHistoryTransactions([])
        setHistoryLoading(false)
        return
      }
      const accountIds = accounts.map((item) => item.id)
      if (!accountIds.length) {
        setHistoryTransactions([])
        setHistoryLoading(false)
        return
      }

      try {
        const rows = []
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await supabase
            .from('transactions')
            .select('id, account_id, transfer_id, transaction_type, status, amount, currency, description, counterparty_name, reference, occurred_at')
            .in('account_id', accountIds)
            .order('occurred_at', { ascending: false })
            .order('id', { ascending: true })
            .range(offset, offset + 999)
          if (error) throw error
          rows.push(...(data || []))
          if (!data || data.length < 1000) break
        }
        if (isMounted) setHistoryTransactions(rows)
      } catch (error) {
        if (isMounted) {
          setHistoryError(error.message || 'Unable to load your account activity. Please try again.')
          setHistoryTransactions([])
        }
      } finally {
        if (isMounted) setHistoryLoading(false)
      }
    }

    loadTransactionHistory()
    return () => {
      isMounted = false
    }
  }, [accounts, accountsError, accountsLoading, historyReloadKey, user?.id])

  function retryTransactionHistory() {
    if (accountsError) {
      setAccountsReloadKey((current) => current + 1)
      return
    }
    setHistoryReloadKey((current) => current + 1)
  }

  async function markNotificationRead(notificationId) {
    if (!supabase) {
      setNotificationError('Your secure session is unavailable. Sign in again before updating notifications.')
      return false
    }
    setNotificationError('')
    setNotificationBusyIds((current) => new Set(current).add(notificationId))
    const readAt = getCurrentIsoTimestamp()
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: readAt })
        .eq('id', notificationId)
        .is('read_at', null)
      if (error) throw error
      setNotifications((current) => current.map((item) => (
        item.id === notificationId ? { ...item, read_at: readAt } : item
      )))
      setPopupNotificationId((current) => current === notificationId ? null : current)
      showActionFeedback('Notification marked as read.')
      return true
    } catch (error) {
      setNotificationError(error.message || 'Unable to mark this notification as read.')
      return false
    } finally {
      setNotificationBusyIds((current) => {
        const next = new Set(current)
        next.delete(notificationId)
        return next
      })
    }
  }

  async function sendCustomerMessageReply(notification, body, numericResponse = null) {
    if (!supabase || !user?.id) {
      return { error: 'Your secure session is unavailable. Sign in again before replying.' }
    }
    const externalRequestId = notification?.data?.external_transfer_request_id
    const messageId = notification?.data?.admin_message_id
    const hasExternalNumericPrompt = typeof externalRequestId === 'string'
      && typeof notification?.data?.response_prompt === 'string'
    if (hasExternalNumericPrompt && (numericResponse === null || !Number.isFinite(Number(numericResponse)))) {
      return { error: 'Enter a valid number before sending your response.' }
    }
    if ((!hasExternalNumericPrompt && typeof messageId !== 'string') || (!hasExternalNumericPrompt && (!body.trim() || body.trim().length > 4000))) {
      return { error: 'Enter a reply of 1 to 4,000 characters.' }
    }
    const { error } = hasExternalNumericPrompt
      ? await supabase.rpc('customer_reply_external_transfer_request', {
        p_request_id: externalRequestId,
        p_response: Number(numericResponse),
      })
      : await supabase.rpc('customer_reply_admin_message', {
        p_message_id: messageId,
        p_body: body.trim(),
      })
    if (error) return { error: error.message || 'Unable to send your secure reply.' }

    const readAt = getCurrentIsoTimestamp()
    setNotifications((current) => current.map((item) => (
      item.id === notification.id
        ? {
          ...item,
          read_at: item.read_at || readAt,
          data: hasExternalNumericPrompt
            ? { ...item.data, customer_response: Number(numericResponse) }
            : item.data,
        }
        : item
    )))
    setPopupNotificationId((current) => current === notification.id ? null : current)
    showActionFeedback(hasExternalNumericPrompt ? 'Your response was sent securely.' : 'Your reply was sent securely to Cedarline.')
    return { data: true }
  }

  async function markAllNotificationsRead() {
    if (!supabase || !user?.id) {
      setNotificationError('Your secure session is unavailable. Sign in again before updating notifications.')
      return
    }
    if (!notifications.some((item) => !item.read_at)) return
    setMarkAllNotificationsBusy(true)
    setNotificationError('')
    const readAt = getCurrentIsoTimestamp()
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: readAt })
        .eq('user_id', user.id)
        .is('read_at', null)
      if (error) throw error
      setNotifications((current) => current.map((item) => item.read_at ? item : { ...item, read_at: readAt }))
      setPopupNotificationId(null)
      showActionFeedback('All notifications marked as read.')
    } catch (error) {
      setNotificationError(error.message || 'Unable to mark notifications as read.')
    } finally {
      setMarkAllNotificationsBusy(false)
    }
  }

  useEffect(() => {
    let isMounted = true

    async function loadInsightTransactions() {
      if (accountsLoading) return
      setTransactionLoading(true)
      setTransactionError('')
      if (!supabase || !user?.id) {
        setTransactionError('Your secure session is unavailable. Sign in again to view spending insights.')
        setTransactionLoading(false)
        return
      }
      if (accountsError) {
        setTransactionError(accountsError)
        setInsightTransactions([])
        setTransactionLoading(false)
        return
      }

      const depositAccountIds = accounts
        .filter((item) => ['checking', 'savings', 'cd'].includes(item.account_type) && item.currency === 'USD')
        .map((item) => item.id)
      if (!depositAccountIds.length) {
        setInsightTransactions([])
        setTransactionLoading(false)
        return
      }

      try {
        const now = new Date()
        const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)
        const rows = []
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await supabase
            .from('transactions')
            .select('id, account_id, transfer_id, category_id, transaction_type, status, amount, currency, occurred_at')
            .in('account_id', depositAccountIds)
            .eq('status', 'posted')
            .gte('occurred_at', twelveMonthsAgo.toISOString())
            .lte('occurred_at', now.toISOString())
            .order('occurred_at', { ascending: false })
            .order('id', { ascending: true })
            .range(offset, offset + 999)
          if (error) throw error
          rows.push(...(data || []))
          if (!data || data.length < 1000) break
        }

        const { data: categories, error: categoriesError } = await supabase
          .from('categories')
          .select('id, name')
        if (categoriesError) throw categoriesError
        const categoryNames = new Map((categories || []).map((category) => [category.id, category.name]))
        if (isMounted) {
          setInsightTransactions(rows.map((transaction) => ({
            ...transaction,
            category_name: categoryNames.get(transaction.category_id) || '',
          })))
        }
      } catch (error) {
        if (isMounted) {
          setTransactionError(error.message || 'Unable to load spending activity. Please refresh the page.')
          setInsightTransactions([])
        }
      } finally {
        if (isMounted) setTransactionLoading(false)
      }
    }

    loadInsightTransactions()
    return () => {
      isMounted = false
    }
  }, [accounts, accountsError, accountsLoading, insightReloadKey, user?.id])

  function retryInsights() {
    if (accountsError) {
      setAccountsReloadKey((current) => current + 1)
      return
    }
    setInsightReloadKey((current) => current + 1)
  }

  useEffect(() => {
    let isMounted = true

    async function loadBudgetTargets() {
      setBudgetLoading(true)
      setBudgetError('')
      if (!supabase || !user?.id) {
        setBudgetError('Your secure session is unavailable. Sign in again to view budget targets.')
        setBudgetLoading(false)
        return
      }
      const periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
      const periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)
      try {
        const { data, error } = await supabase
          .from('budgets')
          .select('name, amount')
          .eq('user_id', user.id)
          .eq('period_start', formatLocalDate(periodStart))
          .eq('period_end', formatLocalDate(periodEnd))
        if (error) throw error
        if (isMounted) {
          const savedTargets = new Map((data || []).map((item) => [item.name, Number(item.amount)]))
          setBudgetTargets(defaultBudgetTargets.map((item) => ({
            ...item,
            target: savedTargets.get(item.category) ?? item.target,
          })))
          setSavedBudgetCategories([...(savedTargets.keys())])
        }
      } catch (error) {
        if (isMounted) setBudgetError(error.message || 'Unable to load your budget targets. Please refresh and try again.')
      } finally {
        if (isMounted) setBudgetLoading(false)
      }
    }

    loadBudgetTargets()
    return () => {
      isMounted = false
    }
  }, [user?.id])

  async function saveBudgetTargets(targets) {
    if (!supabase || !user?.id) {
      throw new Error('Your secure session is unavailable. Sign in again before saving budget targets.')
    }
    const periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    const periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)
    const { error } = await supabase
      .from('budgets')
      .upsert(targets.map((item) => ({
        user_id: user.id,
        name: item.category,
        amount: item.target,
        currency: 'USD',
        period_start: formatLocalDate(periodStart),
        period_end: formatLocalDate(periodEnd),
      })), { onConflict: 'user_id,name,period_start,period_end' })
    if (error) throw error
    setBudgetTargets(targets)
    setSavedBudgetCategories(targets.map((item) => item.category))
    showActionFeedback('Monthly budget targets saved.')
  }

  function navigateToPage(page) {
    setMobileMenuOpen(false)
    if (page === activePage) return
    if (activePage === 'Recent transactions') setInitialTransactionSearch('')
    if (pageTransitionTimer.current) window.clearTimeout(pageTransitionTimer.current)
    setPageTransitionLoading(true)
    setActivePage(page)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    pageTransitionTimer.current = window.setTimeout(() => {
      setPageTransitionLoading(false)
      pageTransitionTimer.current = null
    }, 900)
  }

  async function handleSignOut() {
    setSignOutError('Signing out…')
    const error = await onSignOut()
    setSignOutError(error || '')
  }

  function openGlobalSearchResult(result) {
    setGlobalSearchOpen(false)
    setMobileSearchOpen(false)
    setGlobalSearchQuery('')
    setGlobalSearchActiveIndex(0)
    if (result.kind === 'account') setSelectedAccount(result.accountName)
    if (result.kind === 'transaction') {
      setInitialTransactionSearch(result.transactionSearch)
      setTransactionSearchSelectionId((current) => current + 1)
    }
    navigateToPage(result.page)
  }

  function handleGlobalSearchKeyDown(event) {
    if (event.key === 'Escape') {
      setGlobalSearchOpen(false)
      setMobileSearchOpen(false)
      if (mobileSearchButtonRef.current?.getClientRects().length) {
        mobileSearchButtonRef.current.focus()
      }
      return
    }
    if (event.key === 'ArrowDown' && globalSearchResults.length) {
      event.preventDefault()
      setGlobalSearchOpen(true)
      setGlobalSearchActiveIndex((index) => (index + 1) % globalSearchResults.length)
    } else if (event.key === 'ArrowUp' && globalSearchResults.length) {
      event.preventDefault()
      setGlobalSearchOpen(true)
      setGlobalSearchActiveIndex((index) => (index - 1 + globalSearchResults.length) % globalSearchResults.length)
    } else if (event.key === 'Enter' && globalSearchResults[globalSearchActiveIndex]) {
      event.preventDefault()
      openGlobalSearchResult(globalSearchResults[globalSearchActiveIndex])
    }
  }

  useEffect(() => () => {
    if (pageTransitionTimer.current) window.clearTimeout(pageTransitionTimer.current)
  }, [])

  async function saveProfileSettings(nextSettings) {
    if (!supabase || !user?.id) {
      throw new Error('Your secure session is unavailable. Sign in again before saving your profile.')
    }
    const { error } = await supabase.rpc('save_customer_profile', {
      p_first_name: nextSettings.firstName.trim(),
      p_last_name: nextSettings.lastName.trim(),
      p_phone_e164: nextSettings.phone.trim() || null,
      p_mailing_address: nextSettings.mailingAddress.trim(),
      p_account_updates_enabled: nextSettings.accountUpdates,
      p_product_news_enabled: nextSettings.productNews,
      p_helpful_tips_enabled: nextSettings.helpfulTips,
      p_language: nextSettings.language,
      p_time_zone: nextSettings.timeZone,
      p_session_timeout_minutes: Number(nextSettings.sessionTimeout),
      p_paperless_enabled: nextSettings.paperless,
    })
    if (error) throw error
    setProfileSettings(nextSettings)
    showActionFeedback('Profile settings saved.')
  }

  function showActionFeedback(message, kind = 'success') {
      setActionFeedback((current) => ({
        id: (current?.id || 0) + 1,
        kind,
        message,
      }))
    }

  const latestUnreadNotification = notifications.find((item) => !item.read_at)
  const popupNotification = notifications.find((item) => item.id === popupNotificationId && !item.read_at)
  const pageDataLoading = {
    Dashboard: accountsLoading || historyLoading || transactionLoading,
    Accounts: accountsLoading,
    'Pay & Transfer': accountsLoading,
    Insights: accountsLoading || transactionLoading || budgetLoading,
    Statements: accountsLoading,
    Alerts: notificationsLoading,
    Profile: false,
    'Recent transactions': accountsLoading || historyLoading,
  }[activePage]
  const isPageLoading = pageTransitionLoading || pageDataLoading

  useEffect(() => {
    if (!mobileMenuOpen) return undefined
    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false)
        mobileMenuButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = previousBodyOverflow
    }
  }, [mobileMenuOpen])

  return (
    <div className="dashboard" id="dashboard">
      <dialog
        aria-labelledby="idle-session-title"
        className="idle-session-dialog"
        onCancel={(event) => event.preventDefault()}
        ref={idleDialogRef}
      >
        <span className="idle-session-dialog__eyebrow">Session security</span>
        <h2 id="idle-session-title">Still there?</h2>
        {idleSignOutError ? (
          <p className="idle-session-dialog__error" role="alert">
            Automatic sign-out did not complete: {idleSignOutError}
          </p>
        ) : (
          <p role="status" aria-live="polite">
            You’ll be signed out in {idleWarningSeconds} {idleWarningSeconds === 1 ? 'second' : 'seconds'} because of inactivity.
          </p>
        )}
        <div className="idle-session-dialog__actions">
          <button className="dashboard__button" onClick={signOutFromIdleWarning} type="button">Sign out now</button>
          <button className="dashboard__button dashboard__button--primary" onClick={continueSession} type="button">Stay signed in</button>
        </div>
      </dialog>
      <aside
        className={`dashboard__sidebar${mobileMenuOpen ? ' is-open' : ''}`}
        id="customer-navigation"
      >
        <a className="dashboard__brand" href="/" aria-label="Cedarline dashboard">
          <span className="dashboard__brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Cedarline
        </a>
        <button
          aria-label="Close navigation menu"
          className="dashboard__drawer-close"
          onClick={() => {
            setMobileMenuOpen(false)
            mobileMenuButtonRef.current?.focus()
          }}
          type="button"
        >
          <Icon name="close" size={20} />
        </button>

        <nav className="dashboard__nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <a
              aria-current={activePage === item.label || (item.label === 'Dashboard' && activePage === 'Recent transactions') ? 'page' : undefined}
              className={`dashboard__nav-link${activePage === item.label || (item.label === 'Dashboard' && activePage === 'Recent transactions') ? ' is-active' : ''}`}
              href={`#${item.label.toLowerCase().replaceAll(' ', '-').replace('&', 'and')}`}
              key={item.label}
              onClick={(event) => {
                setMobileMenuOpen(false)
                mobileMenuButtonRef.current?.focus()
                if (item.label === 'Dashboard' || item.label === 'Accounts' || item.label === 'Pay & Transfer' || item.label === 'Insights' || item.label === 'Statements' || item.label === 'Alerts' || item.label === 'Profile') {
                  event.preventDefault()
                  navigateToPage(item.label)
                }
              }}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>

        <div className="dashboard__sidebar-footer">
          <p>A little clarity. Every day.</p>
          <a className="dashboard__support-link" href="#help">
            <span aria-hidden="true">?</span>
            Help &amp; support
          </a>
          <small>Secure online banking</small>
          <button className="dashboard__drawer-signout" disabled={signOutError === 'Signing out…'} onClick={handleSignOut} type="button">
            {signOutError === 'Signing out…' ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>
      {mobileMenuOpen && (
        <button
          aria-label="Close navigation menu"
          className="dashboard__drawer-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          type="button"
        />
      )}

      <div className="dashboard__main">
        <header className={`dashboard__topbar${mobileSearchOpen ? ' is-mobile-search-open' : ''}`}>
          <button
            aria-controls="customer-navigation"
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="dashboard__menu-button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            ref={mobileMenuButtonRef}
            type="button"
          >
            <Icon name={mobileMenuOpen ? 'close' : 'menu'} size={22} />
          </button>
          <div className="dashboard__greeting">
            <strong>{greeting}, {profileSettings.firstName}</strong>
            <span>{date}</span>
          </div>
          <button
            aria-controls="customer-global-search"
            aria-expanded={mobileSearchOpen}
            aria-label={mobileSearchOpen ? 'Close search' : 'Open search'}
            className="dashboard__icon-button dashboard__search-toggle"
            onClick={() => {
              if (mobileSearchOpen) {
                setMobileSearchOpen(false)
                setGlobalSearchOpen(false)
              } else {
                setMobileSearchOpen(true)
              }
            }}
            ref={mobileSearchButtonRef}
            type="button"
          >
            <Icon name={mobileSearchOpen ? 'close' : 'search'} />
          </button>
          <div className="dashboard__search" id="customer-global-search" ref={globalSearchRef}>
            <Icon name="search" size={21} />
            <span className="dashboard__visually-hidden">Search</span>
            <input
              aria-activedescendant={globalSearchOpen && globalSearchResults[globalSearchActiveIndex]
                ? `global-search-result-${globalSearchActiveIndex}`
                : undefined}
              aria-autocomplete="list"
              aria-controls="global-search-results"
              aria-expanded={globalSearchOpen && globalSearchQuery.trim().length >= 2}
              aria-label="Search accounts, transactions, notifications, and help"
              onChange={(event) => {
                setGlobalSearchQuery(event.target.value)
                setGlobalSearchActiveIndex(0)
                setGlobalSearchOpen(true)
              }}
              onFocus={() => {
                if (globalSearchQuery.trim().length >= 2) setGlobalSearchOpen(true)
              }}
              onKeyDown={handleGlobalSearchKeyDown}
              placeholder="Search accounts, transactions, help"
              role="combobox"
              type="search"
              value={globalSearchQuery}
            />
            <kbd aria-hidden="true">Ctrl/⌘ K</kbd>
            {globalSearchOpen && globalSearchQuery.trim().length >= 2 && (
              <div className="dashboard__search-results" id="global-search-results" role="listbox" aria-label="Search results">
                {globalSearchResults.length ? globalSearchResults.map((result, index) => (
                  <button
                    aria-selected={index === globalSearchActiveIndex}
                    className="dashboard__search-result"
                    id={`global-search-result-${index}`}
                    key={result.key}
                    onClick={() => openGlobalSearchResult(result)}
                    onMouseEnter={() => setGlobalSearchActiveIndex(index)}
                    role="option"
                    type="button"
                  >
                    <span className="dashboard__search-result-icon"><Icon name={result.icon} size={18} /></span>
                    <span className="dashboard__search-result-copy">
                      <strong>{result.title}</strong>
                      <small>{result.detail}</small>
                    </span>
                    <span className="dashboard__search-result-kind">{result.kind === 'help' ? 'Help' : result.kind}</span>
                  </button>
                )) : (
                  <p className="dashboard__search-empty" role="status">
                    {accountsLoading || historyLoading
                      ? 'Loading your account information…'
                      : 'No matches yet. Try a shorter phrase or different spelling.'}
                  </p>
                )}
                {globalSearchResults.length > 0 && (
                  <p className="dashboard__search-hint">Use ↑ ↓ to navigate · Enter to open · Esc to close</p>
                )}
              </div>
            )}
          </div>
          <button
            className="dashboard__icon-button dashboard__notification-button"
            onClick={() => navigateToPage('Alerts')}
            type="button"
            aria-label={latestUnreadNotification
              ? `Notifications, ${notifications.filter((item) => !item.read_at).length} unread`
              : 'Notifications'}
          >
            <Icon name="alerts" />
            {notifications.some((item) => !item.read_at) && (
              <span className="dashboard__notification-count" aria-hidden="true">
                {notifications.filter((item) => !item.read_at).length > 9 ? '9+' : notifications.filter((item) => !item.read_at).length}
              </span>
            )}
          </button>
          <button className="dashboard__avatar" onClick={() => navigateToPage('Profile')} type="button" aria-label={`${profileSettings.firstName} ${profileSettings.lastName} profile`}>
            {`${profileSettings.firstName.charAt(0)}${profileSettings.lastName.charAt(0)}`.toUpperCase()}
          </button>
          <button
            className="dashboard__signout"
            disabled={signOutError === 'Signing out…'}
            onClick={handleSignOut}
            type="button"
          >
            {signOutError === 'Signing out…' ? 'Signing out…' : 'Sign out'}
          </button>
        </header>
        {latestUnreadNotification && (
          <aside className={`dashboard__notification-banner${['account-hold', 'security'].includes(getNotificationCategory(latestUnreadNotification.notification_type)) || getNotificationPriority(latestUnreadNotification) !== 'normal' ? ' dashboard__notification-banner--critical' : ''}`} role="status" aria-live="polite">
            <span className="dashboard__notification-banner-icon"><Icon name="alerts" size={19} /></span>
            <div className="dashboard__notification-banner-copy">
              <strong>{latestUnreadNotification.title}</strong>
              <p>{latestUnreadNotification.body}</p>
            </div>
            <button onClick={() => navigateToPage('Alerts')} type="button">View</button>
            <button
              aria-label={notificationBusyIds.has(latestUnreadNotification.id) ? 'Marking notification as read' : 'Mark notification as read'}
              className="dashboard__notification-banner-dismiss"
              disabled={notificationBusyIds.has(latestUnreadNotification.id)}
              onClick={() => markNotificationRead(latestUnreadNotification.id)}
              type="button"
            >{notificationBusyIds.has(latestUnreadNotification.id) ? 'Saving…' : '×'}</button>
          </aside>
        )}
        {notificationError && <p className="dashboard__notification-error" role="alert">{notificationError}</p>}
        {signOutError && signOutError !== 'Signing out…' && (
          <p className="dashboard__auth-error" role="alert">{signOutError}</p>
        )}

        {isPageLoading ? (
          <div className="dashboard__content">
            <BankingPageLoader page={activePage} />
          </div>
        ) : activePage === 'Accounts' ? (
          <div className="dashboard__content">
            <AccountsPage
              accounts={accounts}
              accountsError={accountsError}
              accountsLoading={accountsLoading}
              onSelectAccount={(account) => setSelectedAccount(account)}
              selectedAccount={selectedAccount}
            />
          </div>
        ) : activePage === 'Pay & Transfer' ? (
          <div className="dashboard__content">
            <PayTransferPage
              accounts={accounts}
              onActionFeedback={showActionFeedback}
              onReturnToDashboard={() => navigateToPage('Dashboard')}
              onTransferCompleted={async () => {
                showActionFeedback('Transfer submitted for review. Funds are reserved until a decision is made.')
                try {
                  const { data, error } = await supabase
                    .from('accounts')
                    .select('id, account_number, account_type, name, currency, balance, status')
                    .eq('user_id', user.id)
                    .order('created_at', { ascending: true })
                  if (error) throw error
                  setAccounts(data)
                  setAccountsError('')
                } catch (error) {
                  setAccountsError(error.message || 'Transfer submitted, but account data could not be refreshed.')
                }
                try {
                  const { data, error } = await supabase
                    .from('notifications')
                    .select('id, notification_type, title, body, data, read_at, created_at')
                    .eq('user_id', user.id)
                    .order('created_at', { ascending: false })
                    .limit(100)
                  if (error) throw error
                  const refreshedNotifications = data || []
                  setNotifications(refreshedNotifications)
                  setPopupNotificationId(refreshedNotifications.find((item) => !item.read_at)?.id || null)
                  setNotificationError('')
                } catch (error) {
                  setNotificationError(error.message || 'Transfer submitted, but notifications could not be refreshed.')
                }
              }}
            />
          </div>
        ) : activePage === 'Insights' ? (
          <div className="dashboard__content">
            <InsightsPage
              accounts={accounts}
              budgetTargets={budgetTargets}
              budgetError={budgetError}
              budgetLoading={budgetLoading}
              onAddMoney={() => navigateToPage('Pay & Transfer')}
              onActionFeedback={showActionFeedback}
              onRetryTransactions={retryInsights}
              onSaveBudgets={saveBudgetTargets}
              savedBudgetCategories={savedBudgetCategories}
              transactionError={transactionError}
              transactionLoading={transactionLoading}
              transactions={insightTransactions}
            />
          </div>
        ) : activePage === 'Statements' ? (
          <div className="dashboard__content">
            <StatementsPage
              accounts={accounts}
              accountsError={accountsError}
              accountsLoading={accountsLoading}
              authEmail={user?.email || ''}
              onActionFeedback={showActionFeedback}
              userId={user?.id}
            />
          </div>
        ) : activePage === 'Alerts' ? (
          <div className="dashboard__content">
            <AlertsPage
              authEmail={user?.email || ''}
              markAllNotificationsBusy={markAllNotificationsBusy}
              notificationBusyIds={notificationBusyIds}
              notificationError={notificationError}
              notifications={notifications}
              notificationsLoading={notificationsLoading}
              onActionFeedback={showActionFeedback}
              onMarkAllNotificationsRead={markAllNotificationsRead}
              onMarkNotificationRead={markNotificationRead}
              onReply={sendCustomerMessageReply}
              userId={user?.id}
            />
          </div>
        ) : activePage === 'Profile' ? (
          <div className="dashboard__content">
            <ProfilePage
              authEmail={user?.email || ''}
              onActionFeedback={showActionFeedback}
              onManageAlerts={() => navigateToPage('Alerts')}
              onSaveSettings={saveProfileSettings}
              userId={user?.id}
            />
          </div>
        ) : activePage === 'Recent transactions' ? (
          <div className="dashboard__content">
            <RecentTransactionsPage
              accounts={accounts}
              error={historyError}
              initialSearch={initialTransactionSearch}
              key={`global-search-${transactionSearchSelectionId}`}
              loading={historyLoading || accountsLoading}
              onRetry={retryTransactionHistory}
              transactions={historyTransactions}
            />
          </div>
        ) : (
        <div className="dashboard__content">
          <section className="dashboard__intro" aria-labelledby="dashboard-title">
            <h1 id="dashboard-title">Dashboard</h1>
            <p>A clear view of your money. A fresh start for what’s next.</p>
          </section>

          <section className="dashboard__balance" aria-label="Total deposit balance">
            <div className="dashboard__balance-copy">
              <p className="dashboard__eyebrow">Total deposit balance</p>
              <p className="dashboard__total">{accountsLoading ? 'Loading…' : accountsError ? 'Unavailable' : formatAccountBalance(accounts.filter((account) => ['checking', 'savings', 'cd'].includes(account.account_type) && ['open', 'on_hold'].includes(account.status)).reduce((total, account) => total + Number(account.balance), 0))}</p>
              <p className="dashboard__balance-note">Checking, savings &amp; CD · {accountsError ? 'Balance could not be loaded' : accountsLoading ? 'Loading balances' : 'Balances from your accounts'}</p>
            </div>
            <div className="dashboard__quick-actions">
              <button className="dashboard__button dashboard__button--primary" onClick={() => navigateToPage('Pay & Transfer')} type="button">
                <Icon name="transfer" />
                Transfer
              </button>
              <div>
                <button className="dashboard__button" onClick={() => navigateToPage('Pay & Transfer')} type="button">
                  <Icon name="send" />
                  Send Money
                </button>
                <span>Zelle / External</span>
              </div>
            </div>
          </section>
          {accountsError && <p className="dashboard__data-error" role="alert">{accountsError}</p>}

          <section className="dashboard__accounts-section" id="accounts" aria-labelledby="accounts-title">
            <div className="dashboard__section-heading">
              <div>
                <h2 id="accounts-title">Your accounts</h2>
                <p>Balances across your Cedarline accounts</p>
              </div>
              <a href="#accounts" className="dashboard__section-link" onClick={(event) => {
                event.preventDefault()
                navigateToPage('Accounts')
              }}>View accounts</a>
            </div>
            <div className="dashboard__accounts">
            {accountsLoading ? (
              <p className="dashboard__data-state" role="status">Loading your accounts…</p>
            ) : accountsError ? null : accounts.length === 0 ? (
              <p className="dashboard__data-state" role="status">No accounts are available yet.</p>
            ) : accounts.map((account) => {
              const display = getAccountDisplay(account)
              return (
              <article className="dashboard__account-card" key={account.id}>
                <div className="dashboard__account-heading">
                  <div>
                    <Icon name={display.icon} />
                    <h2>{display.name}</h2>
                  </div>
                  <span aria-label={`Account ending in ${display.lastFour}`}>•• {display.lastFour}</span>
                </div>
                <p className="dashboard__account-label">{display.balanceLabel}</p>
                <p className="dashboard__account-balance">{formatAccountBalance(account.balance, account.currency)}</p>
                <p className="dashboard__account-description">{display.description}</p>
                <div className="dashboard__account-hold-slot">
                  {account.status === 'on_hold' && (
                    <p className="customer-account-hold dashboard__account-hold" role="status">
                      <span aria-hidden="true">!</span> Account on hold
                    </p>
                  )}
                </div>
                <div className="dashboard__account-actions">
                  <button className="dashboard__text-button" onClick={() => navigateToPage('Pay & Transfer')} type="button">Transfer</button>
                  <a className="dashboard__button dashboard__button--small" href="#accounts" onClick={(event) => {
                    event.preventDefault()
                    setSelectedAccount(display.name)
                    navigateToPage('Accounts')
                  }}>Details</a>
                </div>
              </article>
            )})}
            </div>
          </section>

          <aside className="dashboard__welcome">
            <Icon name="plant" size={34} />
            <div>
              <h2>Welcome to your next chapter</h2>
              <p>Add money to your checking account to start using transfers and payments.</p>
            </div>
            <button className="dashboard__button" onClick={() => navigateToPage('Pay & Transfer')} type="button">Add money</button>
          </aside>

          <div className="dashboard__widgets">
            <section className="dashboard__transactions dashboard__panel" id="transactions" aria-labelledby="transactions-title">
              <div className="dashboard__panel-heading">
                <div>
                  <h2 id="transactions-title">Recent transactions</h2>
                  <p>Your latest account activity</p>
                </div>
                <a className="dashboard__section-link" href="#transactions" onClick={(event) => {
                  event.preventDefault()
                  navigateToPage('Recent transactions')
                }}>See all</a>
              </div>
              <div className="dashboard__transaction-head" aria-hidden="true">
                <span>Date</span>
                <span>Description</span>
                <span>Status</span>
                <span>Amount</span>
              </div>
              {historyLoading || accountsLoading ? (
                <div className="transaction-history__empty" role="status">Loading your recent activity…</div>
              ) : historyError ? (
                <div className="transaction-history__empty transaction-history__empty--error" role="alert">
                  <span>{historyError}</span>
                  <button className="dashboard__button" onClick={retryTransactionHistory} type="button">Try again</button>
                </div>
              ) : historyTransactions.length ? (
                <div className="transaction-history__table dashboard__recent-transaction-list" role="table" aria-label="Latest account activity">
                  {historyTransactions.slice(0, 5).map((transaction) => {
                    const transactionAccount = accounts.find((item) => item.id === transaction.account_id)
                    const accountName = transactionAccount?.name
                      || accountDetails[transactionAccount?.account_type]?.name
                      || 'Account'
                    const isCredit = transaction.transaction_type === 'credit'
                    const normalizedStatus = ['pending', 'posted', 'reversed', 'failed'].includes(transaction.status)
                      ? transaction.status
                      : 'pending'
                    return (
                      <div className="transaction-history__row" key={transaction.id} role="row">
                        <span className="transaction-history__date" role="cell">
                          {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(transaction.occurred_at))}
                        </span>
                        <span className="transaction-history__description" role="cell">
                          <strong>{transaction.description}</strong>
                          <small>{accountName}{transaction.counterparty_name ? ` · ${transaction.counterparty_name}` : ''}</small>
                        </span>
                        <span className={`transaction-history__status transaction-history__status--${normalizedStatus}`} role="cell">
                          {normalizedStatus === 'pending' && transaction.transfer_id
                            ? 'Pending review'
                            : normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1)}
                        </span>
                        <strong className={`transaction-history__amount${isCredit ? ' is-credit' : ' is-debit'}`} role="cell">
                          {isCredit ? '+' : '−'}{formatAccountBalance(transaction.amount, transaction.currency)}
                        </strong>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="dashboard__empty">
                <span className="dashboard__empty-icon"><Icon name="receipt" size={27} /></span>
                <h3>Your activity starts here</h3>
                <p>Once you fund your account, deposits, purchases and transfers will appear here. You’re all set to get started.</p>
                <button className="dashboard__button" onClick={() => navigateToPage('Pay & Transfer')} type="button">Explore funding options</button>
                </div>
              )}
            </section>

            <section className="dashboard__insights dashboard__panel" id="insights" aria-labelledby="insights-title">
              <div className="dashboard__panel-heading">
                <div>
                  <h2 id="insights-title">Spending insights</h2>
                  <p className="dashboard__month">{month}</p>
                </div>
                <Icon name="insights" size={20} />
              </div>
              <p className="dashboard__insights-total">{formatAccountBalance(dashboardSpendingCents / 100)}</p>
              <div
                className="dashboard__chart-placeholder"
                role="img"
                aria-label={transactionLoading
                  ? 'Loading spending activity'
                  : transactionError
                    ? 'Spending activity unavailable'
                    : dashboardSpendingCents
                      ? `${formatAccountBalance(dashboardSpendingCents / 100)} in posted purchases this month`
                      : 'No spending activity yet'}
              >
                <span className="dashboard__chart-ring" />
                <span>{transactionLoading ? 'Loading activity…' : dashboardSpendingCents ? 'Posted purchases this month' : 'No spending yet'}</span>
              </div>
              <h3>{dashboardSpendingCents ? 'Your spending this month' : 'Spending will show here'}</h3>
              <p className="dashboard__insights-copy">
                {transactionError
                  ? 'We could not load spending activity. Open Insights to see the error and retry.'
                  : dashboardSpendingCents
                    ? 'Posted purchase activity across your deposit accounts.'
                    : 'Your spending breakdown will appear after your first purchase.'}
              </p>
              <a className="dashboard__insights-link" href="#insights" onClick={(event) => {
                event.preventDefault()
                navigateToPage('Insights')
              }}>Explore insights <span aria-hidden="true">→</span></a>
            </section>
          </div>
        </div>
        )}
      </div>

      <NotificationPopup
        accounts={accounts}
        key={popupNotification?.id || 'notification-popup'}
        busy={notificationBusyIds.has(popupNotification?.id)}
        notification={popupNotification}
        onClose={() => setPopupNotificationId(null)}
        onMarkRead={markNotificationRead}
        onReply={sendCustomerMessageReply}
        onViewAlerts={() => navigateToPage('Alerts')}
      />
      {actionFeedback && (
        <ActionToast
          key={actionFeedback.id}
          kind={actionFeedback.kind}
          message={actionFeedback.message}
          onDismiss={() => setActionFeedback(null)}
        />
      )}
    </div>
  )
}

export default Dashboard
