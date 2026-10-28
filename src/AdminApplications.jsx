import { useEffect, useState } from 'react'
import './AdminApplications.css'
import { supabase } from './lib/supabase.js'
import AdminSelect from './components/AdminSelect.jsx'

const PAGE_SIZE = 8

const statuses = [
  { value: 'all', label: 'All applications' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
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

function ReviewBadge({ status }) {
  const label = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }[status] || status
  return <span className={`admin-applications__status admin-applications__status--${status}`}><span />{label}</span>
}

function maskedTaxId(value) {
  if (!value) return 'Not provided'
  return `•••-••-${value.replace(/\D/g, '').slice(-4).padStart(4, '•')}`
}

export default function AdminApplications() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('pending')
  const [page, setPage] = useState(1)
  const [reloadCount, setReloadCount] = useState(0)
  const [applications, setApplications] = useState([])
  const [total, setTotal] = useState(0)
  const [pendingTotal, setPendingTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedApplication, setSelectedApplication] = useState(null)
  const [details, setDetails] = useState(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [taxIdVisible, setTaxIdVisible] = useState(false)
  const [decision, setDecision] = useState('')
  const [reason, setReason] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')
  const [actionBusy, setActionBusy] = useState(false)

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      if (!supabase) {
        setError('Supabase is not configured. Add the public Supabase URL and key before loading applications.')
        setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      const { data, error: requestError } = await supabase.functions.invoke('admin-applications', {
        body: { action: 'list', search, status, page, pageSize: PAGE_SIZE },
      })
      if (!active) return
      if (requestError) {
        setError(await functionErrorMessage(requestError))
        setApplications([])
        setTotal(0)
      } else if (data?.error) {
        setError(data.error)
        setApplications([])
        setTotal(0)
      } else {
        setApplications(data.applications || [])
        setTotal(data.total || 0)
        setPendingTotal(data.pending_total || 0)
      }
      setLoading(false)
    }, search.trim() ? 250 : 0)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [search, status, page, reloadCount])

  function changeFilter(setter, value) {
    setter(value)
    setPage(1)
  }

  async function openDetails(application) {
    if (!supabase) return
    setSelectedApplication(application)
    setDetails(null)
    setDetailsError('')
    setTaxIdVisible(false)
    setDetailsLoading(true)
    const { data, error: requestError } = await supabase.functions.invoke('admin-applications', {
      body: { action: 'details', userId: application.user_id },
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

  function startDecision(nextDecision, application) {
    setDecision(nextDecision)
    setSelectedApplication(application)
    setReason('')
    setActionError('')
    setActionSuccess('')
  }

  async function submitDecision(event) {
    event.preventDefault()
    if (!selectedApplication || !decision || !supabase) return
    setActionBusy(true)
    setActionError('')
    const { data, error: requestError } = await supabase.functions.invoke('admin-applications', {
      body: {
        action: 'review',
        userId: selectedApplication.user_id,
        decision,
        reason: reason.trim(),
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

    setApplications((current) => current.map((application) => application.user_id === data.user_id
      ? { ...application, status: data.status, pending_count: 0 }
      : application))
    setDecision('')
    setSelectedApplication(null)
    setDetails(null)
    setActionSuccess(data.status === 'approved'
      ? `KYC approved. The user is active and their eligible accounts have been activated.${data.emailSent ? ' Email notice sent.' : ' In-app notice added; email was skipped or unavailable.'}`
      : `KYC rejected. The reason and decision were recorded in the audit log.${data.emailSent ? ' Email notice sent.' : ' Email was skipped or unavailable.'}`)
    setActionBusy(false)
    setReloadCount((count) => count + 1)
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const address = details?.profile?.residential_address
  const formattedAddress = address && typeof address === 'object'
    ? [address.street, address.line1, address.line2, address.city, address.state, address.postal_code, address.country].filter(Boolean).join(', ')
    : ''
  const submittedForm = details?.application?.form_data || {}
  const submittedFormLabels = {
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email address',
    username: 'Username',
    phone: 'Phone number',
    phoneType: 'Phone type',
    dateOfBirth: 'Date of birth',
    employmentStatus: 'Employment status',
    isStudent: 'Student',
    promoCode: 'Promo code',
    bankerId: 'Banker ID',
    governmentIdType: 'Government ID type',
    governmentIdNumber: 'Government ID number',
    governmentIdExpiration: 'Government ID expiration',
    frontImage: 'Front image file',
    backImage: 'Back image file',
    streetAddress: 'Residential street',
    addressLine2: 'Residential address line 2',
    city: 'Residential city',
    state: 'Residential state',
    postalCode: 'Residential ZIP code',
    mailingAddressDifferent: 'Separate mailing address',
    mailingStreetAddress: 'Mailing street',
    mailingAddressLine2: 'Mailing address line 2',
    mailingCity: 'Mailing city',
    mailingState: 'Mailing state',
    mailingPostalCode: 'Mailing ZIP code',
  }
  const submittedFormRows = Object.entries(submittedForm)
    .filter(([key, value]) => key !== 'taxId' && submittedFormLabels[key] && value !== '' && value !== null && value !== undefined)
    .map(([key, value]) => {
      const labels = {
        'drivers-license': 'Driver’s license',
        'state-id': 'State ID',
        passport: 'Passport',
        'self-employed': 'Self-employed',
        employed: 'Employed',
        unemployed: 'Unemployed',
        retired: 'Retired',
        other: 'Other',
        mobile: 'Mobile',
        home: 'Home',
        yes: 'Yes',
        no: 'No',
      }
      return [submittedFormLabels[key], typeof value === 'boolean' ? (value ? 'Yes' : 'No') : (labels[value] || value)]
    })

  return (
    <div className="admin-applications">
      <div className="admin-applications__summary">
        <button
          className={`admin-applications__summary-card${status === 'pending' ? ' admin-applications__summary-card--active' : ''}`}
          onClick={() => changeFilter(setStatus, 'pending')}
          type="button"
        >
          <span>Pending review</span>
          <strong>{pendingTotal.toLocaleString()}</strong>
          <small>Identity applications to review</small>
        </button>
        <div className="admin-applications__privacy"><span aria-hidden="true">◈</span><span><strong>Restricted identity data</strong><small>Personal details and ID files are accessed only in the audited review view.</small></span></div>
      </div>

      <div className="admin-applications__toolbar">
        <label className="admin-applications__search">
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></svg>
          <input aria-label="Search applicants" onChange={(event) => changeFilter(setSearch, event.target.value)} placeholder="Search applicant name or email" value={search} />
        </label>
        <AdminSelect
          ariaLabel="Filter applications by status"
          label="Status"
          onChange={(value) => changeFilter(setStatus, value)}
          options={statuses}
          value={status}
        />
        <span className="admin-applications__total">{total.toLocaleString()} applicants</span>
      </div>

      {error && (
        <div className="admin-applications__error" role="alert">
          <strong>Applications could not be loaded</strong>
          <span>{error}</span>
          <small>Apply the KYC review migration and deploy the <code>admin-applications</code> Supabase Edge Function.</small>
        </div>
      )}

      {!loading && !error && applications.length === 0 && (
        <aside className="admin-applications__source-note" role="note">
          Submitted applications and private identity-document uploads appear here after the customer completes sign-up.
        </aside>
      )}

      {actionSuccess && <p className="admin-applications__success" role="status">{actionSuccess}</p>}

      <div className="admin-applications__table-wrap">
        <table className="admin-applications__table">
          <thead>
            <tr>
              <th scope="col">Applicant</th>
              <th scope="col">Application ID</th>
              <th scope="col">Documents</th>
              <th scope="col">Submitted</th>
              <th scope="col">Status</th>
              <th scope="col" className="admin-applications__actions-heading">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="admin-applications__empty" colSpan="6" role="status">Loading KYC applications…</td></tr>
            ) : error ? (
              <tr><td className="admin-applications__empty" colSpan="6">Application records are unavailable.</td></tr>
            ) : applications.length === 0 ? (
              <tr><td className="admin-applications__empty" colSpan="6">No saved identity applications match this queue.</td></tr>
            ) : applications.map((application) => (
              <tr key={application.user_id}>
                <td>
                  <div className="admin-applications__identity">
                    <span className="admin-applications__initials">{getInitials(application.display_name)}</span>
                    <span><strong>{application.display_name || 'Unnamed applicant'}</strong><small>{application.email}</small></span>
                  </div>
                </td>
                <td className="admin-applications__reference">KYC-{application.user_id.slice(0, 8).toUpperCase()}</td>
                <td><span className="admin-applications__documents-count">{application.document_count} {application.document_count === 1 ? 'file' : 'files'}</span></td>
                <td className="admin-applications__date">{formatDate(application.submitted_at)}</td>
                <td><ReviewBadge status={application.status} /></td>
                <td>
                  <div className="admin-applications__row-actions">
                    <button className="admin-applications__view" type="button" onClick={() => openDetails(application)}>Review <span aria-hidden="true">→</span></button>
                    {application.status === 'pending' && <>
                      <button className="admin-applications__approve-link" type="button" onClick={() => startDecision('approved', application)}>Approve</button>
                      <button className="admin-applications__reject-link" type="button" onClick={() => startDecision('rejected', application)}>Reject</button>
                    </>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="admin-applications__footer">
        <span>{total === 0 ? 'Showing 0 applicants' : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString()} applicants`}</span>
        <div className="admin-applications__pagination">
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</button>
          <span>{page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next</button>
        </div>
      </footer>

      {selectedApplication && !decision && (
        <div className="admin-applications__overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedApplication(null)
        }}>
          <section className="admin-applications__dialog" role="dialog" aria-modal="true" aria-labelledby="admin-application-detail-title">
            <header className="admin-applications__dialog-header">
              <div>
                <p className="admin-applications__eyebrow">KYC application · KYC-{selectedApplication.user_id.slice(0, 8).toUpperCase()}</p>
                <h2 id="admin-application-detail-title">{details?.user?.display_name || selectedApplication.display_name || 'Applicant details'}</h2>
                <p>{details?.user?.email || selectedApplication.email}</p>
              </div>
              <button className="admin-applications__close" type="button" aria-label="Close application details" onClick={() => setSelectedApplication(null)}>×</button>
            </header>
            {detailsLoading ? (
              <p className="admin-applications__detail-state" role="status">Loading restricted applicant details…</p>
            ) : detailsError ? (
              <p className="admin-applications__detail-error" role="alert">{detailsError}</p>
            ) : details && (
              <div className="admin-applications__detail-content">
                <section className="admin-applications__detail-section">
                  <h3>Applicant information</h3>
                  <dl>
                    <div><dt>Legal name</dt><dd>{[details.profile?.legal_first_name, details.profile?.legal_middle_name, details.profile?.legal_last_name].filter(Boolean).join(' ') || details.user.display_name || 'Not provided'}</dd></div>
                    <div><dt>Email address</dt><dd>{details.user.email || 'Not provided'}</dd></div>
                    <div><dt>Phone number</dt><dd>{details.user.phone_e164 || 'Not provided'}</dd></div>
                    <div><dt>Date joined</dt><dd>{formatDate(details.user.created_at)}</dd></div>
                    <div><dt>Date of birth</dt><dd>{formatDate(details.profile?.date_of_birth)}</dd></div>
                    <div><dt>Residential address</dt><dd>{formattedAddress || 'Not provided'}</dd></div>
                    <div className="admin-applications__tax-id-row">
                      <dt>Tax ID</dt>
                      <dd>
                        <span>{taxIdVisible ? (details.profile?.tax_id || 'Not provided') : maskedTaxId(details.profile?.tax_id)}</span>
                        {details.profile?.tax_id && <button type="button" onClick={() => setTaxIdVisible((visible) => !visible)}>{taxIdVisible ? 'Hide' : 'Reveal'}</button>}
                      </dd>
                    </div>
                  </dl>
                  <p className="admin-applications__sensitive-note">Tax ID access and applicant-detail views are recorded in the audit log. Reveal sensitive information only when required for verification.</p>
                </section>
                <section className="admin-applications__detail-section">
                  <header className="admin-applications__section-heading">
                    <h3>Submitted application form</h3>
                    <span>{details.application?.submitted_at ? `Submitted ${formatDate(details.application.submitted_at)}` : 'Legacy application'}</span>
                  </header>
                  {submittedFormRows.length ? (
                    <dl>{submittedFormRows.map(([label, value]) => (
                      <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>
                    ))}</dl>
                  ) : <p className="admin-applications__no-documents">No saved form details are available for this application.</p>}
                  {details.application?.review_reason && <p className="admin-applications__review-notes">Review reason: {details.application.review_reason}</p>}
                </section>
                <section className="admin-applications__detail-section">
                  <header className="admin-applications__section-heading"><h3>Government ID documents</h3><span>{details.documents.length} files</span></header>
                  {details.document_access_error && <p className="admin-applications__document-error" role="alert">{details.document_access_error}</p>}
                  {details.documents.length ? (
                    <div className="admin-applications__document-list">
                      {details.documents.map((document) => (
                        <article className="admin-applications__document" key={document.id}>
                          <span className="admin-applications__document-icon" aria-hidden="true">▤</span>
                          <span className="admin-applications__document-copy">
                            <strong>{document.document_type.replaceAll('_', ' ')}</strong>
                            {document.original_file_name && <small>File: {document.original_file_name}</small>}
                            {document.expires_at && <small>Expires {formatDate(document.expires_at)}</small>}
                            <small>Submitted {formatDate(document.submitted_at)}{document.reviewed_at ? ` · Reviewed ${formatDate(document.reviewed_at)}` : ''}</small>
                            {document.reviewer_notes && <small className="admin-applications__review-notes">Review note: {document.reviewer_notes}</small>}
                          </span>
                          <ReviewBadge status={document.status === 'verified' ? 'approved' : document.status === 'under_review' ? 'pending' : document.status} />
                          {document.signed_url ? (
                            <a className="admin-applications__document-link" href={document.signed_url} rel="noreferrer" target="_blank">Open file ↗</a>
                          ) : (
                            <span className="admin-applications__document-missing">File unavailable</span>
                          )}
                        </article>
                      ))}
                    </div>
                  ) : <p className="admin-applications__no-documents">No government ID documents have been saved for this applicant.</p>}
                </section>
              </div>
            )}
            <footer className="admin-applications__dialog-footer">
              {selectedApplication.status === 'pending' && <>
                <button className="admin-applications__action admin-applications__action--reject" type="button" onClick={() => startDecision('rejected', selectedApplication)}>Reject</button>
                <button className="admin-applications__action admin-applications__action--approve" type="button" onClick={() => startDecision('approved', selectedApplication)}>Approve</button>
              </>}
              <button className="admin-applications__action admin-applications__action--secondary" type="button" onClick={() => setSelectedApplication(null)}>Close</button>
            </footer>
          </section>
        </div>
      )}

      {decision && selectedApplication && (
        <div className="admin-applications__overlay admin-applications__overlay--confirm">
          <form className="admin-applications__confirm" onSubmit={submitDecision} role="dialog" aria-modal="true" aria-labelledby="admin-application-decision-title">
            <span className={`admin-applications__confirm-mark${decision === 'approved' ? ' admin-applications__confirm-mark--approve' : ''}`} aria-hidden="true">{decision === 'approved' ? '✓' : '!'}</span>
            <p className="admin-applications__eyebrow">KYC decision</p>
            <h2 id="admin-application-decision-title">{decision === 'approved' ? 'Approve this application?' : 'Reject this application?'}</h2>
            <p className="admin-applications__confirm-copy">
              {decision === 'approved'
                ? 'All pending identity documents for this applicant will be marked verified and the decision will be audited.'
                : 'All pending identity documents for this applicant will be rejected. A rejection reason is required.'}
            </p>
            <label className="admin-applications__reason">
              {decision === 'rejected' ? 'Rejection reason' : 'Review note (optional)'}
              <textarea autoFocus maxLength={1000} minLength={decision === 'rejected' ? 5 : undefined} onChange={(event) => setReason(event.target.value)} placeholder={decision === 'rejected' ? 'Explain why this application was not approved…' : 'Add an optional note for the audit record…'} required={decision === 'rejected'} rows="3" value={reason} />
            </label>
            {actionError && <p className="admin-applications__action-error" role="alert">{actionError}</p>}
            <div className="admin-applications__confirm-actions">
              <button className="admin-applications__action admin-applications__action--secondary" disabled={actionBusy} onClick={() => setDecision('')} type="button">Cancel</button>
              <button
                className={`admin-applications__action${decision === 'approved' ? ' admin-applications__action--approve' : ' admin-applications__action--reject'}`}
                disabled={actionBusy || (decision === 'rejected' && reason.trim().length < 5)}
                type="submit"
              >
                {actionBusy ? 'Recording…' : decision === 'approved' ? 'Confirm approval' : 'Confirm rejection'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
