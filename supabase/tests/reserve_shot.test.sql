-- reserve_shot / confirm_shot: server-authoritative, idempotent allotment and
-- upload confirmation (Story 1.5, AD-4). Run with `npm run test:db`.
-- Self-contained (creates its own event + guests); everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(23);

insert into public.events (id, window_open, window_close)
values ('eeeeeeee-0000-4000-8000-00000000eeee', now() - interval '1 hour', now() + interval '1 day');
insert into public.guests (id, event_id, first_name, device_token, photos_remaining, clips_remaining)
values
  ('aaaaaaaa-0000-4000-8000-00000000aaaa', 'eeeeeeee-0000-4000-8000-00000000eeee', 'Tap', 'tap-dev', 1, 1),
  ('bbbbbbbb-0000-4000-8000-00000000bbbb', 'eeeeeeee-0000-4000-8000-00000000eeee', 'Other', 'other-dev', 1, 1);

-- ---- photo reservation, isolation, idempotent replay -----------------------
create temp table first_res as
  select * from public.reserve_shot('tap-dev', 'photo', '11111111-1111-4111-8111-111111111111', now(), 'jpg');
select is((select status from first_res), 'reserved', 'first photo reservation succeeds');
select is((select photos_remaining from public.guests where device_token = 'tap-dev'), 0,
  'photo reservation decrements photos once');
select is((select clips_remaining from public.guests where device_token = 'tap-dev'), 1,
  'photo reservation leaves clips untouched');

create temp table replay_res as
  select * from public.reserve_shot('tap-dev', 'photo', '11111111-1111-4111-8111-111111111111', now(), 'jpg');
select is((select status from replay_res), 'exists', 'replaying the same client_shot_id is idempotent');
select ok(
  (select r.shot_id = f.shot_id and r.r2_key = f.r2_key and r.r2_key is not null
     from replay_res r, first_res f),
  'replay returns the original shot id and object key');
select is((select photos_remaining from public.guests where device_token = 'tap-dev'), 0,
  'replay does not decrement again');
select is(
  (select status from public.reserve_shot('tap-dev', 'photo', '22222222-2222-4222-8222-222222222222', now(), 'jpg')),
  'cap_reached', 'photo cap is enforced');

-- ---- clip reservation + cap -------------------------------------------------
select is(
  (select status from public.reserve_shot('tap-dev', 'clip', '33333333-3333-4333-8333-333333333333', now(), 'mp4')),
  'reserved', 'clip reservation succeeds');
select ok(
  (select clips_remaining = 0 and photos_remaining = 0 from public.guests where device_token = 'tap-dev'),
  'clip reservation decrements clips only');
select is(
  (select status from public.reserve_shot('tap-dev', 'clip', '44444444-4444-4444-8444-444444444444', now(), 'mp4')),
  'cap_reached', 'clip cap is enforced');
select is(
  (select count(*)::int from public.shots s join public.guests g on g.id = s.guest_id
    where g.device_token = 'tap-dev'),
  2, 'only successful reservations create rows');

select matches((select r2_key from first_res),
  '^events/eeeeeeee-0000-4000-8000-00000000eeee/aaaaaaaa-0000-4000-8000-00000000aaaa/[0-9a-f-]{36}\.jpg$',
  'photo key is events/<event>/<guest>/<shot>.jpg');
select matches(
  (select s.r2_key from public.shots s where s.client_shot_id = '33333333-3333-4333-8333-333333333333'),
  '\.mp4$', 'clip key carries the clip extension');

-- ---- rejection paths --------------------------------------------------------
select is(
  (select status from public.reserve_shot('no-such-device', 'photo', '55555555-5555-4555-8555-555555555555', now(), 'jpg')),
  'guest_not_found', 'unknown device token is rejected');
select is(
  (select status from public.reserve_shot('tap-dev', 'gif', '66666666-6666-4666-8666-666666666666', now(), 'gif')),
  'bad_type', 'unknown shot type is rejected');

-- ---- confirm_shot -------------------------------------------------------------
select is(public.confirm_shot('tap-dev', '11111111-1111-4111-8111-111111111111'), 'confirmed',
  'confirming a reserved shot succeeds');
select is(
  (select upload_status from public.shots where client_shot_id = '11111111-1111-4111-8111-111111111111'),
  'uploaded', 'confirm flips upload_status to uploaded');
select is(public.confirm_shot('tap-dev', '11111111-1111-4111-8111-111111111111'), 'confirmed',
  'confirm is idempotent');
select is(public.confirm_shot('other-dev', '33333333-3333-4333-8333-333333333333'), 'shot_not_found',
  'a guest cannot confirm another guest''s shot');
select is(public.confirm_shot('no-such-device', '11111111-1111-4111-8111-111111111111'), 'guest_not_found',
  'unknown device cannot confirm');

-- ---- privileges: only the Edge Functions (service_role) may call these ------
select ok(not has_function_privilege('anon', 'public.reserve_shot(text,text,text,timestamptz,text)', 'execute'),
  'anon cannot call reserve_shot');
select ok(not has_function_privilege('authenticated', 'public.reserve_shot(text,text,text,timestamptz,text)', 'execute'),
  'authenticated cannot call reserve_shot');
select ok(not has_function_privilege('anon', 'public.confirm_shot(text,text)', 'execute'),
  'anon cannot call confirm_shot');

select * from finish();
rollback;
