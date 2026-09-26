---
title: 'Story 3.3 — Participation dashboard'
type: 'feature'
created: '2026-09-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '97b81d2b808243d51094aada867a86d96af182b7'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-2-qr-window-control.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On the night Kim can't tell whether the game is working: who has joined, and whether their shots are reaching the server (FR18).

**Approach:**
- Add a per-event **Dashboard** page (O2) at `/operator/events/:eventId/dashboard`, linked from the event list and the event page. Story 3.4's Download all will live here too.
- At the top: totals (guests, photos saved, clips saved, on the way) and the window phase line.
- Below: one row per guest, newest joiner first, showing:
  - first name and join time;
  - "N photos · M clips saved";
  - "K on the way" (reserved but not yet uploaded);
  - when they last shot.
- It is fresh on load, has a Refresh button, and auto-refreshes every 60 seconds while the tab is visible.
- The data comes from one operator-only security-definer function.

## Boundaries & Constraints

**Always:**
- The data comes from `operator_participation(p_event_id)`, a security-definer SQL function.
  - It returns rows only when `is_operator()`; anyone else gets zero rows.
  - It is executable by `authenticated` only.
  - It returns: guest id (the row key), `first_name`, `joined_at`, photos saved, clips saved, on the way, and `last_shot_at`.
  - It never returns device tokens, R2 keys or shot ids.
- **Counts:**
  - "Saved" = `upload_status = 'uploaded'` for that type.
  - "On the way" = reserved rows still `local`.
  - A guest who joined but has shot nothing shows as "No shots yet".
- The page states that shots still offline on a phone appear once they upload.
- Refresh behaviour:
  - Only the newest answer counts.
  - A failed refresh keeps the last data, with "Couldn't refresh — showing HH:MM".
  - A hidden tab doesn't poll.
- An unknown or malformed event id shows "That event doesn't exist".
- The page is behind the existing operator gate and is part of the lazy operator chunk.

**Ask First:** Showing photos or thumbnails. Per-guest actions (remove a guest, reset an allotment). Any refresh interval other than 60 seconds.

