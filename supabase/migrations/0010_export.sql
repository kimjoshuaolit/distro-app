-- 0010_export.sql — Story 3.4
-- Download all (FR18, AD-7): the operator saves every uploaded shot to a folder
-- on his laptop to cut the montage. Two steps, like the couple's collection:
--
--   1. List (metadata only): operator_export_shots — security definer, answers
--      only when is_operator(), never returns storage keys. Paged (PostgREST
--      caps a response at 1000 rows).
--   2. Sign (just in time): the issue-export-urls Edge Function checks
--      is_operator() with the caller's JWT, then asks operator_export_keys
--      (service role only) for at most 100 keys and signs 10-minute GETs.
--
-- As in 0007/0009: no operator RLS policy on events (the couple gate), guests
-- or shots.

-- Uploaded shots of one event, keyset-paged by shot id (pass the last shot_id
-- seen as p_after). taken_at is the device's capture time, else the
-- reservation time; ext is the stored object's extension (jpg / mp4 / webm).
create or replace function public.operator_export_shots(p_event_id uuid, p_after uuid default null)
returns table (
  shot_id  uuid,
  guest_id uuid,
  type     text,
  taken_at timestamptz,
  ext      text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.guest_id,
    s.type,
    coalesce(s.captured_at, s.created_at),
    lower(substring(s.r2_key from '\.([A-Za-z0-9]{1,8})$'))
  from public.shots s
  join public.guests g on g.id = s.guest_id
  where g.event_id = p_event_id
    and s.upload_status = 'uploaded'
    and s.r2_key is not null -- same filter as operator_export_keys: listed = signable
    and (p_after is null or s.id > p_after)
    and public.is_operator()
  order by s.id
  limit 1000;
$$;

revoke all on function public.operator_export_shots(uuid, uuid) from public, anon, authenticated;
grant execute on function public.operator_export_shots(uuid, uuid) to authenticated;

-- Storage keys for up to 100 uploaded shots of one event (more returns
-- nothing). Service role only: issue-export-urls has already checked the
-- caller is the operator, and keys never leave the server. Security invoker:
-- the only caller (service_role) can read shots anyway.
create or replace function public.operator_export_keys(p_event_id uuid, p_shot_ids uuid[])
returns table (shot_id uuid, r2_key text)
language sql
stable
security invoker
set search_path = public
as $$
  select s.id, s.r2_key
  from public.shots s
  join public.guests g on g.id = s.guest_id
  where g.event_id = p_event_id
    and s.upload_status = 'uploaded'
    and s.r2_key is not null
    and s.id = any (p_shot_ids)
    and coalesce(cardinality(p_shot_ids), 0) <= 100;
$$;

revoke all on function public.operator_export_keys(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.operator_export_keys(uuid, uuid[]) to service_role;
