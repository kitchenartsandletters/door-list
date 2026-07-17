import { useMemo, useState } from 'react'
import { supabase } from '../supabase.js'
import { parseOrdersCsv, distinctItems, buildGuestList } from '../lib/csv.js'

export default function Builder() {
  const [step, setStep] = useState(1)
  const [items, setItems] = useState([]) // raw parsed line items
  const [parseErr, setParseErr] = useState(null)
  const [fileName, setFileName] = useState(null)

  // step 2 state
  const [isBundle, setIsBundle] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [bookItems, setBookItems] = useState(new Set())

  // step 3 state
  const [guests, setGuests] = useState([])
  const [name, setName] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [date, setDate] = useState('')
  const [labels, setLabels] = useState([])
  const [labelDraft, setLabelDraft] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualQty, setManualQty] = useState(1)
  const [manualBook, setManualBook] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishErr, setPublishErr] = useState(null)

  const distinct = useMemo(() => distinctItems(items), [items])

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseErr(null)
    try {
      const parsed = await parseOrdersCsv(file)
      if (!parsed.length) throw new Error('No usable line items found in this file.')
      setItems(parsed)
      setFileName(file.name)
      setStep(2)
    } catch (err) {
      setParseErr(err.message || 'Could not read that file.')
    }
  }

  function toggle(set, value, setter) {
    const next = new Set(set)
    next.has(value) ? next.delete(value) : next.add(value)
    setter(next)
  }

  function toReview() {
    const list = buildGuestList(items, selected, isBundle ? bookItems : new Set())
    setGuests(list)
    // Prefill event name from the most common selected line item
    const first = distinct.find((d) => selected.has(d.item))
    if (first && !name) {
      setName(first.item.replace(/^Event:\s*/i, '').split(' - ')[0].trim())
    }
    setStep(3)
  }

  function addManual(e) {
    e.preventDefault()
    const n = manualName.trim()
    if (!n) return
    setGuests((prev) =>
      [...prev, { name: n, qty: Math.max(1, Number(manualQty) || 1), includes_book: isBundle && manualBook, manual: true }].sort(
        (a, b) => a.name.localeCompare(b.name)
      )
    )
    setManualName('')
    setManualQty(1)
    setManualBook(false)
  }

  function addLabel(e) {
    e.preventDefault()
    const l = labelDraft.trim()
    if (l && !labels.includes(l)) setLabels([...labels, l])
    setLabelDraft('')
  }

  async function publish() {
    if (!name.trim() || guests.length === 0) {
      setPublishErr('Give the event a name and at least one guest.')
      return
    }
    setPublishing(true)
    setPublishErr(null)
    const { data: ev, error: evErr } = await supabase
      .from('events')
      .insert({
        name: name.trim(),
        subtitle: subtitle.trim() || null,
        event_date: date || null,
        is_bundle: isBundle,
        labels,
      })
      .select()
      .single()
    if (evErr) {
      setPublishErr(evErr.message)
      setPublishing(false)
      return
    }
    const rows = guests.map((g) => ({
      event_id: ev.id,
      name: g.name,
      qty: g.qty,
      includes_book: !!g.includes_book,
      source: g.manual ? 'manual' : 'order',
    }))
    const { error: gErr } = await supabase.from('guests').insert(rows)
    if (gErr) {
      setPublishErr(gErr.message + ' — the event was created; retry publishing guests or delete it from the registry.')
      setPublishing(false)
      return
    }
    window.location.hash = `#/event/${ev.id}`
  }

  const totalSelected = guests.reduce((s, g) => s + g.qty, 0)

  return (
    <div className="builder">
      <div className="steps" aria-hidden="true">
        {['Upload', 'Map items', 'Review'].map((s, i) => (
          <span key={s} className={`step ${step === i + 1 ? 'step-on' : ''} ${step > i + 1 ? 'step-done' : ''}`}>
            {s}
          </span>
        ))}
      </div>

      {step === 1 && (
        <div className="panel">
          <h2 className="panel-title">Upload a Shopify orders export</h2>
          <p className="panel-note">
            The file is read entirely on this device — only guest names and ticket
            counts are saved. Emails, phones, and order details never leave your browser.
          </p>
          <label className="dropzone">
            <input type="file" accept=".csv,text/csv" onChange={onFile} hidden />
            <span className="dropzone-cta">Choose CSV file</span>
            <span className="dropzone-sub">orders_export.csv from Shopify admin</span>
          </label>
          {parseErr && <div className="error-bar">{parseErr}</div>}
        </div>
      )}

      {step === 2 && (
        <div className="panel">
          <h2 className="panel-title">Which line items belong to this event?</h2>
          <p className="panel-note">Found {distinct.length} distinct items in {fileName}.</p>

          <label className="bundle-toggle">
            <input
              type="checkbox"
              checked={isBundle}
              onChange={(e) => setIsBundle(e.target.checked)}
            />
            <span>
              <b>Bundle event</b> — some tickets include a book
            </span>
          </label>

          <ul className="item-list">
            {distinct.map((d) => {
              const on = selected.has(d.item)
              return (
                <li key={d.item} className={`item-row ${on ? 'item-on' : ''}`}>
                  <label className="item-main">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(selected, d.item, setSelected)}
                    />
                    <span className="item-name">{d.item}</span>
                    <span className="item-qty">
                      {d.qty} × / {d.buyers} buyer{d.buyers === 1 ? '' : 's'}
                    </span>
                  </label>
                  {isBundle && on && (
                    <label className="item-book">
                      <input
                        type="checkbox"
                        checked={bookItems.has(d.item)}
                        onChange={() => toggle(bookItems, d.item, setBookItems)}
                      />
                      <span>includes book</span>
                    </label>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="panel-actions">
            <button className="btn-ghost" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="btn-primary" disabled={selected.size === 0} onClick={toReview}>
              Review list
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="panel">
          <h2 className="panel-title">Review &amp; publish</h2>

          <div className="field-grid">
            <input
              className="field"
              placeholder="Event name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="field"
              placeholder="Subtitle (optional)"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
            />
            <input
              className="field"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Event date"
            />
          </div>

          <div className="labels-editor">
            {labels.map((l) => (
              <button
                key={l}
                type="button"
                className="chip-label chip-x"
                onClick={() => setLabels(labels.filter((x) => x !== l))}
                title="Remove label"
              >
                {l} ×
              </button>
            ))}
            <form className="label-form" onSubmit={addLabel}>
              <input
                className="field field-sm"
                placeholder="Add label (press list, comps…)"
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
              />
            </form>
          </div>

          <p className="panel-note">
            {guests.length} rows · {totalSelected} tickets
            {isBundle &&
              ` · ${guests.filter((g) => g.includes_book).reduce((s, g) => s + g.qty, 0)} with book`}
          </p>

          <ul className="review-list">
            {guests.map((g, i) => (
              <li key={`${g.name}-${g.includes_book}-${i}`} className="review-row">
                <span className="review-name">
                  {g.name}
                  {g.includes_book && <span className="badge-book">Book</span>}
                </span>
                <span className="review-qty">×{g.qty}</span>
                <button
                  className="btn-ghost btn-sm btn-danger-text"
                  onClick={() => setGuests(guests.filter((_, j) => j !== i))}
                  aria-label={`Remove ${g.name}`}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>

          <form className="add-form" onSubmit={addManual}>
            <input
              className="add-name"
              placeholder="Add a name manually"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
            />
            <input
              className="add-qty"
              type="number"
              min="1"
              max="20"
              value={manualQty}
              onChange={(e) => setManualQty(e.target.value)}
              aria-label="Tickets"
            />
            {isBundle && (
              <label className="manual-book">
                <input
                  type="checkbox"
                  checked={manualBook}
                  onChange={(e) => setManualBook(e.target.checked)}
                />
                book
              </label>
            )}
            <button className="btn-save" type="submit">
              Add
            </button>
          </form>

          {publishErr && <div className="error-bar">{publishErr}</div>}

          <div className="panel-actions">
            <button className="btn-ghost" onClick={() => setStep(2)}>
              Back
            </button>
            <button className="btn-primary" disabled={publishing} onClick={publish}>
              {publishing ? 'Publishing…' : 'Publish list'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
