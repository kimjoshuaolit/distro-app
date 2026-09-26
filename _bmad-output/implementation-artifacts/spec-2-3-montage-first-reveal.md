---
title: 'Story 2.3 — Montage-first reveal'
type: 'feature'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'a811b6f52e1c929db877d5a83b692c32671bc079'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-2-browse-private-collection.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The reveal is meant to be a moment, not a file dump (FR16, FR17 hero cut, UX-DR5). Right now the couple lands straight on the roll shelf, and there is no way to host the montage Kim edits outside the app (AD-7).

**Approach:** The granted view of `/reveal/:eventId` opens on a softened montage stage: cinematic letterbox, one big Play, and the caption "Press play before you scroll." The event's hosted montage plays there through a short-lived signed URL from a new couple-tier `issue-montage-url` Edge Function. The 2.2 shelf sits beneath it. With no montage, the stage shows "Your reveal is being prepared" and the shelf is still beneath. Delivery fits the narrative: Kim, the best man, hand-edits the cut and runs a local operator script (`npm run montage:upload -- <eventId> <file>`) that uploads it to R2 and sets `events.montage_key`. The couple never uploads, because it's their surprise. An in-app upload button waits for Epic 3.

## Boundaries & Constraints

**Always:**
- The montage URL is issued only after the same RLS-with-caller-JWT couple gate as 2.2 (`decideCoupleAccess`).
- `montage_key` never reaches any client.
- The URL is signed ≤1 hour. If playback errors, re-sign it once and resume at the current time.
- Play is a real `<button>` (44px+, labeled). Native controls appear once playing, with no autoplay and no muted autoplay.
- The stage letterboxes any aspect ratio and fits phone width with no horizontal scroll. Reveal tokens, 16px text.
- The operator script runs only on Kim's machine with server credentials read from a gitignored env file. It never ships to the client bundle.

**Ask First:** Any couple/guest upload path. Locking the shelf until the montage is watched. Transcoding or thumbnails.

