-- Couple access (Story 2.1, FR13 / AD-5): a couple signed in from an email link
-- reads every roll of THEIR event and nothing else; anon and strangers read
-- nothing; the Auth hook refuses accounts for unlisted emails; guest My Roll
-- privacy (1.6) is unchanged. Run with `npm run test:db`. Rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(80);

-- ---- Fixtures: two events, two couples, three guests, four shots ------------
insert into public.events (id, window_open, window_close)
values
  ('c0c0c0c0-0000-4000-8000-0000000000e1', now() - interval '1 day', now() + interval '1 day'),
  ('c0c0c0c0-0000-4000-8000-0000000000e2', now() - interval '1 day', now() + interval '1 day');
insert into public.event_couples (event_id, email)
values
  ('c0c0c0c0-0000-4000-8000-0000000000e1', 'ana.partner@example.test'),
  ('c0c0c0c0-0000-4000-8000-0000000000e1', 'ben.partner@example.test'),
  ('c0c0c0c0-0000-4000-8000-0000000000e2', 'other@example.test');
insert into public.guests (id, event_id, first_name, device_token)
values
  ('c1c1c1c1-0000-4000-8000-000000000001', 'c0c0c0c0-0000-4000-8000-0000000000e1', 'Rosa', 'token-rosa'),
  ('c2c2c2c2-0000-4000-8000-000000000002', 'c0c0c0c0-0000-4000-8000-0000000000e1', 'Theo', 'token-theo'),
  ('c3c3c3c3-0000-4000-8000-000000000003', 'c0c0c0c0-0000-4000-8000-0000000000e2', 'Uma',  'token-uma');
insert into public.shots (guest_id, type, upload_status, client_shot_id, r2_key)
values
  ('c1c1c1c1-0000-4000-8000-000000000001', 'photo', 'uploaded', 'rosa-1', 'k/rosa-1.jpg'),
  ('c1c1c1c1-0000-4000-8000-000000000001', 'clip',  'local',    'rosa-2', 'k/rosa-2.mp4'),
  ('c2c2c2c2-0000-4000-8000-000000000002', 'photo', 'uploaded', 'theo-1', 'k/theo-1.jpg'),
  ('c3c3c3c3-0000-4000-8000-000000000003', 'photo', 'uploaded', 'uma-1',  'k/uma-1.jpg');

-- ---- Schema ------------------------------------------------------------------
select hasnt_column('public', 'events', 'couple_owner', 'events.couple_owner is gone (moved to event_couples)');
select throws_ok(
  $$insert into public.event_couples (event_id, email) values ('c0c0c0c0-0000-4000-8000-0000000000e1', 'third@example.test')$$,
  '23514', NULL, 'an event cannot have a third couple email');
select throws_ok(
  $$insert into public.event_couples (event_id, email) values ('c0c0c0c0-0000-4000-8000-0000000000e2', 'Mixed@Example.test')$$,
  '23514', NULL, 'couple emails must be stored lowercased and trimmed');
select throws_ok(
  $$update public.event_couples set event_id = 'c0c0c0c0-0000-4000-8000-0000000000e1' where email = 'other@example.test'$$,
  '23514', NULL, 'an update cannot move a third email onto a full event');
select lives_ok(
  $$insert into public.event_couples (event_id, email) values ('c0c0c0c0-0000-4000-8000-0000000000e1', 'ana.partner@example.test') on conflict do nothing$$,
  're-inserting an existing pair on a full event is a no-op under on conflict do nothing');
select throws_ok(
  $$insert into public.event_couples (event_id, email) values ('c0c0c0c0-0000-4000-8000-0000000000e1', 'ana.partner@example.test')$$,
  '23505', NULL, '...and a plain unique violation without it (not "too many")');
select lives_ok(
  $$update public.event_couples set email = 'ana.renamed@example.test' where email = 'ana.partner@example.test'$$,
  'a full event can still change one of its own emails (the row itself is not counted)');
update public.event_couples set email = 'ana.partner@example.test' where email = 'ana.renamed@example.test';
select results_eq(
  $$select event_id::text, email from public.event_couples where event_id::text like 'c0c0c0c0-%' order by event_id, email$$,
  $$values ('c0c0c0c0-0000-4000-8000-0000000000e1', 'ana.partner@example.test'),
           ('c0c0c0c0-0000-4000-8000-0000000000e1', 'ben.partner@example.test'),
           ('c0c0c0c0-0000-4000-8000-0000000000e2', 'other@example.test')$$,
  'couple fixtures unchanged after the trigger checks');

