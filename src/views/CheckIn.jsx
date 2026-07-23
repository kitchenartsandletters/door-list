import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabase.js'

const REASON_PRESETS = ['Refund', 'Cancellation', 'No-show', 'Duplicate', 'Entered by mistake']

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
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', qty: 1, includes_book: false })
  const [deleting, setDeleting] = useState(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [showRemoved, setShowRemoved] = useState(false)
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
      setQuery('')
      fetchAll()
    }
  }

  function addWithPrefill(prefilledName) {
    setNewName(prefilledName)
    setNewQty(1)
    setNewBook(false)
    setAdding(true)
  }

  function startEdit(guest) {
    setEditingId(guest.id)
    setEditForm({
      name: guest.name,
      qty: guest.qty,
      includes_book: !!guest.includes_book,
    })
  }

  async function saveEdit(guest) {
    const name = editForm.name.trim() || guest.name
    const qty = clamp(Number(editForm.qty) || 1, 1, 20)
    const patch = { name, qty, includes_book: !!editForm.includes_book }
    if (qty < guest.checked_in) patch.checked_in = qty
    const { error } = await supabase.from('guests').update(patch).eq('id', guest.id)
    if (error) setError(error.message)
    else {
      setEditingId(null)
      fetchAll()
    }
  }

  function askDelete(guest) {
    setEditingId(null)
    setDeleting(guest)
    setDeleteReason('')
  }

  async function confirmDelete() {
    if (!deleting) return
    const reason = deleteReason.trim() || 'Removed'
    const { error } = await supabase
      .from('guests')
      .update({ deleted_at: new Date().toISOString(), deleted_reason: reason })
      .eq('id', deleting.id)
    if (error) setError(error.message)
    else {
      setDeleting(null)
      setDeleteReason('')
      fetchAll()
    }
  }

  async function restore(guest) {
    const { error } = await supabase
      .from('guests')
      .update({ deleted_at: null, deleted_reason: null })
      .eq('id', guest.id)
    if (error) setError(error.message)
    else fetchAll()
  }

  const active = useMemo(() => guests.filter((g) => !g.deleted_at), [guests])
  const removed = useMemo(() => guests.filter((g) => g.deleted_at), [guests])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return active
    return active.filter((g) => g.name.toLowerCase().includes(q))
  }, [active, query])

  const pending = filtered.filter((g) => g.checked_in < g.qty)
  const done = filtered.filter((g) => g.checked_in >= g.qty)
  const pendingBook = pending.filter((g) => g.includes_book)
  const pendingGeneral = pending.filter((g) => !g.includes_book)

  const totalTickets = active.reduce((s, g) => s + g.qty, 0)
  const totalIn = active.reduce((s, g) => s + Math.min(g.checked_in, g.qty), 0)

  if (loading) return <div className="empty">Loading the list…</div>
  if (!event)
    return (
      <div className="empty">
        List not found. <a href="#/">Back to all lists</a>
      </div>
    )

  const rowProps = {
    editingId,
    editForm,
    setEditForm,
    onStartEdit: startEdit,
    onSaveEdit: saveEdit,
    onCancelEdit: () => setEditingId(null),
    onAskDelete: askDelete,
    onAdjust: adjust,
    isBundle: event.is_bundle,
  }

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
                <input type="checkbox" checked={newBook} onChange={(e) => setNewBook(e.target.checked)} />
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
        {pending.length === 0 &&
          (query.trim() ? (
            <div className="empty-add">
              <p className="empty-add-note">No matches for "{query}".</p>
              <button className="btn-primary" onClick={() => addWithPrefill(query.trim())}>
                + Add "{query.trim()}" as guest
              </button>
            </div>
          ) : (
            <div className="empty">Everyone is checked in. Nice work.</div>
          ))}
        {event.is_bundle ? (
          <>
            {pendingBook.length > 0 && (
              <>
                <h3 className="subhead">Ticket + book</h3>
                <Rows guests={pendingBook} {...rowProps} />
              </>
            )}
            {pendingGeneral.length > 0 && (
              <>
                <h3 className="subhead">General admission</h3>
                <Rows guests={pendingGeneral} {...rowProps} />
              </>
            )}
          </>
        ) : (
          <Rows guests={pending} {...rowProps} />
        )}
      </section>

      <section className="done-section">
        <h2 className="section-title">
          Checked in <span className="count-chip chip-done">{done.length}</span>
        </h2>
        {done.length === 0 && <div className="empty">Fulfilled rows land here.</div>}
        <Rows guests={done} {...rowProps} done />
      </section>

      {removed.length > 0 && (
        <section className="removed-section">
          <button
            className="removed-toggle"
            onClick={() => setShowRemoved((v) => !v)}
            aria-expanded={showRemoved}
          >
            <span>
              Removed <span className="count-chip chip-muted">{removed.length}</span>
            </span>
            <span className="chevron">{showRemoved ? '▾' : '▸'}</span>
          </button>
          {showRemoved && (
            <ul className="rows removed-rows">
              {removed.map((g) => (
                <li key={g.id} className="row row-removed">
                  <div className="row-main row-removed-main">
                    <span className="row-name">
                      <s>{g.name}</s>
                      {g.includes_book && <span className="badge-book badge-muted">Book</span>}
                    </span>
                    <span className="removed-reason">{g.deleted_reason}</span>
                    <span className="row-count">×{g.qty}</span>
                  </div>
                  <button className="btn-restore" onClick={() => restore(g)}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {deleting && (
        <div className="modal-overlay" onClick={() => setDeleting(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Remove {deleting.name}?</h3>
            <p className="modal-hint">
              They'll move to the Removed section and can be restored. Why are they being removed?
            </p>
            <div className="reason-chips">
              {REASON_PRESETS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`reason-chip ${deleteReason === r ? 'reason-chip-on' : ''}`}
                  onClick={() => setDeleteReason(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <input
              className="field"
              placeholder="Or type a reason…"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
            />
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button className="btn-primary btn-danger" onClick={confirmDelete}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Rows({ guests, done = false, editingId, ...ctx }) {
  return (
    <ul className="rows">
      {guests.map((g) =>
        editingId === g.id ? (
          <EditRow key={g.id} guest={g} {...ctx} />
        ) : (
          <GuestRow key={g.id} guest={g} done={done} {...ctx} />
        )
      )}
    </ul>
  )
}

function GuestRow({ guest, done, onStartEdit, onAdjust }) {
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
            : `Check in one ticket for ${guest.name}, ${remaining} remaining${
                guest.includes_book ? ', includes book' : ''
              }`
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
      <button
        className="btn-edit"
        onClick={() => onStartEdit(guest)}
        aria-label={`Edit ${guest.name}`}
        title="Edit"
      >
        ✎
      </button>
    </li>
  )
}

function EditRow({ guest, editForm, setEditForm, onSaveEdit, onCancelEdit, onAskDelete, isBundle }) {
  return (
    <li className="row row-editing">
      <div className="edit-panel">
        <input
          className="field"
          value={editForm.name}
          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
          placeholder="Name"
          aria-label="Name"
        />
        <div className="edit-row">
          <span className="edit-label">Tickets</span>
          <div className="stepper">
            <button
              type="button"
              onClick={() => setEditForm({ ...editForm, qty: Math.max(1, editForm.qty - 1) })}
              aria-label="Fewer tickets"
            >
              –
            </button>
            <span className="stepper-value">{editForm.qty}</span>
            <button
              type="button"
              onClick={() => setEditForm({ ...editForm, qty: Math.min(20, editForm.qty + 1) })}
              aria-label="More tickets"
            >
              +
            </button>
          </div>
          {isBundle && (
            <label className="manual-book">
              <input
                type="checkbox"
                checked={editForm.includes_book}
                onChange={(e) => setEditForm({ ...editForm, includes_book: e.target.checked })}
              />
              includes book
            </label>
          )}
        </div>
        {editForm.qty < guest.checked_in && (
          <p className="edit-warning">
            {guest.checked_in} already checked in — saving will lower it to {editForm.qty}.
          </p>
        )}
        <div className="edit-actions">
          <button className="btn-ghost btn-danger-text" onClick={() => onAskDelete(guest)}>
            Remove guest
          </button>
          <span className="spacer" />
          <button className="btn-ghost" onClick={onCancelEdit}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => onSaveEdit(guest)}>
            Save
          </button>
        </div>
      </div>
    </li>
  )
}

function sortByName(list) {
  return [...list].sort((a, b) => a.name.localeCompare(b.name))
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n))
}
