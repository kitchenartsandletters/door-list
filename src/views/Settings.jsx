import { useState } from 'react'
import { supabase } from '../supabase.js'

export default function Settings() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  async function save(e) {
    e.preventDefault()
    setMsg(null)
    if (!/^\d{4}$/.test(next)) {
      setMsg({ err: true, text: 'The new code must be exactly 4 digits.' })
      return
    }
    if (next !== confirm) {
      setMsg({ err: true, text: "New codes don't match." })
      return
    }
    setBusy(true)
    const { data, error } = await supabase.rpc('update_pin', {
      current_pin: current,
      new_pin: next,
    })
    setBusy(false)
    if (error) setMsg({ err: true, text: error.message })
    else if (data === true) {
      setMsg({ err: false, text: 'Code updated.' })
      setCurrent('')
      setNext('')
      setConfirm('')
    } else {
      setMsg({ err: true, text: 'Current code is wrong.' })
    }
  }

  return (
    <div className="panel">
      <h2 className="panel-title">Door code</h2>
      <p className="panel-note">
        The 4-digit code is required to delete a list or change this code. Check-ins,
        archiving, and building new lists never ask for it, so the door stays fast.
      </p>
      <form className="pin-form" onSubmit={save}>
        <input
          className="field"
          inputMode="numeric"
          maxLength={4}
          placeholder="Current code"
          value={current}
          onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ''))}
        />
        <input
          className="field"
          inputMode="numeric"
          maxLength={4}
          placeholder="New 4-digit code"
          value={next}
          onChange={(e) => setNext(e.target.value.replace(/\D/g, ''))}
        />
        <input
          className="field"
          inputMode="numeric"
          maxLength={4}
          placeholder="Repeat new code"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
        />
        {msg && <div className={msg.err ? 'error-bar' : 'ok-bar'}>{msg.text}</div>}
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Update code'}
        </button>
      </form>
    </div>
  )
}
