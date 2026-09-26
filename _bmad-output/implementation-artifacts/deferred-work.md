# Deferred Work

Surfaced during builds; revisit deliberately. Append-only.

- source_spec: `spec-1-2-guest-joins-from-qr.md`
  summary: Make guest join idempotent per device (avoid duplicate guests + fresh allotments on reload, private-mode storage loss, or repeated POSTs by anyone holding the event UUID).
  evidence: `join-event` generates a new device token and inserts a new 25/5 guest on every POST; normal-flow dupes are only prevented client-side via localStorage, so blocked storage or a forced POST creates unlimited guests. Likely fix: client generates+persists a device token, server upserts on (event_id, device_token); consider a per-event guest cap.

- source_spec: `spec-1-2-guest-joins-from-qr.md`
  summary: Restrict `join-event` CORS to the known app origin instead of `*` once the Cloudflare Pages URL exists.
  evidence: The function sets `Access-Control-Allow-Origin: '*'` on a state-creating endpoint; the production origin isn't known until deploy, so tighten it then.

- source_spec: `spec-1-2-guest-joins-from-qr.md`
  summary: Add an automated integration test for the `join-event` Edge Function (Deno + Postgres) covering the window gate, quota defaults, and error/status mapping.
  evidence: The trusted server path is currently verified only by live curl during the build; the pure rules it delegates to are unit-tested, but the wiring needs a Deno+PG runtime the node/vitest setup can't provide.

- source_spec: `spec-1-3-take-retro-photos.md`
  summary: Reconcile the client photo counter against the durable IndexedDB shot count (and ultimately the server) on camera mount, so a cleared/rewritten localStorage session can't diverge from stored shots.
  evidence: `Camera.tsx` seeds the counter from localStorage only; `countByType`/`getShotsByEvent` exist but aren't used to validate it. Best handled with Story 1.5's server-authoritative cap.

- source_spec: `spec-1-3-take-retro-photos.md`
  summary: Decide and apply a front-camera mirror convention consistently across the live preview and the baked JPEG.
  evidence: `useCamera` requests `facingMode:'user'` but neither the `<video>` nor `bakePhoto` mirrors selfies; modern selfie UX usually mirrors the preview.

- source_spec: `spec-1-3-take-retro-photos.md`
  summary: Give "camera busy" (getUserMedia `NotReadableError`, another app holding the camera) its own recovery message instead of the generic "unavailable".
  evidence: `useCamera` maps only NotAllowed/NotFound/Overconstrained; NotReadableError falls through to generic unavailable copy.

- source_spec: `spec-1-3-take-retro-photos.md`
  summary: Add a jsdom + React Testing Library harness (and a `*.test.tsx` include) so component/hook logic (Camera flow, useCamera error mapping) can be tested; today vitest runs node-only and the include glob is `*.test.ts`.
  evidence: The capture pipeline's pure seams are unit-tested, but Camera.tsx/useCamera.ts decision branches aren't reachable by the current toolchain, and a `*.test.tsx` would be silently skipped.

