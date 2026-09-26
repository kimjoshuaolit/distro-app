-- Release control (Story 2.4, FR15 / AD-3): `events.released` defaults to
-- private, the couple can read it for their own event only, and no client role
-- (anon, a guest, the couple, another couple, a password session) can write
-- `events` at all. Only service_role (the set-release Edge Function) can.
-- Run with `npm run test:db`. Rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(22);

-- ---- Fixtures: two events, each with its couple -------------------------------
insert into public.events (id, window_open, window_close)
values
  ('f0f0f0f0-0000-4000-8000-0000000000b1', now() - interval '1 day', now() + interval '1 day'),
  ('f0f0f0f0-0000-4000-8000-0000000000b2', now() - interval '1 day', now() + interval '1 day');
insert into public.event_couples (event_id, email)
values
  ('f0f0f0f0-0000-4000-8000-0000000000b1', 'rel.one@example.test'),
  ('f0f0f0f0-0000-4000-8000-0000000000b1', 'rel.two@example.test'),
  ('f0f0f0f0-0000-4000-8000-0000000000b2', 'rel.other@example.test');
insert into public.guests (id, event_id, first_name, device_token)
values ('f1f1f1f1-0000-4000-8000-000000000001', 'f0f0f0f0-0000-4000-8000-0000000000b1', 'Rosa', 'token-rel-rosa');

-- ---- Schema and privileges ------------------------------------------------------
select col_default_is('public', 'events', 'released', 'false', 'released defaults to false (private)');
select col_not_null('public', 'events', 'released', 'released is never null');
select is((select released from public.events where id = 'f0f0f0f0-0000-4000-8000-0000000000b1'), false,
  'a fresh event is private');

select ok(not has_table_privilege('anon', 'public.events', 'update'), 'anon has no UPDATE on events');
select ok(not has_table_privilege('authenticated', 'public.events', 'update'), 'authenticated has no UPDATE on events');
select ok(not has_column_privilege('authenticated', 'public.events', 'released', 'update'),
  'authenticated cannot update events.released specifically');
select ok(not has_table_privilege('anon', 'public.events', 'insert, delete, truncate'),
  'anon has no INSERT/DELETE/TRUNCATE on events');
select ok(not has_table_privilege('authenticated', 'public.events', 'insert, delete, truncate'),
  'authenticated has no INSERT/DELETE/TRUNCATE on events');
select ok(has_column_privilege('authenticated', 'public.events', 'released', 'select'),
  'authenticated can still read events.released (the switch reads it)');
select ok(has_table_privilege('service_role', 'public.events', 'update'),
  'service_role can update events (set-release)');

-- ---- As the couple (email-link session) -----------------------------------------
set local role authenticated;
set local request.headers = '{}';
set local request.jwt.claims = '{"email":"rel.one@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';

select results_eq($$select released from public.events$$, $$values (false)$$,
  'the couple reads released for their own event only');
select throws_ok($$update public.events set released = true where id = 'f0f0f0f0-0000-4000-8000-0000000000b1'$$,
  '42501', NULL, 'the couple cannot set released directly');
select throws_ok($$delete from public.events where id = 'f0f0f0f0-0000-4000-8000-0000000000b1'$$,
  '42501', NULL, 'the couple cannot delete their event');
select throws_ok($$truncate public.events cascade$$, '42501', NULL, 'the couple cannot truncate events');

-- The other partner: same read, same refusal.
set local request.jwt.claims = '{"email":"rel.two@example.test","role":"authenticated","amr":[{"method":"magiclink","timestamp":1}]}';
select results_eq($$select released from public.events$$, $$values (false)$$,
  'the second partner reads the same flag');
select throws_ok($$update public.events set released = true$$, '42501', NULL,
  'the second partner cannot set it directly either');

-- Another couple: only their own event.
set local request.jwt.claims = '{"email":"rel.other@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select is_empty($$select 1 from public.events where id = 'f0f0f0f0-0000-4000-8000-0000000000b1'$$,
  'another couple cannot read this event''s flag');

-- The right inbox, but a password session: nothing (2.1 amr rule).
set local request.jwt.claims = '{"email":"rel.one@example.test","role":"authenticated","amr":[{"method":"password","timestamp":1}]}';
select is_empty($$select released from public.events$$, 'a password session reads no flag');
reset role;

-- ---- As anon (a guest, device token or not) -------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-device-token": "token-rel-rosa"}';
select is_empty($$select released from public.events$$, 'anon (even a guest of the event) reads no flag');
select throws_ok($$update public.events set released = true$$, '42501', NULL, 'anon cannot set released');
reset role;

-- ---- Unchanged by all of the above; the service role can write it ---------------
select is((select released from public.events where id = 'f0f0f0f0-0000-4000-8000-0000000000b1'), false,
  'no client role changed released');

set local role service_role;
update public.events set released = true where id = 'f0f0f0f0-0000-4000-8000-0000000000b1';
select is((select released from public.events where id = 'f0f0f0f0-0000-4000-8000-0000000000b1'), true,
  'service_role (set-release) sets released');
reset role;

select * from finish();
rollback;
