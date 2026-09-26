---
title: 'Story 2.4 — Release control'
type: 'feature'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: '58a5fdbcd2b5403c73772e9f9f6bfb2f46d1a5d4'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-3-montage-first-reveal.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The couple can't yet say whether their collection may be shared (FR15). `events.released` already exists (default `false`, readable by the couple and writable by no client), but nothing sets it.

**Approach:** Add a new `set-release` Edge Function, the only write path (AD-3). It sets `released` to an explicit value, and only for an inbox-proven partner of that event. The gate is the same one 2.2/2.3 use: read the event through RLS with the caller's JWT, then `decideCoupleAccess`. Below the roll shelf, the reveal gets a small "Sharing" switch that is private by default. Public sharing stays deferred, so turning the switch on marks the collection as okay to share and exposes nothing.

## Boundaries & Constraints

**Always:**
- The request is `{eventId, released: boolean}` with an explicit value, never a toggle, so a double tap can't flip it back.
- The couple gate runs before any write. Only after the gate does the service role update exactly that row and return `{released}`.
- The client reads the current value through RLS, never from the Edge Function.
- The switch is a real `role="switch"` button with `aria-checked`, a label and a 44px+ target. It shows a "Saving…" state. On failure it reverts and shows a gentle `role="alert"` message.
- The copy is honest. When off: "Private — only the two of you can see this collection." When on: "Marked okay to share. Nothing is public yet — Kim will check with you before any sharing opens."

**Ask First:** Any public-sharing surface or link. Operator (Kim) write access (Epic 3). A confirmation step on the switch.

**Never:** Direct client `update` on `events`. A new client-writable column or policy. Anything that reads `released` to widen access.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Couple sets it | partner JWT, `{eventId, released:true}` | row updated; `{released:true}`; switch shows on | N/A |
| Same value again | already true, `released:true` | `{released:true}` (idempotent) | N/A |
| Not the couple | anon / other couple / password session / guest | 403 `not_couple`; row unchanged | switch reverts + alert |
| Bad body | missing/non-uuid `eventId`, non-boolean `released`, array | 400 `bad_request` | N/A |
| Server failure | read or update error | 500 `server_error` (safe log, no tokens) | switch reverts + alert |
| Read fails on load | RLS read errors | switch hidden behind "Couldn't load sharing" + retry; shelf unaffected | retry |

</frozen-after-approval>

## Code Map

