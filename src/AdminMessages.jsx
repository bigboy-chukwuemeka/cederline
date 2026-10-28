import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import AdminSelect from './components/AdminSelect.jsx'
import './AdminMessages.css'

const messagePriorities = [
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const messageCategories = [
  { value: '', label: 'No category' },
  { value: 'account_alert', label: 'Account Alert' },
  { value: 'security', label: 'Security' },
  { value: 'general', label: 'General' },
  { value: 'investigation', label: 'Investigation' },
]

function formatMessageTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function formatConversationTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay
    ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date)
    : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
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

async function getRequestError(error) {
  if (error?.name === 'FunctionsFetchError') {
    const detail = error.context?.message || error.context?.cause?.message
    console.error('Admin messaging request could not reach the Edge Function:', error.context || error)
    return detail
      ? `The browser could not reach the secure messaging service (${detail}). Check the browser network and try Refresh.`
      : 'The browser could not reach the secure messaging service. Check the browser network and try Refresh.'
  }
  if (error?.context && typeof error.context.json === 'function') {
    try {
      const body = await error.context.json()
      if (typeof body?.error === 'string') return body.error
    } catch {
      return error.message || 'The secure messaging request failed.'
    }
  }
  return error?.message || 'The secure messaging request failed.'
}

export default function AdminMessages() {
  const [inboxSearch, setInboxSearch] = useState('')
  const [inbox, setInbox] = useState([])
  const [inboxLoading, setInboxLoading] = useState(true)
  const [inboxError, setInboxError] = useState('')
  const [inboxReload, setInboxReload] = useState(0)
  const [selectedUser, setSelectedUser] = useState(null)
  const [isComposing, setIsComposing] = useState(false)
  const [messages, setMessages] = useState([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [threadError, setThreadError] = useState('')
  const [threadReload, setThreadReload] = useState(0)
  const [recipientSearch, setRecipientSearch] = useState('')
  const [recipients, setRecipients] = useState([])
  const [recipientLoading, setRecipientLoading] = useState(false)
  const [recipientError, setRecipientError] = useState('')
  const [messageSubject, setMessageSubject] = useState('')
  const [messageDraft, setMessageDraft] = useState('')
  const [messagePriority, setMessagePriority] = useState('normal')
  const [messageCategory, setMessageCategory] = useState('')
  const [sendError, setSendError] = useState('')
  const [sendBusy, setSendBusy] = useState(false)
  const [sendStatus, setSendStatus] = useState('')
  const endOfThreadRef = useRef(null)
  const messageLength = messageDraft.length
  const subjectLength = messageSubject.length
  const selectedUserId = selectedUser?.id

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      if (!supabase) {
        setInboxError('Supabase is not configured. Add the public Supabase URL and key before loading messages.')
        setInboxLoading(false)
        return
      }
      setInboxLoading(true)
      setInboxError('')
      const { data, error } = await supabase.functions.invoke('admin-messages', {
        body: { action: 'inbox', search: inboxSearch, limit: 100 },
      })
      if (!active) return
      if (error) {
        setInboxError(await getRequestError(error))
        setInbox([])
      } else if (data?.error) {
        setInboxError(data.error)
        setInbox([])
      } else {
        setInbox(data.conversations || [])
      }
      setInboxLoading(false)
    }, inboxSearch.trim() ? 200 : 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [inboxSearch, inboxReload])

  useEffect(() => {
    if (!isComposing || recipientSearch.trim().length < 2) return undefined
    let active = true
    const timer = window.setTimeout(async () => {
      if (!supabase) {
        setRecipientError('Supabase is not configured.')
        return
      }
      setRecipientLoading(true)
      setRecipientError('')
      const { data, error } = await supabase.functions.invoke('admin-messages', {
        body: { action: 'recipients', search: recipientSearch },
      })
      if (!active) return
      if (error) {
        setRecipientError(await getRequestError(error))
        setRecipients([])
      } else if (data?.error) {
        setRecipientError(data.error)
        setRecipients([])
      } else {
        setRecipients(data.users || [])
      }
      setRecipientLoading(false)
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [isComposing, recipientSearch])

  useEffect(() => {
    if (!selectedUserId || isComposing || !supabase) return undefined
    let active = true
    async function loadThread() {
      setThreadLoading(true)
      setThreadError('')
      const { data, error } = await supabase.functions.invoke('admin-messages', {
        body: { action: 'thread', userId: selectedUserId },
      })
      if (!active) return
      if (error) {
        setThreadError(await getRequestError(error))
        setMessages([])
      } else if (data?.error) {
        setThreadError(data.error)
        setMessages([])
      } else {
        setMessages(data.messages || [])
      }
      setThreadLoading(false)
    }
    loadThread()
    return () => {
      active = false
    }
  }, [selectedUserId, isComposing, threadReload])

  useEffect(() => {
    endOfThreadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, selectedUser?.id])

  function openConversation(conversation) {
    setIsComposing(false)
    if (selectedUser?.id !== conversation.user.id) {
      setMessages([])
      setThreadLoading(true)
      setThreadError('')
    }
    setSelectedUser(conversation.user)
    setSendError('')
    setSendStatus('')
    setMessageSubject('')
    setMessageDraft('')
    setMessagePriority('normal')
    setMessageCategory('')
  }

  function startNewMessage() {
    setSelectedUser(null)
    setIsComposing(true)
    setRecipientSearch('')
    setRecipients([])
    setRecipientError('')
    setMessages([])
    setThreadError('')
    setSendError('')
    setSendStatus('')
    setMessageSubject('')
    setMessageDraft('')
    setMessagePriority('normal')
    setMessageCategory('')
  }

  function selectRecipient(user) {
    setSelectedUser(user)
    setIsComposing(false)
    setMessages([])
    setThreadLoading(true)
    setThreadError('')
    setRecipientSearch('')
    setRecipients([])
    setSendError('')
    setSendStatus('')
    setMessageSubject('')
    setMessageDraft('')
    setMessagePriority('normal')
    setMessageCategory('')
    setThreadReload((count) => count + 1)
  }

  function handleRecipientSearchChange(value) {
    setRecipientSearch(value)
    if (value.trim().length < 2) {
      setRecipients([])
      setRecipientLoading(false)
      setRecipientError('')
    }
  }

  async function sendMessage(event) {
    event.preventDefault()
    if (!selectedUser || !messageSubject.trim() || !messageDraft.trim() || sendBusy || !supabase) return
    setSendBusy(true)
    setSendError('')
    setSendStatus('')
    const { data, error } = await supabase.functions.invoke('admin-messages', {
      body: {
        action: 'send',
        userId: selectedUser.id,
        subject: messageSubject.trim(),
        message: messageDraft.trim(),
        priority: messagePriority,
        category: messageCategory || null,
      },
    })
    if (error) {
      setSendError(await getRequestError(error))
      setSendBusy(false)
      return
    }
    if (data?.error) {
      setSendError(data.error)
      setSendBusy(false)
      return
    }
    setMessageSubject('')
    setMessageDraft('')
    setMessagePriority('normal')
    setMessageCategory('')
    setSendBusy(false)
    setSendStatus(data.emailSent
      ? 'Secure message and email notice sent successfully.'
      : 'Secure message sent in-app. Email was skipped or unavailable.')
    setThreadReload((count) => count + 1)
    setInboxReload((count) => count + 1)
  }

  return (
    <section className="admin-messages" aria-label="Customer messages">
      <aside className="admin-messages__inbox">
        <div className="admin-messages__inbox-heading">
          <div><h2>Inbox</h2><span>{inbox.length} conversations</span></div>
          <div className="admin-messages__inbox-actions">
            <button
              aria-label="Refresh conversations"
              className="admin-messages__refresh-button"
              disabled={inboxLoading}
              onClick={() => {
                setInboxReload((count) => count + 1)
                if (selectedUser && !isComposing) setThreadReload((count) => count + 1)
              }}
              type="button"
            >
              {inboxLoading ? 'Loading…' : 'Refresh'}
            </button>
            <button className="admin-messages__compose-button" type="button" onClick={startNewMessage}>＋ New message</button>
          </div>
        </div>
        <label className="admin-messages__inbox-search">
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></svg>
          <input aria-label="Search conversations" onChange={(event) => setInboxSearch(event.target.value)} placeholder="Search conversations" value={inboxSearch} />
        </label>
        {inboxError && <p className="admin-messages__inline-error" role="alert">{inboxError}</p>}
        <div className="admin-messages__conversation-list">
          {inboxLoading ? (
            <p className="admin-messages__list-state" role="status">Loading conversations…</p>
          ) : inbox.length === 0 ? (
            <div className="admin-messages__list-empty">
              <span aria-hidden="true">✉</span>
              <strong>{inboxError ? 'Inbox unavailable' : inboxSearch ? 'No matching conversations' : 'No conversations yet'}</strong>
              {!inboxError && <p>Start a secure message to a customer.</p>}
              {!inboxError && <button type="button" onClick={startNewMessage}>Compose a message</button>}
            </div>
          ) : inbox.map((conversation) => (
            <button
              aria-current={!isComposing && selectedUser?.id === conversation.user.id ? 'true' : undefined}
              className={`admin-messages__conversation${!isComposing && selectedUser?.id === conversation.user.id ? ' admin-messages__conversation--active' : ''}`}
              key={conversation.user.id}
              onClick={() => openConversation(conversation)}
              type="button"
            >
              <span className="admin-messages__avatar">{getInitials(conversation.user.display_name)}</span>
              <span className="admin-messages__conversation-copy">
                <span className="admin-messages__conversation-top">
                  <strong>{conversation.user.display_name || 'Unnamed user'}</strong>
                  <time dateTime={conversation.last_message.created_at}>{formatConversationTime(conversation.last_message.created_at)}</time>
                </span>
                <small>{conversation.user.email}</small>
                <span className="admin-messages__preview">
                  {conversation.last_message.sender_id === conversation.user.id ? 'Customer: ' : 'You: '}
                  {conversation.last_message.sender_id === conversation.user.id
                    ? conversation.last_message.body
                    : conversation.last_message.subject || conversation.last_message.body}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="admin-messages__inbox-footer"><span /> Secure customer communication</div>
      </aside>

      <div className="admin-messages__workspace">
        {!selectedUser && !isComposing ? (
          <div className="admin-messages__welcome">
            <span className="admin-messages__welcome-icon" aria-hidden="true">✉</span>
            <h2>Customer messages</h2>
            <p>Select a conversation from the inbox or compose a secure message to any customer.</p>
            <button className="admin-messages__primary-button" type="button" onClick={startNewMessage}>Compose a message</button>
          </div>
        ) : isComposing && !selectedUser ? (
          <div className="admin-messages__new-message">
            <header className="admin-messages__thread-header">
              <span className="admin-messages__avatar admin-messages__avatar--header">✉</span>
              <div><h2>New message</h2><p>Select the customer who will receive this message.</p></div>
            </header>
            <section className="admin-messages__recipient-picker" aria-label="Select message recipient">
              <label htmlFor="admin-message-recipient">To</label>
              <input
                autoFocus
                id="admin-message-recipient"
                onChange={(event) => handleRecipientSearchChange(event.target.value)}
                placeholder="Search by customer name or email"
                value={recipientSearch}
              />
              {recipientLoading && <p className="admin-messages__recipient-state" role="status">Searching customers…</p>}
              {recipientError && <p className="admin-messages__inline-error" role="alert">{recipientError}</p>}
              {!recipientLoading && recipientSearch.trim().length >= 2 && recipients.length === 0 && !recipientError && (
                <p className="admin-messages__recipient-state">No customers found for “{recipientSearch}”.</p>
              )}
              {recipients.length > 0 && (
                <ul className="admin-messages__recipient-results">
                  {recipients.map((user) => (
                    <li key={user.id}>
                      <button type="button" onClick={() => selectRecipient(user)}>
                        <span className="admin-messages__avatar">{getInitials(user.display_name)}</span>
                        <span><strong>{user.display_name || 'Unnamed user'}</strong><small>{user.email}</small></span>
                        <span className={`admin-messages__user-status${user.is_active ? '' : ' admin-messages__user-status--inactive'}`}>{user.is_active ? 'Active' : 'Locked'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="admin-messages__delivery-note">
                <span aria-hidden="true">✓</span>
                <p><strong>Delivered in app</strong><small>The customer will see this message in their Evergreen app Alerts. No email or SMS is sent.</small></p>
              </div>
            </section>
          </div>
        ) : (
          <div className="admin-messages__thread">
            <header className="admin-messages__thread-header">
              <span className="admin-messages__avatar admin-messages__avatar--header">{getInitials(selectedUser?.display_name)}</span>
              <div><h2>{selectedUser?.display_name || 'Unnamed user'}</h2><p>{selectedUser?.email}{selectedUser && !selectedUser.is_active ? ' · Login locked' : ''}</p></div>
              <span className={`admin-messages__contact-status${selectedUser?.is_active ? '' : ' admin-messages__contact-status--inactive'}`}><span />{selectedUser?.is_active ? 'Active customer' : 'Locked account'}</span>
            </header>
            <div className="admin-messages__thread-history" aria-live="polite">
              {threadLoading ? (
                <p className="admin-messages__thread-state" role="status">Loading secure conversation…</p>
              ) : threadError ? (
                <div className="admin-messages__thread-error" role="alert">{threadError}</div>
              ) : messages.length === 0 ? (
                <div className="admin-messages__thread-empty">
                  <span aria-hidden="true">✉</span>
                  <strong>Start the conversation</strong>
                  <p>Your message will appear in this thread and in the customer’s in-app Alerts.</p>
                </div>
              ) : (
                <>
                  <p className="admin-messages__history-label">Secure message history</p>
                  {messages.map((message) => (
                    <article className={`admin-messages__bubble${message.sender_id === selectedUser?.id ? ' admin-messages__bubble--customer' : ''}`} key={message.id}>
                      {message.sender_id !== selectedUser?.id && (
                        <header className="admin-messages__message-heading">
                          <strong>{message.subject || 'Secure message'}</strong>
                          <span className={`admin-messages__priority admin-messages__priority--${message.priority || 'normal'}`}>{message.priority || 'normal'}</span>
                        </header>
                      )}
                      {message.category && <span className="admin-messages__message-category">{message.category.replaceAll('_', ' ')}</span>}
                      <p>{message.body}</p>
                      <time dateTime={message.created_at}>{message.sender_id === selectedUser?.id ? selectedUser.display_name : 'Evergreen Admin'} · {formatMessageTime(message.created_at)}</time>
                    </article>
                  ))}
                  <div ref={endOfThreadRef} />
                </>
              )}
            </div>
            <form className="admin-messages__composer" onSubmit={sendMessage}>
              {sendError && <p className="admin-messages__inline-error" role="alert">{sendError}</p>}
              {sendStatus && <p className="admin-messages__send-status" role="status">{sendStatus}</p>}
              <label className="admin-messages__delivery-note admin-messages__delivery-note--composer">
                <span aria-hidden="true">✓</span>
                <span><strong>Secure in-app delivery</strong><small>The customer will see the subject and message in Alerts. Email and SMS are not sent.</small></span>
              </label>
              <label className="admin-messages__field">
                Subject / title
                <input
                  autoComplete="off"
                  maxLength={120}
                  onChange={(event) => setMessageSubject(event.target.value)}
                  placeholder="e.g. Important update about your account"
                  required
                  value={messageSubject}
                />
              </label>
              <div className="admin-messages__message-options">
                <div className="admin-messages__field">
                  <span>Priority</span>
                  <AdminSelect
                    ariaLabel="Message priority"
                    onChange={setMessagePriority}
                    options={messagePriorities}
                    value={messagePriority}
                  />
                </div>
                <div className="admin-messages__field">
                  <span>Category (optional)</span>
                  <AdminSelect
                    ariaLabel="Message category"
                    onChange={setMessageCategory}
                    options={messageCategories}
                    value={messageCategory}
                  />
                </div>
              </div>
              <label className="admin-messages__field">
                Message
                <textarea
                  aria-label="Write a message"
                  maxLength={4000}
                  onChange={(event) => setMessageDraft(event.target.value)}
                  placeholder="Write a clear, professional message. Include any relevant details and the action the customer should take."
                  required
                  rows="5"
                  value={messageDraft}
                />
              </label>
              <div className="admin-messages__composer-actions">
                <span>{subjectLength.toLocaleString()} / 120 subject · {messageLength.toLocaleString()} / 4,000 message characters</span>
                <button className="admin-messages__primary-button" disabled={sendBusy || !messageSubject.trim() || !messageDraft.trim() || threadLoading} type="submit">
                  {sendBusy ? 'Sending…' : 'Send notification'}
                  {!sendBusy && <span aria-hidden="true">➤</span>}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </section>
  )
}
