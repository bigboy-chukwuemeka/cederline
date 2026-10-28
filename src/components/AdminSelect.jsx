import { useEffect, useId, useRef, useState } from 'react'
import './AdminSelect.css'

export default function AdminSelect({ ariaLabel, className = '', label, onChange, options, value }) {
  const generatedId = useId()
  const triggerId = `admin-select-${generatedId}`
  const menuId = `${triggerId}-options`
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const optionRefs = useRef([])
  const [open, setOpen] = useState(false)
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selectedOption = options[selectedIndex]

  useEffect(() => {
    if (!open) return undefined
    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    optionRefs.current[selectedIndex]?.focus()
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, selectedIndex])

  function choose(option) {
    onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  function handleMenuKeyDown(event, index) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex = (index + delta + options.length) % options.length
      optionRefs.current[nextIndex]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const targetIndex = event.key === 'Home' ? 0 : options.length - 1
      optionRefs.current[targetIndex]?.focus()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  function handleTriggerKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen(true)
    }
  }

  return (
    <div className={`admin-select${open ? ' admin-select--open' : ''}${className ? ` ${className}` : ''}`} ref={rootRef}>
      {label && <span className="admin-select__label">{label}</span>}
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel || label}
        className="admin-select__trigger"
        id={triggerId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        type="button"
      >
        <span>{selectedOption?.label || value}</span>
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      {open && (
        <div
          aria-labelledby={triggerId}
          className="admin-select__menu"
          id={menuId}
          role="listbox"
        >
          {options.map((option, index) => (
            <button
              aria-selected={option.value === selectedOption?.value}
              className={`admin-select__option${option.value === selectedOption?.value ? ' admin-select__option--selected' : ''}`}
              key={option.value}
              onClick={() => choose(option)}
              onKeyDown={(event) => handleMenuKeyDown(event, index)}
              ref={(element) => { optionRefs.current[index] = element }}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span>{option.label}</span>
              {option.value === selectedOption?.value && <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m4 10 4 4 8-8" /></svg>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
