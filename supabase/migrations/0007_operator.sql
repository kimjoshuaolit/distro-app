-- 0007_operator.sql — Story 3.1
-- The operator's identity tier (AD-5). Kim signs in with a Supabase magic link
-- to an email on the `operators` allow-list (added per environment with
-- `npm run operator:add`, never committed), and may then READ every event and
-- its couple list — through operator-only functions, never an `events` RLS
-- policy (that would open the couple gate; see below). Every event write goes
-- through the `save-event` Edge
-- Function, which asks is_operator() with the caller's JWT and then calls
-- operator_save_event() as service_role (AD-3). No client role writes events,
-- event_couples or operators (0004, 0006, and below).
--
-- One inbox-proof rule for both tiers: inbox_proven_email() is the single
-- place that reads the JWT email + `amr` (see 0004's header for why password
-- and email-change sessions must not count). couple_event_ids() is rebased on
-- it, unchanged in behavior; is_operator() uses it too.

-- ---- Authorized operator emails -------------------------------------------------

create table public.operators (
  email      text primary key
             check (email = lower(btrim(email)) and email <> ''),
  created_at timestamptz not null default now()
);

-- Server-side only: RLS on with no policies, and the default grants removed.
alter table public.operators enable row level security;
revoke all on public.operators from public, anon, authenticated;

-- ---- The shared inbox-proof helper ----------------------------------------------

-- The signed-in email, lowercased and trimmed, but only when the session was
-- opened from an email link (JWT amr otp / magiclink / email/signup / invite /
-- recovery). Anything else — no claims, malformed claims, a password session,
-- an empty email — is NULL, never an error.
create or replace function public.inbox_proven_email()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email    text;
  v_by_email boolean;
begin
  begin
    declare
      v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    begin
      v_email := lower(btrim(v_claims ->> 'email'));
      v_by_email := jsonb_typeof(v_claims -> 'amr') = 'array' and exists (
        select 1 from jsonb_array_elements(v_claims -> 'amr') a
        where jsonb_typeof(a) = 'object'
          and a ->> 'method' in ('otp', 'magiclink', 'email/signup', 'invite', 'recovery')
      );
    end;
  exception when others then
    return null; -- malformed claims setting
  end;
  if v_email is null or v_email = '' or v_by_email is not true then
    return null;
  end if;
  return v_email;
end;
$$;

-- Only the security-definer helpers below call it.
revoke all on function public.inbox_proven_email() from public, anon, authenticated;

-- Same contract as 0004: the event ids the signed-in couple may read.
create or replace function public.couple_event_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.event_id from public.event_couples c where c.email = public.inbox_proven_email();
$$;

revoke all on function public.couple_event_ids() from public, anon, authenticated;
grant execute on function public.couple_event_ids() to authenticated;

-- Is the caller the operator? Callable by any client (anon is simply false),
-- so save-event can ask with the caller's own JWT.
create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.operators o where o.email = public.inbox_proven_email());
$$;

revoke all on function public.is_operator() from public, anon, authenticated;
grant execute on function public.is_operator() to anon, authenticated;

-- ---- Auth hook: couples and operators may get accounts --------------------------

create or replace function public.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if v_email <> '' and (
    exists (select 1 from public.event_couples c where c.email = v_email)
    or exists (select 1 from public.operators o where o.email = v_email)
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This email is not on the list for a reveal.'
    )
  );
end;
$$;

revoke all on function public.before_user_created_hook(jsonb) from public, anon, authenticated;
grant execute on function public.before_user_created_hook(jsonb) to supabase_auth_admin;

-- ---- Event fields -----------------------------------------------------------------

-- "Ana & Ben" — shown in the operator console (3.1). Nullable: older/seeded
-- events may not have one.
alter table public.events
  add column couple_names text
    check (couple_names is null or (couple_names = btrim(couple_names) and char_length(couple_names) between 1 and 80));

-- A window can't close before it opens.
alter table public.events
  add constraint events_window_order
    check (window_open is null or window_close is null or window_close > window_open);

grant select (couple_names) on public.events to authenticated;

-- ---- Operator reads ---------------------------------------------------------------
-- Deliberately NOT an RLS policy on `events`: "this session can read the event
-- row" is the couple gate everywhere (the reveal page, issue-couple-view-urls,
-- issue-montage-url, set-release). An operator policy there would let the
-- operator through all of them — the couple's montage, their collection
-- signing and their release switch. So the operator reads through these
-- functions, which answer only when is_operator(), and `events` RLS stays
-- couple-only.

-- Every event (or one), latest-opening first.
create or replace function public.operator_events(p_event_id uuid default null)
returns table (id uuid, couple_names text, window_open timestamptz, window_close timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.couple_names, e.window_open, e.window_close, e.created_at
  from public.events e
  where public.is_operator() and (p_event_id is null or e.id = p_event_id)
  order by e.window_open desc nulls last, e.created_at desc;
$$;

revoke all on function public.operator_events(uuid) from public, anon, authenticated;
grant execute on function public.operator_events(uuid) to authenticated;

-- The couple list stays locked to clients (0004); the operator reads one
-- event's emails through this function, which returns nothing for anyone else.
create or replace function public.operator_couple_emails(p_event_id uuid)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select c.email from public.event_couples c
  where c.event_id = p_event_id and public.is_operator()
  order by c.created_at, c.email;
$$;

revoke all on function public.operator_couple_emails(uuid) from public, anon, authenticated;
grant execute on function public.operator_couple_emails(uuid) to authenticated;

-- ---- The one write path (called by save-event as service_role) ------------------

-- Create (p_event_id null) or update one event and replace its couple list, in
-- one transaction. Removed emails go first so the max-two trigger never counts
-- an email that is on its way out. Unknown id → no_data_found (P0002). Inputs
-- are validated by save-event; constraints and the trigger backstop them.
create or replace function public.operator_save_event(
  p_event_id     uuid,
  p_couple_names text,
  p_window_open  timestamptz,
  p_window_close timestamptz,
  p_emails       text[]
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_event_id is null then
    insert into public.events (couple_names, window_open, window_close)
    values (p_couple_names, p_window_open, p_window_close)
    returning id into v_id;
  else
    update public.events
      set couple_names = p_couple_names, window_open = p_window_open, window_close = p_window_close
      where id = p_event_id
      returning id into v_id;
    if v_id is null then
      raise exception 'event not found' using errcode = 'no_data_found';
    end if;
  end if;

  delete from public.event_couples
    where event_id = v_id and email <> all (coalesce(p_emails, '{}'));
  insert into public.event_couples (event_id, email)
    select v_id, e from unnest(coalesce(p_emails, '{}')) as e
    on conflict do nothing;

  return v_id;
end;
$$;

revoke all on function public.operator_save_event(uuid, text, timestamptz, timestamptz, text[])
  from public, anon, authenticated;
grant execute on function public.operator_save_event(uuid, text, timestamptz, timestamptz, text[])
  to service_role;
