-- Operator tier (Story 3.1, AD-5 / AD-3): an email on `operators`, signed in
-- from an email link, is the operator — it reads every event and (through
-- operator_couple_emails) each couple list; nothing else changes for couples
-- or guests; no client role writes events, event_couples or operators; the
-- one write path, operator_save_event, is service_role-only. The Auth hook
-- admits operators and still refuses strangers. Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(57);

-- ---- Fixtures -------------------------------------------------------------------
insert into public.events (id, window_open, window_close, couple_names)
values
  ('a0a0a0a0-0000-4000-8000-0000000000c1', now() - interval '1 day', now() + interval '1 day', 'Ana & Ben'),
  ('a0a0a0a0-0000-4000-8000-0000000000c2', now() - interval '1 day', now() + interval '1 day', 'Cleo & Dan');
insert into public.event_couples (event_id, email)
values
  ('a0a0a0a0-0000-4000-8000-0000000000c1', 'op.ana@example.test'),
  ('a0a0a0a0-0000-4000-8000-0000000000c1', 'op.ben@example.test'),
  ('a0a0a0a0-0000-4000-8000-0000000000c2', 'op.cleo@example.test');
insert into public.operators (email) values ('op.kim@example.test');
insert into public.guests (id, event_id, first_name, device_token)
values ('a1a1a1a1-0000-4000-8000-000000000001', 'a0a0a0a0-0000-4000-8000-0000000000c1', 'Rosa', 'token-op-rosa');

-- ---- Schema & privileges --------------------------------------------------------
select has_table('public', 'operators', 'operators table exists');
select throws_ok(
  $$insert into public.operators (email) values ('Mixed@Example.test')$$,
  '23514', NULL, 'operator emails must be stored lowercased and trimmed');
select ok(not has_table_privilege('anon', 'public.operators', 'select'), 'anon cannot read operators');
select ok(not has_table_privilege('authenticated', 'public.operators', 'select'), 'authenticated cannot read operators');
select ok(not has_table_privilege('authenticated', 'public.operators', 'insert, update, delete, truncate'),
  'authenticated cannot write operators');
select ok(not has_table_privilege('authenticated', 'public.event_couples', 'select'),
  'event_couples stays unreadable to clients (the operator reads via a function)');
select ok(not has_table_privilege('authenticated', 'public.events', 'insert, update, delete, truncate'),
  'still no client writes on events (0006)');
select ok(has_column_privilege('authenticated', 'public.events', 'couple_names', 'select'),
  'authenticated can read events.couple_names');
select ok(not has_function_privilege('authenticated', 'public.operator_save_event(uuid, text, timestamptz, timestamptz, text[])', 'execute'),
  'authenticated cannot call operator_save_event');
select ok(not has_function_privilege('anon', 'public.operator_save_event(uuid, text, timestamptz, timestamptz, text[])', 'execute'),
  'anon cannot call operator_save_event');
select ok(has_function_privilege('service_role', 'public.operator_save_event(uuid, text, timestamptz, timestamptz, text[])', 'execute'),
  'service_role can call operator_save_event (save-event)');
select ok(not has_function_privilege('authenticated', 'public.inbox_proven_email()', 'execute'),
  'inbox_proven_email is internal');
select throws_ok(
  $$update public.events set window_close = window_open - interval '1 hour' where id = 'a0a0a0a0-0000-4000-8000-0000000000c1'$$,
  '23514', NULL, 'a window cannot close before it opens');
select throws_ok(
  $$update public.events set couple_names = ' padded ' where id = 'a0a0a0a0-0000-4000-8000-0000000000c1'$$,
  '23514', NULL, 'couple_names must be trimmed');

-- ---- The operator (email-link session) ------------------------------------------
set local role authenticated;
set local request.headers = '{}';
set local request.jwt.claims = '{"email":" Op.Kim@Example.TEST ","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';

select ok(public.is_operator(), 'a listed email from an email link is the operator (case/space-insensitive)');
select ok((select count(*) from public.operator_events() where id::text like 'a0a0a0a0-%') = 2,
  'the operator reads every event (operator_events)');
select results_eq(
  $$select couple_names from public.operator_events('a0a0a0a0-0000-4000-8000-0000000000c2')$$,
  $$values ('Cleo & Dan'::text)$$, 'operator_events(id) reads one event');
