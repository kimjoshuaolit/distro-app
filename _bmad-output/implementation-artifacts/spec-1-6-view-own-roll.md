---
title: 'Story 1.6 — View my own roll'
type: 'feature'
created: '2026-09-23'
status: 'done'
review_loop_iteration: 0
baseline_commit: '63d382197e2475de4952b257f0427dfe2f9e6824'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-5-offline-safe-upload.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Guests can shoot and upload, but can't see what they've shot. They need a contact sheet of their own roll (FR11), provably private to them (FR12), including shots that are only in the cloud because the phone evicted them.

**Approach:** A "My Roll" screen that renders instantly from the phone's IndexedDB shots, then merges the guest's server rows (read through a real RLS policy keyed by their device token) for per-shot status. Cloud-only uploaded shots load through short-lived signed view URLs from a new edge function (AD-2). Photos show as baked; clips play with the retro look applied at playback (CSS grade, grain, vignette, date stamp), never baked (AD-8). Captures are final: no delete, no retake.

## Boundaries & Constraints

**Always:** The local roll renders without waiting on the network; a server/offline failure silently degrades to device-only (AD-1). Guest reads go through RLS scoped by the `x-device-token` request header, with no anon policy that could expose another guest's rows (AD-3/AD-5). Media is only ever device object URLs or ≤10-minute signed R2 GET URLs issued after an ownership check (AD-2). Object URLs are revoked on unmount. Tap targets ≥44px; viewer is keyboard- and screen-reader-operable.

**Ask First:** Any write path from My Roll (delete/hide/retake/download). Changing how guests are identified.

