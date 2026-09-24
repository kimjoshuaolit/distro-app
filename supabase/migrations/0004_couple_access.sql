-- 0004_couple_access.sql — Story 2.1
-- The couple's identity tier (AD-5). Up to two partner inboxes per event sign
-- in with a Supabase magic link; RLS then lets them READ their own event's
-- events/guests/shots rows and nothing else. Every rule here lives in the
-- database (AD-3) — the client is never trusted to decide who is the couple.
--
-- Two locks (see spec 2.1 design notes):
--   1. couple_can_sign_in() lets the reveal page say "not on the list" before
--      sending anything (advisory UX; reveals only whether an address is this
--      event's couple).
--   2. before_user_created_hook() is the real gate: Auth refuses to create an
--      account for any email that isn't some event's couple, so a bypassed
--      client still can't mint one.
-- A third, quieter rule: couple access requires a session that proved control
-- of the inbox — JWT `amr` method otp / magiclink / email/signup / invite /
-- recovery (GoTrue v2.196 labels both magic links and first-time signup
-- confirmations `otp`; the others are its names for the remaining email-link
-- flows). Password sign-up stays enabled in Supabase Auth, so a password
-- session for a listed address must see nothing even once confirmed (`amr`
-- `password`), as must `email_change` (proves the NEW inbox only). GoTrue also
-- stores a random password hash for magic-link users, so auth.users can't tell
-- the two apart. Auth config pairs this with `enable_confirmations = true` +
-- `double_confirm_changes`, so an email change or password sign-up can't make
-- the JWT carry another couple's address without that inbox (FR13).

-- ---- Authorized couple emails ------------------------------------------------

create table public.event_couples (
  event_id   uuid not null references public.events (id) on delete cascade,
  email      text not null
             check (email = lower(btrim(email)) and email <> ''),
  created_at timestamptz not null default now(),
  primary key (event_id, email)
);

-- Lookups by email (couple_event_ids, the hook) don't lead with event_id.
create index event_couples_email_idx on public.event_couples (email);

-- Operator-managed (Epic 3). No client role may read or write it: RLS on with
-- no policies, and the default Supabase grants removed as well.
alter table public.event_couples enable row level security;
revoke all on public.event_couples from public, anon, authenticated;

-- One inbox per partner: at most two emails per event. The event row lock
-- serializes concurrent writes for the same event. Not counted: the row being
-- updated (its old values), and an identical (event_id, email) pair — BEFORE
-- triggers fire ahead of ON CONFLICT, so re-inserting an existing pair must
-- stay a no-op (or a plain unique violation), not a "too many" error.
create or replace function public.event_couples_max_two()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform 1 from public.events where id = new.event_id for update;
  if (
    select count(*) from public.event_couples c
    where c.event_id = new.event_id
      and c.email <> new.email
      and (tg_op <> 'UPDATE' or (c.event_id, c.email) <> (old.event_id, old.email))
  ) >= 2 then
    raise exception 'an event can have at most two couple emails'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.event_couples_max_two() from public, anon, authenticated;

create trigger event_couples_max_two
  before insert or update of event_id, email on public.event_couples
  for each row execute function public.event_couples_max_two();

-- Carry over the single owner email from Epic 1, then retire the column.
insert into public.event_couples (event_id, email)
select e.id, lower(btrim(e.couple_owner))
from public.events e
where e.couple_owner is not null and btrim(e.couple_owner) <> ''
on conflict do nothing;

alter table public.events drop column couple_owner;

-- ---- Helpers -----------------------------------------------------------------

-- The event ids the signed-in couple may read. The email comes from the
-- verified JWT (PostgREST's `request.jwt.claims`), compared lowercased and
-- trimmed, and the session must have been opened from an email link (see top).
-- Missing, empty or malformed claims yield no rows, never an error.
create or replace function public.couple_event_ids()
returns setof uuid
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
    return; -- malformed claims setting
  end;
  if v_email is null or v_email = '' or v_by_email is not true then
    return;
  end if;
  return query
    select c.event_id from public.event_couples c where c.email = v_email;
end;
$$;

-- Only a signed-in session evaluates couple policies.
revoke all on function public.couple_event_ids() from public, anon, authenticated;
grant execute on function public.couple_event_ids() to authenticated;

-- Advisory check behind the plain "that email isn't on the list" message.
-- Answers only yes/no for one (event, email) pair; malformed input is "no".
create or replace function public.couple_can_sign_in(p_event_id uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.event_couples c
    where c.event_id = p_event_id
      and c.email = lower(btrim(coalesce(p_email, '')))
  );
$$;

revoke all on function public.couple_can_sign_in(uuid, text) from public, anon, authenticated;
grant execute on function public.couple_can_sign_in(uuid, text) to anon, authenticated;

-- Supabase Auth "before user created" hook: allow only emails that are some
-- event's couple. `{}` allows; an `error` object refuses with that status.
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
  if v_email <> '' and exists (select 1 from public.event_couples c where c.email = v_email) then
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

-- Auth calls the hook as supabase_auth_admin; nobody else may.
grant usage on schema public to supabase_auth_admin;
revoke all on function public.before_user_created_hook(jsonb) from public, anon, authenticated;
grant execute on function public.before_user_created_hook(jsonb) to supabase_auth_admin;

-- ---- Column grants -----------------------------------------------------------
-- RLS limits rows; column grants limit what any client role can ever see.

-- events: never the montage storage key (signed URLs only, AD-2).
revoke select on public.events from anon, authenticated;
grant select (id, window_open, window_close, released, created_at)
  on public.events to anon, authenticated;

-- guests: names for attribution, never the device token or allotments. Guests
-- themselves (anon) have no business reading this table at all.
revoke select on public.guests from anon, authenticated;
grant select (id, event_id, first_name, created_at) on public.guests to authenticated;

-- shots: guest_id added so My Roll can pin its read to its own guest even when
-- a couple session in the same browser can see the whole event.
grant select (guest_id) on public.shots to anon, authenticated;

-- ---- Couple read policies (read-only; release is Story 2.4) ------------------
-- Permissive, so they OR with shots_own_roll_select. `(select …)` evaluates the
-- helper once per statement.

create policy events_couple_select
  on public.events
  for select
  to authenticated
  using (id in (select public.couple_event_ids()));

create policy guests_couple_select
  on public.guests
  for select
  to authenticated
  using (event_id in (select public.couple_event_ids()));

create policy shots_couple_select
  on public.shots
  for select
  to authenticated
  using (
    guest_id in (
      select g.id from public.guests g
      where g.event_id in (select public.couple_event_ids())
    )
  );
