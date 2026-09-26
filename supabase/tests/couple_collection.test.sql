-- Couple collection (Story 2.2, FR14 / AD-2): the couple can address their
-- event's shots by id, and couple_viewable_shot_keys hands the signing function
-- storage keys for uploaded shots of ONE event only. Anon never sees shot ids;
-- no client role can call the key function. Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(31);

-- ---- Fixtures: two events, three guests, five shots ---------------------------
-- coll.both is on both events (a couple can be listed on two reveals).
insert into public.events (id, window_open, window_close)
values
  ('d0d0d0d0-0000-4000-8000-0000000000e1', now() - interval '1 day', now() + interval '1 day'),
  ('d0d0d0d0-0000-4000-8000-0000000000e2', now() - interval '1 day', now() + interval '1 day');
insert into public.event_couples (event_id, email)
values
  ('d0d0d0d0-0000-4000-8000-0000000000e1', 'coll.one@example.test'),
  ('d0d0d0d0-0000-4000-8000-0000000000e1', 'coll.both@example.test'),
  ('d0d0d0d0-0000-4000-8000-0000000000e2', 'coll.two@example.test'),
  ('d0d0d0d0-0000-4000-8000-0000000000e2', 'coll.both@example.test');
insert into public.guests (id, event_id, first_name, device_token)
values
  ('d1d1d1d1-0000-4000-8000-000000000001', 'd0d0d0d0-0000-4000-8000-0000000000e1', 'Rosa', 'token-coll-rosa'),
  ('d2d2d2d2-0000-4000-8000-000000000002', 'd0d0d0d0-0000-4000-8000-0000000000e1', 'Theo', 'token-coll-theo'),
  ('d3d3d3d3-0000-4000-8000-000000000003', 'd0d0d0d0-0000-4000-8000-0000000000e2', 'Uma',  'token-coll-uma');
insert into public.shots (id, guest_id, type, upload_status, client_shot_id, r2_key)
values
  ('5a000000-0000-4000-8000-000000000001', 'd1d1d1d1-0000-4000-8000-000000000001', 'photo', 'uploaded', 'rosa-1', 'k/rosa-1.jpg'),
  ('5a000000-0000-4000-8000-000000000002', 'd1d1d1d1-0000-4000-8000-000000000001', 'clip',  'local',    'rosa-2', 'k/rosa-2.mp4'),
  ('5a000000-0000-4000-8000-000000000003', 'd2d2d2d2-0000-4000-8000-000000000002', 'clip',  'uploaded', 'theo-1', 'k/theo-1.mp4'),
  ('5a000000-0000-4000-8000-000000000004', 'd2d2d2d2-0000-4000-8000-000000000002', 'photo', 'uploaded', 'theo-2', 'k/theo-2.jpg'),
  ('5a000000-0000-4000-8000-000000000005', 'd3d3d3d3-0000-4000-8000-000000000003', 'photo', 'uploaded', 'uma-1',  'k/uma-1.jpg');

-- ---- couple_viewable_shot_keys: what issue-couple-view-urls may sign ----------
select results_eq(
  $$select shot_id::text from public.couple_viewable_shot_keys(
      'd0d0d0d0-0000-4000-8000-0000000000e1', array['5a000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000002',
             '5a000000-0000-4000-8000-000000000003','5a000000-0000-4000-8000-000000000004',
             '5a000000-0000-4000-8000-000000000005','5a000000-0000-4000-8000-0000000000ff']::uuid[]) order by 1$$,
  $$values ('5a000000-0000-4000-8000-000000000001'), ('5a000000-0000-4000-8000-000000000003'),
           ('5a000000-0000-4000-8000-000000000004')$$,
  'only uploaded shots of this event''s guests, among the requested ids');
select results_eq(
  $$select r2_key from public.couple_viewable_shot_keys(
      'd0d0d0d0-0000-4000-8000-0000000000e1', array['5a000000-0000-4000-8000-000000000001']::uuid[])$$,
  $$values ('k/rosa-1.jpg')$$,
  'returns the stored object key for signing');
