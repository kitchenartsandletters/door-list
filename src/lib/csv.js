import Papa from 'papaparse'

// Parse a Shopify orders export in the browser. Only names + quantities
// ever leave this function — emails, phones, addresses are discarded.
export function parseOrdersCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        try {
          resolve(extractLineItems(res.data))
        } catch (e) {
          reject(e)
        }
      },
      error: reject,
    })
  })
}

function extractLineItems(rows) {
  if (!rows.length || !('Lineitem name' in rows[0])) {
    throw new Error(
      "This doesn't look like a Shopify orders export (no \"Lineitem name\" column)."
    )
  }
  let lastOrder = null
  let lastBuyer = null
  const items = []
  for (const r of rows) {
    const order = (r['Name'] || '').trim()
    if (order && order !== lastOrder) {
      lastOrder = order
      lastBuyer = null
    }
    const buyer = (r['Billing Name'] || '').trim()
    if (buyer) lastBuyer = buyer
    const item = (r['Lineitem name'] || '').trim()
    const qty = parseInt(r['Lineitem quantity'], 10)
    const cancelled = (r['Cancelled at'] || '').trim() !== ''
    if (!item || !qty || qty < 1 || cancelled) continue
    items.push({ buyer: lastBuyer || 'Unknown buyer', item, qty })
  }
  return items
}

// Distinct line items with totals, for the mapping step.
export function distinctItems(items) {
  const map = new Map()
  for (const it of items) {
    const cur = map.get(it.item) || { item: it.item, qty: 0, buyers: new Set() }
    cur.qty += it.qty
    cur.buyers.add(it.buyer)
    map.set(it.item, cur)
  }
  return [...map.values()]
    .map((v) => ({ item: v.item, qty: v.qty, buyers: v.buyers.size }))
    .sort((a, b) => b.qty - a.qty)
}

// Aggregate selected line items into guest rows. Book-bundle tickets are
// kept as separate rows from general tickets for the same buyer, so the
// door person knows exactly how many books to hand over.
export function buildGuestList(items, selectedSet, bookSet) {
  const acc = new Map()
  for (const it of items) {
    if (!selectedSet.has(it.item)) continue
    const isBook = bookSet.has(it.item)
    const key = `${it.buyer}||${isBook ? 'b' : 'g'}`
    const cur = acc.get(key) || { name: it.buyer, qty: 0, includes_book: isBook }
    cur.qty += it.qty
    acc.set(key, cur)
  }
  return [...acc.values()].sort((a, b) => a.name.localeCompare(b.name))
}
