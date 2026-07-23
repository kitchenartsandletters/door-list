# door-list worker

Two Railway cron services that keep the door-list Supabase data in sync with Shopify.

- `sync_events.py` — **weekly**. Imports every Shopify product with `product_type == "Event"` as an event in the registry. Parses an `MM-DD-YYYY` product tag as the event date. Past-dated events are auto-archived. Tag `book-bundle` sets `is_bundle=true`.
- `sync_guests.py` — **daily**. For each active event with a linked Shopify product, pulls recent orders and reconciles the guest list. Uses each line item's `currentQuantity`, so refunds and partial refunds land automatically. Cancelled orders are ignored.

Manually-created events (no `shopify_product_id`) and manually-added guests (`source` = `manual` or `door`) are never touched by either script — the door workflow you already use stays untouched.

## Env vars (Railway service variables)

Shared with the sr-ops-suite services:

- `SHOP_URL` — e.g. `castironbooks.myshopify.com`
- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- `SHOPIFY_API_VERSION` (optional, defaults to `2025-10`)

New for this worker:

- `SUPABASE_URL` — same URL the frontend uses
- `SUPABASE_SERVICE_ROLE_KEY` — **not** the anon key. Bypasses RLS so the worker can write. Get it from Supabase Studio → Project settings → API → `service_role` key. Never expose this to the frontend.
- `SYNC_LOOKBACK_DAYS` (optional, defaults to `90`) — how far back the daily job looks for order changes. Bump this if you sell tickets more than three months in advance.

## Railway setup (two cron services in the same project)

For each script, add a new service under the door-list Railway project:

1. **New service** → **Deploy from GitHub repo** → `kitchenartsandletters/door-list`.
2. **Settings → Source → Root directory**: `worker`.
3. **Settings → Deploy → Custom start command**:
   - Events service: `python sync_events.py`
   - Guests service: `python sync_guests.py`
4. **Settings → Deploy → Cron schedule** (Railway cron is UTC):
   - Events service: `0 8 * * 1` — Mondays at 3am EST
   - Guests service: `0 8 * * *` — daily at 3am EST
5. **Variables**: add the env vars above.

Railway auto-detects Python 3.12 from `.python-version` and installs `requirements.txt`.

## Shopify data conventions

For a product to become a door-list event:

- `Product type` must be exactly `Event`.
- Add a tag in the form `MM-DD-YYYY` (e.g. `08-20-2026`). Products without a valid date tag are logged and skipped.
- (Optional) Add the tag `book-bundle` for events where every ticket includes a book.

## Local run (for testing)

```bash
cd worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export SHOP_URL=... SHOPIFY_CLIENT_ID=... SHOPIFY_CLIENT_SECRET=...
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
python sync_events.py
python sync_guests.py
```

Set `LOG_LEVEL=DEBUG` for more detail.
