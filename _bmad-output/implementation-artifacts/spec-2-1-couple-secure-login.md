---
title: 'Story 2.1 — Couple secure login'
type: 'feature'
created: '2026-09-24'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'b26ebff187ae1ff9188a94dab2e965fe5b1436ed'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-6-view-own-roll.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing yet lets the couple reach their collection. Only the couple's own inboxes should be able to sign in (FR13, NFR3), and a signed-in couple must be able to read every roll in *their* event and nothing else (AD-5).

**Approach:** An event-scoped reveal page at `/reveal/:eventId` with a Supabase magic-link login. Each event has up to two authorized emails (one per partner) in a new `event_couples` table, which replaces `events.couple_owner`. A `before_user_created` auth hook refuses to create accounts for unlisted emails. Couple-scoped RLS on `events`/`guests`/`shots` grants read access to their event only. The page gates on session + event access; the signed-in view is a warm "your reveal is being prepared" shell that 2.2/2.3 fill in.

## Boundaries & Constraints

**Always:** Authorization lives in the database (RLS + SECURITY DEFINER helpers), never in client trust (AD-3). Emails are compared lowercased and trimmed. Guests' `device_token` is never readable by any client role. My Roll (1.6) must keep showing only the guest's own shots, even when a couple session exists in the same browser. Warm reveal skin (`--reveal-*` tokens), 16px text, 44px controls, labeled inputs.

**Ask First:** Any couple *write* path (release is 2.4). Changing how guests are identified. Adding an operator role (Epic 3).

**Never:** No password login, no public sign-up surface, no collection/media rendering (2.2), no montage (2.3), no signed-URL issuance for the couple yet.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Authorized request | listed email (any case) on `/reveal/E` | magic link sent → "Check your inbox" (works if opened on another device) | rate-limited → "Give it a minute, then try again" |
| Unlisted email | email not in `event_couples` for E | plain: "That email isn't on the list for this reveal — check the spelling or ask Kim." No email sent | N/A |
| Invalid email | malformed input | inline validation, no request | N/A |
| Link clicked | valid link → `/reveal/E#access_token…` | session established, hash cleared, granted shell | expired/used link → "That link has expired — send a new one" + form |
| Signed in, wrong event | couple of A opens `/reveal/B` | "This reveal belongs to another couple" + sign out | N/A |
| Signed out / anon | no session | login form; REST reads of events/guests/shots return zero rows | N/A |
| Hook | account creation for unlisted email | refused (403) | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0001_init.sql` — `events.couple_owner` (to drop), RLS on with no policies; `event_status` SECURITY DEFINER pattern.
- `supabase/migrations/0003_own_roll.sql` — `current_guest_id()` pattern; `shots` column grants `(client_shot_id,type,upload_status,captured_at)` to anon+authenticated; `shots_own_roll_select` policy (permissive — couple policies OR with it).
- `supabase/tests/own_roll.test.sql:55` — authenticated-without-claims still sees own roll; must stay green.
- `supabase/seed.sql` — events insert `couple_owner`; move to `event_couples`.
- `supabase/config.toml:154-285` — `site_url` is `127.0.0.1:3000` (Vite serves `:5173`); hook stubs at ~278; email template stub; Mailpit at `:54324`.
- `src/lib/supabase.ts` — singleton client (default implicit flow, `detectSessionInUrl: true`).
- `src/lib/api.ts:195` `getServerRoll` — selects all visible `shots`; with a couple session it would return the whole event → must filter `guest_id`. `src/lib/guestSession.ts` has `guestId` (= `guests.id`, from `join-event`).
- `src/screens/Join.tsx` / `Roll.tsx` — screen/state + CSS conventions; `src/App.tsx` routes; `src/styles/tokens.css:20` reveal tokens.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0004_couple_access.sql` -- `event_couples(event_id fk cascade, email lowercase check, pk(event_id,email))`, RLS on, no client grants; backfill from `couple_owner`, then drop it. `couple_event_ids()` (SECURITY DEFINER, JWT email → event ids; authenticated only). `couple_can_sign_in(event_id, email)` (anon+authenticated). `before_user_created_hook(event jsonb)` (supabase_auth_admin only; `{}` or `{error:{http_code:403,…}}`). SELECT policies `to authenticated` on events/guests/shots for the couple's event. Column grants: guests `(id,event_id,first_name,created_at)` to authenticated only; events hide `montage_key`; `shots.guest_id` to anon+authenticated -- DB-enforced couple scope.
- [x] `supabase/config.toml` -- `site_url`/redirect allow-list for `localhost:5173` + `127.0.0.1:5173`; enable the hook; warm `magic_link` template (`supabase/templates/magic_link.html`) -- local flow works end to end. *(Review: + `enable_confirmations = true` and a matching `confirmation` template for first sign-ins.)*
- [x] `supabase/seed.sql` -- seed `event_couples` (two partner emails on event 1, one on event 2) -- dev data.
- [x] `src/lib/api.ts` -- `getServerRoll(deviceToken, guestId)` adds `.eq('guest_id', guestId)`; update caller in `src/roll/useRoll.ts` -- My Roll stays own-only under a couple session.
- [x] `src/lib/coupleAuth.ts` -- pure `normalizeEmail`, `isValidEmail`, `parseAuthRedirectError(hash)`, `mapOtpError`; `checkCoupleEmail`, `requestMagicLink(eventId,email)` (`emailRedirectTo` = `/reveal/:eventId`), `getCoupleEvent(eventId)`, `signOut` -- thin Supabase wrappers.
- [x] `src/couple/coupleGate.ts` + `useCoupleSession.ts` -- pure `coupleGate(session, access, linkError)` → `loading|login|denied|granted`; hook subscribes to `onAuthStateChange`, checks event access -- testable gating. *(Review: + `src/couple/accessCheck.ts` for keyed access, retry/backoff and error classification; gate also takes an event check and adds `notFound`/`error` views.)*
- [x] `src/screens/Reveal.tsx` + `.css`, `src/App.tsx` -- `/reveal/:eventId`: login form, sent, not-on-list, expired-link, denied (+sign out), granted shell (kicker "Your wedding · developed", title "From your people", "being prepared" note, sign out) -- the UI.
- [x] Tests -- `supabase/tests/couple_access.test.sql` (matrix hook/RLS rows, column denial, cross-event isolation, guest roll unaffected); `src/lib/coupleAuth.test.ts`, `src/couple/coupleGate.test.ts`; update `api.test.ts` for the `guest_id` filter. *(Review: + `src/couple/accessCheck.test.ts`, fake timers.)*

