-- 0003_own_roll.sql — Story 1.6
-- A guest can read their own roll, and only their own roll, through real RLS.
-- Guests have no Supabase auth session (AD-5): the client sends its opaque
-- device token as the `x-device-token` request header, which PostgREST exposes
-- to SQL as `request.headers`. The token is a 64-hex secret, so it works as a
-- bearer credential scoped to one guest.

-- The guest id for the calling request's device token, or NULL.
-- SECURITY DEFINER because `guests` has no anon policy (deny-by-default); it
-- returns only the id belonging to the token the caller already holds, so it
-- can't be used to discover anyone else. Absent, empty or malformed header
-- settings all yield NULL rather than an error.
create or replace function public.current_guest_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token text;
  v_id    uuid;
begin
  begin
    v_token := nullif(
      coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json ->> 'x-device-token',
      ''
    );
  exception when others then
    return null; -- malformed headers setting
  end;
  if v_token is null then
    return null;
  end if;
  select g.id into v_id from public.guests g where g.device_token = v_token;
  return v_id;
end;
$$;

-- Policy evaluation runs as the caller, so the request roles need execute.
-- A couple signed in on the same phone (Epic 2) is 'authenticated', not anon,
-- and must still see their own guest roll.
revoke all on function public.current_guest_id() from public;
grant execute on function public.current_guest_id() to anon, authenticated;

-- Object keys the guest may view: their own shots, only once uploaded. The
-- issue-view-urls function signs GET URLs for exactly these (AD-2). Anything
-- not owned, not uploaded, or unknown simply isn't returned.
create or replace function public.viewable_shot_keys(
  p_device_token     text,
  p_client_shot_ids  text[]
)
returns table (client_shot_id text, r2_key text)
language sql
stable
security definer
set search_path = public
as $$
  select s.client_shot_id, s.r2_key
  from public.shots s
  join public.guests g on g.id = s.guest_id
  where g.device_token = p_device_token
    and s.upload_status = 'uploaded'
    and s.r2_key is not null
    and s.client_shot_id = any (p_client_shot_ids);
$$;

revoke all on function public.viewable_shot_keys(text, text[]) from public, anon, authenticated;
grant execute on function public.viewable_shot_keys(text, text[]) to service_role;

-- Guests read metadata only: RLS limits rows, column grants limit columns, so
-- storage keys and internal ids stay server-side even for the owner.
revoke select on public.shots from anon, authenticated;
grant select (client_shot_id, type, upload_status, captured_at) on public.shots to anon, authenticated;

-- Read-only own-roll policy. No insert/update/delete policies: all writes stay
-- in the service-role Edge Functions (AD-3). `(select …)` makes Postgres
-- evaluate the token lookup once per statement, not once per row.
create policy shots_own_roll_select
  on public.shots
  for select
  to anon, authenticated
  using (guest_id = (select public.current_guest_id()));
