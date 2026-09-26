-- Window control (Story 3.2): reserve_shot's upload cutoff (7 days after the
-- close, new reservations only; an already-reserved shot may always finish; an
-- unset close never refuses), and operator_set_window's Open now / Close now
-- rules, callable by service_role only. Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(31);

-- ---- Fixtures: closed 2 days ago / closed 8 days ago / never closes -------------
insert into public.events (id, window_open, window_close)
values
  ('b0b0b0b0-0000-4000-8000-0000000000d1', now() - interval '3 days', now() - interval '2 days'),
  ('b0b0b0b0-0000-4000-8000-0000000000d2', now() - interval '9 days', now() - interval '8 days'),
  ('b0b0b0b0-0000-4000-8000-0000000000d3', now() - interval '1 day', null),
  ('b0b0b0b0-0000-4000-8000-0000000000d4', now() + interval '2 days', now() + interval '3 days'),
  ('b0b0b0b0-0000-4000-8000-0000000000d5', null, null);
insert into public.guests (id, event_id, first_name, device_token)
values
  ('b1b1b1b1-0000-4000-8000-000000000001', 'b0b0b0b0-0000-4000-8000-0000000000d1', 'Rosa', 'token-win-recent'),
  ('b1b1b1b1-0000-4000-8000-000000000002', 'b0b0b0b0-0000-4000-8000-0000000000d2', 'Theo', 'token-win-old'),
  ('b1b1b1b1-0000-4000-8000-000000000003', 'b0b0b0b0-0000-4000-8000-0000000000d3', 'Uma',  'token-win-open');
-- A shot Theo reserved back when uploads were still open.
insert into public.shots (guest_id, type, upload_status, client_shot_id, r2_key)
values ('b1b1b1b1-0000-4000-8000-000000000002', 'photo', 'local', 'theo-early', 'events/x/theo-early.jpg');

-- ---- The upload cutoff --------------------------------------------------------------
select is((select status from public.reserve_shot('token-win-recent', 'photo', 'rosa-late', now(), 'jpg')), 'reserved',
  'closed 2 days ago: a late upload is still accepted (inside the 7-day grace)');
select is((select photos_remaining from public.guests where device_token = 'token-win-recent'), 24,
  '...and it spent a photo as usual');

select is((select status from public.reserve_shot('token-win-old', 'photo', 'theo-late', now(), 'jpg')), 'upload_closed',
  'closed 8 days ago: a new reservation is refused (upload_closed)');
select is((select photos_remaining from public.guests where device_token = 'token-win-old'), 25,
  '...without spending anything');
select is_empty($$select 1 from public.shots where client_shot_id = 'theo-late'$$, '...and without a row');
select is((select status from public.reserve_shot('token-win-old', 'photo', 'theo-early', now(), 'jpg')), 'exists',
  'an already-reserved shot may still finish after the cutoff (exists)');
select is((select status from public.reserve_shot('token-win-old', 'bogus', 'theo-x', now(), 'jpg')), 'bad_type',
  'bad_type still wins over upload_closed');
select is((select status from public.reserve_shot('no-such-token', 'photo', 'x', now(), 'jpg')), 'guest_not_found',
  'guest_not_found unchanged');

select is((select status from public.reserve_shot('token-win-open', 'clip', 'uma-1', now(), 'mp4')), 'reserved',
  'an event with no close time never refuses');

-- Exactly at the edge: closed 7 days minus a minute ago → still accepted.
update public.events
  set window_open = now() - interval '8 days', window_close = now() - interval '7 days' + interval '1 minute'
  where id = 'b0b0b0b0-0000-4000-8000-0000000000d1';
select is((select status from public.reserve_shot('token-win-recent', 'photo', 'rosa-edge', now(), 'jpg')), 'reserved',
  'just inside 7 days: accepted');
update public.events set window_close = now() - interval '7 days' - interval '1 minute'
  where id = 'b0b0b0b0-0000-4000-8000-0000000000d1';
select is((select status from public.reserve_shot('token-win-recent', 'photo', 'rosa-past', now(), 'jpg')), 'upload_closed',
  'just past 7 days: refused');

-- ---- operator_set_window ------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.operator_set_window(uuid, text)', 'execute'),
  'authenticated cannot call operator_set_window');
select ok(not has_function_privilege('anon', 'public.operator_set_window(uuid, text)', 'execute'),
  'anon cannot call operator_set_window');
