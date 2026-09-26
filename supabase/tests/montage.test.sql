-- Montage-first reveal (Story 2.3, AD-2 / AD-7): events.montage_key is the R2
-- key of the hosted montage. No client role — anon, a guest, the couple, any
-- other signed-in session — can ever read (or set) it; only the service role
-- (issue-montage-url, the operator upload script) can. The couple can still
-- read their event row. Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(20);

-- ---- Fixtures: two events, each with its couple; event 1 has a montage -------
insert into public.events (id, window_open, window_close, montage_key)
values
  ('e0e0e0e0-0000-4000-8000-0000000000a1', now() - interval '1 day', now() + interval '1 day',
   'events/e0e0e0e0-0000-4000-8000-0000000000a1/montage/20260926T120000000Z.mp4'),
  ('e0e0e0e0-0000-4000-8000-0000000000a2', now() - interval '1 day', now() + interval '1 day', null);
insert into public.event_couples (event_id, email)
values
  ('e0e0e0e0-0000-4000-8000-0000000000a1', 'mont.one@example.test'),
  ('e0e0e0e0-0000-4000-8000-0000000000a2', 'mont.two@example.test');
insert into public.guests (id, event_id, first_name, device_token)
values ('e1e1e1e1-0000-4000-8000-000000000001', 'e0e0e0e0-0000-4000-8000-0000000000a1', 'Rosa', 'token-mont-rosa');

-- ---- Privileges ---------------------------------------------------------------
select ok(not has_column_privilege('anon', 'public.events', 'montage_key', 'select'),
  'anon cannot read events.montage_key');
select ok(not has_column_privilege('authenticated', 'public.events', 'montage_key', 'select'),
  'authenticated (the couple) cannot read events.montage_key');
select ok(has_column_privilege('authenticated', 'public.events', 'id', 'select'),
  'authenticated can still read events.id (the couple gate reads it)');
select ok(has_column_privilege('service_role', 'public.events', 'montage_key', 'select'),
  'service_role can read events.montage_key (issue-montage-url)');
select ok(has_column_privilege('service_role', 'public.events', 'montage_key', 'update'),
  'service_role can set events.montage_key (the operator upload)');

-- ---- As the couple (email-link session) -----------------------------------------
set local role authenticated;
set local request.headers = '{}';
set local request.jwt.claims = '{"email":"mont.one@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';

select results_eq(
  $$select id::text from public.events$$,
  $$values ('e0e0e0e0-0000-4000-8000-0000000000a1')$$,
  'the couple still reads their own event row');
select lives_ok($$select id, window_open, window_close, released, created_at from public.events$$,
  'the couple can read the granted event columns');
select throws_ok($$select montage_key from public.events$$, '42501', NULL,
  'the couple cannot read montage_key');
select throws_ok($$select * from public.events$$, '42501', NULL,
  'select * as the couple is refused (montage_key is not granted)');
select throws_ok($$select id from public.events where montage_key is not null$$, '42501', NULL,
  'the couple cannot even filter on montage_key');

-- Trying to point the event at another object: refused or a no-op, never a change.
do $$
begin
  update public.events set montage_key = 'events/hijack.mp4' where id = 'e0e0e0e0-0000-4000-8000-0000000000a1';
exception when insufficient_privilege then
  null;
end
$$;

-- Another couple: no row at all.
set local request.jwt.claims = '{"email":"mont.two@example.test","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}';
select results_eq(
  $$select id::text from public.events$$,
  $$values ('e0e0e0e0-0000-4000-8000-0000000000a2')$$,
  'another couple reads only their own event');
select throws_ok($$select montage_key from public.events$$, '42501', NULL,
  'another couple cannot read montage_key');

-- The right inbox, but a password session: nothing (2.1 amr rule).
set local request.jwt.claims = '{"email":"mont.one@example.test","role":"authenticated","amr":[{"method":"password","timestamp":1}]}';
select is_empty($$select id from public.events$$, 'a password session for the couple email reads no event');
select throws_ok($$select montage_key from public.events$$, '42501', NULL,
  'a password session cannot read montage_key');
reset role;

-- ---- As anon (a guest, device token or not) -------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-device-token": "token-mont-rosa"}';
select is_empty($$select id from public.events$$, 'anon (even a guest of the event) reads no event rows');
select throws_ok($$select montage_key from public.events$$, '42501', NULL, 'anon cannot read montage_key');
do $$
begin
  update public.events set montage_key = 'events/hijack.mp4' where id = 'e0e0e0e0-0000-4000-8000-0000000000a1';
exception when insufficient_privilege then
  null;
end
$$;
reset role;

-- ---- The key is untouched; the service role sees it -----------------------------
select is(
  (select montage_key from public.events where id = 'e0e0e0e0-0000-4000-8000-0000000000a1'),
  'events/e0e0e0e0-0000-4000-8000-0000000000a1/montage/20260926T120000000Z.mp4',
  'neither the couple nor anon could change montage_key');

set local role service_role;
select is(
  (select montage_key from public.events where id = 'e0e0e0e0-0000-4000-8000-0000000000a1'),
  'events/e0e0e0e0-0000-4000-8000-0000000000a1/montage/20260926T120000000Z.mp4',
  'service_role reads the montage key');
select is(
  (select montage_key from public.events where id = 'e0e0e0e0-0000-4000-8000-0000000000a2'),
  null, 'no montage hosted yet reads as null');
update public.events set montage_key = 'events/e0e0e0e0-0000-4000-8000-0000000000a2/montage/20260926T130000000Z.webm'
  where id = 'e0e0e0e0-0000-4000-8000-0000000000a2';
select is(
  (select montage_key from public.events where id = 'e0e0e0e0-0000-4000-8000-0000000000a2'),
  'events/e0e0e0e0-0000-4000-8000-0000000000a2/montage/20260926T130000000Z.webm',
  'service_role can host a montage (the upload script''s write)');
reset role;

select * from finish();
rollback;
