-- 0005_couple_collection.sql — Story 2.2
-- The couple browses every guest's roll of their event (FR14). Metadata is read
-- through the couple RLS from 0004; media is only ever served through signed
-- GET URLs from the issue-couple-view-urls Edge Function (AD-2), which first
-- proves the caller is this event's couple by reading the event through RLS
-- with the caller's own JWT, then asks this function for the storage keys.

-- Shots are addressed by their server id: client_shot_id is only unique per
-- guest, so it can't name a shot across a whole event. Couples only — guests
-- (anon + device token) keep the 1.6 metadata columns.
grant select (id) on public.shots to authenticated;

-- An uploaded shot always has an object behind it: reserve_shot (0002) sets
-- the key before confirm_upload can mark it uploaded. Make that an invariant,
-- so "uploaded" alone is enough for the collection to vouch for a shot.
alter table public.shots
  add constraint shots_uploaded_has_key
  check (upload_status <> 'uploaded' or r2_key is not null);

-- Object keys the couple may view for one event: uploaded shots of that
-- event's guests, among the requested ids (at most 30 per call, like the
-- function; more returns nothing). Anything else (another event, not uploaded,
-- unknown) is simply not returned. Service role only — the Edge Function has
-- already authorized the caller, and storage keys never leave the server.
-- SECURITY INVOKER: the only caller (service_role) can read shots anyway, so
-- definer rights would add nothing but risk.
create or replace function public.couple_viewable_shot_keys(
  p_event_id  uuid,
  p_shot_ids  uuid[]
)
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
    and coalesce(cardinality(p_shot_ids), 0) <= 30;
$$;

revoke all on function public.couple_viewable_shot_keys(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.couple_viewable_shot_keys(uuid, uuid[]) to service_role;