-- ---- Signed in from an email link: their event only --------------------------
set local role authenticated;
set local request.headers = '{}'; -- no guest token: couple access alone
-- Case and whitespace in the JWT email don't matter.
set local request.jwt.claims = '{"email":" Ana.Partner@Example.TEST ","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';

select results_eq('select id from public.events', $$values ('c0c0c0c0-0000-4000-8000-0000000000e1'::uuid)$$,
  'couple sees their own event row only');
select results_eq('select first_name from public.guests order by first_name', $$values ('Rosa'), ('Theo')$$,
  'couple sees every guest of their event, by first name');
select results_eq('select client_shot_id from public.shots order by client_shot_id',
  $$values ('rosa-1'), ('rosa-2'), ('theo-1')$$,
  'couple sees every shot of their event');
select is((select count(*)::int from public.guests where event_id = 'c0c0c0c0-0000-4000-8000-0000000000e2'), 0,
  'couple cannot see another event''s guests');
select is((select count(*)::int from public.shots where client_shot_id = 'uma-1'), 0,
  'couple cannot see another event''s shots');
select results_eq('select public.couple_event_ids()', $$values ('c0c0c0c0-0000-4000-8000-0000000000e1'::uuid)$$,
  'couple_event_ids resolves the JWT email to its event');
select lives_ok($$select id, window_open, window_close, released, created_at from public.events$$,
  'couple can read the event''s public columns');
select lives_ok($$select id, event_id, first_name, created_at from public.guests$$,
  'couple can read guest names for attribution');

-- Column denial: secrets stay server-side even for the couple.
select throws_ok($$select device_token from public.guests$$, '42501', NULL, 'couple cannot read guests.device_token');
select throws_ok($$select photos_remaining from public.guests$$, '42501', NULL, 'couple cannot read guest allotments');
select throws_ok($$select montage_key from public.events$$, '42501', NULL, 'couple cannot read events.montage_key');
select throws_ok($$select r2_key from public.shots$$, '42501', NULL, 'couple cannot read shots.r2_key');
select throws_ok($$select * from public.event_couples$$, '42501', NULL, 'couple cannot read event_couples');

-- Read-only: couple writes are refused or silently filtered (release is 2.4).
select lives_ok(
  $$update public.events set released = true where id = 'c0c0c0c0-0000-4000-8000-0000000000e1'$$,
  'couple update of events runs but is filtered by RLS (no update policy)');
select is((select released from public.events where id = 'c0c0c0c0-0000-4000-8000-0000000000e1'), false,
  '...and released is unchanged');
select lives_ok($$delete from public.shots where client_shot_id = 'rosa-1'$$,
  'couple delete of shots runs but is filtered by RLS (no delete policy)');
select is((select count(*)::int from public.shots where client_shot_id = 'rosa-1'), 1,
  '...and the shot is still there');
select throws_ok(
  $$insert into public.event_couples (event_id, email) values ('c0c0c0c0-0000-4000-8000-0000000000e2', 'x@example.test')$$,
  '42501', NULL, 'couple cannot add couple emails');

-- The other partner of the same event gets the same view.
set local request.jwt.claims = '{"email":"ben.partner@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select is((select count(*)::int from public.shots), 3, 'the second partner sees the same event');

-- The other event's couple sees only theirs (cross-event isolation).
set local request.headers = '{}';
set local request.jwt.claims = '{"email":"other@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select results_eq('select id from public.events', $$values ('c0c0c0c0-0000-4000-8000-0000000000e2'::uuid)$$,
  'event 2''s couple sees only event 2');
select results_eq('select first_name from public.guests', $$values ('Uma')$$,
  'event 2''s couple sees only event 2''s guests');
select results_eq('select client_shot_id from public.shots', $$values ('uma-1')$$,
  'event 2''s couple sees only event 2''s shots');

