-- Release control (Story 2.4, FR15 / AD-3). Setting `events.released` is a
-- privileged write: it goes only through the `set-release` Edge Function, which
-- checks the caller is this event's couple and then writes as service_role.
--
-- Until now, "no client writes to events" rested on RLS alone (there is no
-- insert/update/delete policy). But the Supabase default grants still gave
-- anon/authenticated INSERT/UPDATE/DELETE, and also TRUNCATE, which RLS does not
-- cover. Revoke them, so a future update policy (say, for the operator console)
-- can never quietly let a client flip `released`. SELECT stays as 0004 granted it.
revoke insert, update, delete, truncate, references, trigger
  on public.events from anon, authenticated;