**Implementation notes (deviations from the plan above):**
- **Inbox-proof sessions only (FR13).** Supabase Auth keeps password sign-up and email change enabled, so a listed address alone is not enough. Three layers:
  - `couple_event_ids()` requires the JWT `amr` to contain one of `otp`, `magiclink`, `email/signup`, `invite`, `recovery`. It refuses `password`, `email_change`, `oauth`, `sso/saml`, `anonymous` and `token_refresh`, and refuses any `amr` that is missing, empty or not an array of objects. The method strings were checked against the running GoTrue v2.196 binary. Observed live: magic links **and** first-time signup confirmations both carry `otp`, and password sessions carry `password`. An `auth.users.encrypted_password` check was tried first and dropped, because GoTrue stores a random hash for magic-link users too.
  - `config.toml` sets `enable_confirmations = true` (with `double_confirm_changes = true`). Review finding: with confirmations off, `updateUser({ email: <event 2 couple> })` was auto-confirmed, so after a refresh the JWT carried event 2's email with `amr` otp.
  - First-time couples now receive the **confirmation** email (link `type=signup`), themed like the magic-link one (`supabase/templates/confirmation.html`).
- **Verified live against Mailpit** (local stack, GoTrue v2.196):
  - A new listed email → confirmation email → `amr` otp → granted. A returning email → magic-link email → granted.
  - `updateUser({ email: other.couple@… })` → the user's email stays unchanged with only a pending `new_email` (both inboxes must confirm). After a refresh the JWT keeps the old email; event 2 returns 0 rows.
  - A password sign-up for a listed email → no session, and password login gives `email_not_confirmed`. After the couple confirms from their inbox, the couple is granted, while password login (`amr` password) sees 0 events and 0 guests.
  - An unlisted sign-up → 403 from the hook. Anon REST → zero rows.