-- ---- Sessions that are not an email-link couple see nothing ------------------
set local request.headers = '{}';
-- A password session for a listed address (Auth allows password sign-up).
set local request.jwt.claims = '{"email":"ana.partner@example.test","role":"authenticated","amr":[{"method":"password","timestamp":1}]}';
select is((select count(*)::int from public.events), 0, 'a password session for a listed email sees no events');
select is((select count(*)::int from public.guests), 0, 'a password session sees no guests');
select is((select count(*)::int from public.shots), 0, 'a password session sees no shots');

set local request.jwt.claims = '{"email":"ana.partner@example.test","role":"authenticated"}';
select is((select count(*)::int from public.events), 0, 'a session without amr sees nothing');

set local request.jwt.claims = '{"email":"stranger@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select is((select count(*)::int from public.events), 0, 'an unlisted email sees no events');
select is((select count(*)::int from public.guests), 0, 'an unlisted email sees no guests');
select is((select count(*)::int from public.shots), 0, 'an unlisted email sees no shots');

set local request.jwt.claims = '';
select is((select count(*)::int from public.events), 0, 'empty claims see nothing (no error)');
set local request.jwt.claims = 'this is not json';
select is((select count(*)::int from public.guests), 0, 'malformed claims see nothing (no error)');

-- ---- Guest roll unaffected by a couple session (1.6 / AC 3) ------------------
-- A couple who is also guest Rosa on the same phone: the event's rows are
-- visible, and My Roll's guest_id filter narrows them to Rosa's own.
set local request.jwt.claims = '{"email":"ana.partner@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
set local request.headers = '{"x-device-token": "token-rosa"}';
select results_eq(
  $$select client_shot_id from public.shots where guest_id = 'c1c1c1c1-0000-4000-8000-000000000001' order by 1$$,
  $$values ('rosa-1'), ('rosa-2')$$,
  'couple + guest: filtering by own guest_id yields only the guest''s shots');
-- Event 2's couple who is guest Rosa on event 1 sees their own roll, nothing more of event 1.
set local request.jwt.claims = '{"email":"other@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select results_eq(
  $$select client_shot_id from public.shots where guest_id = 'c1c1c1c1-0000-4000-8000-000000000001' order by 1$$,
  $$values ('rosa-1'), ('rosa-2')$$,
  'another event''s couple who is a guest here still sees their own roll');
select is((select count(*)::int from public.shots where client_shot_id = 'theo-1'), 0,
  '...and not the other guests of that event');
set local request.headers = '{}';
reset role;

-- ---- amr: only methods that prove control of the inbox ----------------------
-- couple_event_ids() is SECURITY DEFINER, so the caller's role doesn't matter
-- here; RLS wiring is covered above. One listed email, varying amr.
create function pg_temp.events_for_amr(p_amr text) returns int language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"email":"ana.partner@example.test","role":"authenticated"' || coalesce(',"amr":' || p_amr, '') || '}',
    true);
  return (select count(*)::int from public.couple_event_ids());
end $f$;

select is(pg_temp.events_for_amr('[{"method":"otp","timestamp":1}]'), 1, 'amr otp (magic link / first-sign-in confirmation) is allowed');
select is(pg_temp.events_for_amr('[{"method":"magiclink","timestamp":1}]'), 1, 'amr magiclink is allowed');
select is(pg_temp.events_for_amr('[{"method":"email/signup","timestamp":1}]'), 1, 'amr email/signup is allowed');
select is(pg_temp.events_for_amr('[{"method":"invite","timestamp":1}]'), 1, 'amr invite is allowed');
select is(pg_temp.events_for_amr('[{"method":"recovery","timestamp":1}]'), 1, 'amr recovery is allowed');
select is(pg_temp.events_for_amr('[{"method":"totp","timestamp":2},{"method":"otp","timestamp":1}]'), 1,
  'an email-link session that later stepped up with MFA is allowed');

select is(pg_temp.events_for_amr('[{"method":"password","timestamp":1}]'), 0, 'amr password is refused');
select is(pg_temp.events_for_amr('[{"method":"email_change","timestamp":1}]'), 0, 'amr email_change is refused');
select is(pg_temp.events_for_amr('[{"method":"oauth","timestamp":1}]'), 0, 'amr oauth is refused');
select is(pg_temp.events_for_amr('[{"method":"sso/saml","timestamp":1}]'), 0, 'amr sso/saml is refused');
select is(pg_temp.events_for_amr('[{"method":"anonymous","timestamp":1}]'), 0, 'amr anonymous is refused');
select is(pg_temp.events_for_amr('[{"method":"token_refresh","timestamp":1}]'), 0, 'amr token_refresh is refused');
select is(pg_temp.events_for_amr('[{"method":"totp","timestamp":2},{"method":"password","timestamp":1}]'), 0,
  'password + MFA is still refused');
