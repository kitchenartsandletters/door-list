-- v2: multi-event registry, book bundles, PIN-gated destructive actions
create extension if not exists pgcrypto with schema extensions;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subtitle text,
  event_date date,
  is_bundle boolean not null default false,
  labels text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);

alter table public.events enable row level security;

create policy "anon read events" on public.events
  for select to anon using (true);
create policy "anon insert events" on public.events
  for insert to anon with check (true);
create policy "anon update events" on public.events
  for update to anon using (true) with check (true);
-- No delete policy: deletion only via delete_event() with a valid PIN.

alter table public.guests add column event_id uuid references public.events(id) on delete cascade;
alter table public.guests add column includes_book boolean not null default false;

-- Backfill: adopt the existing v1 list as the first registry event
do $$
declare eid uuid;
begin
  insert into public.events (name, subtitle)
  values ('Feeding Our People', 'Comfort, Care, and Home Cooking')
  returning id into eid;
  update public.guests set event_id = eid where event_id is null;
end $$;

alter table public.guests alter column event_id set not null;

-- PIN storage: hashed, in a table with RLS enabled and NO anon policies,
-- so it is unreadable/unwritable through the API.
create table public.app_settings (
  key text primary key,
  value text not null
);
alter table public.app_settings enable row level security;

insert into public.app_settings (key, value)
values ('pin_hash', extensions.crypt('8305', extensions.gen_salt('bf')));

create or replace function public.verify_pin(pin text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from app_settings
    where key = 'pin_hash' and value = extensions.crypt(pin, value)
  );
$$;
-- Intentionally NOT granted to anon; only callable inside the functions below.

create or replace function public.delete_event(target_event uuid, pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.verify_pin(pin) then
    return false;
  end if;
  delete from public.events where id = target_event; -- guests cascade
  return true;
end $$;

create or replace function public.update_pin(current_pin text, new_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.verify_pin(current_pin) then
    return false;
  end if;
  if new_pin !~ '^\d{4}$' then
    return false;
  end if;
  update public.app_settings
  set value = extensions.crypt(new_pin, extensions.gen_salt('bf'))
  where key = 'pin_hash';
  return true;
end $$;

grant execute on function public.delete_event(uuid, text) to anon;
grant execute on function public.update_pin(text, text) to anon;

alter publication supabase_realtime add table public.events;
