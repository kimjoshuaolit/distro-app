-- Participation (Story 3.3, FR18): operator_participation answers only for the
-- operator — one event's guests, newest joiner first, with saved counts by type,
-- shots on the way and the last shot time — and nothing for couples, password
-- sessions, signed-out callers or guests. It never returns tokens or keys.
-- Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(17);

-- ---- Fixtures -------------------------------------------------------------------
insert into public.events (id, window_open, window_close, couple_names)
values
  ('b0b0b0b0-0000-4000-8000-0000000000e1', now() - interval '3 hours', now() + interval '3 hours', 'Ana & Ben'),
  ('b0b0b0b0-0000-4000-8000-0000000000e2', now() - interval '3 hours', now() + interval '3 hours', 'Cleo & Dan'),
  ('b0b0b0b0-0000-4000-8000-0000000000e3', now() - interval '3 hours', now() + interval '3 hours', 'Eve & Fin');
insert into public.event_couples (event_id, email) values ('b0b0b0b0-0000-4000-8000-0000000000e1', 'pt.ana@example.test');
insert into public.operators (email) values ('pt.kim@example.test');
insert into public.guests (id, event_id, first_name, device_token, created_at)
values
  ('b1b1b1b1-0000-4000-8000-000000000001', 'b0b0b0b0-0000-4000-8000-0000000000e1', 'Rosa', 'token-pt-rosa', now() - interval '2 hours'),
  ('b1b1b1b1-0000-4000-8000-000000000002', 'b0b0b0b0-0000-4000-8000-0000000000e1', 'Sam', 'token-pt-sam1', now() - interval '1 hour'),
  ('b1b1b1b1-0000-4000-8000-000000000003', 'b0b0b0b0-0000-4000-8000-0000000000e1', 'Sam', 'token-pt-sam2', now() - interval '30 minutes'),
  ('b1b1b1b1-0000-4000-8000-000000000004', 'b0b0b0b0-0000-4000-8000-0000000000e2', 'Other', 'token-pt-other', now() - interval '10 minutes');
-- Rosa: 3 photos + 1 clip uploaded, 1 photo + 1 clip still on the way. The
-- newest reservation (c6, 5 min ago) was shot an hour ago while offline.
insert into public.shots (guest_id, type, r2_key, upload_status, client_shot_id, created_at, captured_at)
values
  ('b1b1b1b1-0000-4000-8000-000000000001', 'photo', 'k/1.jpg', 'uploaded', 'c1', now() - interval '100 minutes', null),
  ('b1b1b1b1-0000-4000-8000-000000000001', 'photo', 'k/2.jpg', 'uploaded', 'c2', now() - interval '90 minutes', null),
  ('b1b1b1b1-0000-4000-8000-000000000001', 'photo', 'k/3.jpg', 'uploaded', 'c3', now() - interval '80 minutes', null),
  ('b1b1b1b1-0000-4000-8000-000000000001', 'clip', 'k/4.mp4', 'uploaded', 'c4', now() - interval '70 minutes', null),
  ('b1b1b1b1-0000-4000-8000-000000000001', 'photo', 'k/5.jpg', 'local', 'c5', now() - interval '20 minutes', now() - interval '21 minutes'),
  ('b1b1b1b1-0000-4000-8000-000000000001', 'clip', 'k/6.mp4', 'local', 'c6', now() - interval '5 minutes', now() - interval '60 minutes'),
  ('b1b1b1b1-0000-4000-8000-000000000004', 'photo', 'k/7.jpg', 'uploaded', 'c7', now() - interval '5 minutes', null);

-- ---- Privileges -----------------------------------------------------------------
select has_function('public', 'operator_participation', array['uuid'], 'operator_participation exists');
select ok(not has_function_privilege('anon', 'public.operator_participation(uuid)', 'execute'),
  'anon (guests, signed-out) cannot call operator_participation');
select ok(has_function_privilege('authenticated', 'public.operator_participation(uuid)', 'execute'),
  'authenticated may call it (it answers only for the operator)');
