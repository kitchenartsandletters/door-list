import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabase.js'

export default function CheckIn({ eventId }) {
  const [event, setEvent] = useState(null)
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newQty, setNewQty] = useState(1)
  const [newBook, setNewBook] = useState(false)
  const channelRef = useRef(null)

  async function fetchAll() {
    const [evRes, gRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).single(),
      supabase.from('guests').select('*').eq('event_id', eventId).order('name'),
    ])
    if (evRes.error) setError(evRes.error.message)
    else setEvent(evRes.data)
    if (gRes.error) setError(gRes.error.message)
    else setGuests(gRes.data)
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()
    channelRef.current = supabase
      .channel(`guests-${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'guests', filter: `event_id=eq.${eventId}` },
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

    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchAll()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [eventId])

  async function adjust(guest, delta) {
    setGuests((prev) =>
      prev.map((g) =>
        g.id === guest.id ? { ...g, checked_in: clamp(g.checked_in + delta, 0, g.qty) } : g
      )
    )
    const { data, error } = await supabase.rpc('adjust_checkin', {
      guest_id: guest.id,
      delta,
    })
    if (error) {
      setError(error.message)
      fetchAll()
    } else if (data && data[0]) {
      setGuests((prev) => prev.map((g) => (g.id === data[0].id ? data[0] : g)))
    }
  }

  async function addGuest(e) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    const { error } = await supabase.from('guests').insert({
      event_id: eventId,
      name,
      qty: clamp(Number(newQty) || 1, 1, 20),
      includes_book: !!(event?.is_bundle && newBook),
      source: 'door',
    })
    if (error) setError(error.message)
    else {
      setNewName('')
      setNewQty(1)
      setNewBook(false)
      setAdding(false)
      fetchAll()
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return guests
    return guests.filter((g) => g.name.toLowerCase().includes(q))
  }, [guests, query])

  const pending = filtered.filter((g) => g.checked_in < g.qty)
  const done = filtered.filter((g) => g.checked_in >= g.qty)
  const pendingBook = pending.filter((g) => g.includes_book)
  const pendingGeneral = pending.filter((g) => !g.includes_book)

  const totalTickets = guests.reduce((s, g) => s + g.qty, 0)
  const totalIn = guests.reduce((s, g) => s + Math.min(g.checked_in, g.qty), 0)

  if (loading) return <div className="empty">Loading the list…</div>
  if (!event) return <div className="empty">List not found. <a href="#/">Back to all lists</a></div>

  return (
    <>
      <div className="masthead">
      <div className="masthead-row">
        <div>
          <h1 className="event-name">{event.name}</h1>
          {event.subtitle && <p className="event-sub">{event.subtitle}</p>}
          {(event.labels.length > 0 || event.is_bundle) && (
            <div className="card-meta header-meta">
              {event.is_bundle && <span className="chip-label chip-book">Ticket + Book</span>}
              {event.labels.map((l) => (
                <span key={l} className="chip-label">
                  {l}
                </span>
              ))}
            </div>
          )}
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
          {event.is_bundle && (
            <label className="manual-book">
              <input
                type="checkbox"
                checked={newBook}
                onChange={(e) => setNewBook(e.target.checked)}
              />
              book
            </label>
          )}
          <button className="btn-save" type="submit">
            Save
          </button>
        </form>
      )}
      {error && <div className="error-bar">{error} — pull to refresh or try again.</div>}
      </div>

      <section>
        <h2 className="section-title">
          Guest list <span className="count-chip">{pending.length}</span>
        </h2>
        {pending.length === 0 && (
          <div className="empty">
            {query ? 'No matching names on the guest list.' : 'Everyone is checked in. Nice work.'}
          </div>
        )}
        {event.is_bundle ? (
          <>
            {pendingBook.length > 0 && (
              <>
                <h3 className="subhead">Ticket + book</h3>
                <Rows guests={pendingBook} onAdjust={adjust} />
              </>
            )}
            {pendingGeneral.length > 0 && (
              <>
                <h3 className="subhead">General admission</h3>
                <Rows guests={pendingGeneral} onAdjust={adjust} />
              </>
            )}
          </>
        ) : (
          <Rows guests={pending} onAdjust={adjust} />
        )}
      </section>

      <section className="done-section">
        <h2 className="section-title">
          Checked in <span className="count-chip chip-done">{done.length}</span>
        </h2>
        {done.length === 0 && <div className="empty">Fulfilled rows land here.</div>}
        <Rows guests={done} onAdjust={adjust} done />
      </section>
    </>
  )
}

function Rows({ guests, onAdjust, done = false }) {
  return (
    <ul className="rows">
      {guests.map((g) => (
        <GuestRow key={g.id} guest={g} onAdjust={onAdjust} done={done} />
      ))}
    </ul>
  )
}

function GuestRow({ guest, onAdjust, done = false }) {
  const remaining = guest.qty - guest.checked_in
  return (
    <li className={`row ${done ? 'row-done' : ''}`}>
      <button
        className={`row-main ${guest.includes_book ? 'row-book' : ''}`}
        onClick={() => !done && onAdjust(guest, 1)}
        disabled={done}
        aria-label={
          done
            ? `${guest.name}, fully checked in`
            : `Check in one ticket for ${guest.name}, ${remaining} remaining${guest.includes_book ? ', includes book' : ''}`
        }
      >
        <span className="row-name">
          {guest.name}
          {guest.includes_book && <span className="badge-book">Book</span>}
        </span>
        <span className="pips" aria-hidden="true">
          {Array.from({ length: guest.qty }).map((_, i) => (
            <span key={i} className={`pip ${i < guest.checked_in ? 'pip-filled' : ''}`} />
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
