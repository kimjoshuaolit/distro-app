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
