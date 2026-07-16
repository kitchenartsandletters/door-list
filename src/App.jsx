import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, configured } from './supabase.js'

const EVENT_NAME = 'Feeding Our People'
const EVENT_SUB = 'Comfort, Care, and Home Cooking'

export default function App() {
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newQty, setNewQty] = useState(1)
  const channelRef = useRef(null)

  async function fetchGuests() {
    const { data, error } = await supabase
      .from('guests')
      .select('*')
      .order('name', { ascending: true })
    if (error) setError(error.message)
    else {
      setGuests(data)
      setError(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!configured) {
      setLoading(false)
      return
    }
    fetchGuests()

    // Realtime: keep every open device in sync
    channelRef.current = supabase
      .channel('guests-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'guests' },
        (payload) => {
          setGuests((prev) => {
            if (payload.eventType === 'INSERT') {
              if (prev.some((g) => g.id === payload.new.id)) return prev
              return sortByName([...prev, payload.new])
            }
            if (payload.eventType === 'UPDATE') {
              return prev.map((g) => (g.id === payload.new.id ? payload.new : g))
            }
            if (payload.eventType === 'DELETE') {
              return prev.filter((g) => g.id !== payload.old.id)
            }
            return prev
          })
        }
      )
      .subscribe()

    // Refetch when the door person's phone wakes back up
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchGuests()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [])

  async function adjust(guest, delta) {
    // Optimistic update; realtime + RPC result reconcile
    setGuests((prev) =>
      prev.map((g) =>
        g.id === guest.id
          ? { ...g, checked_in: clamp(g.checked_in + delta, 0, g.qty) }
          : g
      )
    )
    const { data, error } = await supabase.rpc('adjust_checkin', {
      guest_id: guest.id,
      delta,
    })
    if (error) {
      setError(error.message)
      fetchGuests() // roll back optimistic state
    } else if (data && data[0]) {
      setGuests((prev) => prev.map((g) => (g.id === data[0].id ? data[0] : g)))
    }
  }

  async function addGuest(e) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    const { error } = await supabase
      .from('guests')
      .insert({ name, qty: clamp(Number(newQty) || 1, 1, 20), source: 'door' })
    if (error) setError(error.message)
    else {
      setNewName('')
      setNewQty(1)
      setAdding(false)
      fetchGuests()
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return guests
    return guests.filter((g) => g.name.toLowerCase().includes(q))
  }, [guests, query])

  const pending = filtered.filter((g) => g.checked_in < g.qty)
  const done = filtered.filter((g) => g.checked_in >= g.qty)

  const totalTickets = guests.reduce((s, g) => s + g.qty, 0)
  const totalIn = guests.reduce((s, g) => s + Math.min(g.checked_in, g.qty), 0)

  if (!configured) {
    return (
      <div className="shell">
        <div className="setup-note">
          <h1>Almost there</h1>
          <p>
            Set <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> in your environment, then
            rebuild. See the README for the two-minute setup.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="shell">
      <header className="masthead">
        <div className="masthead-row">
          <div>
            <h1 className="event-name">{EVENT_NAME}</h1>
            <p className="event-sub">{EVENT_SUB}</p>
          </div>
          <div className="tally" aria-label={`${totalIn} of ${totalTickets} tickets checked in`}>
            <span className="tally-in">{totalIn}</span>
            <span className="tally-sep">/</span>
            <span className="tally-total">{totalTickets}</span>
            <span className="tally-label">in</span>
          </div>
        </div>
        <div className="controls">
          <input
            className="search"
            type="search"
            placeholder="Search names…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
        </div>
        <button className="btn-add" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : '+ Add guest'}
        </button>
        {adding && (
          <form className="add-form" onSubmit={addGuest}>
            <input
              className="add-name"
              placeholder="Full name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            <input
              className="add-qty"
              type="number"
              min="1"
              max="20"
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              aria-label="Number of tickets"
            />
            <button className="btn-save" type="submit">
              Save
            </button>
          </form>
        )}
        {error && <div className="error-bar">{error} — pull to refresh or try again.</div>}
      </header>

      {loading ? (
        <div className="empty">Loading the list…</div>
      ) : (
        <>
          <section>
            <h2 className="section-title">
              Guest list <span className="count-chip">{pending.length}</span>
            </h2>
            {pending.length === 0 && (
              <div className="empty">
                {query
                  ? 'No matching names on the guest list.'
                  : 'Everyone is checked in. Nice work.'}
              </div>
            )}
            <ul className="rows">
              {pending.map((g) => (
                <GuestRow key={g.id} guest={g} onAdjust={adjust} />
              ))}
            </ul>
          </section>

          <section className="done-section">
            <h2 className="section-title">
              Checked in <span className="count-chip chip-done">{done.length}</span>
            </h2>
            {done.length === 0 && (
              <div className="empty">Fulfilled rows land here.</div>
            )}
            <ul className="rows">
              {done.map((g) => (
                <GuestRow key={g.id} guest={g} onAdjust={adjust} done />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

function GuestRow({ guest, onAdjust, done = false }) {
  const remaining = guest.qty - guest.checked_in
  return (
    <li className={`row ${done ? 'row-done' : ''}`}>
      <button
        className="row-main"
        onClick={() => !done && onAdjust(guest, 1)}
        disabled={done}
        aria-label={
          done
            ? `${guest.name}, fully checked in`
            : `Check in one ticket for ${guest.name}, ${remaining} remaining`
        }
      >
        <span className="row-name">{guest.name}</span>
        <span className="pips" aria-hidden="true">
          {Array.from({ length: guest.qty }).map((_, i) => (
            <span
              key={i}
              className={`pip ${i < guest.checked_in ? 'pip-filled' : ''}`}
            />
          ))}
        </span>
        <span className="row-count">
          {guest.checked_in}/{guest.qty}
        </span>
      </button>
      <button
        className="btn-undo"
        onClick={() => onAdjust(guest, -1)}
        disabled={guest.checked_in === 0}
        aria-label={`Undo one check-in for ${guest.name}`}
      >
        –
      </button>
    </li>
  )
}

function sortByName(list) {
  return [...list].sort((a, b) => a.name.localeCompare(b.name))
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n))
}
