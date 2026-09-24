-- Own-roll RLS (Story 1.6, FR12): an anon request sees only the shots of the
-- guest whose device token is in `x-device-token` — never anyone else's.
-- Run with `npm run test:db`. Self-contained; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(21);

insert into public.events (id, window_open, window_close)
values ('eeeeeeee-0000-4000-8000-0000000000e1', now() - interval '1 hour', now() + interval '1 day');
insert into public.guests (id, event_id, first_name, device_token)
values
  ('a1a1a1a1-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000e1', 'Ana', 'token-ana'),
  ('b2b2b2b2-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-0000000000e1', 'Ben', 'token-ben');
insert into public.shots (guest_id, type, upload_status, client_shot_id, r2_key)
values
  ('a1a1a1a1-0000-4000-8000-000000000001', 'photo', 'uploaded', 'ana-1', 'k/ana-1.jpg'),
  ('a1a1a1a1-0000-4000-8000-000000000001', 'clip',  'local',    'ana-2', 'k/ana-2.mp4'),
  ('b2b2b2b2-0000-4000-8000-000000000002', 'photo', 'uploaded', 'ben-1', 'k/ben-1.jpg');

-- Act as the browser: anon role + request headers, exactly as PostgREST sets them.
set local role anon;

set local request.headers = '{"x-device-token": "token-ana"}';
select is((select count(*)::int from public.shots), 2, 'Ana sees exactly her two shots');
select is((select count(*)::int from public.shots where client_shot_id like 'ben-%'), 0,
  'Ana cannot see Ben''s shot');
select is(public.current_guest_id(), 'a1a1a1a1-0000-4000-8000-000000000001'::uuid,
  'current_guest_id resolves only the caller''s own guest');

set local request.headers = '{"x-device-token": "token-ben"}';
select results_eq('select client_shot_id from public.shots', $$values ('ben-1')$$,
  'Ben sees only his own shot');

set local request.headers = '{"x-device-token": "not-a-real-token"}';
select is((select count(*)::int from public.shots), 0, 'an unknown token sees nothing');

set local request.headers = '{}';
select is((select count(*)::int from public.shots), 0, 'no token header sees nothing');

set local request.headers = '';
select is((select count(*)::int from public.shots), 0, 'an empty headers setting sees nothing (no error)');

set local request.headers = 'this is not json';
select is((select count(*)::int from public.shots), 0, 'a malformed headers setting sees nothing (no error)');

-- Metadata only: even the owner can't read storage keys or internal ids.
set local request.headers = '{"x-device-token": "token-ana"}';
select throws_ok($$select r2_key from public.shots$$, '42501', NULL,
  'guests cannot read the r2_key column, even on their own rows');
select lives_ok($$select client_shot_id, type, upload_status, captured_at from public.shots$$,
  'guests can read the roll metadata columns');

-- A couple signed in on the same phone (Epic 2) is 'authenticated', not anon.
reset role;
set local role authenticated;
set local request.headers = '{"x-device-token": "token-ana"}';
select is((select count(*)::int from public.shots), 2, 'an authenticated session still sees its own guest roll');
reset role;
set local role anon;

-- Guests can't read the guests table (names/tokens) at all. Since 2.1 anon has
-- no column grants there, so the read is refused outright.
set local request.headers = '{"x-device-token": "token-ana"}';
select throws_ok($$select count(*) from public.guests$$, '42501', NULL, 'anon still cannot read guests');

-- Read-only: every write is refused (RLS rejects or silently filters).
select throws_ok(
  $$insert into public.shots (guest_id, type, client_shot_id) values ('a1a1a1a1-0000-4000-8000-000000000001','photo','x')$$,
  NULL, 'anon cannot insert shots');
update public.shots set upload_status = 'uploaded' where client_shot_id = 'ana-2';
delete from public.shots where client_shot_id = 'ana-1';
reset role;
select is((select upload_status from public.shots where client_shot_id = 'ana-2'), 'local',
  'anon update changed nothing');
select is((select count(*)::int from public.shots where client_shot_id = 'ana-1'), 1,
  'anon delete removed nothing');

-- ---- viewable_shot_keys: what issue-view-urls may sign (AD-2) ----------------
select results_eq(
  $$select client_shot_id from public.viewable_shot_keys('token-ana', array['ana-1','ana-2','ben-1','nope'])$$,
  $$values ('ana-1')$$,
  'only the caller''s own UPLOADED shots are viewable (not local, not another guest''s, not unknown)');
select results_eq(
  $$select r2_key from public.viewable_shot_keys('token-ana', array['ana-1'])$$,
  $$values ('k/ana-1.jpg')$$,
  'returns the stored object key for signing');
select is(
  (select count(*)::int from public.viewable_shot_keys('token-ben', array['ana-1'])),
  0, 'another guest cannot get keys for Ana''s shot');
select is(
  (select count(*)::int from public.viewable_shot_keys('not-a-real-token', array['ana-1','ben-1'])),
  0, 'an unknown token gets nothing');
select ok(
  not has_function_privilege('anon', 'public.viewable_shot_keys(text,text[])', 'execute'),
  'anon cannot call viewable_shot_keys directly');
-- The edge function calls it with named arguments; pin those names.
select is(
  (select count(*)::int from public.viewable_shot_keys(
     p_device_token => 'token-ana', p_client_shot_ids => array['ana-1'])),
  1, 'callable with the named parameters issue-view-urls uses');

select * from finish();
rollback;
