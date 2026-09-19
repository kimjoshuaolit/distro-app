-- Dev/test seed. Fixed ids so /j/<id> is reachable in local dev.
-- Applied by `supabase db reset`. Not used in production.

-- An OPEN event.
insert into public.events (id, couple_owner, window_open, window_close)
values (
  '00000000-0000-0000-0000-000000000001',
  'couple@example.test',
  now() - interval '1 hour',
  now() + interval '365 days'
)
on conflict (id) do nothing;

-- An ENDED event (window already passed) — for testing the "that's a wrap" path.
insert into public.events (id, couple_owner, window_open, window_close)
values (
  '00000000-0000-0000-0000-000000000002',
  'couple@example.test',
  now() - interval '10 days',
  now() - interval '9 days'
)
on conflict (id) do nothing;

-- A NOT-YET-OPEN event (window in the future) — for testing the "isn't open yet" path.
insert into public.events (id, couple_owner, window_open, window_close)
values (
  '00000000-0000-0000-0000-000000000003',
  'couple@example.test',
  now() + interval '7 days',
  now() + interval '8 days'
)
on conflict (id) do nothing;