- `supabase/functions/issue-montage-url/index.ts` -- copy its shape exactly: CORS, `fail`, `describe`, env checks, caller-JWT read of `events` → `decideCoupleAccess` (`_shared/couple-rules.ts`), then the service client.
- `supabase/functions/_shared/montage-rules.ts` -- validation pattern with `isUuid` (`join-rules.ts`).
- `supabase/migrations/0004_couple_access.sql:179` -- `events` SELECT is column-granted (`released` included). There is no UPDATE grant or policy for client roles, and it stays that way. `couple_access.test.sql:94` already shows that a couple's direct update doesn't change `released`.
- `src/lib/api.ts` -- `parseFunctionError`, `FUNCTION_TIMEOUT_MS`, the `MontageError`/`getMontageUrl` pattern; `src/lib/coupleAuth.ts:112` (`getCoupleEvent`) for the RLS `events` read.
- `src/screens/Reveal.tsx:257` -- `Collection` shelf view; the control goes after the shelf block, before `{footer}`, on the shelf view only (not on roll deep links). Reveal tokens in `src/styles/tokens.css`; `Reveal.css` class conventions.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/functions/_shared/release-rules.ts` (+ `.test.ts`) -- `validateReleaseRequest` (plain object, uuid `eventId` lowercased, strict boolean `released`) -- tested rules.
- [x] `supabase/functions/set-release/index.ts` -- couple gate, then the service role runs `update … set released where id` with `select('released')`, returning `{released}` -- the only write path.
- [x] `src/lib/api.ts` (+ test if a pure parser is extracted) -- `getRelease(eventId)` (RLS read) and `setRelease(eventId, released)` (`ReleaseError` with the server code, response shape checked) -- data access.
- [x] `src/couple/useRelease.ts`, `src/couple/ReleaseControl.tsx` + `.css`; `src/screens/Reveal.tsx` -- load → switch; save with revert on failure; ignore a stale answer from an older save -- the UI.
- [x] `supabase/tests/release.test.sql` -- anon/authenticated have no UPDATE on `events`; a couple's direct `update … set released` changes nothing; the couple can read `released` for their own event only -- the no-direct-write invariant.

**Acceptance Criteria:**
- Given a signed-in partner, when they turn sharing on and reload, then the switch is still on, and either partner can turn it back off.
- Given a fresh event, when the couple opens the reveal, then sharing shows private (off).
- Given anyone who isn't that event's couple, when they call `set-release` or update `events` directly, then `released` is unchanged.

## Spec Change Log

- **Implementation (no review loopback):** the Design Note's "no migration" was wrong. `events` still carried the Supabase default INSERT/UPDATE/DELETE/TRUNCATE grants for anon/authenticated, so "no client write" rested on RLS alone, and TRUNCATE isn't covered by RLS. The pgTAP task ("anon/authenticated have no UPDATE on `events`") could only pass by revoking them. **Amended:** added `0006_release_control.sql`, which revokes client writes on `events`, and flipped `couple_access.test.sql:94` from "filtered by RLS" to "refused 42501". **Avoided:** a future update policy (e.g. operator console) silently letting a client flip `released`. **KEEP:** SELECT grants from 0004 untouched; all writes remain service_role-only.

## Design Notes

The column and its default shipped in 0001. 0006 turns "no client write" from "no policy yet" into "no privilege at all". The Edge Function only adds a gated write. The switch saves immediately without a confirm step, because flipping it exposes nothing and it can be flipped back. The switch uses `aria-disabled` rather than `disabled` while saving, so keyboard focus isn't dropped. The reducer ignores taps while a save is in flight.

## Verification

**Commands:**
- `npm run test`, `npm run lint`, `npm run build` -- green.
- `npx supabase db reset` then `npm run test:db` -- all suites pass (recreate the `shots` bucket afterwards).

**Manual checks:**
- Serve functions (`docker rm -f supabase_edge_runtime_dispo-retro-cam` first; readiness takes ~80s, so poll the endpoint). Use curl to check that partner → 200 and that other couple / anon → 403 with the row unchanged. In the browser, signed in as a partner: the switch is off → on → reload → still on.

**Implementation notes:**
- Built in fast mode (user request): inline, self-review of the gate instead of review subagents (no high-severity findings).
- Gates: 324 vitest, 6 pgTAP suites / 197 assertions, lint clean, build OK (the bundle-size warning is already deferred).
- Live-verified against the local stack:
  - partner.one → `true` returns 200, and repeating it is idempotent.
  - The other couple, the anon key and no auth header each get 403 with the row unchanged.
  - A `"toggle"` value and a missing id each get 400.
  - partner.two → `false` returns 200.
  - A direct PostgREST PATCH as the couple is refused with 403 / 42501.
- Browser: signed in as partner.one, the switch went off → on (focus kept) and stayed on after reload. At 375px there is no horizontal scroll and the tap target is 44px.

## Suggested Review Order

**Who can flip it — start here**

- Same caller-JWT RLS gate as 2.2/2.3; nothing is written before it passes.
  [`set-release/index.ts:61`](../../supabase/functions/set-release/index.ts#L61)

- Service-role write of the explicit value to one row; returns what was saved.
  [`set-release/index.ts:84`](../../supabase/functions/set-release/index.ts#L84)

- Strict body: uuid id plus a real boolean, never a toggle.
  [`release-rules.ts:14`](../../supabase/functions/_shared/release-rules.ts#L14)

**No direct writes**

- Revokes the default client write grants on `events` (TRUNCATE included).
  [`0006_release_control.sql:10`](../../supabase/migrations/0006_release_control.sql#L10)

**The switch**

- Pure state: optimistic value, one save at a time, revert on failure.
  [`releaseState.ts:41`](../../src/couple/releaseState.ts#L41)

- `role="switch"`, honest copy, keeps focus while saving.
  [`ReleaseControl.tsx:47`](../../src/couple/ReleaseControl.tsx#L47)

- Beneath the shelf, above sign-out; the shelf view only.
  [`Reveal.tsx:272`](../../src/screens/Reveal.tsx#L272)

- RLS read and Edge Function write, with typed `ReleaseError`.
  [`api.ts:393`](../../src/lib/api.ts#L393)

**Tests**

- pgTAP: default private, no client write privilege, per-couple read, service_role write.
  [`release.test.sql:44`](../../supabase/tests/release.test.sql#L44)

- 2.1's "filtered by RLS" assertion is now "refused".
  [`couple_access.test.sql:96`](../../supabase/tests/couple_access.test.sql#L96)
