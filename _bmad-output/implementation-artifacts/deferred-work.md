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
