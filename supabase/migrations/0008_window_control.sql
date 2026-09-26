-- 0008_window_control.sql — Story 3.2
-- The operator opens and closes the camera window with one tap (set-window
-- Edge Function → operator_set_window, service_role only), and uploads now
-- have an end: 7 days after the window closes, reserve_shot refuses NEW
-- reservations ('upload_closed'). Until then, shots taken during the party but
-- stuck on a phone (weak venue wifi; uploads only run while the page is open)
-- still land (NFR1). An already-reserved shot ('exists') can always finish,
-- and an event with no close time never refuses.

-- ---- reserve_shot, with the upload cutoff ---------------------------------------
-- Same contract as 0002, plus:
--   status = 'upload_closed' -> the event closed more than 7 days ago
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
  v_close    timestamptz;
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

  -- Idempotent replay: this shot was already reserved (it may always finish).
  select * into v_existing from public.shots
    where guest_id = v_guest.id and client_shot_id = p_client_shot_id;
  if found then
    return query select 'exists', v_existing.id, v_existing.r2_key,
      v_guest.photos_remaining, v_guest.clips_remaining;
    return;
  end if;

  -- The upload cutoff: no new reservations 7 days after the window closed.
  select e.window_close into v_close from public.events e where e.id = v_guest.event_id;
  if v_close is not null and now() > v_close + interval '7 days' then
    return query select 'upload_closed', null::uuid, null::text,
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

-- Unchanged privileges: the issue-upload-url function (service_role) only.
revoke all on function public.reserve_shot(text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.reserve_shot(text, text, text, timestamptz, text) to service_role;

-- ---- Open now / Close now (called by set-window as service_role) ---------------
-- The window stays the single source of truth; these just move its ends to the
-- database's now():
--   'close' -> close = now(); an unset or not-yet-reached open moves to now() - 1 minute
--   'open'  -> open  = now(); an unset or already-past close moves to now() + 12 hours
-- Both are safe to repeat (a double tap, a stale second tab): closing an
-- already-closed event keeps its real close time (so the 7-day upload grace
-- isn't quietly extended), and opening an already-open event keeps its open.
-- Unknown id -> no_data_found (P0002). Bad action -> invalid_parameter_value (22023).
create or replace function public.operator_set_window(p_event_id uuid, p_action text)
returns table (window_open timestamptz, window_close timestamptz)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  v_now timestamptz := now();
begin
  if p_action = 'close' then
    update public.events e
      set window_close = case
            when e.window_close is not null and e.window_close <= v_now then e.window_close -- already closed
            else v_now
          end,
          window_open = case
            when e.window_close is not null and e.window_close <= v_now then e.window_open
            when e.window_open is null or e.window_open >= v_now then v_now - interval '1 minute'
            else e.window_open
          end
      where e.id = p_event_id;
  elsif p_action = 'open' then
    update public.events e
      set window_open = case
            when e.window_open is not null and e.window_open <= v_now
                 and (e.window_close is null or e.window_close > v_now) then e.window_open -- already open
            else v_now
          end,
          window_close = case
            when e.window_close is null or e.window_close <= v_now then v_now + interval '12 hours'
            else e.window_close
          end
      where e.id = p_event_id;
  else
    raise exception 'unknown window action' using errcode = 'invalid_parameter_value';
  end if;
  if not found then
    raise exception 'event not found' using errcode = 'no_data_found';
  end if;
  return query select e.window_open, e.window_close from public.events e where e.id = p_event_id;
end;
$$;

revoke all on function public.operator_set_window(uuid, text) from public, anon, authenticated;
grant execute on function public.operator_set_window(uuid, text) to service_role;
