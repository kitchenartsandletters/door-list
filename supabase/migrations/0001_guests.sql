-- Guest check-in table + atomic check-in function + realtime
create table public.guests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  qty integer not null default 1 check (qty > 0),
  checked_in integer not null default 0 check (checked_in >= 0 and checked_in <= qty),
  source text not null default 'order', -- 'order' | 'manual' | 'door'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.guests enable row level security;

-- Access is gated by the private app URL, not auth: anon may read/write, never delete.
create policy "anon can read guests" on public.guests
  for select to anon using (true);
create policy "anon can add guests" on public.guests
  for insert to anon with check (true);
create policy "anon can update guests" on public.guests
  for update to anon using (true) with check (true);

-- Atomic, clamped increment/decrement so two doors can't over-check a row
create or replace function public.adjust_checkin(guest_id uuid, delta integer)
returns setof public.guests
language sql
security invoker
set search_path = public
as $$
  update public.guests
  set checked_in = greatest(0, least(qty, checked_in + delta)),
      updated_at = now()
  where id = guest_id
  returning *;
$$;

grant execute on function public.adjust_checkin(uuid, integer) to anon;

-- Broadcast row changes to all connected devices
alter publication supabase_realtime add table public.guests;
