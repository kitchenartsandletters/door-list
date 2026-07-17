import { useState } from 'react'

export default function PinModal({ title, hint, onSubmit, onClose }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function go(e) {
    e.preventDefault()
    if (!/^\d{4}$/.test(pin)) {
      setErr('Enter the 4-digit code.')
      return
    }
    setBusy(true)
    const ok = await onSubmit(pin)
    setBusy(false)
    if (!ok) {
      setErr('Wrong code — try again.')
      setPin('')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={go}>
        <h3 className="modal-title">{title}</h3>
        {hint && <p className="modal-hint">{hint}</p>}
        <input
          className="pin-input"
          inputMode="numeric"
          pattern="\d*"
          maxLength={4}
          autoFocus
          placeholder="••••"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, ''))
            setErr(null)
          }}
          aria-label="4-digit code"
        />
        {err && <p className="modal-err">{err}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
        </div>
      </form>
    </div>
  )
}
