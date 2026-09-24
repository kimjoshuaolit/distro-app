-- Dev/test seed. Fixed ids so /j/<id> is reachable in local dev.
-- Applied by `supabase db reset`. Not used in production.

-- An OPEN event.
insert into public.events (id, window_open, window_close)
values (
  '00000000-0000-0000-0000-000000000001',
  now() - interval '1 hour',
  now() + interval '365 days'
)
on conflict (id) do nothing;

-- An ENDED event (window already passed) — for testing the "that's a wrap" path.
insert into public.events (id, window_open, window_close)
values (
  '00000000-0000-0000-0000-000000000002',
  now() - interval '10 days',
  now() - interval '9 days'
)
on conflict (id) do nothing;

-- A NOT-YET-OPEN event (window in the future) — for testing the "isn't open yet" path.
insert into public.events (id, window_open, window_close)
values (
  '00000000-0000-0000-0000-000000000003',
  now() + interval '7 days',
  now() + interval '8 days'
)
on conflict (id) do nothing;

-- Couple inboxes (Story 2.1) — magic links land in Mailpit (localhost:54324).
--   /reveal/00000000-0000-0000-0000-000000000001 — both partners
--   /reveal/00000000-0000-0000-0000-000000000002 — a different couple (use it
--   to check that event 1's couple is denied here)
insert into public.event_couples (event_id, email)
values
  ('00000000-0000-0000-0000-000000000001', 'partner.one@example.test'),
  ('00000000-0000-0000-0000-000000000001', 'partner.two@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'other.couple@example.test')
on conflict do nothing;