**Never:**
- An RLS policy for the operator on `events`, `guests` or `shots`: `events` RLS is the couple gate.
- Exposing the dashboard data to guests or the couple.
- Realtime subscriptions or polling while the tab is hidden.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Party in progress | 3 guests, uploads in flight | totals + rows, newest joiner first, "2 on the way" where relevant | N/A |
| Nobody yet | event with no guests | "No one has joined yet" + the join link hint | N/A |
| Refresh fails | offline mid-night | last data stays, "Couldn't refresh — showing 9:41 PM" | retried at the next tick or on Refresh |
| Non-operator calls the RPC | anon / couple / password session | zero rows (anon: no execute) | N/A |
| Unknown event | valid uuid with no row, or a non-uuid | "That event doesn't exist" + link back | N/A |
| Duplicate names | two guests named "Sam" | two rows, told apart by their join time | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0007_operator.sql:154` `operator_events` / `:172` `operator_couple_emails` -- the pattern to copy for the new security-definer read (`where public.is_operator()`, revoke all, then grant to authenticated).
- `supabase/migrations/0001_init.sql:19-38` -- `guests` (`first_name`, `created_at`) and `shots` (`type`, `upload_status` local|uploaded, `created_at` = reservation time). `0002_uploads.sql:76`: `reserve_shot` inserts the `local` row that `confirm_shot` flips to `uploaded`.
- `src/lib/operatorApi.ts:77` `getEvent` (null for unknown or malformed ids), `OperatorReadError`, `READ_TIMEOUT_MS` -- add `getParticipation` next to it.
- `src/capture/eventWindow.ts:53` `createWindowWatcher` -- the model for newest-answer-wins, polling only while visible, with injected `every` and `isVisible`. Write a separate pure refresher; don't couple it to the camera lock.
- `supabase/functions/_shared/window-rules.ts:40` `windowPhase` / `uploadsUntil`, plus `src/operator/WindowControl.tsx` -- the phase-line wording to reuse (read-only here).
- `src/screens/Operator.tsx:213,264` -- view selection by `useMatch`; add the dashboard match. `:189` the event list rows (a sibling "Dashboard" link, never nested inside the row `<Link>`).
- `src/operator/EventForm.tsx:55` `EventLinks` -- add a "Dashboard" link next to "Table cards & QR".
- `src/App.tsx:47` -- add the child route `events/:eventId/dashboard`.
- `supabase/tests/operator.test.sql` -- helper style for operator, couple and password JWT claims in pgTAP.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0009_participation.sql` -- `operator_participation(uuid)`, ordered `joined_at desc`, with grants.
- [x] `supabase/tests/participation.test.sql` -- counts (saved by type, on the way, zero shots), ordering, the event scope (another event's guests are excluded), and zero rows for couple, password and no-claims sessions. anon has no execute, and no sensitive columns are returned.
- [x] `src/operator/participation.ts` (+ test) -- pure code:
  - `toGuestRows` (snake → camel, drops malformed rows);
  - `totals`;
  - `createRefresher({load, onResult, every, isVisible})`: newest wins, `refresh()` on demand, `stop()`;
  - `formatAgo(iso, now)` ("just now", "12 min ago", "2 h ago").
- [x] `src/lib/operatorApi.ts` (+ test) -- `getParticipation(eventId)`, which throws `OperatorReadError`.
- [x] `src/operator/useParticipation.ts`, `src/operator/Dashboard.tsx` + `.css` -- `{status, rows, updatedAt, failed}`. The page shows the header with couple names and phase, the totals, the list, the Refresh button (busy state), the stale notice, the empty and not-found states and the offline hint.
- [x] `src/App.tsx`, `src/screens/Operator.tsx`, `src/operator/EventForm.tsx` -- the route, the view selection and the links.

**Acceptance Criteria:**
- Given an open event with guests shooting, when Kim opens the dashboard, then he sees each joined guest with rough per-guest counts, fresh on load and updated within about a minute while the page is visible.
- Given a guest, a couple or a signed-out caller, when they call `operator_participation`, then they get nothing.
- Given all existing suites, when run after 0009, then they still pass.

## Spec Change Log

- **Review round 1 (patch only; no loopback; no high findings):**
  - **Last shot** is now when the shot was taken: `max(coalesce(captured_at, created_at))`. A backlog uploaded hours later no longer reads as "just now".
  - **The dashboard header** reads a summary only (`getEventSummary` → `operator_events`). It no longer fetches the couple's emails every minute.
  - **One shared `windowLine`** now serves the Camera panel and the dashboard. The dashboard gains the late-upload grace wording.
  - **Refresh:**
    - "Not found" stops polling and survives a later failed refresh.
    - The hook folds a result only onto its own event's state.
    - The "Updated …" line is no longer a live region.
    - The guest list has a heading.
  - **Copy:** the hint now explains "saved" vs "on the way"; the join link uses `joinUrl()`.
  - **Data:** `toGuestRows` drops unreadable dates.
  - **Deferred:** console-wide 401/403 → sign-in prompt, and component tests (logged in `deferred-work.md`).

## Design Notes

- **Rows come from `guests` left-joined to aggregated `shots`**, so guests with zero shots still appear. On the way uses `count(*) filter (where upload_status = 'local')`.
- **A shot stuck on the way forever** (its device was lost after it reserved) keeps counting as on the way. That's honest, and fine for a glance.
- **Why an RPC, not RLS:** an operator `guests`/`shots` policy wouldn't open the couple gate, but it would widen the tables' policy surface that guest (1.6) and couple (2.2) reads depend on. One definer function keeps the operator's read in a single place.

## Verification

**Commands:**
- `npm run test`, `npm run lint`, `npm run build` -- green; the guest bundle size is unchanged.
- `npx supabase db reset`, then `npm run test:db` -- all suites pass.

**Manual checks:**
- Live: the operator session gets rows over REST RPC; couple and anon sessions get `[]` or 401.
- Browser: join 2 guests and shoot. The dashboard shows both newest first with the right counts and updates after Refresh. Going offline shows the stale notice; an unknown id shows not found.

**Implementation notes:**
- Implemented inline, with the full three-reviewer review (blind, edge-case, verification-gap). The verification-gap reviewer found nothing. Patches applied and re-verified live.
- Gates: 425 vitest; 9 pgTAP suites / 302 assertions; lint clean; build OK. The guest bundle is unchanged at 546.9 kB; the console chunk grew by about 7 KB.
- Live REST, as the operator: rows newest first with the correct counts. A backlog shot (reserved 3 min ago, taken 60 min ago) doesn't move "last shot". The couple gets `[]`; anon gets 401 (42501).
- Browser checks:
  - totals and rows are correct;
  - Refresh picks up a finished upload;
  - a simulated offline refresh keeps the numbers with "Couldn't refresh — showing …";
  - an unknown or malformed id shows "Event not found";
  - an event with no guests shows the join-link hint;
  - a closed event shows "uploads have closed too";
  - at 375 px there's no sideways scroll;
  - the links from the event list and the event page work;
  - the refactored Camera panel shows the same wording.

## Suggested Review Order

**The operator-only read — start here (it's the data exposure)**

- One security-definer read, answering only when `is_operator()`: no RLS policy, and the couple gate stays untouched.
  [`0009_participation.sql:50`](../../supabase/migrations/0009_participation.sql#L50)

- Names, times and counts only; `authenticated` may call it, anon may not.
  [`0009_participation.sql:17`](../../supabase/migrations/0009_participation.sql#L17)

- "Last shot" = capture time, so a late backlog isn't "just now".
  [`0009_participation.sql:46`](../../supabase/migrations/0009_participation.sql#L46)

**Client reads**

- Participation over the RPC; a malformed id never reaches the server.
  [`operatorApi.ts:110`](../../src/lib/operatorApi.ts#L110)

- Header read without couple emails (it's polled every minute).
  [`operatorApi.ts:76`](../../src/lib/operatorApi.ts#L76)

**Refresh behaviour**

- Newest answer wins; hidden tabs don't poll; nothing reported after stop.
  [`participation.ts:111`](../../src/operator/participation.ts#L111)

- A failed refresh keeps what's on screen (data, or "not found").
  [`participation.ts:78`](../../src/operator/participation.ts#L78)

- Hook: stops on "not found", folds results only onto its own event.
  [`useParticipation.ts:38`](../../src/operator/useParticipation.ts#L38)

**The page**

- Totals, stale notice, guest rows, empty and offline hints.
  [`Dashboard.tsx:47`](../../src/operator/Dashboard.tsx#L47)

- One shared window line for the Camera panel and the dashboard.
  [`windowLine.ts:6`](../../src/operator/windowLine.ts#L6)

- Route and view selection; Dashboard links sit beside rows, never nested.
  [`Operator.tsx:223`](../../src/screens/Operator.tsx#L223)

**Tests**

- pgTAP: counts, order, scope, and nothing for couple, password, no-email or guest callers.
  [`participation.test.sql:53`](../../supabase/tests/participation.test.sql#L53)

- Refresher with fake timers: visibility, newest-wins, failures, stop.
  [`participation.test.ts:102`](../../src/operator/participation.test.ts#L102)