select ok(has_function_privilege('service_role', 'public.operator_set_window(uuid, text)', 'execute'),
  'service_role can (set-window)');
select ok(not has_function_privilege('authenticated', 'public.reserve_shot(text, text, text, timestamptz, text)', 'execute'),
  'reserve_shot is still service_role only');

set local role service_role;

-- Close an open event: close = now, open untouched.
select lives_ok($$select * from public.operator_set_window('b0b0b0b0-0000-4000-8000-0000000000d3', 'close')$$,
  'close an open event');
select ok((select window_close = now() and window_open = now() - interval '1 day'
           from public.events where id = 'b0b0b0b0-0000-4000-8000-0000000000d3'),
  'close sets close = now() and keeps the open time');
select is((select is_open from public.event_status('b0b0b0b0-0000-4000-8000-0000000000d3')), true,
  'event_status still counts the close instant itself as open (now <= close)');

-- Close a not-yet-open event: open moves to just before now.
select lives_ok($$select * from public.operator_set_window('b0b0b0b0-0000-4000-8000-0000000000d4', 'close')$$,
  'close a scheduled event');
select ok((select window_close = now() and window_open = now() - interval '1 minute'
           from public.events where id = 'b0b0b0b0-0000-4000-8000-0000000000d4'),
  'a not-yet-reached open moves to now() - 1 minute (close stays after open)');

-- Open an event that closed long ago: open = now, close moves to now + 12h.
select results_eq(
  $$select window_open = now(), window_close = now() + interval '12 hours'
    from public.operator_set_window('b0b0b0b0-0000-4000-8000-0000000000d2', 'open')$$,
  $$values (true, true)$$,
  'open now on a closed event: open = now(), close = now() + 12h (returned)');
select is((select is_open from public.event_status('b0b0b0b0-0000-4000-8000-0000000000d2')), true,
  '...and it is open for joining');

-- Open an event with a future close: close is kept.
update public.events set window_open = now() + interval '1 hour', window_close = now() + interval '5 hours'
  where id = 'b0b0b0b0-0000-4000-8000-0000000000d1';
select lives_ok($$select * from public.operator_set_window('b0b0b0b0-0000-4000-8000-0000000000d1', 'open')$$,
  'open early');
select ok((select window_open = now() and window_close = now() + interval '5 hours'
           from public.events where id = 'b0b0b0b0-0000-4000-8000-0000000000d1'),
  'opening early keeps a future close time');

-- Unset window: open gives a 12h window.
select results_eq(
  $$select window_open = now(), window_close = now() + interval '12 hours'
    from public.operator_set_window('b0b0b0b0-0000-4000-8000-0000000000d5', 'open')$$,
  $$values (true, true)$$,
  'open now with no window set: a 12h window from now');

select throws_ok($$select * from public.operator_set_window('b0b0b0b0-0000-4000-8000-0000000000ff', 'close')$$,
  'P0002', NULL, 'unknown event → no_data_found');
select throws_ok($$select * from public.operator_set_window('b0b0b0b0-0000-4000-8000-0000000000d1', 'toggle')$$,
  '22023', NULL, 'a bad action → invalid_parameter_value');

-- Safe to repeat. Closing an already-closed event keeps its real close time
-- (the 7-day upload grace isn't quietly extended)...
update public.events set window_open = now() - interval '3 days', window_close = now() - interval '2 days'
  where id = 'b0b0b0b0-0000-4000-8000-0000000000d1';
select lives_ok($$select * from public.operator_set_window('b0b0b0b0-0000-4000-8000-0000000000d1', 'close')$$,
  'close an already-closed event');
select ok((select window_close = now() - interval '2 days' and window_open = now() - interval '3 days'
           from public.events where id = 'b0b0b0b0-0000-4000-8000-0000000000d1'),
  '...keeps its original open and close times');
-- ...and opening an already-open event keeps its open time.
update public.events set window_open = now() - interval '1 hour', window_close = now() + interval '5 hours'
  where id = 'b0b0b0b0-0000-4000-8000-0000000000d1';
select lives_ok($$select * from public.operator_set_window('b0b0b0b0-0000-4000-8000-0000000000d1', 'open')$$,
  'open an already-open event');
select ok((select window_open = now() - interval '1 hour' and window_close = now() + interval '5 hours'
           from public.events where id = 'b0b0b0b0-0000-4000-8000-0000000000d1'),
  '...keeps both times');
reset role;

select * from finish();
rollback;
