---
title: 'Story 1.5 — Offline-safe upload & server-enforced limit'
type: 'feature'
created: '2026-09-19'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'c836420ecf4361ee4c629f8533b2abb97f3baadc'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4-record-video-clips.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Captures live only in IndexedDB (Stories 1.3–1.4); nothing uploads them, and the 25/5 allotment is enforced only by the client counter, which a reload or tampering can bypass. Weak venue wifi must never lose a shot.

**Approach:** Add an `issue-upload-url` Edge Function that atomically checks the server allotment and issues a short-lived signed R2 PUT URL (AD-2/AD-4), a `confirm-upload` function that marks the shot uploaded, and a non-blocking client upload queue that drains local shots with retry/backoff and survives offline periods (AD-1). Media blobs go to Cloudflare R2 (S3-compatible), never Postgres.

## Boundaries & Constraints

**Always:** Capture stays local-first — uploading is a separate background step that never gates or blocks capture (AD-1). The allotment is server-authoritative: `issue-upload-url` decrements exactly once per shot and rejects overage (AD-4). Reservation is idempotent per `(guest, client_shot_id)` so retries never double-count. R2/service-role creds live only in Edge Function env; the client only ever receives short-lived signed URLs. Edge errors are `{ error: { code, message } }` and never leak creds. Object key = `events/<eventId>/<guestId>/<shotId>.<ext>`.

**Ask First:** Provisioning real Cloudflare R2 (account/bucket/keys) or changing the two-phase reserve→confirm shape. Any schema change beyond adding `client_shot_id` + the reserve/confirm plumbing.