select ok(
  pg_get_function_result('public.operator_participation(uuid)'::regprocedure) !~* '(token|r2_key|shot_id|email)',
  'it returns no device tokens, R2 keys, shot ids or emails');

-- ---- The operator ---------------------------------------------------------------
set local role authenticated;
set local request.headers = '{}';
set local request.jwt.claims = '{"email":"pt.kim@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';

select results_eq(
  $$select first_name, photos_saved, clips_saved, on_the_way
    from public.operator_participation('b0b0b0b0-0000-4000-8000-0000000000e1')$$,
  $$values ('Sam'::text, 0, 0, 0), ('Sam'::text, 0, 0, 0), ('Rosa'::text, 3, 1, 2)$$,
  'one row per guest, newest joiner first, saved by type and on the way');
select results_eq(
  $$select guest_id from public.operator_participation('b0b0b0b0-0000-4000-8000-0000000000e1')$$,
  $$values ('b1b1b1b1-0000-4000-8000-000000000003'::uuid), ('b1b1b1b1-0000-4000-8000-000000000002'::uuid),
           ('b1b1b1b1-0000-4000-8000-000000000001'::uuid)$$,
  'two guests with the same name stay two rows (told apart by join time)');
select ok(
  (select joined_at from public.operator_participation('b0b0b0b0-0000-4000-8000-0000000000e1')
     where guest_id = 'b1b1b1b1-0000-4000-8000-000000000001')
  = now() - interval '2 hours', -- now() is fixed for the transaction (the fixtures used it)
  'joined_at is the guest''s join time');
select ok(
  (select last_shot_at from public.operator_participation('b0b0b0b0-0000-4000-8000-0000000000e1')
     where guest_id = 'b1b1b1b1-0000-4000-8000-000000000001')
  = now() - interval '21 minutes',
  'last_shot_at is when the latest shot was taken (capture time, else reservation), not when it uploaded');
select ok(
  (select last_shot_at is null from public.operator_participation('b0b0b0b0-0000-4000-8000-0000000000e1')
     where guest_id = 'b1b1b1b1-0000-4000-8000-000000000002'),
  'a guest with no shots has no last_shot_at');
select results_eq(
  $$select first_name, photos_saved from public.operator_participation('b0b0b0b0-0000-4000-8000-0000000000e2')$$,
  $$values ('Other'::text, 1)$$,
  'scoped to the one event asked about');
select is_empty(
  $$select 1 from public.operator_participation('b0b0b0b0-0000-4000-8000-0000000000e3')$$,
  'an event nobody has joined yet has no rows');
select is_empty(
  $$select 1 from public.operator_participation('b0b0b0b0-0000-4000-8000-0000000000ff')$$,
  'an unknown event has no rows');
select is_empty($$select 1 from public.guests where event_id::text like 'b0b0b0b0-%'$$,
  'the operator still gets no guest rows through RLS (reads only via the function)');

-- ---- Everyone else gets nothing -------------------------------------------------
set local request.jwt.claims = '{"email":"pt.ana@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select is_empty($$select 1 from public.operator_participation('b0b0b0b0-0000-4000-8000-0000000000e1')$$,
  'the couple gets nothing');

set local request.jwt.claims = '{"email":"pt.kim@example.test","role":"authenticated","amr":[{"method":"password","timestamp":1}]}';
select is_empty($$select 1 from public.operator_participation('b0b0b0b0-0000-4000-8000-0000000000e1')$$,
  'a password session on the operator email gets nothing');

set local request.jwt.claims = '{"role":"authenticated"}';
select is_empty($$select 1 from public.operator_participation('b0b0b0b0-0000-4000-8000-0000000000e1')$$,
  'a session without an email gets nothing');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-device-token":"token-pt-rosa"}';
select throws_ok($$select * from public.operator_participation('b0b0b0b0-0000-4000-8000-0000000000e1')$$,
  '42501', NULL, 'a guest (anon + device token) cannot call it');

select * from finish();
rollback;