select is(
  (select count(*)::int from public.couple_viewable_shot_keys(
     'd0d0d0d0-0000-4000-8000-0000000000e2', array['5a000000-0000-4000-8000-000000000001']::uuid[])),
  0, 'another event cannot get keys for this event''s shots');
select is(
  (select count(*)::int from public.couple_viewable_shot_keys(
     'd0d0d0d0-0000-4000-8000-0000000000e9', array['5a000000-0000-4000-8000-000000000005']::uuid[])),
  0, 'an unknown event gets nothing');
select is(
  (select count(*)::int from public.couple_viewable_shot_keys('d0d0d0d0-0000-4000-8000-0000000000e1', '{}'::uuid[])),
  0, 'no ids, no keys');
-- The edge function calls it with named arguments; pin those names.
select is(
  (select count(*)::int from public.couple_viewable_shot_keys(
     p_event_id => 'd0d0d0d0-0000-4000-8000-0000000000e2',
     p_shot_ids => array['5a000000-0000-4000-8000-000000000005']::uuid[])),
  1, 'callable with the named parameters issue-couple-view-urls uses');

-- ---- The 30-id cap (same as the function's request limit) --------------------
select is(
  (select count(*)::int from public.couple_viewable_shot_keys(
     'd0d0d0d0-0000-4000-8000-0000000000e1',
     array['5a000000-0000-4000-8000-000000000001']::uuid[]
       || array(select gen_random_uuid() from generate_series(1, 29)))),
  1, 'exactly 30 ids are served');
select is(
  (select count(*)::int from public.couple_viewable_shot_keys(
     'd0d0d0d0-0000-4000-8000-0000000000e1',
     array['5a000000-0000-4000-8000-000000000001']::uuid[]
       || array(select gen_random_uuid() from generate_series(1, 30)))),
  0, 'more than 30 ids return nothing');

-- ---- A couple listed on two events: keys stay per event -----------------------
-- The function is what scopes keys to the authorized event, so even a couple
-- the EF would admit to both events only gets that event's keys per call.
set local role service_role;
select results_eq(
  $$select shot_id::text from public.couple_viewable_shot_keys(
      'd0d0d0d0-0000-4000-8000-0000000000e1', array['5a000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000002',
             '5a000000-0000-4000-8000-000000000003','5a000000-0000-4000-8000-000000000004',
             '5a000000-0000-4000-8000-000000000005','5a000000-0000-4000-8000-0000000000ff']::uuid[]) order by 1$$,
  $$values ('5a000000-0000-4000-8000-000000000001'), ('5a000000-0000-4000-8000-000000000003'),
           ('5a000000-0000-4000-8000-000000000004')$$,
  'as service_role (security invoker): event 1 ids only, even when event 2 ids are asked for');
select results_eq(
  $$select shot_id::text from public.couple_viewable_shot_keys(
      'd0d0d0d0-0000-4000-8000-0000000000e2', array['5a000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000002',
             '5a000000-0000-4000-8000-000000000003','5a000000-0000-4000-8000-000000000004',
             '5a000000-0000-4000-8000-000000000005','5a000000-0000-4000-8000-0000000000ff']::uuid[])$$,
  $$values ('5a000000-0000-4000-8000-000000000005')$$,
  'as service_role: event 2 ids only, even when event 1 ids are asked for');
reset role;

-- ---- Privileges: signing inputs stay server-side ------------------------------
select ok(has_function_privilege('service_role', 'public.couple_viewable_shot_keys(uuid,uuid[])', 'execute'),
  'service_role can call couple_viewable_shot_keys');
select ok(not has_function_privilege('anon', 'public.couple_viewable_shot_keys(uuid,uuid[])', 'execute'),
  'anon cannot call couple_viewable_shot_keys');
select ok(not has_function_privilege('authenticated', 'public.couple_viewable_shot_keys(uuid,uuid[])', 'execute'),
  'authenticated (the couple) cannot call couple_viewable_shot_keys');
select ok(
  (select not p.prosecdef from pg_proc p where p.oid = 'public.couple_viewable_shot_keys(uuid,uuid[])'::regprocedure),
  'couple_viewable_shot_keys is security invoker');
select ok(has_column_privilege('authenticated', 'public.shots', 'id', 'select'),
  'authenticated can read shots.id');
select ok(not has_column_privilege('anon', 'public.shots', 'id', 'select'),
  'anon cannot read shots.id');
select ok(not has_column_privilege('authenticated', 'public.shots', 'r2_key', 'select'),
  'shots.r2_key stays unreadable to the couple');

-- ---- Integrity: an uploaded shot always has an object key ---------------------
select throws_ok(
  $$insert into public.shots (guest_id, type, upload_status, client_shot_id, r2_key)
    values ('d1d1d1d1-0000-4000-8000-000000000001', 'photo', 'uploaded', 'rosa-9', null)$$,
  '23514', NULL, 'an uploaded shot cannot be inserted without a key');
select throws_ok(
  $$update public.shots set r2_key = null where id = '5a000000-0000-4000-8000-000000000001'$$,
  '23514', NULL, 'an uploaded shot cannot lose its key');
select lives_ok(
  $$insert into public.shots (guest_id, type, upload_status, client_shot_id, r2_key)
    values ('d1d1d1d1-0000-4000-8000-000000000001', 'photo', 'local', 'rosa-8', null)$$,
  'a not-yet-uploaded shot may still have no key');

-- ---- As the browser -----------------------------------------------------------
set local role authenticated;
set local request.headers = '{}';
set local request.jwt.claims = '{"email":"coll.one@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';

select results_eq(
  $$select id::text from public.shots where upload_status = 'uploaded' order by 1$$,
  $$values ('5a000000-0000-4000-8000-000000000001'), ('5a000000-0000-4000-8000-000000000003'),
           ('5a000000-0000-4000-8000-000000000004')$$,
  'the couple reads their event''s uploaded shot ids');
select lives_ok($$select id, guest_id, type, captured_at from public.shots$$,
  'the couple can read the collection columns');
select throws_ok(
  $$select * from public.couple_viewable_shot_keys('d0d0d0d0-0000-4000-8000-0000000000e1', array['5a000000-0000-4000-8000-000000000001']::uuid[])$$,
  '42501', NULL, 'the couple cannot fetch storage keys directly');

-- Same inbox, but not a session opened from an email link (2.1): nothing.
set local request.jwt.claims = '{"email":"coll.one@example.test","role":"authenticated","amr":[{"method":"password","timestamp":1}]}';
select is_empty($$select id from public.shots$$, 'a password session reads no shot rows (not even ids)');
select is_empty($$select id from public.guests$$, 'a password session reads no guests');
set local request.jwt.claims = '{"email":"coll.one@example.test","role":"authenticated"}';
select is_empty($$select id from public.shots$$, 'a session without amr reads no shot rows (not even ids)');
set local request.jwt.claims = '{"email":"coll.one@example.test","role":"authenticated","amr":[]}';
select is_empty($$select id from public.shots$$, 'a session with an empty amr reads no shot rows');

set local request.jwt.claims = '{"email":"coll.two@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select results_eq($$select id::text from public.shots$$, $$values ('5a000000-0000-4000-8000-000000000005')$$,
  'event 2''s couple reads only event 2''s shot ids');

set local request.jwt.claims = '{"email":"coll.both@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select is(
  (select count(*)::int from public.shots where upload_status = 'uploaded'),
  4, 'a couple on two events reads both events'' shots through RLS');
select throws_ok(
  $$select * from public.couple_viewable_shot_keys('d0d0d0d0-0000-4000-8000-0000000000e2', array['5a000000-0000-4000-8000-000000000005']::uuid[])$$,
  '42501', NULL, '...but still cannot fetch storage keys directly');
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-device-token": "token-coll-rosa"}';
select throws_ok($$select id from public.shots$$, '42501', NULL,
  'a guest (anon) still cannot read shot ids, even on their own roll');
reset role;

select * from finish();
rollback;
