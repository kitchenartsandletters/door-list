# Door Lists

A lightweight, shared guest check-in tool. One private URL, no login — everyone who opens it sees and updates the same live lists. Build a door list from any Shopify orders export in three steps, run check-in from a phone, and manage every event from one registry.

## The registry

The home screen lists every event as a card with a live checked-in tally, date, and label chips. Tap a card to open its check-in view. Lists can be **archived** (reversible, no code needed) or **deleted** (permanent, requires the 4-digit door code). Build a new list with **+ New list from Shopify CSV**.

## The builder

1. **Upload** — pick a Shopify `orders_export.csv`. Parsing happens entirely in the browser; only guest names and ticket counts are stored. Emails, phones, and order details never leave the device. Cancelled orders are skipped automatically.
2. **Map items** — tick which line items belong to this event. Toggle **Bundle event** if some tickets include a book, then mark which line items are ticket-with-book.
3. **Review & publish** — name the event, set a date, add label chips (press list, comps, …), prune rows, add manual guests, publish.

## The door code

A 4-digit code gates destructive actions: deleting a list and changing the code itself. It is stored as a bcrypt hash in a table with no anon access; verification happens inside `security definer` Postgres functions, so the code never transits readable and UI tampering can't bypass it. Check-ins, archiving, and building lists never prompt for it. Change it under Settings (gear icon). It's a latch, not a vault — the real access control is keeping the URL private.

## How check-in works at the door

- **Search** a name, **tap the row** to check in one ticket. Each ticket is a pip (circle) on the row; tapping fills the next pip.
- Multi-ticket buyers (e.g. 2 or 4 tickets) stay on the guest list until every pip is filled, then the row moves to **Checked in** at the bottom.
- **–** button undoes one check-in (mistakes happen).
- **+ Add guest** handles walk-ups.
- Updates sync live to every open device via Supabase Realtime, and refresh when a phone wakes from sleep.

## Stack

- React 19 + Vite 8 (static build)
- Supabase (Postgres + Realtime), accessed with the publishable/anon key
- Railway for hosting (static build served with `serve`)

## Data model

`public.events` (name, subtitle, date, `is_bundle`, `labels[]`, status) and `public.guests`:

| column     | type | notes                                    |
| ---------- | ---- | ---------------------------------------- |
| name       | text | display name                             |
| qty        | int  | tickets purchased                        |
| checked_in | int  | clamped 0..qty by `adjust_checkin()` RPC |
| source     | text | `order` / `manual` / `door`              |
| event_id   | uuid | FK to events, cascades on delete         |
| includes_book | bool | ticket bundled with a book            |

Check-ins go through the `adjust_checkin(guest_id, delta)` Postgres function so concurrent taps from two devices can never over- or under-count. RLS allows anon select/insert/update but **not delete**; access control is the private URL itself.

Migrations live in `supabase/migrations/` (already applied to the linked project; kept here as the source of truth).

## Local dev

```bash
cp .env.example .env   # fill in your Supabase URL + publishable key
npm install
npm run dev
```

## Deploy to Railway

1. New project → **Deploy from GitHub repo** → select this repo.
2. Add two service variables (Variables tab):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   (Vite inlines these at build time, so redeploy after changing them.)
3. Railway auto-detects Node, runs `npm run build`, then `npm start` (which serves `dist/` on `$PORT`).
4. Generate a domain under Settings → Networking. That URL is the private link to share with door staff.

## Resetting between events

To clear check-ins but keep the list:

```sql
update public.guests set checked_in = 0;
```

To load a new guest list, truncate and re-seed with a new `000X_seed_*.sql`.
