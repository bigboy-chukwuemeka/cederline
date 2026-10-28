import { useEffect, useRef, useState } from 'react'
import './ActionToast.css'

export default function ActionToast({ kind = 'success', message, onDismiss }) {
  const [isLeaving, setIsLeaving] = useState(false)
  const onDismissRef = useRef(onDismiss)

  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    const timer = window.setTimeout(() => setIsLeaving(true), 5200)
    return () => window.clearTimeout(timer)
  }, [message])

  useEffect(() => {
    if (!isLeaving) return undefined
    const timer = window.setTimeout(() => onDismissRef.current?.(), 220)
    return () => window.clearTimeout(timer)
  }, [isLeaving])

  if (!message) return null

  return (
    <aside
      className={`action-toast action-toast--${kind}${isLeaving ? ' is-leaving' : ''}`}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
    >
      <span aria-hidden="true" className="action-toast__icon">{kind === 'error' ? '!' : '✓'}</span>
      <p>{message}</p>
      <button aria-label="Dismiss message" onClick={() => setIsLeaving(true)} type="button">×</button>
    </aside>
  )
}