-- The couple gate (reveal page, issue-couple-view-urls, issue-montage-url,
-- set-release) is "can this session read the event row through RLS". The
-- operator must NOT pass it: no montage, no signing, no release switch.
select is_empty($$select 1 from public.events where id::text like 'a0a0a0a0-%'$$,
  'the operator does not pass the couple gate (no events rows through RLS)');
select throws_ok($$select montage_key from public.events$$, '42501', NULL, 'the operator still cannot read montage_key');
select results_eq(
  $$select * from public.operator_couple_emails('a0a0a0a0-0000-4000-8000-0000000000c1') order by 1$$,
  $$values ('op.ana@example.test'), ('op.ben@example.test')$$,
  'the operator reads an event''s couple emails');
select is_empty($$select id from public.guests where event_id::text like 'a0a0a0a0-%'$$,
  'the operator gets no guest rows in 3.1 (collection access is 3.3/3.4)');
select throws_ok($$select * from public.operators$$, '42501', NULL, 'even the operator cannot read operators');
select throws_ok($$update public.events set released = true$$, '42501', NULL, 'the operator cannot write events directly');
select throws_ok(
  $$insert into public.event_couples (event_id, email) values ('a0a0a0a0-0000-4000-8000-0000000000c2', 'x@example.test')$$,
  '42501', NULL, 'the operator cannot write event_couples directly');
select throws_ok(
  $$select public.operator_save_event(null, 'X', now(), now() + interval '1 hour', '{}')$$,
  '42501', NULL, 'the operator cannot call operator_save_event directly (only save-event can)');

-- The right inbox, but a password session: not the operator (the 2.1 amr rule).
set local request.jwt.claims = '{"email":"op.kim@example.test","role":"authenticated","amr":[{"method":"password","timestamp":1}]}';
select ok(not public.is_operator(), 'a password session for the operator email is not the operator');
select is_empty($$select 1 from public.operator_events()$$, '...and reads no event');
select is_empty($$select * from public.operator_couple_emails('a0a0a0a0-0000-4000-8000-0000000000c1')$$,
  '...and no couple emails');

-- An email change proves only the NEW inbox: not the operator either.
set local request.jwt.claims = '{"email":"op.kim@example.test","role":"authenticated","amr":[{"method":"email_change","timestamp":1}]}';
select ok(not public.is_operator(), 'an email_change session is not the operator');

-- Malformed / missing claims: never an error, never the operator.
set local request.jwt.claims = '{"email":"op.kim@example.test","role":"authenticated","amr":"otp"}';
select ok(not public.is_operator(), 'a non-array amr is not the operator');
set local request.jwt.claims = '{"role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select ok(not public.is_operator(), 'no email claim is not the operator');

-- ---- A couple is unchanged --------------------------------------------------------
set local request.jwt.claims = '{"email":"op.ana@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select ok(not public.is_operator(), 'a couple is not the operator');
select results_eq($$select id::text from public.events where id::text like 'a0a0a0a0-%'$$,
  $$values ('a0a0a0a0-0000-4000-8000-0000000000c1')$$, 'a couple still reads only their own event');
select is_empty($$select * from public.operator_couple_emails('a0a0a0a0-0000-4000-8000-0000000000c1')$$,
  'a couple cannot read the couple list, even their own');
select is_empty($$select 1 from public.operator_events()$$, 'a couple cannot list events through operator_events');
select results_eq($$select public.couple_event_ids()$$, $$values ('a0a0a0a0-0000-4000-8000-0000000000c1'::uuid)$$,
  'couple_event_ids (rebased on inbox_proven_email) still resolves the couple');
set local request.jwt.claims = '{"email":"op.ana@example.test","role":"authenticated","amr":[{"method":"password","timestamp":1}]}';
select is_empty($$select public.couple_event_ids()$$, 'couple_event_ids still refuses a password session');
reset role;

-- ---- Anon ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select ok(not public.is_operator(), 'anon is not the operator (and may ask)');
select throws_ok($$select * from public.operator_couple_emails('a0a0a0a0-0000-4000-8000-0000000000c1')$$,
  '42501', NULL, 'anon cannot call operator_couple_emails');
select throws_ok($$select * from public.operator_events()$$, '42501', NULL, 'anon cannot call operator_events');
reset role;

