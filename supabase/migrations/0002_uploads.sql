-- 0002_uploads.sql — Story 1.5
-- Idempotent, server-authoritative shot reservation for the upload pipeline.
-- The client never decrements its own allotment: reserve_shot is the single
-- trusted path that checks the cap (AD-4) and mints the R2 object key (AD-2).

-- Ties a shots row to the client's local IndexedDB shot id so a retried upload
-- (weak wifi, double-tap) reserves at most once. Nullable + unique: Postgres
-- treats NULLs as distinct, so legacy/never-reserved rows don't collide.
alter table public.shots add column client_shot_id text;
create unique index shots_guest_client_idx
  on public.shots (guest_id, client_shot_id);

-- Atomically reserve one shot of a type for the guest owning p_device_token.
-- SECURITY DEFINER + service_role-only: called only by the issue-upload-url
-- Edge Function, never by anon/authenticated clients.
--   status = 'reserved'        -> new row created, allotment decremented once
--          | 'exists'          -> same client_shot_id already reserved (no-op)
--          | 'cap_reached'     -> no remaining allotment for this type
--          | 'guest_not_found' -> unknown device token
--          | 'bad_type'        -> p_type not in (photo, clip)
create or replace function public.reserve_shot(
  p_device_token   text,
  p_type           text,
  p_client_shot_id text,
  p_captured_at    timestamptz,
  p_ext            text
)
returns table (
  status           text,
  shot_id          uuid,
  r2_key           text,
  photos_remaining int,
  clips_remaining  int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest    public.guests%rowtype;
  v_existing public.shots%rowtype;
  v_shot_id  uuid;
  v_key      text;
begin
  if p_type not in ('photo', 'clip') then
    return query select 'bad_type', null::uuid, null::text, null::int, null::int;
    return;
  end if;

  -- Serialize concurrent reservations for this device on the guest row.
  select * into v_guest from public.guests where device_token = p_device_token for update;
  if not found then
    return query select 'guest_not_found', null::uuid, null::text, null::int, null::int;
    return;
  end if;

  -- Idempotent replay: this shot was already reserved.
  select * into v_existing from public.shots
    where guest_id = v_guest.id and client_shot_id = p_client_shot_id;
  if found then
    return query select 'exists', v_existing.id, v_existing.r2_key,
      v_guest.photos_remaining, v_guest.clips_remaining;
    return;
  end if;

  if (p_type = 'photo' and v_guest.photos_remaining <= 0)
     or (p_type = 'clip' and v_guest.clips_remaining <= 0) then
    return query select 'cap_reached', null::uuid, null::text,
      v_guest.photos_remaining, v_guest.clips_remaining;
    return;
  end if;

  v_shot_id := gen_random_uuid();
  v_key := 'events/' || v_guest.event_id || '/' || v_guest.id || '/' || v_shot_id || '.' || p_ext;

  insert into public.shots (id, guest_id, type, r2_key, upload_status, captured_at, client_shot_id)
    values (v_shot_id, v_guest.id, p_type, v_key, 'local', p_captured_at, p_client_shot_id);

  -- Decrement under the row lock. Compute in-memory then write the absolute
  -- value: qualifying the RHS with v_guest avoids the RETURNS TABLE columns
  -- (photos_remaining/clips_remaining) shadowing the table columns.
  if p_type = 'photo' then
    v_guest.photos_remaining := v_guest.photos_remaining - 1;
    update public.guests set photos_remaining = v_guest.photos_remaining where id = v_guest.id;
  else
    v_guest.clips_remaining := v_guest.clips_remaining - 1;
    update public.guests set clips_remaining = v_guest.clips_remaining where id = v_guest.id;
  end if;

  return query select 'reserved', v_shot_id, v_key,
    v_guest.photos_remaining, v_guest.clips_remaining;
end;
$$;

-- Flip a reserved shot to 'uploaded' for the guest owning p_device_token.
-- Idempotent. The confirm-upload function HEAD-checks the object first; this
-- only records the result, and reports whether anything actually matched.
--   'confirmed' | 'shot_not_found' | 'guest_not_found'
create or replace function public.confirm_shot(
  p_device_token   text,
  p_client_shot_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest_id uuid;
begin
  select id into v_guest_id from public.guests where device_token = p_device_token;
  if not found then
    return 'guest_not_found';
  end if;

  update public.shots set upload_status = 'uploaded'
    where guest_id = v_guest_id and client_shot_id = p_client_shot_id;
  if not found then
    return 'shot_not_found';
  end if;

  return 'confirmed';
end;
$$;

revoke all on function public.confirm_shot(text, text) from public, anon, authenticated;
grant execute on function public.confirm_shot(text, text) to service_role;

-- Lock down to service_role only. Supabase auto-grants execute on new public
-- functions to anon/authenticated, so revoke those explicitly (not just PUBLIC):
-- this privileged reserve/decrement path is reachable only via the Edge Function.
revoke all on function public.reserve_shot(text, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.reserve_shot(text, text, text, timestamptz, text) to service_role;