- source_spec: `spec-1-4-record-video-clips.md`
  summary: Request best-effort `navigator.storage.persist()` and handle IndexedDB eviction, since ~500KB × up to 5 clips (plus 25 photos) held locally before upload is materially more eviction-prone than photos alone (iOS Safari 7-day inactivity / storage-pressure eviction).
  evidence: Nothing calls `persist()`; `saveClip`/`capturePhoto` surface QuotaExceeded (counter isn't spent) but there's no eviction guard. Best paired with Story 1.5's upload path so clips leave the device sooner.

- source_spec: `spec-1-4-record-video-clips.md`
  summary: Add automated coverage for `useClipRecorder` lifecycle (10s auto-stop, mic-denied silent fallback, double-tap in-flight guard, empty-blob skip, onerror teardown) and the `handleClipComplete` durable-before-decrement wiring.
  evidence: These behaviors were verified only by manual browser E2E during the build (mediaSupport + captureClip pure seams are unit-tested); the hook/Camera branches need the jsdom+RTL harness above, plus mocks for MediaRecorder and getUserMedia.

- source_spec: `spec-1-4-record-video-clips.md`
  summary: Add an explicit `Shot.mimeType` field rather than relying on `blob.type` alone, to make the Story 1.6 playback/download path robust if a blob's type is ever dropped in transit.
  evidence: `saveClip` persists the recorder blob with its `type`, but `db.ts` `Shot` has no dedicated mime field; adequate today, worth hardening for the viewer/upload.

- source_spec: `spec-1-5-offline-safe-upload.md`
  summary: Reconcile the on-screen photo/clip counter with the server's authoritative remaining counts, pending-aware (client remaining = server remaining − local shots not yet reserved).
  evidence: `reserve_shot` returns `photos_remaining`/`clips_remaining` but `issue-upload-url` drops them and the client never resyncs `guestSession`; a cleared/reinstalled device or counter drift can show more shots than the server will accept (those become 'rejected'). Naively copying the server count would over-report while shots are still queued.

- source_spec: `spec-1-5-offline-safe-upload.md`
  summary: Decide the post-event upload policy (e.g. accept uploads for N days after `window_close`, and/or reject reservations whose `captured_at` is after close).
  evidence: `reserve_shot` intentionally does not check the event window — gating uploads on it would drop legitimate shots captured just before close that upload late on bad wifi (AD-1). The per-guest 25/5 cap bounds abuse, but a stale device token can still reserve its remaining allotment after the event ends.

- source_spec: `spec-1-5-offline-safe-upload.md`
  summary: Provision production Cloudflare R2 at deploy — bucket, the PUT CORS rule for the Pages origin, and `R2_*` Function secrets — and smoke-test one real upload.
  evidence: The pipeline is verified end-to-end only against the local Supabase S3-compatible endpoint; the required bucket CORS policy is documented in `supabase/functions/.env.example` but can't be applied until the Cloudflare account/Pages domain exist. Without it every browser PUT fails (and retries forever).

- source_spec: `spec-1-6-view-own-roll.md`
  summary: Bring the initial JS bundle back under Vite's 500 kB warning (now ~510 kB / 148 kB gzip) — e.g. a separate vendor chunk for supabase-js, or code-splitting only once a service worker can precache route chunks.
  evidence: It was already ~499.5 kB before Story 1.6 (supabase-js + react-dom dominate). Lazy-loading My Roll was tried and reverted in review: with no service worker, a lazy chunk can't load offline and a failed chunk fetch blanked the app — worse on venue wifi than 10 kB of extra JS.

- source_spec: `spec-1-6-view-own-roll.md`
  summary: Consider a subtle "showing shots on this phone" hint when the server roll can't be reached.
  evidence: By approved intent My Roll degrades silently to device-only when offline (matrix row 2), which review flagged as possibly confusing because cloud-only shots vanish without explanation. A product call, not a defect.

- source_spec: `spec-2-1-couple-secure-login.md`
  summary: Provision couple auth on the hosted Supabase project at deploy — enable the `before_user_created` hook, set Site URL + redirect allow-list for the Pages origin (`/reveal/*`), upload the magic-link and confirmation templates, keep email confirmations ON, and configure a custom SMTP sender — then smoke-test one real couple sign-in.
  evidence: All of these live in `supabase/config.toml`, which only applies to the local stack; on the hosted project they're dashboard settings. Without the hook, the migration's "real gate" doesn't exist, and Supabase's built-in email is heavily rate-limited and may only deliver to team addresses.

- source_spec: `spec-2-1-couple-secure-login.md`
  summary: Decide whether the couple's read access should wait for the reveal (e.g. only after `window_close` or an operator "delivered" flag), so the couple can't peek at guests' shots through the API during the wedding.
  evidence: Story 2.1's couple policies grant their event's rows as soon as they sign in; the product frames delivery as "days later, the wait is part of the ritual", but no story defines a delivery gate. A product call, not a defect.

- source_spec: `spec-2-3-montage-first-reveal.md`
  summary: If the reveal sits open for more than an hour before Play, the first tap spends the one-shot re-sign, and the couple may have to tap Play a second time.
  evidence: The review noted it as low severity. A fresh signed URL could be fetched on Play when the current one is near expiry, instead of relying on the error path.

- source_spec: `spec-3-1-operator-login-event-setup.md`
  summary: Make event creation idempotent (a client-generated id or idempotency key), so retrying after a timed-out create can't make a duplicate event.
  evidence: The review found that a create which times out on the client after the server has inserted the row, followed by a retry, gives two events. The console can't delete events (that needs an Ask First decision), so a duplicate needs SQL to remove.

- source_spec: `spec-3-1-operator-login-event-setup.md`
  summary: Add `operator:remove` / `operator:list` scripts; today revoking an operator means raw SQL on production.
  evidence: The review noted that `operator:add` exists with no counterpart. Low urgency with a single operator.

- source_spec: `spec-3-1-operator-login-event-setup.md`
  summary: Guard edits to a live or released event, and concurrent edits: warn before moving a window while guests are shooting, and add an `updated_at` check so two tabs don't overwrite each other silently.
  evidence: `operator_save_event` is last-write-wins with no state checks. The review raised it; Story 3.2's window control is the natural home for it.

- source_spec: `spec-3-1-operator-login-event-setup.md`
  summary: The auth email subject ("Your wedding reveal — here's your link") is global, so the operator's sign-in email carries couple wording in its subject line (the body is correct).
  evidence: GoTrue has one subject per template. Branching the subject on `.RedirectTo` like the body should be tried against the hosted project.

- source_spec: `spec-3-1-operator-login-event-setup.md`
  summary: In the console, handle a gateway 401 on save (expired JWT) and a mid-session `not_operator` by re-running the operator gate or signing out, instead of the generic "check your connection". Also warn before leaving a form with unsaved edits.
  evidence: `saveEvent` maps any error without the typed body to `server_error`. Rare, since supabase-js refreshes tokens, but the copy misleads when it happens.

- source_spec: `spec-3-1-operator-login-event-setup.md`
  summary: Add component and hook tests for `useOperatorSession`, `EventForm` and `Operator` once a jsdom + React Testing Library harness exists. They were verified live in the browser for 3.1.
  evidence: The review found only the pure helpers unit-tested, which matches the existing "hook lifecycle tests need a jsdom + RTL harness" deferral from Story 1.4.

- source_spec: `spec-3-2-qr-window-control.md`
  summary: Print one real test sheet of table cards on A4 and on Letter, and scan every QR with two phones, before the wedding.
  evidence: The card sizes (90×125 mm, 2×2 inside 10 mm margins) and the QR payload were checked by measurement and by decoding offline, but no print preview could be rendered in the automated browser.

- source_spec: `spec-3-2-qr-window-control.md`
  summary: Consider encoding a configured public origin (e.g. `VITE_PUBLIC_ORIGIN`) in the QR instead of `window.location.origin`, so cards printed from a preview deploy or an alternate domain still point at the live site.
  evidence: `isLocalOrigin` warns about localhost/LAN, but a `*.pages.dev` preview or old domain would pass silently. The review raised it.

- source_spec: `spec-3-2-qr-window-control.md`
  summary: A shot refused with `upload_closed` stays rejected on the device even if the operator later re-opens the event (uploads accepted again).
  evidence: `upload_closed` is terminal client-side by design (no retry loop). A re-open more than 7 days after a close is unlikely, but it would need a "retry refused shots" pass. The review raised it.

- source_spec: `spec-3-2-qr-window-control.md`
  summary: Component tests for `WindowControl` (confirm/cancel, skew, errors), `TableCards` (missing/failed/retry) and the Camera lock wiring once a jsdom + React Testing Library harness exists. Pure logic is covered: the window watcher, window rules, QR payload.
  evidence: Same harness gap as the earlier hook and component deferrals. All three were verified live in the browser for 3.2.

- source_spec: `spec-3-3-participation-dashboard.md`
  summary: Console-wide, an operator read failing with 401/403 (session expired or revoked) shows "check your connection" or "couldn't refresh" instead of a sign-in prompt. The dashboard's refresher drops `OperatorReadError.status`.
  evidence: The same pattern exists in the event list, event form and table cards. supabase-js auto-refresh makes it rare while the tab is open. The review raised it. The fix is to route 401/403 from any operator read to the session gate.

- source_spec: `spec-3-3-participation-dashboard.md`
  summary: Component tests for `Dashboard` (loading, missing, failed, stale and empty screens) and the `useParticipation` visibility/online listeners, once a jsdom + React Testing Library harness exists.
  evidence: Same harness gap as the earlier component deferrals. The pure refresher, state fold and row mapping are unit-tested, and every screen was verified live in the browser for 3.3.