-- ---- operator_save_event (as save-event's service role) --------------------------
set local role service_role;

-- Create.
select lives_ok(
  $$select set_config('test.new_id', public.operator_save_event(
      null, 'Eve & Finn', '2026-11-14T06:00:00Z', '2026-11-14T18:00:00Z',
      array['eve@example.test', 'finn@example.test'])::text, true)$$,
  'creates an event');
select results_eq(
  $$select couple_names, window_open, window_close, released from public.events where id = current_setting('test.new_id')::uuid$$,
  $$values ('Eve & Finn'::text, '2026-11-14T06:00:00Z'::timestamptz, '2026-11-14T18:00:00Z'::timestamptz, false)$$,
  'the new event has the names and window, and is private');
select results_eq(
  $$select email from public.event_couples where event_id = current_setting('test.new_id')::uuid order by email$$,
  $$values ('eve@example.test'), ('finn@example.test')$$,
  'the new event has its couple emails');

-- Edit: rename, move the window, swap one email (a full event — the old email
-- goes first, so the max-two trigger never counts it).
select is(
  public.operator_save_event(
    current_setting('test.new_id')::uuid, 'Eve & Finnegan', '2026-11-14T07:00:00Z', '2026-11-15T02:00:00Z',
    array['eve@example.test', 'gus@example.test']),
  current_setting('test.new_id')::uuid,
  'editing returns the same id');
select results_eq(
  $$select couple_names, window_open, window_close from public.events where id = current_setting('test.new_id')::uuid$$,
  $$values ('Eve & Finnegan'::text, '2026-11-14T07:00:00Z'::timestamptz, '2026-11-15T02:00:00Z'::timestamptz)$$,
  'the edit updated the names and window');
select results_eq(
  $$select email from public.event_couples where event_id = current_setting('test.new_id')::uuid order by email$$,
  $$values ('eve@example.test'), ('gus@example.test')$$,
  'swapping an email on a full event works (removed first, then added)');

-- Clearing the list.
select lives_ok(
  $$select public.operator_save_event(current_setting('test.new_id')::uuid, 'Eve & Finnegan',
      '2026-11-14T07:00:00Z', '2026-11-15T02:00:00Z', '{}')$$,
  'an edit can remove every couple email');
select is_empty($$select 1 from public.event_couples where event_id = current_setting('test.new_id')::uuid$$,
  '...and the list is empty');

-- Refusals, each leaving the event as it was.
select throws_ok(
  $$select public.operator_save_event('a0a0a0a0-0000-4000-8000-0000000000ff', 'X', now(), now() + interval '1 hour', '{}')$$,
  'P0002', NULL, 'an unknown event id is no_data_found');
select throws_ok(
  $$select public.operator_save_event(current_setting('test.new_id')::uuid, 'X', now(), now() + interval '1 hour',
      array['a@example.test', 'b@example.test', 'c@example.test'])$$,
  '23514', NULL, 'three emails trip the max-two trigger');
select throws_ok(
  $$select public.operator_save_event(current_setting('test.new_id')::uuid, 'X', now(), now() - interval '1 hour', '{}')$$,
  '23514', NULL, 'a backwards window is refused');
select is((select couple_names from public.events where id = current_setting('test.new_id')::uuid), 'Eve & Finnegan',
  'a refused save changed nothing');
reset role;

-- A couple removed by an edit loses access at once.
set local role service_role;
select lives_ok(
  $$select public.operator_save_event('a0a0a0a0-0000-4000-8000-0000000000c1', 'Ana & Ben',
      now() - interval '1 day', now() + interval '1 day', array['op.ana@example.test'])$$,
  'the operator removes Ben''s email');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"email":"op.ben@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select is_empty($$select 1 from public.events where id = 'a0a0a0a0-0000-4000-8000-0000000000c1'$$,
  'the removed partner can no longer read the event');
reset role;

-- ---- The Auth hook ------------------------------------------------------------------
select is(public.before_user_created_hook('{"user":{"email":" Op.Kim@Example.test "}}'::jsonb), '{}'::jsonb,
  'the hook admits an operator email');
select is(public.before_user_created_hook('{"user":{"email":"op.cleo@example.test"}}'::jsonb), '{}'::jsonb,
  'the hook still admits a couple email');
select is((public.before_user_created_hook('{"user":{"email":"stranger@example.test"}}'::jsonb) -> 'error' ->> 'http_code')::int, 403,
  'the hook still refuses a stranger');

select * from finish();
rollback;