- `event_couples` also enforces the "up to two" rule with a trigger that fires `before insert or update of event_id, email` under an event-row lock. The count excludes the row being updated (its old values) and any identical `(event_id, email)` pair, so an `on conflict do nothing` re-insert on a full event stays a no-op. The table also has an index on `email` for the hook and helper lookups.
- Anon has no column grants on `guests`, so anon reads are refused (401/42501) instead of returning zero rows, and `own_roll.test.sql` asserts `throws_ok` there. `events` columns other than `montage_key` stay granted to anon, so anon reads of `events` return zero rows via RLS.
- **Gate:** `coupleGate(session, access, linkError, eventCheck)` returns `{ view }` objects: `loading | notFound | login(linkError) | denied | granted | error`.
  - A malformed id → `notFound`, with no requests at all.
  - A well-formed id is checked with the anon `event_status` RPC (`getEventStatus`); an unknown event → `notFound`, whether signed out or signed in.
  - A transient event-check failure → carry on, since RLS still decides access.
  - A session supersedes a failed-link notice and clears it.
- **Access checks** (`src/couple/accessCheck.ts`, pure and node-tested with fake timers):
  - `getCoupleEvent` throws `AccessCheckError(status, code)` and has a 15s timeout.
  - Transient failures (status 0 = network or timeout, 5xx, 408, 429) retry after 3s, 6s, 12s, 24s, then 48s, and after that become the terminal `error` view.
  - `42501` and other 4xx are terminal immediately. A `401` is terminal and also triggers a local sign-out.
  - The terminal view offers "Try again" (a new attempt, i.e. a new key) and "Sign out".
  - Results are keyed by `(userId, email, eventId, attempt)`, so a result for an old user, email or attempt is never shown, and a USER_UPDATED email change triggers a re-check.
- **Reveal a11y:**
  - There is one visually hidden polite `role="status"` region; errors alone use `role="alert"`, and the section no longer carries `aria-live`.
  - The loading state has a visually hidden `h1`.
  - The sign-out error and the login announcement are keyed to the view or session epoch, so they clear without effects. The login form remounts per session identity, so signing out never shows a stale "Check your inbox".
- **Email templates:** a plain-text link fallback below the button, the button now reads "Open your reveal", and the kicker is darkened to `#9a4a1f` (5.6:1 on cream, where the amber token gives only 3.7:1).
- **Backfill verified manually:** after `db reset --version 0003`, `couple_owner = '  Mixed@Example.Test '` became `(id, 'mixed@example.test')` and a blank owner was skipped. The column was dropped. At 0003 the seed itself fails, as expected, because it references `event_couples`. A full `db reset` then passes.
- `src/lib/supabase.ts` pins `flowType: 'implicit'` explicitly. Sign-out uses `scope: 'local'` (this device only).
- `useRoll` takes `guestId` and skips the server read when it has none, rather than issuing an unfiltered read.
- Local dev: `db reset` removes storage buckets, so recreate the private `shots` bucket afterwards if you need local uploads.
- pgTAP claims include `"amr":[{"method":"otp"}]`; the amr cases use a `pg_temp` helper that sets the claims.

**Acceptance Criteria:**
- Given a listed email, when they request and click the magic link, then they land signed in on their event's reveal and RLS returns that event's guests and shots only.
- Given an anonymous or unlisted visitor, when they open `/reveal/:eventId` or query events/guests/shots directly, then no collection data is returned.
- Given a couple signed in on a phone that is also a guest, when they open My Roll, then only that guest's own shots appear.

## Design Notes

