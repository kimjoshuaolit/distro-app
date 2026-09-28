---
title: 'Story 3.4 — Download all media'
type: 'feature'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'a8f32b0ea8d060ed270a33b51c279d37e557d2c8'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-3-participation-dashboard.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** To cut the montage, Kim needs every guest's roll on his laptop, organized by guest. Today the media sits only in private storage, behind per-shot signed links (FR18, AD-7).

**Approach:**
- A **Download all** panel on the O2 Dashboard. Kim picks a folder (Chrome or Edge on desktop, File System Access API), and the app streams every uploaded shot straight into it:
  - one folder per guest, e.g. `Rosa/2026-11-14 21.40.05 photo 3f2a.jpg`;
  - `montage.<ext>` if a montage is hosted;
  - a `manifest.csv`.
- Links are signed just in time, in batches, by a new operator-gated Edge Function.
- Re-running skips files already saved, so an interrupted run resumes.

## Boundaries & Constraints

**Always:**
- **Listing.** The client lists uploaded shots through `operator_export_shots(p_event_id, p_after)`:
  - security-definer, answering only when `is_operator()`, `authenticated`-only;
  - returns `shot_id`, `guest_id`, `type`, `taken_at` (= `captured_at`, falling back to `created_at`) and `ext`;
  - pages of ≤1000, keyset on `shot_id`;
  - never storage keys.