select is(pg_temp.events_for_amr('[{"method":"OTP","timestamp":1}]'), 0, 'method names are matched exactly');

select is(pg_temp.events_for_amr(null), 0, 'amr missing is refused');
select is(pg_temp.events_for_amr('[]'), 0, 'amr empty array is refused');
select is(pg_temp.events_for_amr('{"method":"otp"}'), 0, 'amr as an object (not an array) is refused');
select is(pg_temp.events_for_amr('"otp"'), 0, 'amr as a string is refused');
select is(pg_temp.events_for_amr('["otp"]'), 0, 'amr as an array of strings is refused');
select is(pg_temp.events_for_amr('null'), 0, 'amr null is refused');

-- ---- Anon: nothing ------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{}';
select is((select count(*)::int from public.events), 0, 'anon reads zero events');
select is((select count(*)::int from public.shots), 0, 'anon without a device token reads zero shots');
select throws_ok($$select first_name from public.guests$$, '42501', NULL, 'anon cannot read guests at all');
select throws_ok($$select montage_key from public.events$$, '42501', NULL, 'anon cannot read events.montage_key');
select throws_ok($$select * from public.event_couples$$, '42501', NULL, 'anon cannot read event_couples');

-- A guest (anon + token) can pin My Roll to their own guest id.
set local request.headers = '{"x-device-token": "token-rosa"}';
select is((select count(*)::int from public.shots where guest_id = 'c1c1c1c1-0000-4000-8000-000000000001'), 2,
  'a guest can filter their own roll by guest_id');

-- The advisory "on the list" check.
select ok(public.couple_can_sign_in('c0c0c0c0-0000-4000-8000-0000000000e1', '  Ana.Partner@EXAMPLE.test '),
  'couple_can_sign_in: listed email, any case/whitespace');
select ok(not public.couple_can_sign_in('c0c0c0c0-0000-4000-8000-0000000000e2', 'ana.partner@example.test'),
  'couple_can_sign_in: listed for another event is not on this list');
select ok(not public.couple_can_sign_in('c0c0c0c0-0000-4000-8000-0000000000e1', 'stranger@example.test'),
  'couple_can_sign_in: unlisted email');
select ok(not public.couple_can_sign_in('c0c0c0c0-0000-4000-8000-0000000000e1', null),
  'couple_can_sign_in: null email is no');
reset role;

-- ---- Auth hook: refuse accounts for unlisted emails ---------------------------
select is(public.before_user_created_hook('{"user":{"email":"Ben.Partner@example.test"}}'::jsonb), '{}'::jsonb,
  'hook allows a listed email (any case)');
select is(
  public.before_user_created_hook('{"user":{"email":"stranger@example.test"}}'::jsonb) -> 'error' ->> 'http_code',
  '403', 'hook refuses an unlisted email with 403');
select is(
  public.before_user_created_hook('{"user":{"phone":"+15550100"}}'::jsonb) -> 'error' ->> 'http_code',
  '403', 'hook refuses a user without an email');

-- ---- Privileges ---------------------------------------------------------------
select ok(has_function_privilege('supabase_auth_admin', 'public.before_user_created_hook(jsonb)', 'execute'),
  'Auth (supabase_auth_admin) can run the hook');
select ok(not has_function_privilege('anon', 'public.before_user_created_hook(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.before_user_created_hook(jsonb)', 'execute'),
  'clients cannot call the hook');
select ok(not has_function_privilege('anon', 'public.couple_event_ids()', 'execute'),
  'anon cannot call couple_event_ids');
select ok(has_function_privilege('anon', 'public.couple_can_sign_in(uuid,text)', 'execute'),
  'anon can call couple_can_sign_in');
select ok(not has_column_privilege('anon', 'public.guests', 'device_token', 'select')
  and not has_column_privilege('authenticated', 'public.guests', 'device_token', 'select'),
  'no client role can read guests.device_token');

select * from finish();
rollback;
