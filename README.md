# Door List

A lightweight, shared guest check-in tool for **Feeding Our People: Comfort, Care, and Home Cooking**. One private URL, no login — everyone who opens it sees and updates the same live list.

## How it works at the door

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

Single table `public.guests`:

| column     | type | notes                                     |
| ---------- | ---- | ----------------------------------------- |
| name       | text | display name                              |
| qty        | int  | tickets purchased                         |
| checked_in | int  | clamped 0..qty by `adjust_checkin()` RPC  |
| source     | text | `order` / `manual` / `door`               |

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