**Never:** No public buckets or client-held R2 creds. No storing blobs in Postgres or Supabase Storage as the system of record. No deleting local shots on upload (own-roll view reads them in 1.6) — only flip `upload_status` to `uploaded`. No editing the retro/video pipeline. No couple/operator surfaces.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reserve (happy) | valid device token, type has remaining>0, new `client_shot_id` | decrement that type once, insert `shots` row (`upload_status=local`, `r2_key`), return signed PUT URL + key + shotId | N/A |
| Idempotent retry | same `client_shot_id` already reserved | return existing key + a fresh signed URL, **no** second decrement | N/A |
| Cap reached | type remaining == 0, unseen `client_shot_id` | HTTP 409 `cap_reached`, no row, no decrement | client stops retrying that shot, marks it over-limit |
| Bad input | missing/wrong token, bad type, non-uuid id, disallowed contentType | HTTP 400 `bad_request` (404 `guest_not_found` for unknown token) | client surfaces generic non-fatal error; shot stays local |
| R2 PUT fails / offline | signed URL issued, PUT errors or network down | shot stays `local`, queue retries with backoff; never marked uploaded, never lost | exponential backoff, resume on `online` |
| Confirm | PUT succeeded → `confirm-upload` | `upload_status=uploaded` (idempotent); local shot flipped uploaded | retry on transient failure |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0001_init.sql` — existing `shots` already has `r2_key`, `upload_status`, `captured_at`; `guests` holds `photos_remaining`/`clips_remaining`. RLS deny-by-default; EFs use service role.
- `supabase/functions/join-event/index.ts` — copy this EF shape verbatim: `cors`/`json`/`fail` helpers, `Deno.serve`, OPTIONS + POST-only, `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`, typed `{error:{code,message}}`.
- `supabase/functions/_shared/join-rules.ts` — pure-rules pattern (no runtime imports) unit-tested from the client project; mirror it for `upload-rules.ts`. `isUuid` reusable.
- `src/lib/api.ts` — client API layer; `JoinError` class + the `functions.invoke` error-unwrap pattern to mirror for `UploadError`.
- `src/capture/db.ts` — `Shot { id,eventId,guestId,type,blob,capturedAt,uploadStatus }`; `getShotsByEvent`, `putShot`. `id` IS the `client_shot_id`.
- `src/capture/capturePhoto.ts`, `src/capture/captureClip.ts` — write shots with `uploadStatus:'local'`; queue picks them up.
- `src/screens/Camera.tsx` — capture handlers (`handleCapture`, `handleClipComplete`); mount point for the uploader + indicator; `session.deviceToken` available.
- `supabase/config.toml` (`[storage.s3_protocol] enabled=true`) — local S3-compatible endpoint usable to verify SigV4 presign+PUT without real R2. `.env.example` documents client-safe keys only.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0002_uploads.sql` — add `shots.client_shot_id text` + unique `(guest_id, client_shot_id)`; add `reserve_shot(p_device_token, p_type, p_client_shot_id, p_captured_at, p_ext)` SECURITY DEFINER plpgsql that locks the guest row `FOR UPDATE`, returns existing row if `client_shot_id` seen (status `exists`), else on remaining>0 decrements that type + inserts the `shots` row with `r2_key='events/'||event_id||'/'||guest_id||'/'||shot_id||'.'||p_ext` (status `reserved`), else status `cap_reached`; returns `(status, shot_id, r2_key, photos_remaining, clips_remaining)`. Grant execute to `service_role` only.
- [x] `supabase/functions/_shared/upload-rules.ts` — pure `validateUploadRequest(payload)` (device token non-empty string, `client_shot_id` uuid, `type∈{photo,clip}`, contentType allowed, capturedAt ISO) and `extForContentType(ct)` (`image/jpeg`→`jpg`, `video/mp4`→`mp4`, `video/webm`→`webm`, strips `;codecs`; else null). No runtime imports.
- [x] `supabase/functions/issue-upload-url/index.ts` — validate via upload-rules; call `reserve_shot` RPC; `cap_reached`→409, invalid→400/404; else presign an R2 PUT URL (SigV4, ~5-min TTL, bound content-type) with `npm:aws4fetch` against `R2_ENDPOINT` (`https://<acct>.r2.cloudflarestorage.com`)/`R2_BUCKET` using `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`; return `{uploadUrl, r2Key, shotId, expiresIn}`.
- [x] `supabase/functions/confirm-upload/index.ts` — service role; resolve guest by device token; idempotent `UPDATE shots SET upload_status='uploaded' WHERE guest_id=? AND client_shot_id=?`; return `{ok:true}`.
- [x] `src/lib/api.ts` — add `UploadError`, `issueUploadUrl(deviceToken, shot)`, `putToR2(uploadUrl, blob, contentType)` (fetch PUT), `confirmUpload(deviceToken, clientShotId)`; reuse the invoke error-unwrap.
- [x] `src/capture/db.ts` — add `getPendingUploads(eventId)` (`uploadStatus==='local'`) and `markUploaded(id)`.
- [x] `src/capture/uploadQueue.ts` — `uploadShot(shot, deviceToken, deps)` orchestrator (issue→put→confirm→markUploaded) returning `'uploaded'|'cap_reached'|'retry'`; pure `nextDelay(attempt)` backoff. Dependencies injected for testability.
- [x] `src/capture/useUploader.ts` — hook draining pending shots for the event: runs on mount, on `online`, and when `bump()` is called; sequential with backoff; exposes `{ pendingCount, state, bump }` (`state∈idle|uploading|offline|error`). Non-blocking.
- [x] `src/ui/UploadIndicator.tsx` + `.css` — small status chip: "Saving… N left" / "All saved ✓" / "Offline — your shots are safe". `role="status"`.
- [x] `src/screens/Camera.tsx` — mount `useUploader(eventToken, session.deviceToken)`; call `bump()` after each durable capture; render `UploadIndicator`.
- [x] `supabase/config.toml` + `.env.example` — document `R2_*` (and local S3 endpoint) as Edge-Function-only env; keep client `.env.example` secret-free.
- [x] `src/capture/upload-rules.test.ts`, `src/capture/uploadQueue.test.ts` — unit-test the I/O matrix (validation, ext mapping, idempotent-retry, cap_reached, offline-retry/backoff) with mocked deps.

