-- 0001_init.sql — Story 1.2
-- events / guests / shots + RLS + the event_status read RPC.

-- gen_random_uuid() lives in pgcrypto (preinstalled on Supabase).
create extension if not exists pgcrypto;

-- One wedding event.
create table public.events (
  id           uuid primary key default gen_random_uuid(),
  couple_owner text,                          -- couple auth email (Epic 2); nullable for now
  window_open  timestamptz,
  window_close timestamptz,
  montage_key  text,                          -- R2 key of the reveal video (Epic 2)
  released     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- One guest per device that joins; holds the server-authoritative allotment.
create table public.guests (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events (id) on delete cascade,
  first_name       text not null,
  device_token     text not null unique,
  photos_remaining int not null default 25,
  clips_remaining  int not null default 5,
  created_at       timestamptz not null default now()
);

-- Capture metadata + R2 key (written from Story 1.5; created now per AC).
create table public.shots (
  id            uuid primary key default gen_random_uuid(),
  guest_id      uuid not null references public.guests (id) on delete cascade,
  type          text not null check (type in ('photo', 'clip')),
  r2_key        text,
  upload_status text not null default 'local' check (upload_status in ('local', 'uploaded')),
  captured_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index guests_event_id_idx on public.guests (event_id);
create index shots_guest_id_idx on public.shots (guest_id);

-- RLS on everywhere, with NO anon policies -> default deny.
-- Privileged writes go through Edge Functions (service role bypasses RLS).
-- Guest own-roll read policies arrive in Story 1.6.
alter table public.events enable row level security;
alter table public.guests enable row level security;
alter table public.shots enable row level security;

-- Advisory, read-only window status for a KNOWN event id.
-- SECURITY DEFINER so anon can call it with no table SELECT policy, and it
-- returns ONLY window status -- never the events row (couple_owner/montage_key stay hidden).
-- Returns zero rows when the id does not exist (client treats empty as "invalid").
create or replace function public.event_status(p_event_id uuid)
returns table (is_open boolean, opens_at timestamptz, closes_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      e.window_open is not null
      and now() >= e.window_open
      and (e.window_close is null or now() <= e.window_close)
    ) as is_open,
    e.window_open as opens_at,
    e.window_close as closes_at
  from public.events e
  where e.id = p_event_id;
$$;

revoke all on function public.event_status(uuid) from public;
grant execute on function public.event_status(uuid) to anon, authenticated;
