import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import PinModal from '../components/PinModal.jsx'

export default function Registry() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deleting, setDeleting] = useState(null) // event pending PIN confirm

  async function fetchEvents() {
    const { data, error } = await supabase
      .from('events')
      .select('*, guests(qty, checked_in)')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else {
      setEvents(data)
      setError(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchEvents()
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchEvents()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  async function setStatus(ev, status) {
    const { error } = await supabase.from('events').update({ status }).eq('id', ev.id)
    if (error) setError(error.message)
    else fetchEvents()
  }

  async function confirmDelete(pin) {
    const { data, error } = await supabase.rpc('delete_event', {
      target_event: deleting.id,
      pin,
    })
    if (error) {
      setError(error.message)
      return false
    }
    if (data === true) {
      setDeleting(null)
      fetchEvents()
      return true
    }
    return false
  }

  const active = events.filter((e) => e.status === 'active')
  const archived = events.filter((e) => e.status === 'archived')

  return (
    <>
      <div className="registry-actions">
        <a className="btn-primary btn-wide" href="#/new">
          + New list from Shopify CSV
        </a>
      </div>

      {error && <div className="error-bar">{error}</div>}
      {loading && <div className="empty">Loading events…</div>}

      {!loading && active.length === 0 && (
        <div className="empty">No active lists yet. Build one from a CSV export.</div>
      )}

      <div className="cards">
        {active.map((ev) => (
          <EventCard
            key={ev.id}
            ev={ev}
            onArchive={() => setStatus(ev, 'archived')}
            onDelete={() => setDeleting(ev)}
          />
        ))}
      </div>

      {archived.length > 0 && (
        <>
          <h2 className="section-title archived-title">Archived</h2>
          <div className="cards">
            {archived.map((ev) => (
              <EventCard
                key={ev.id}
                ev={ev}
                archived
                onRestore={() => setStatus(ev, 'active')}
                onDelete={() => setDeleting(ev)}
              />
            ))}
          </div>
        </>
      )}

      {deleting && (
        <PinModal
          title={`Delete “${deleting.name}”?`}
          hint="This permanently removes the list and all its check-ins. Enter the 4-digit code to confirm."
          onSubmit={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  )
}

function EventCard({ ev, archived = false, onArchive, onRestore, onDelete }) {
  const totalTickets = ev.guests.reduce((s, g) => s + g.qty, 0)
  const totalIn = ev.guests.reduce((s, g) => s + Math.min(g.checked_in, g.qty), 0)

  return (
    <div className={`card ${archived ? 'card-archived' : ''}`}>
      <a className="card-body" href={`#/event/${ev.id}`}>
        <div className="card-top">
          <h3 className="card-name">{ev.name}</h3>
          <span className="card-tally">
            <b>{totalIn}</b>/{totalTickets}
          </span>
        </div>
        {ev.subtitle && <p className="card-sub">{ev.subtitle}</p>}
        <div className="card-meta">
          {ev.event_date && (
            <span className="chip-label chip-date">
              {new Date(ev.event_date + 'T00:00:00').toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          )}
          {ev.is_bundle && <span className="chip-label chip-book">Ticket + Book</span>}
          {ev.labels.map((l) => (
            <span key={l} className="chip-label">
              {l}
            </span>
          ))}
        </div>
      </a>
      <div className="card-actions">
        {archived ? (
          <button className="btn-ghost btn-sm" onClick={onRestore}>
            Restore
          </button>
        ) : (
          <button className="btn-ghost btn-sm" onClick={onArchive}>
            Archive
          </button>
        )}
        <button className="btn-ghost btn-sm btn-danger-text" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}
