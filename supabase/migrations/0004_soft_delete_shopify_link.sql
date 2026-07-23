-- v2.1: soft-delete on guests + Shopify product linkage on events
alter table public.guests add column deleted_at timestamptz;
alter table public.guests add column deleted_reason text;

alter table public.events add column shopify_product_id text unique;

-- Helpful indexes for the check-in and sync paths
create index if not exists guests_event_active_idx
  on public.guests (event_id) where deleted_at is null;
create index if not exists events_shopify_product_idx
  on public.events (shopify_product_id) where shopify_product_id is not null;
