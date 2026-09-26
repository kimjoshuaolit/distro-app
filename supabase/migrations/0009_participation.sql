-- 0009_participation.sql — Story 3.3
-- The operator's participation read (FR18): who joined an event and roughly
-- how much each guest has shot. Like operator_events (0007), it's a
-- security-definer function that answers only when is_operator() — no
-- operator RLS policy on events (the couple gate), guests or shots. It
-- returns names, times and counts only: never device tokens, R2 keys or shot
-- ids.
--
--   photos_saved / clips_saved -> shots confirmed uploaded, by type
--   on_the_way                 -> shots reserved but not uploaded yet
--   last_shot_at               -> when the guest last shot (the device's capture
--                                 time, else the reservation time; NULL if none) —
--                                 a backlog uploaded hours later isn't "just now"
--
-- Shots still offline on a phone haven't reserved yet, so they don't count.

create or replace function public.operator_participation(p_event_id uuid)
returns table (
  guest_id     uuid,
  first_name   text,
  joined_at    timestamptz,
  photos_saved int,
  clips_saved  int,
  on_the_way   int,
  last_shot_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.id,
    g.first_name,
    g.created_at,
    coalesce(s.photos_saved, 0),
    coalesce(s.clips_saved, 0),
    coalesce(s.on_the_way, 0),
    s.last_shot_at
  from public.guests g
  left join lateral (
    select
      (count(*) filter (where sh.type = 'photo' and sh.upload_status = 'uploaded'))::int as photos_saved,
      (count(*) filter (where sh.type = 'clip' and sh.upload_status = 'uploaded'))::int as clips_saved,
      (count(*) filter (where sh.upload_status = 'local'))::int as on_the_way,
      max(coalesce(sh.captured_at, sh.created_at)) as last_shot_at
    from public.shots sh
    where sh.guest_id = g.id
  ) s on true
  where g.event_id = p_event_id and public.is_operator()
  order by g.created_at desc, g.id;
$$;

revoke all on function public.operator_participation(uuid) from public, anon, authenticated;
grant execute on function public.operator_participation(uuid) to authenticated;
