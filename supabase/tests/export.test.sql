-- Download all (Story 3.4): operator_export_shots lists one event's uploaded
-- shots for the operator only (no storage keys, keyset-paged);
-- operator_export_keys is service-role only, event-scoped, uploaded-only and
-- capped at 100 ids. Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(20);

-- ---- Fixtures -------------------------------------------------------------------
insert into public.events (id, window_open, window_close, couple_names)
values
  ('e0e0e0e0-0000-4000-8000-0000000000a1', now() - interval '3 hours', now() + interval '3 hours', 'Ana & Ben'),
  ('e0e0e0e0-0000-4000-8000-0000000000a2', now() - interval '3 hours', now() + interval '3 hours', 'Cleo & Dan');
insert into public.event_couples (event_id, email) values ('e0e0e0e0-0000-4000-8000-0000000000a1', 'ex.ana@example.test');
insert into public.operators (email) values ('ex.kim@example.test');
insert into public.guests (id, event_id, first_name, device_token)
values
  ('e1e1e1e1-0000-4000-8000-000000000001', 'e0e0e0e0-0000-4000-8000-0000000000a1', 'Rosa', 'token-ex-rosa'),
  ('e1e1e1e1-0000-4000-8000-000000000002', 'e0e0e0e0-0000-4000-8000-0000000000a2', 'Other', 'token-ex-other');
insert into public.shots (id, guest_id, type, r2_key, upload_status, client_shot_id, created_at, captured_at)
values
  -- event a1: two uploaded photos, one uploaded clip, one still on the way
  ('e2e2e2e2-0000-4000-8000-000000000001', 'e1e1e1e1-0000-4000-8000-000000000001', 'photo', 'events/a1/r/1.jpg', 'uploaded', 'x1', now() - interval '50 minutes', now() - interval '55 minutes'),
  ('e2e2e2e2-0000-4000-8000-000000000002', 'e1e1e1e1-0000-4000-8000-000000000001', 'photo', 'events/a1/r/2.JPG', 'uploaded', 'x2', now() - interval '40 minutes', null),
  ('e2e2e2e2-0000-4000-8000-000000000003', 'e1e1e1e1-0000-4000-8000-000000000001', 'clip', 'events/a1/r/3.mp4', 'uploaded', 'x3', now() - interval '30 minutes', null),
  ('e2e2e2e2-0000-4000-8000-000000000004', 'e1e1e1e1-0000-4000-8000-000000000001', 'photo', 'events/a1/r/4.jpg', 'local', 'x4', now() - interval '5 minutes', null),
  -- event a2
  ('e2e2e2e2-0000-4000-8000-000000000005', 'e1e1e1e1-0000-4000-8000-000000000002', 'photo', 'events/a2/o/5.jpg', 'uploaded', 'x5', now() - interval '5 minutes', null);

-- ---- Privileges -----------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.operator_export_shots(uuid, uuid)', 'execute'),
  'anon cannot list the export');
select ok(has_function_privilege('authenticated', 'public.operator_export_shots(uuid, uuid)', 'execute'),
  'authenticated may call the listing (it answers only for the operator)');
select ok(
  pg_get_function_result('public.operator_export_shots(uuid, uuid)'::regprocedure) !~* '(r2|key|token|email)',
  'the listing returns no storage keys, tokens or emails');
select ok(not has_function_privilege('authenticated', 'public.operator_export_keys(uuid, uuid[])', 'execute'),
  'authenticated cannot read storage keys');
select ok(not has_function_privilege('anon', 'public.operator_export_keys(uuid, uuid[])', 'execute'),
  'anon cannot read storage keys');
select ok(has_function_privilege('service_role', 'public.operator_export_keys(uuid, uuid[])', 'execute'),
  'service_role (issue-export-urls) can read storage keys');

-- ---- Keys (service role) --------------------------------------------------------
select results_eq(
  $$select shot_id, r2_key from public.operator_export_keys('e0e0e0e0-0000-4000-8000-0000000000a1',
      array['e2e2e2e2-0000-4000-8000-000000000001', 'e2e2e2e2-0000-4000-8000-000000000004',
            'e2e2e2e2-0000-4000-8000-000000000005']::uuid[])$$,
  $$values ('e2e2e2e2-0000-4000-8000-000000000001'::uuid, 'events/a1/r/1.jpg'::text)$$,
  'keys only for uploaded shots of the named event (not on-the-way, not another event)');