- **Signing.** A new Edge Function, `issue-export-urls`:
  - runs the operator gate first (`is_operator()` with the caller's JWT, same as `set-window`);
  - body: `{eventId, shotIds: 0–100 unique uuids, montage?: boolean}`;
  - keys come from a service-role-only `operator_export_keys(p_event_id, p_shot_ids)` (uploaded shots of that event only; more than 100 ids returns nothing);
  - returns `{urls: {shotId: url}, montage?: {url, ext}|null, expiresIn: 600}`;
  - a row that fails to sign is omitted; keys never leave the function or reach its logs.
- **Naming.**
  - Guest folders follow join order across **all** guests, so names are stable between runs. A repeated name becomes `Sam`, then `Sam (2)`, compared case-insensitively.
  - Names are made Windows-safe: strip `<>:"/\|?*` and control characters, trim trailing dots and spaces, and change reserved names such as `CON` or `COM1`. An empty name becomes `Guest`.
  - Files are named `YYYY-MM-DD HH.MM.SS <photo|clip> <tag>.<ext>` in the laptop's local time. `<tag>` is the first 4 hex characters of the shot id, so a name never depends on which other shots exist (a late upload can't take a saved shot's name). Only an identical name (same second, same tag) gets ` (2)`. *(Renegotiated with Kim after review round 1: the earlier order-based ` (2)` could let a late upload be skipped as "already there".)*
- **Running.**
  - Streams each response to disk (never the whole set in memory), with 4 downloads at a time.
  - A file that already exists with size > 0 is skipped.
  - A failed file is re-signed and retried once; files still failing are counted, and a re-run picks them up.
  - Progress shows files done / total and bytes.
  - Cancel stops cleanly.
  - `manifest.csv` is rewritten each run: guest, path, type, taken_at (ISO). Cells starting `= + - @` are neutralised.
- **Unsupported browser** (no `showDirectoryPicker`): the panel explains "Use Chrome or Edge on a laptop" and nothing runs.
- **R2 CORS.** The documented rule adds `GET` for the site origin (the browser reads signed GETs with `fetch`).

**Ask First:** Zipping. Including shots that are still on the way. Deleting or renaming files already in the folder. Any other file-naming scheme.

**Never:** R2 credentials or storage keys in the browser. An operator RLS policy on `events`, `guests` or `shots`. A public or long-lived link (TTL > 10 min). Overwriting a saved file. Loading media into memory whole.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First run | 3 guests, 40 uploaded shots, montage hosted | 3 guest folders + `montage.mp4` + `manifest.csv`; "Saved 41" | N/A |
| Re-run after interruption | 25 of 40 already on disk | only the 15 missing are downloaded; "15 saved · 25 already there" | N/A |
| Duplicate / unsafe names | "Sam", "sam", "CON", "a/b?" | `Sam`, `sam (2)`, `CON_`, `a_b_` | N/A |
| Link expired or network blip | one file's GET fails | re-signed and retried once; if it still fails, "1 couldn't be saved — run again" | the run continues |
| Non-operator calls the EF | anon / couple / password session | 403 `not_operator`; nothing signed | N/A |
| Bad body | non-uuid ids, >100 ids, repeats | 400 `bad_request` | N/A |
| Unsupported browser | Safari / Firefox / phone | explanation, no button | N/A |
| Nothing uploaded | 0 shots, no montage | "Nothing to download yet" | N/A |

</frozen-after-approval>

## Code Map

- `supabase/functions/set-window/index.ts:48-64` -- the gate-first Edge Function to copy (`decideOperatorAccess`, `describe`, CORS, `fail`).
- `supabase/functions/issue-couple-view-urls/index.ts:89-115` + `_shared/view-rules.ts:42` `toCoupleViewUrlMap` -- tolerant parallel signing and the "all failed → 500" rule, to reuse.
- `_shared/r2.ts:46` `presignGet` -- signing; `issue-montage-url/index.ts:84-100` -- reading `montage_key` with the service role.
- `supabase/migrations/0005_couple_collection.sql:27` `couple_viewable_shot_keys` -- the key-lookup pattern (security invoker, service_role, capped ids). `0009_participation.sql` -- the operator-gated definer read pattern.
- `supabase/config.toml:18` `max_rows = 1000` -- the reason the listing is paged.
- `src/lib/operatorApi.ts` -- `getParticipation` (guests for folder names; ordered newest first, so re-sort by join time), `functionError`, `OperatorReadError`. Add `listExportShots` and `issueExportUrls`.
- `src/operator/Dashboard.tsx` -- mount `<DownloadAll>` under the totals.
- `supabase/functions/.env.example:17-23` -- the R2 CORS rule, which gains `GET`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0010_export.sql` -- `operator_export_shots` and `operator_export_keys`, with grants.
- [x] `supabase/tests/export.test.sql` -- operator-only listing:
  - uploaded shots only, event-scoped, keyset paging, `taken_at` fallback, `ext`;
  - no keys returned; couple, password and anon get nothing;
  - `operator_export_keys` is service-role only, event-scoped, uploaded-only, and returns nothing for more than 100 ids.
- [x] `supabase/functions/_shared/export-rules.ts` (+ test) -- `validateExportRequest`, `MAX_EXPORT_IDS = 100`, `EXPORT_TTL_SECONDS = 600`.
- [x] `supabase/functions/issue-export-urls/index.ts` -- the gate, validation, key lookup, signing and the montage link.
- [x] `src/operator/exportPlan.ts` (+ test) -- `safeName`, `guestFolders`, `buildPlan`, `manifestCsv` (pure).
- [x] `src/operator/exportRunner.ts` (+ test) -- `runExport(plan, deps)`. Deps are injected: `sign`, `fetchBody`, `exists`, `write`, `onProgress` and `signal`. It covers:
  - batch signing, concurrency 4, skipping existing files;
  - retrying once with a fresh link, then counting the failure;
  - cancel, and the summary.
- [x] `src/lib/operatorApi.ts` (+ test) -- `listExportShots` (follows pages) and `issueExportUrls`.
- [x] `src/operator/DownloadAll.tsx` + `.css`; `Dashboard.tsx` -- the panel:
  - support check, folder pick (`readwrite`), progress, Cancel and the summary;
  - "Keep this tab open"; "run again later to add new uploads".
- [x] `supabase/functions/.env.example`, `README.md` -- CORS `["PUT","GET"]`; one go-live line.

**Acceptance Criteria:**
- Given an event with uploaded shots, when Kim runs Download all into an empty folder, then each guest's shots land in that guest's folder with the manifest and the montage, and a second run downloads nothing new.
- Given an interrupted run, when it is run again, then only missing files are fetched and existing files are untouched.
- Given all existing suites, when run after 0010, then they still pass.

## Spec Change Log

- **Review round 1: intent gap, resolved with Kim; no high security findings.**
  - **Finding.** File suffixes came from `(taken_at, shot_id)` order. A late upload in the same second as a saved shot, with a lower id, would take the saved shot's name. The re-run would then skip it as "already there", so the late shot would never be downloaded.
  - **Amended (frozen Naming rule, with Kim's approval).** Every file name carries a 4-hex tag from its own shot id: `… photo 3f2a.jpg`. A name never depends on which other shots exist; ` (2)` is only for a fully identical name.
  - **Not reverted.** Only `buildPlan`'s naming depended on the rule, so the rest of the implementation was kept.
  - **KEEP:** two-step list/sign, streaming to swap-file writables, the size > 0 skip, and join-order folder suffixes.
- **Patches in the same round:**
  - **Listing:** pages until an empty page (never infers the end from a page size); a non-advancing page stops without duplicates; it filters `r2_key is not null` like the key lookup.
  - **Runner:**
    - `SIGN_BATCH` is 8, so links are used soon after signing.
    - A signing outage halts the run ("Couldn't get download links"), instead of about 4 calls per batch failing every file.
    - A pure `manifestFor` decides whether to write the manifest and what goes in it.
    - Montage failure is covered by tests.
  - **Edge Function:** a pure `montageLink` — no key means `null`, and a signing failure throws, never "no montage".
  - **Panel:**
    - A download that stalls for 60 seconds is dropped, and a body shorter than `Content-Length` isn't committed.
    - A manifest-write failure (for example, the file is open in Excel) is reported separately from the saved files.
    - A `.dispo-retro-cam-event` marker refuses another event's folder.
    - An ended session (401/403 on listing or signing) shows the sign-in message.
    - The wake lock is re-acquired when you return to the tab; the panel is keyed by event; "Listing…" is announced.
  - **Manifest:** a path that starts like a formula is written as `./…`, so it stays a real path. Guest names are NFC-normalized, since macOS treats NFC and NFD as one folder.
  - **Deferred** (logged in `deferred-work.md`): the in-app navigation prompt, re-downloading a re-hosted montage, file names across time zones, a size estimate, and component tests.

## Design Notes

- **Two-step access.** Listing (metadata, keyless, RLS-safe RPC) is separate from signing (the Edge Function, ≤100 ids per call, just in time). About 3,000 files at 10-minute links can't all be signed up front for a multi-GB download.
- **Stable names are the resume key.**
  - Folder suffixes come from join order across all guests, which only ever grows.
  - File names come from the shot itself: time taken, type, and the 4-hex tag of its id.
  - A later upload can never rename, or take the name of, a saved shot, and a saved file is never overwritten.
- **Streaming.** `(await fileHandle.createWritable())` plus `response.body.pipeTo(writable)` writes to a swap file that commits on close, so an existing file is always complete.

## Verification

**Commands:**
- `npm run test`, `npm run lint`, `npm run build` -- green; the guest bundle is unchanged.
- `npx supabase db reset`, then `npm run test:db` -- all suites pass.

**Manual checks:**
- Serve functions: `issue-export-urls` as the operator → 200 with urls; couple and anon → 403; a bad body → 400.
- Browser (local S3, with the `shots` bucket recreated):
  - seed a few real uploads;
  - Download all into a scratch folder shows per-guest folders, the manifest and the montage;
  - a re-run reports everything as already there.

  Where the automated pane can't drive the folder picker, test the runner against an injected fake directory instead.

**Implementation notes:**
- Implemented inline, with the full three-reviewer review (blind, edge-case, verification-gap). One intent gap, the naming rule, was renegotiated with Kim and patched. There were no high security findings.
- Gates: 466 vitest; 10 pgTAP suites / 322 assertions; lint clean; build OK. The guest bundle is unchanged at 546.9 kB; the console chunk is 69.7 kB.
- Live `issue-export-urls` checks (local S3), run before and after the patches:
  - As the operator: 200. It signs only uploaded shots of the event, leaving out an on-the-way shot and an unknown id. The montage comes back as `{url, ext: "mp4"}` and `expiresIn` is 600.
  - A signed GET returns the exact source bytes, and CORS allows `localhost:5173`.
  - The couple and anon get 403. A repeated id, more than 100 ids, or an empty request each get 400.
  - Another event gets `{urls: {}, montage: null}`.
- Browser checks (the real `DownloadAll` code, with the picker stubbed to an OPFS folder):
  - The first run saves 7 files at their exact sizes: `Rosa/`, `Sam/`, `sam (2)/`, `montage.mp4` and `manifest.csv`. The guest named "CON" has no shots, so there's no folder. The on-the-way shot is left out.
  - A re-run reports "Saved 0 · 7 already there".
  - After deleting 2 files and overwriting one with marker content, the re-run restored the 2 and left the marker file untouched.
  - A folder marked for another event is refused, and nothing is written to it.
  - An empty event shows "Nothing to download yet".
  - Without `showDirectoryPicker`, the panel says "Chrome or Edge on a laptop".
  - The real native folder dialog can't be automated; Kim should do one real run into a folder before the wedding.

## Suggested Review Order

**Who can get links — start here (bulk access to every guest's media)**

- Operator gate before the body is even read; then a service-role key lookup capped at 100.
  [`issue-export-urls/index.ts:64`](../../supabase/functions/issue-export-urls/index.ts#L64)

- Keys: uploaded shots of the named event only; more than 100 ids returns nothing; service role only.
  [`0010_export.sql:55`](../../supabase/migrations/0010_export.sql#L55)

- Listing: operator-gated definer, metadata only (never keys), keyset-paged.
  [`0010_export.sql:18`](../../supabase/migrations/0010_export.sql#L18)

- Body rules: uuid ids, no repeats, 100 max; 10-minute links.
  [`export-rules.ts:40`](../../supabase/functions/_shared/export-rules.ts#L40)

- No montage → null; a signing failure throws, never "no montage".
  [`export-rules.ts:23`](../../supabase/functions/_shared/export-rules.ts#L23)

**Names are the resume key**

- File names from the shot itself (time, type, id tag): a late upload can't take a saved name.
  [`exportPlan.ts:99`](../../src/operator/exportPlan.ts#L99)

- Guest folders in join order, case-insensitive, stable as guests join.
  [`exportPlan.ts:57`](../../src/operator/exportPlan.ts#L57)

- Windows/macOS-safe names (reserved words, NFC, root names).
  [`exportPlan.ts:37`](../../src/operator/exportPlan.ts#L37)

**The run**

- Skip saved files, sign just in time in batches of 8, 4 at a time.
  [`exportRunner.ts:64`](../../src/operator/exportRunner.ts#L64)

- Signing down → halt, not fail everything; one fresh-link retry per file.
  [`exportRunner.ts:119`](../../src/operator/exportRunner.ts#L119)

- Manifest only after a complete run, listing only files in the folder.
  [`exportRunner.ts:185`](../../src/operator/exportRunner.ts#L185)

**Writing to disk**

- Streamed to a swap-file writable; stall and short-body guards; nothing half-written is committed.
  [`DownloadAll.tsx:66`](../../src/operator/DownloadAll.tsx#L66)

- One event per folder (the marker); session-ended and manifest-failure messages.
  [`DownloadAll.tsx:199`](../../src/operator/DownloadAll.tsx#L199)

- Listing pages until empty (never trusts a page size); a gateway 401 means "not the operator".
  [`operatorApi.ts:128`](../../src/lib/operatorApi.ts#L128)

**Tests**

- pgTAP: key cap, event scope, uploaded-only, nothing for couple, password or anon.
  [`export.test.sql:47`](../../supabase/tests/export.test.sql#L47)

- Runner with a fake folder and server: resume, retry, halt, montage, cancel.
  [`exportRunner.test.ts:60`](../../src/operator/exportRunner.test.ts#L60)