**Never:** No other guest's shots, counts or names reachable. No public bucket URLs. No baking retro into stored video. No couple/operator surfaces.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Device + server agree | local shots; server rows for the uploaded ones | grid in capture order, frames numbered; badge "Saved" (uploaded on either side) or "Saving…" (still local) | N/A |
| Offline / server read fails | local shots, network down | same grid from the device, statuses from local | no error shown; no cloud-only tiles |
| Cloud-only, uploaded | server row `uploaded`, blob missing on device | tile loads via signed view URL, badge "Saved" | URL fetch fails → "Unavailable" tile |
| Cloud-only, never uploaded | server row `local`, not on device | muted "Unavailable" tile (nothing to show) | N/A |
| Refused over limit | local `rejected` | tile shows the image with "Not saved — over the limit" | N/A |
| Empty roll | no local shots, no server rows | gentle empty state + "Back to camera" | N/A |
| RLS | anon read with own token / other token / no token | only own rows / other guest's only / zero rows; anon cannot insert/update/delete | N/A |
| View URLs | ids not owned, not uploaded, or unknown | omitted from response; >30 ids, non-uuid, bad token → 400/404 | client shows "Unavailable" |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0002_uploads.sql` — pattern for SECURITY DEFINER fns + explicit `revoke … from public, anon, authenticated`; `shots.client_shot_id`, `upload_status`. RLS on `shots`/`guests` is deny-by-default (0001).
- `supabase/functions/_shared/r2.ts` — `client()`, `objectUrl()`, `presignPut`; add `presignGet` here. `issue-upload-url/index.ts` = EF shape to copy (cors/json/fail, service role, typed errors). `_shared/join-rules.ts` `isUuid`.
- `supabase/tests/reserve_shot.test.sql` — self-contained pgTAP pattern (own event/guests, rollback); `npm run test:db`.
- `src/lib/supabase.ts` — singleton anon client; postgrest builders support `.setHeader(name, value)` for the per-request token.
- `src/lib/api.ts` — `parseFunctionError`, `UploadError`, `FUNCTION_TIMEOUT_MS`; add roll reads here. Mock pattern in `api.test.ts`.
- `src/capture/db.ts` — `getShotsByEvent`, `Shot`, client-only `'rejected'` status.
- `src/capture/useUploader.ts` — mount on My Roll too so uploads keep draining; its `pendingCount` changes signal a status refresh.
- `src/capture/retro.ts` — `formatStamp(date)` for the playback stamp; tokens `--font-stamp`, `--stamp-orange`.
- `src/screens/Camera.tsx` — `camera__spacer` slot in the button row → roll entry point; `getGuestSession`/`Navigate` redirect pattern. `src/App.tsx` routes.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0003_own_roll.sql` — `current_guest_id()` STABLE SECURITY DEFINER: guest id for `request.headers ->> 'x-device-token'` (safe when the setting is absent/empty), execute revoked from public and granted to anon (policy evaluation needs it; it only ever returns the caller's own id); `shots` SELECT policy `to anon using (guest_id = current_guest_id())`. No insert/update/delete policies.
- [x] `supabase/functions/_shared/r2.ts` — add `presignGet(key, ttlSeconds)`.
- [x] `supabase/functions/issue-view-urls/index.ts` — POST `{deviceToken, clientShotIds}` (1–30 uuids); service role; returns `{ urls: { [clientShotId]: signedGetUrl }, expiresIn: 600 }` for the guest's `uploaded` shots only.
- [x] `src/lib/api.ts` — `getServerRoll(deviceToken)` (select `client_shot_id,type,upload_status,captured_at` with the `x-device-token` header) and `issueViewUrls(deviceToken, ids)`, both with timeouts.
- [x] `src/roll/buildRoll.ts` — pure merge of local shots + server rows into ordered `RollItem`s (frame no., type, capturedAt, status `saved|saving|not_saved|unavailable`, media source), plus fetching view URLs for cloud-only uploaded items via an injected fn, tolerant of every failure.
- [x] `src/roll/useRoll.ts` — hook: device-first render, then server merge; creates/revokes object URLs; refreshes when the uploader's pending count changes.
- [x] `src/ui/RetroPlayback.tsx` + `.css` — wraps a `<video>`: warm-grade CSS filter, animated grain, vignette, burned-in-style date stamp (`formatStamp`, event-local).
- [x] `src/ui/RollViewer.tsx` + `.css` — full-frame dialog: prev/next buttons, swipe, ←/→/Esc, frame "N / total", close; clips via `RetroPlayback` with controls.
- [x] `src/screens/Roll.tsx` + `.css` — `/r/:eventToken` (no session → join): header with name + "Back to camera", contact-sheet grid of film frames with status badges, empty state; mounts `useUploader`.
- [x] `src/screens/Camera.tsx` + `src/App.tsx` — "My roll" button in the spacer slot; register the route.
- [x] Tests — `src/roll/buildRoll.test.ts` (matrix rows 1–6), `src/lib/api.test.ts` (header set, view-URL call/errors), `supabase/tests/own_roll.test.sql` (RLS row), EF verified live.

**Implementation notes (deviations from the plan above):**
- View-URL ownership moved into a SQL function `viewable_shot_keys(token, ids[])` (service_role-only, pgTAP-tested) and request validation into `supabase/functions/_shared/view-rules.ts` (vitest) — so matrix row 8 is covered by tests that run, not just a live check. Same pattern as `confirm_shot` in 1.5.
- `current_guest_id()` is executable by `anon` (the policy needs it) and revoked from `public`/`authenticated`; it can only ever return the caller's own id.
- Review round 1 (3 subagents) → patches: object URLs cached per shot and signed view URLs cached with expiry (pure, tested `src/roll/rollSession.ts`), so upload-progress refreshes no longer restart a playing clip and links refresh before they lapse or after a media error (rate-limited); roll reloads on `online`/visible; viewer counts against the whole roll, background `inert` + scroll-locked, single focus owner, swipe cancel/click suppression; badges wrap instead of truncating; RLS uses `(select current_guest_id())`, covers `authenticated` (a signed-in couple on the same phone), column grants hide `r2_key`/ids from guests, malformed headers yield NULL; view-URL TTL/mapping moved to tested `view-rules.ts` helpers with parallel signing.
- My Roll is bundled eagerly: lazy-loading was tried and reverted in review (no service worker → the chunk can't load offline, and a failed fetch blanked the app). Bundle size deferred.
- Closing the viewer focuses the tile of the frame last viewed (Safari doesn't focus buttons on tap, so the viewer's own "restore previous focus" isn't enough).
- Verified the CORS preflight: Kong reflects requested headers, so `x-device-token` passes; RLS also verified over real PostgREST HTTP, not only pgTAP.

**Acceptance Criteria:**
- Given a guest with shots, when they open My Roll, then their photos and clips appear as a contact-sheet grid from device + cloud, each tappable to full-frame (FR11).
- Given two guests on the same event, when one reads the roll, then the other's shots are never returned or viewable (FR12).
- Given a guest who hasn't shot yet, when they open My Roll, then a gentle empty state appears.
- Given a clip, when it plays full-frame, then it shows the retro grade, grain and date stamp without the stored file being altered.

## Design Notes

Why header-keyed RLS instead of an RPC: guests have no Supabase auth session, but PostgREST exposes request headers to policies, so a real `shots` policy enforces privacy in the database (testable in pgTAP with `set local request.headers`). The device token is a 64-hex secret, so it works as a bearer credential. Verify the browser CORS preflight allows `x-device-token` through Kong; if it doesn't, fall back to sending it through a permitted header, not an RPC.

## Verification

**Commands:**
- `npm run test` / `npm run lint` / `npm run build` — green.
- `npx supabase db reset` then `npm run test:db` — reserve/confirm + own-roll RLS suites pass.

**Manual checks:**
- Functions served locally: `issue-view-urls` returns working signed GET URLs only for the caller's uploaded shots.
- In-app browser with the synthetic camera: shoot photos + a clip, open My Roll, check the grid, statuses and full-frame viewer (clip retro overlay); delete a shot from IndexedDB to confirm the cloud-only path; confirm the empty state for a fresh guest.

## Suggested Review Order

**Privacy boundary — guest RLS (FR12) — start here**

- The whole design hinges on this: device token from the request header → guest id, never anyone else's.
  [`0003_own_roll.sql:13`](../../supabase/migrations/0003_own_roll.sql#L13)

- The read-only own-roll policy; `(select …)` evaluates once per statement.
  [`0003_own_roll.sql:79`](../../supabase/migrations/0003_own_roll.sql#L79)

- Column grants: guests see metadata, never storage keys or internal ids.
  [`0003_own_roll.sql:74`](../../supabase/migrations/0003_own_roll.sql#L74)

- Client sends the token as a per-request header on this one query.
  [`api.ts:200`](../../src/lib/api.ts#L200)

**Viewing cloud-only shots (AD-2)**

- Ownership decided in SQL: own + uploaded only; everything else omitted.
  [`0003_own_roll.sql:49`](../../supabase/migrations/0003_own_roll.sql#L49)

- Edge function: validate → guest → viewable keys → parallel signing.
  [`issue-view-urls/index.ts:53`](../../supabase/functions/issue-view-urls/index.ts#L53)

- TTL is pinned into the URL; without it links would default to a day.
  [`view-rules.ts:31`](../../supabase/functions/_shared/view-rules.ts#L31)

- Request validation shared with vitest (≤30 uuids, token required).
  [`view-rules.ts:41`](../../supabase/functions/_shared/view-rules.ts#L41)

**Building the roll — device first, never throws (AD-1)**

- Merge device + server: status per shot, capture-time order, frame numbers.
  [`buildRoll.ts:40`](../../src/roll/buildRoll.ts#L40)

- Server/URL failures degrade to device-only or "Unavailable", never an error.
  [`buildRoll.ts:103`](../../src/roll/buildRoll.ts#L103)

- Paint from the phone first, then commit the merged roll.
  [`rollSession.ts:103`](../../src/roll/rollSession.ts#L103)

- One object URL per shot, reused — refreshes don't restart playing clips.
  [`rollSession.ts:16`](../../src/roll/rollSession.ts#L16)

- Signed URLs cached with expiry; only stale/missing ones re-fetched.
  [`rollSession.ts:56`](../../src/roll/rollSession.ts#L56)

- Thin hook: reload on upload progress, reconnect, app-visible, pre-expiry.
  [`useRoll.ts:28`](../../src/roll/useRoll.ts#L28)

- Media load errors re-fetch that link, rate-limited so a dead link can't spin.
  [`useRoll.ts:114`](../../src/roll/useRoll.ts#L114)

**UI**

- Contact sheet, empty state, uploader kept running for live badges.
  [`Roll.tsx:71`](../../src/screens/Roll.tsx#L71)

- Page behind the viewer is inert and scroll-locked; Roll owns focus return.
  [`Roll.tsx:108`](../../src/screens/Roll.tsx#L108)

- Swipe that ends on a control must not also click it.
  [`RollViewer.tsx:71`](../../src/ui/RollViewer.tsx#L71)

- Retro at playback: grade, grain, vignette, stamp over an untouched file (AD-8).
  [`RetroPlayback.tsx:16`](../../src/ui/RetroPlayback.tsx#L16)

- Grain only animates while playing (battery).
  [`RetroPlayback.css:27`](../../src/ui/RetroPlayback.css#L27)

- Entry point from the camera's spare button slot.
  [`Camera.tsx:286`](../../src/screens/Camera.tsx#L286)

**Tests**

- pgTAP acting as the browser: anon/authenticated + headers, columns, writes refused.
  [`own_roll.test.sql:23`](../../supabase/tests/own_roll.test.sql#L23)

- Media/URL caches, load sequencing and viewer mapping in plain node.
  [`rollSession.test.ts:33`](../../src/roll/rollSession.test.ts#L33)