**Implementation notes (deviations from the plan above):**
- `upload-rules.test.ts` is colocated at `supabase/functions/_shared/` (matches the `join-rules.test.ts` convention; picked up by the vitest include glob).
- Added `supabase/tests/reserve_shot.test.sql` (pgTAP, `npx supabase test db`, 12 assertions) so the server-side matrix rows — idempotent replay, cap enforcement, no rows on rejection, key format, service_role-only privilege — are automated, not just hand-verified.
- `db.ts` also gained `markRejected` and a client-only `'rejected'` upload status so a `cap_reached` shot stops being retried (the server never creates a row for it; server statuses stay `local|uploaded`).
- `reserve_shot` revokes execute from `anon`/`authenticated` explicitly — Supabase auto-grants those on new public functions, so revoking from `PUBLIC` alone left `anon` able to call it (caught in verification).
- The presigned URL signs `content-type`, `content-length` and `host` (aws4fetch `allHeaders`), so it accepts only the declared type and exact byte size; `validateUploadRequest` enforces per-type caps (photo 10 MB, clip 50 MB) before any URL is issued. Presign/HEAD live in `supabase/functions/_shared/r2.ts`.
- `confirm-upload` HEAD-checks the object before recording it (409 `not_uploaded` if absent) and records via a `confirm_shot` SQL function (404 when nothing matches). Local dev needs `R2_SERVER_ENDPOINT` so the function's container can reach the host's S3 endpoint.
- Review round 1 (3 subagents) → patches: the scheduling moved into a pure, fake-timer-tested `src/capture/uploadRunner.ts` (single-flight with rerun coalescing, catch-all → error + backoff retry, offline polling, no timers after dispose); `useUploader` is a thin wrapper that also wakes on `visibilitychange`; queue errors split into `skipped` (shot-specific, doesn't block the roll) vs `retry` (transient); timeouts on every upload call; honest indicator (`checking` renders nothing, reports refused shots); `npm run test:db` script.
- Added `supabase/functions/.env.example` as the home for the `R2_*` secrets (root `.env.example` points to it).

**Acceptance Criteria:**
- Given a guest with photos remaining, when a local photo is queued, then exactly one signed PUT URL is issued, the blob lands in R2, `upload_status` becomes `uploaded`, and `photos_remaining` drops by one server-side.
- Given the same shot is retried (network flake), when `issue-upload-url` is called again with the same `client_shot_id`, then no additional decrement occurs and the shot ends uploaded exactly once.
- Given the device is offline mid-roll, when captures continue, then capture is never blocked, shots stay durable locally, and the queue resumes and drains automatically when connectivity returns.
- Given a guest at their type cap, when a further upload is attempted, then the server returns `cap_reached` and issues no URL.

## Design Notes

Two-phase reserve→confirm keeps the counter authoritative even if the R2 PUT fails: reservation decrements + creates the row; the object may arrive later on retry; `confirm-upload` only flips status. `client_shot_id` (= the IndexedDB shot `id`, a UUID) makes reservation idempotent so retries and double-taps can't over-count. Presign the PUT (not a PUT through the EF) so large blobs never transit the function. Real R2 provisioning is deferred to deploy; verify locally against the S3-compatible endpoint.

## Verification

**Commands:**
- `npm run test` — expected: new upload-rules + uploadQueue suites pass with existing suite green.
- `npm run lint` && `npm run build` — expected: clean, type-checks.
- `npx supabase start` then `npx supabase db reset` — expected: `0002_uploads.sql` applies; `reserve_shot` callable.
- `npm run test:db` — expected: pgTAP suite (`supabase/tests/reserve_shot.test.sql`) passes: cap, idempotent replay, per-type isolation, `confirm_shot`, service_role-only privileges.
- Integration (local): call `issue-upload-url` (curl/Deno) against the local stack with S3 env pointed at the Supabase S3 endpoint — expected: happy issue returns a working PUT URL, idempotent retry doesn't double-decrement, cap_reached at 0; `confirm-upload` flips status.

**Manual checks:**
- In-app browser E2E with the synthetic camera: capture a few shots, confirm the UploadIndicator drains to "All saved", toggle offline (DevTools) to confirm capture continues and the queue resumes on reconnect.

## Suggested Review Order

**Server-authoritative allotment (AD-4) — start here**

- Single trusted reserve path: row-locks the guest, idempotent per client shot, mints the key.
  [`0002_uploads.sql:21`](../../supabase/migrations/0002_uploads.sql#L21)

- `FOR UPDATE` serializes concurrent reservations from one device.
  [`0002_uploads.sql:51`](../../supabase/migrations/0002_uploads.sql#L51)

- Replay returns the original row with no second decrement — what makes retries safe.
  [`0002_uploads.sql:57`](../../supabase/migrations/0002_uploads.sql#L57)

- Explicit anon/authenticated revoke; Supabase auto-grants these on new functions.
  [`0002_uploads.sql:126`](../../supabase/migrations/0002_uploads.sql#L126)

**Upload URL issuance & storage boundary (AD-2)**

- Edge function: validate → reserve → map status to HTTP.
  [`issue-upload-url/index.ts:45`](../../supabase/functions/issue-upload-url/index.ts#L45)

- Presign binds content-type + content-length, so the size cap can't be bypassed.
  [`r2.ts:31`](../../supabase/functions/_shared/r2.ts#L31)

- Per-type byte caps bound storage cost before any URL exists.
  [`upload-rules.ts:13`](../../supabase/functions/_shared/upload-rules.ts#L13)

- Request validation shared with the client tests (pure, no runtime imports).
  [`upload-rules.ts:50`](../../supabase/functions/_shared/upload-rules.ts#L50)

**Confirmation — never trust the client's word**

- HEAD-checks the object exists before recording it uploaded.
  [`confirm-upload/index.ts:64`](../../supabase/functions/confirm-upload/index.ts#L64)

- Status flip in SQL: idempotent, owner-scoped, reports "nothing matched".
  [`0002_uploads.sql:99`](../../supabase/migrations/0002_uploads.sql#L99)

- Server-side existence check; `R2_SERVER_ENDPOINT` only for local containers.
  [`r2.ts:46`](../../supabase/functions/_shared/r2.ts#L46)

**Client queue — offline-safe, never blocks capture (AD-1)**

- Pure scheduler: single-flight, rerun coalescing, backoff, offline poll, dispose-safe.
  [`uploadRunner.ts:32`](../../src/capture/uploadRunner.ts#L32)

- `continue` (not `break`) so a capture arriving mid-read is never dropped.
  [`uploadRunner.ts:75`](../../src/capture/uploadRunner.ts#L75)

- Catch-all turns surprises into an error state plus a retry, never a stall.
  [`uploadRunner.ts:100`](../../src/capture/uploadRunner.ts#L100)

- One shot end-to-end; terminal states persist, everything else stays local.
  [`uploadQueue.ts:44`](../../src/capture/uploadQueue.ts#L44)

- Transient (offline/5xx) pauses the batch; shot-specific failures are skipped.
  [`uploadQueue.ts:35`](../../src/capture/uploadQueue.ts#L35)

- One bad shot can't block the roll.
  [`uploadQueue.ts:75`](../../src/capture/uploadQueue.ts#L75)

**Browser wiring & UI**

- Thin hook; also wakes on `visibilitychange` since phones freeze timers when locked.
  [`useUploader.ts:40`](../../src/capture/useUploader.ts#L40)

- Sends byte size; every call has a timeout so weak wifi can't wedge the queue.
  [`api.ts:130`](../../src/lib/api.ts#L130)

- PUT straight to storage; 4xx vs 5xx classified for the queue.
  [`api.ts:160`](../../src/lib/api.ts#L160)

- Bump after each durable capture — uploads trail capture, never gate it.
  [`Camera.tsx:104`](../../src/screens/Camera.tsx#L104)

- Honest chip: silent while checking, never "all saved" with shots pending or refused.
  [`UploadIndicator.tsx:15`](../../src/ui/UploadIndicator.tsx#L15)

- Client-only `'rejected'` status stops retrying cap-refused shots.
  [`db.ts:8`](../../src/capture/db.ts#L8)

**Tests & config**

- pgTAP: cap, replay identity, per-type isolation, confirm, privileges (`npm run test:db`).
  [`reserve_shot.test.sql:8`](../../supabase/tests/reserve_shot.test.sql#L8)

- Fake-timer runner tests, incl. the lost-bump regression.
  [`uploadRunner.test.ts:137`](../../src/capture/uploadRunner.test.ts#L137)

- Required R2 bucket CORS rule — deploy blocker if skipped.
  [`.env.example:17`](../../supabase/functions/.env.example#L17)