select is_empty(
  format($$select 1 from public.operator_export_keys('e0e0e0e0-0000-4000-8000-0000000000a1', %L::uuid[])$$,
    (select array_agg(case when i = 1 then 'e2e2e2e2-0000-4000-8000-000000000001'::uuid else gen_random_uuid() end)
       from generate_series(1, 101) i)),
  'more than 100 ids returns nothing');

-- ---- The operator ---------------------------------------------------------------
set local role authenticated;
set local request.headers = '{}';
set local request.jwt.claims = '{"email":"ex.kim@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';

select results_eq(
  $$select shot_id, type, ext from public.operator_export_shots('e0e0e0e0-0000-4000-8000-0000000000a1')$$,
  $$values ('e2e2e2e2-0000-4000-8000-000000000001'::uuid, 'photo'::text, 'jpg'::text),
           ('e2e2e2e2-0000-4000-8000-000000000002'::uuid, 'photo'::text, 'jpg'::text),
           ('e2e2e2e2-0000-4000-8000-000000000003'::uuid, 'clip'::text, 'mp4'::text)$$,
  'uploaded shots of the event, ordered by id, with a lowercased extension');
select ok(
  (select guest_id from public.operator_export_shots('e0e0e0e0-0000-4000-8000-0000000000a1') limit 1)
  = 'e1e1e1e1-0000-4000-8000-000000000001', 'each row names its guest');
select ok(
  (select taken_at from public.operator_export_shots('e0e0e0e0-0000-4000-8000-0000000000a1')
     where shot_id = 'e2e2e2e2-0000-4000-8000-000000000001') = now() - interval '55 minutes',
  'taken_at is the capture time when known');
select ok(
  (select taken_at from public.operator_export_shots('e0e0e0e0-0000-4000-8000-0000000000a1')
     where shot_id = 'e2e2e2e2-0000-4000-8000-000000000002') = now() - interval '40 minutes',
  'taken_at falls back to the reservation time');
select results_eq(
  $$select shot_id from public.operator_export_shots('e0e0e0e0-0000-4000-8000-0000000000a1',
      'e2e2e2e2-0000-4000-8000-000000000001')$$,
  $$values ('e2e2e2e2-0000-4000-8000-000000000002'::uuid), ('e2e2e2e2-0000-4000-8000-000000000003'::uuid)$$,
  'p_after continues after the last id seen (keyset paging)');
select is_empty(
  $$select 1 from public.operator_export_shots('e0e0e0e0-0000-4000-8000-0000000000a1',
      'e2e2e2e2-0000-4000-8000-000000000003')$$,
  'paging past the last shot ends the listing');
select results_eq(
  $$select shot_id from public.operator_export_shots('e0e0e0e0-0000-4000-8000-0000000000a2')$$,
  $$values ('e2e2e2e2-0000-4000-8000-000000000005'::uuid)$$,
  'scoped to the event asked about');
select throws_ok($$select public.operator_export_keys('e0e0e0e0-0000-4000-8000-0000000000a1', array[]::uuid[])$$,
  '42501', NULL, 'the operator cannot read keys directly (only the Edge Function can)');

-- ---- Everyone else gets nothing -------------------------------------------------
set local request.jwt.claims = '{"email":"ex.ana@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select is_empty($$select 1 from public.operator_export_shots('e0e0e0e0-0000-4000-8000-0000000000a1')$$,
  'the couple gets nothing from the export listing');

set local request.jwt.claims = '{"email":"ex.kim@example.test","role":"authenticated","amr":[{"method":"password","timestamp":1}]}';
select is_empty($$select 1 from public.operator_export_shots('e0e0e0e0-0000-4000-8000-0000000000a1')$$,
  'a password session on the operator email gets nothing');

set local request.jwt.claims = '{"role":"authenticated"}';
select is_empty($$select 1 from public.operator_export_shots('e0e0e0e0-0000-4000-8000-0000000000a1')$$,
  'a session without an email gets nothing');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-device-token":"token-ex-rosa"}';
select throws_ok($$select * from public.operator_export_shots('e0e0e0e0-0000-4000-8000-0000000000a1')$$,
  '42501', NULL, 'a guest (anon + device token) cannot call the listing');

select * from finish();
rollback;