- **Implicit flow, not PKCE:** couples often request on a laptop and tap the email on a phone; PKCE needs the requesting browser's verifier, so it would fail cross-device.
- **Two locks:** `couple_can_sign_in` powers the plain "not on the list" message (user-approved trade-off: reveals only whether an address is this event's couple); the hook is the real server-side gate, so a bypassed client still can't mint accounts. An existing account whose email is later removed still signs in but RLS yields nothing → "denied".
- RLS test pattern: `set local role authenticated; set local request.jwt.claims = '{"email":"…","role":"authenticated"}';`.

## Verification

**Commands:**
- `npm run test`, `npm run lint`, `npm run build` -- green.
- `npx supabase db reset` (restart the stack for config changes) then `npm run test:db` -- all suites pass.

**Manual checks:**
- In-app browser: request a link for a seeded email, open it from Mailpit (`localhost:54324`), land granted; unlisted email → plain message; couple of event 1 on `/reveal/<event 2>` → denied; sign out → login. Curl REST as anon → zero rows. Guest My Roll unchanged while signed in as couple.

## Suggested Review Order

**Who counts as the couple (DB-enforced) — start here**

- JWT email → event ids, only for sessions opened from an email link.
  [`0004_couple_access.sql:90`](../../supabase/migrations/0004_couple_access.sql#L90)

- The amr allow-list: inbox-proving methods only; password and email_change refused.
  [`0004_couple_access.sql:109`](../../supabase/migrations/0004_couple_access.sql#L109)

- Read-only couple policies; permissive, so they OR with the guest own-roll policy.
  [`0004_couple_access.sql:196`](../../supabase/migrations/0004_couple_access.sql#L196)

- Column grants: names for attribution; never device tokens or the montage key.
  [`0004_couple_access.sql:180`](../../supabase/migrations/0004_couple_access.sql#L180)

**Who may sign in**

- Auth hook: accounts are only ever created for a listed couple email.
  [`0004_couple_access.sql:148`](../../supabase/migrations/0004_couple_access.sql#L148)

- Advisory yes/no behind the plain "not on the list" message (accepted trade-off).
  [`0004_couple_access.sql:129`](../../supabase/migrations/0004_couple_access.sql#L129)

- At most two inboxes per event, enforced on insert and update.
  [`0004_couple_access.sql:49`](../../supabase/migrations/0004_couple_access.sql#L49)

- Confirmations on: closes password sign-up and unconfirmed email-change takeover.
  [`config.toml:230`](../../supabase/config.toml#L230)

- Hook registration and the redirect allow-list for `/reveal/*`.
  [`config.toml:294`](../../supabase/config.toml#L294)

**Client flow**

- Implicit flow pinned so a link requested on a laptop works on a phone.
  [`supabase.ts:17`](../../src/lib/supabase.ts#L17)

- Pure gate: event validity + session + access → one view.
  [`coupleGate.ts:55`](../../src/couple/coupleGate.ts#L55)

- Access check: transient errors back off and cap; permanent ones end the wait.
  [`accessCheck.ts:88`](../../src/couple/accessCheck.ts#L88)

- Thin hook: auth events in, keyed access check out.
  [`useCoupleSession.ts:46`](../../src/couple/useCoupleSession.ts#L46)

- Sign-in helpers: validate, pre-check list, send link back to this reveal.
  [`coupleAuth.ts:73`](../../src/lib/coupleAuth.ts#L73)

- The screen: not-found, login, denied, error and granted views.
  [`Reveal.tsx:190`](../../src/screens/Reveal.tsx#L190)

**Guest privacy under a couple session**

- My Roll pins its read to its own guest, since a couple can see the whole event.
  [`api.ts:197`](../../src/lib/api.ts#L197)

**Tests and peripherals**

- pgTAP as the browser: couple scope, cross-event isolation, amr cases, trigger.
  [`couple_access.test.sql:65`](../../supabase/tests/couple_access.test.sql#L65)

- Retry, backoff, cap and stale-result keying with fake timers.
  [`accessCheck.test.ts:67`](../../src/couple/accessCheck.test.ts#L67)

- Gate mapping including malformed and unknown events.
  [`coupleGate.test.ts:6`](../../src/couple/coupleGate.test.ts#L6)

- Dev seed: two partners on event 1, a different couple on event 2.
  [`seed.sql:1`](../../supabase/seed.sql#L1)

- Warm sign-in emails with a plain-text link fallback.
  [`magic_link.html:1`](../../supabase/templates/magic_link.html#L1)