**Never:** An auto-assembled fallback reel (deferred). Retro overlay on the montage (it's a finished cut). Public bucket URLs. Committing secrets.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Montage hosted | couple opens reveal, `montage_key` set | stage with one Play; tap → plays with controls; shelf beneath | URL fetch fails → "The montage didn't load" + retry, shelf still usable |
| Not yet hosted | `montage_key` null | stage shows "Your reveal is being prepared" (gentle, not an error); shelf beneath | N/A |
| Expired mid-watch | playback error after link lapses | re-sign once, resume at same time | second failure → the didn't-load state |
| EF gate | `issue-montage-url` `{eventId}` | couple → `{url, expiresIn}` or `{url: null}` when none | anon/other couple/password session → 403; bad body → 400 |
| Operator upload | `montage:upload <eventId> <file.mp4\|.mov\|.webm>` | streamed PUT to `events/<eventId>/montage/<timestamp>.<ext>`, then `montage_key` updated; prints success | unknown event / bad ext / missing env / upload fail → clear message, exit 1, key unchanged |
| Replace | upload again | new key wins; old object kept | N/A |

</frozen-after-approval>

## Code Map

- `supabase/functions/issue-couple-view-urls/index.ts` — copy its shape: env checks, user-scoped read of `events` → `decideCoupleAccess` (`_shared/couple-rules.ts`), service client, safe error logging.
- `supabase/functions/_shared/r2.ts:46` `presignGet(key, ttl)`; `view-rules.ts` `withExpiry`, validation pattern, `isUuid` (`join-rules.ts`).
- `supabase/migrations/0004_couple_access.sql:180` — the `events` column grant already excludes `montage_key` (verify in pgTAP).
- `src/lib/api.ts` — `issueCoupleViewUrls`/`parseFunctionError` pattern for `getMontageUrl(eventId)`.
- `src/screens/Reveal.tsx` (granted branch renders `Collection` → `RollShelf`); `Reveal.css`; `src/styles/tokens.css:20` reveal tokens. The mockup `montageStage` is in `_bmad-output/planning-artifacts/ux-designs/ux-dispo-retro-cam-2026-09-01/mockups/key-screens.html` (C1).
- Node is v24 (runs `.ts` directly). `aws4fetch` is used by Deno via `npm:`, so add it as a devDependency for the script. `vitest.config.ts` include globs cover `src/` and `supabase/functions/` only. `.gitignore` already ignores `.env` / `.env.*`.
- `supabase/functions/.env.example` — R2 env names (`R2_ENDPOINT`, `R2_BUCKET`, keys, `R2_REGION`). The host-side endpoint locally is `http://127.0.0.1:54321/storage/v1/s3`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/functions/_shared/montage-rules.ts` (+ test) -- `validateMontageRequest` (uuid `eventId`) and `MONTAGE_TTL_SECONDS` (3600) -- tested rules.
- [x] `supabase/functions/issue-montage-url/index.ts` -- the couple gate, then the service role reads `montage_key` → `{url: presigned | null, expiresIn}` -- AD-2 couple tier.
- [x] `src/lib/api.ts` -- `getMontageUrl(eventId)` with timeout and typed errors -- data access.
- [x] `src/couple/montageSession.ts` (+ test) -- pure state: `loading | none | ready | playing | failed`, plus the one-shot re-sign-and-resume rule on a playback error -- testable logic.
- [x] `src/couple/MontageStage.tsx` + `.css`; `src/screens/Reveal.tsx` -- stage above the shelf (kicker/title stay), Play overlay, caption, prepared and failed states -- the UI.
- [x] `scripts/montage-rules.ts` (+ test) and `scripts/upload-montage.ts`; `package.json` (`montage:upload` via `node --env-file=…`, add `scripts/**/*.test.ts` to vitest, `aws4fetch` dev dep); eslint/tsconfig coverage -- the operator path. Pure parts: arg parsing, ext→content-type, key naming. The script streams the file, checks the event exists, and updates `montage_key` only after a successful PUT.
- [x] `README.md` + `supabase/functions/.env.example` -- document the operator montage upload (env file, local and prod) -- Kim can run it.
- [x] Tests -- `supabase/tests/montage.test.sql` (`montage_key` unreadable by anon/authenticated/couple; the couple can still read events). EF and script verified live against local storage.

**Acceptance Criteria:**
- Given Kim runs the upload script for an event, when the couple opens their reveal, then the stage plays that montage on one Play, with the roll shelf beneath.
- Given no montage has been uploaded, when the couple opens their reveal, then they see "Your reveal is being prepared" and can still browse the shelf.
- Given anyone other than that event's couple, when they call `issue-montage-url` or read `events`, then they get no montage URL or key.

## Design Notes

A shelf beneath with a "press play before you scroll" nudge (matching the C1 mockup) was chosen over locking the collection, so a montage that fails to load never blocks the couple. A 1-hour TTL plus resume-on-error covers long cuts and pauses while staying short-lived. The timestamped key means a replaced montage is never served from a stale cache.

## Verification

**Commands:**
- `npm run test`, `npm run lint`, `npm run build` -- green.
- `npx supabase db reset` then `npm run test:db` -- all suites pass. Recreate the `shots` bucket afterwards.

**Manual checks:**
- Serve functions (`docker rm -f supabase_edge_runtime_dispo-retro-cam` first). Sign in as the couple via Mailpit: first the prepared state, then run `npm run montage:upload` with a sample mp4 and see the stage play it on one Play with the shelf beneath. Event 2's couple gets a 403, and the network log shows only a signed URL.

**Implementation notes:**
- Built in fast mode (user request): implemented inline after an interrupted subagent run, one high-severity-only review pass (no findings), unit + pgTAP + one live check.
- Live-verified locally:
  - The couple gets `{url:null}` before upload.
  - Another couple and anon get 403.
  - `npm run montage:upload` hosted a sample mp4.
  - The signed GET returns 200 video/mp4, and the unsigned address returns 403.
  - A bad extension exits 1.
  - In the browser, the stage showed one Play and played from the signed URL with native controls, with the shelf beneath.
  - At 375px there is no horizontal scroll.
- A temporary 30s TTL, left over from the interrupted run's resume test, was restored to 3600 (the unit test pins it).

## Suggested Review Order

**Who can get the montage — start here**

- Couple gate (same as 2.2) before the key is even read; `{url:null}` when not hosted.
  [`index.ts:75`](../../supabase/functions/issue-montage-url/index.ts#L75)

- Request rules and the 1-hour TTL.
  [`montage-rules.ts:9`](../../supabase/functions/_shared/montage-rules.ts#L9)

**The operator upload (Kim only)**

- Event check → streamed signed PUT → key updated only after success.
  [`upload-montage.ts:40`](../../scripts/upload-montage.ts#L40)

- Pure helpers: args, ext → content type, timestamped key, env.
  [`montage-rules.ts:35`](../../scripts/montage-rules.ts#L35)

**The stage**

- Play overlay, prepared/failed states, one re-sign-and-resume on a lapsed link.
  [`MontageStage.tsx:20`](../../src/couple/MontageStage.tsx#L20)

- Pure state machine behind it.
  [`montageSession.ts:1`](../../src/couple/montageSession.ts#L1)

- Stage above the shelf, never locking it.
  [`Reveal.tsx:230`](../../src/screens/Reveal.tsx#L230)

**Tests and docs**

- pgTAP: `montage_key` unreadable/unfilterable by every client role.
  [`montage.test.sql:10`](../../supabase/tests/montage.test.sql#L10)

- How to run the upload, local and prod.
  [`README.md:78`](../../README.md#L78)
