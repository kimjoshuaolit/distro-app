---
title: 'Story 1.2 — Guest joins from the QR link'
type: 'feature'
created: '2026-09-19'
status: 'done'
review_loop_iteration: 0
baseline_commit: '64c48f862135b609ff61022607590e101369f378'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-1-project-foundation-deployed-shell.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app shell has no backend and no way in. A guest scanning the QR needs to land, give a first name, and receive their own roll identity plus the 25-photo / 5-clip allotment — created server-side so it cannot be forged.

**Approach:** Stand up the Supabase data model (`events`/`guests`/`shots` + RLS) and a `join-event` Edge Function that validates the event window and creates the guest + allotment server-side, returning an opaque device token the client stores. Build the QR-link welcome/name screen with clear open / closed / invalid states. Develop against a local Supabase stack (CLI + Docker); hosted deploy is documented, not executed.

## Boundaries & Constraints

**Always:**
- Guest row + allotment are created ONLY server-side by `join-event` (service role); the client never inserts a guest or sets a quota (AD-5, AD-4).
- RLS enabled on all three tables; in this story anon has NO direct table access. Guest access = a read-only `event_status` RPC (safe status fields only) + the `join-event` function.
- Window validation is server-authoritative in `join-event`; the client's on-load status read is UX only and re-checked at join.
- Device token is opaque + random, stored in `localStorage` keyed per event, every access in try/catch.
- Core rules (`validateFirstName`, `isEventOpen`, `isUuid`) live in a pure, unit-tested module the function imports; IO wrappers stay thin.
- Conventions: tables snake_case plural, functions kebab-case, UUID v4 ids; service-role key only in function env; client gets only anon key + URL. Supabase artifacts under `supabase/`, runnable via CLI + Docker.

**Ask First:**
- Creating/linking a hosted Supabase project or deploying to the cloud (needs the user's account). Local is the build target.

**Never:**
- No camera/capture/upload/own-roll view (1.3–1.6); `shots` is created but not read/written by guests here.
- No couple/operator auth (Epics 2–3). No client-side guest creation, quota, or direct writes to `guests`/`shots`. No anon exposure of sensitive event columns (couple_owner, montage_key).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error |
|----------|--------------|-------------------|-------|
| Join open event | valid id, window open, name "Ana" | guest created {photos 25, clips 5}, opaque token returned + stored, joined state shown | — |
| Closed / not-yet-open | valid id, now outside window | clear "not open" message; join blocked | `join-event` 403 `event_closed` |
| Invalid link | id unknown or not a uuid | "invalid link" message; cannot join | `join-event` 404 `event_not_found` |
| Empty / whitespace name | open event, name " " | submit disabled; server rejects; friendly re-prompt | 400 `invalid_name` |
| Over-long name | name > 40 chars | trimmed/limited; rejected if still invalid | 400 `invalid_name` |
| Already joined on device | localStorage has token for event | name form skipped, joined state; no duplicate guest | storage throws → fall back to name form |
| Anon direct table read | anon selects guests/shots/events | RLS denies (no rows) | — |

</frozen-after-approval>

## Code Map

Continuity from Story 1.1 (`done`): tokens in `src/styles/tokens.css`; `BrowserRouter` in `src/main.tsx`; catch-all route already in `App.tsx`; `.env.example` already has the two `VITE_` vars; screen-styling pattern from `Placeholder.tsx/.css`.

- `src/App.tsx` -- add `/j/:eventToken` route.
- `src/lib/supabase.ts` -- (new) anon client from `VITE_` env.
- `src/lib/api.ts` -- (new) `getEventStatus` (rpc) + `joinEvent` (functions.invoke).
- `src/lib/guestSession.ts` -- (new) per-event token store, try/catch.
- `src/screens/Join.tsx` + `Join.css` -- (new) welcome / name / states / joined UI.
- `supabase/config.toml`, `supabase/migrations/0001_init.sql`, `supabase/seed.sql` -- (new) local project, schema+RLS+RPC, test event.
- `supabase/functions/_shared/join-rules.ts` -- (new) pure rules.
- `supabase/functions/join-event/index.ts` -- (new) Deno EF.
- `package.json` -- add `@supabase/supabase-js`; devDeps `supabase`, `vitest`; `test` script.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/config.toml` -- init local Supabase config (`supabase init`).
- [x] `supabase/migrations/0001_init.sql` -- `events`/`guests`/`shots` with constraints + indexes; enable RLS on all three with NO anon policies (default deny); `event_status(uuid)` `SECURITY DEFINER STABLE` returning only is_open/opens_at/closes_at, granted to anon.
- [x] `supabase/seed.sql` -- one event, fixed uuid, open window, for dev/testing.
- [x] `supabase/functions/_shared/join-rules.ts` -- pure `validateFirstName`, `isEventOpen`, `isUuid`; no runtime-specific imports.
- [x] `supabase/functions/join-event/index.ts` -- Deno EF: CORS + OPTIONS; parse `{eventToken, firstName}`; validate via join-rules; service-role client; fetch event; window check; insert guest 25/5 + random token; return `{guestId, deviceToken, firstName, photosRemaining, clipsRemaining}`; typed `{error:{code,message}}`.
- [x] `src/lib/supabase.ts` -- anon client from `import.meta.env`.
- [x] `src/lib/guestSession.ts` -- `get`/`save`/`clear` per event, storage in try/catch.
- [x] `src/lib/api.ts` -- `getEventStatus(eventId)`, `joinEvent(eventId, firstName)`.
- [x] `src/screens/Join.tsx` -- states loading / invalid / closed / open(name form) / joining / joined / error; warm microcopy (UX-DR6); labeled input, body ≥16px, button ≥44px (UX-DR8).
- [x] `src/screens/Join.css` -- on-brand welcome, tokens only.
- [x] `src/App.tsx` -- add `/j/:eventToken` → `Join`.
- [x] `package.json` + `vitest.config.ts` -- add `@supabase/supabase-js` (^2.113), devDeps `supabase` + `vitest`, `"test":"vitest run"`, vitest include `src/**/*.test.ts` + `supabase/functions/**/*.test.ts`; ignore `supabase/functions` in eslint (Deno).
- [x] `join-rules.test.ts` + `src/lib/guestSession.test.ts` -- unit-test every deterministic matrix row (name validation, window boundaries, uuid, storage get/save/clear + throw fallback).
- [x] `.env.example` + `README.md` -- local Supabase steps (`start`, `db reset`, `functions serve`, where to copy local URL + anon key) + hosted-deploy note.

**Acceptance Criteria:**
- Given a local stack with migration + seed applied, when a guest opens `/j/<open-event-id>` and submits a first name, then `join-event` creates a guest with 25 photos + 5 clips, returns an opaque token stored in localStorage, and a joined state shows (FR2, FR3).
- Given the window is closed or the id is unknown/not a uuid, when the guest opens the link, then a clear "not open"/"invalid" message shows, joining is impossible, and `join-event` independently rejects a forced attempt (FR4).
- Given the anon client, when it selects `guests`/`shots`/`events` directly, then RLS denies it (AD-3; FR12 foundation).
- Given a returning device with a stored token, when the guest reopens the link, then the name form is skipped and no duplicate guest is created.

## Design Notes

- **Guest identity (AD-5):** anon, identified by the opaque `device_token` from `join-event`, stored client-side. Own-roll RLS scoping is Story 1.6; here, deny-by-default so nothing leaks early.
- **`event_status` RPC vs anon SELECT policy:** the RPC exposes only window status for a known id, never the `events` row — a plain RLS-client read (AD-3) that keeps sensitive columns hidden.
- **Rule duplication is intentional:** `isEventOpen` is authoritative in TS (in `join-event`, unit-tested) and mirrored in SQL (`event_status`, advisory UX pre-check).

## Verification

**Commands:**
- `npm install` -- resolves supabase-js 2.x, `supabase`, `vitest`.
- `npm run test` -- exits 0; covers all deterministic matrix rows.
- `npm run build` / `npm run lint` -- exit 0 (supabase/ excluded from client tsconfig; supabase/functions ignored by eslint).
- `npx supabase start` + `npx supabase db reset` -- stack boots; migration + seed apply cleanly.
- `npx supabase functions serve join-event` + live curl/app checks -- server matrix rows: open→guest{25,5}+token; closed→403; unknown→404; empty name→400; anon direct select→denied.

**Manual checks:**
- App: `/j/<seed-id>` shows welcome + name form; join → joined + token in localStorage; reopen → form skipped; closed/invalid id → right message.

## Spec Change Log

- Review (patches, no loopback): distinguished not-yet-open (`pending`) from ended (`ended`) in `getEventStatus`/`Join`, added a client-side UUID pre-check so malformed ids resolve to `invalid` without an RPC round-trip, mapped transient RPC failures to a retryable `error` state (not `invalid`), added `aria-live` to the Join card, added `src/lib/api.test.ts`, and added a future-window seed event. Deferred (see deferred-work.md): server-side per-device dedup/idempotency, tightening CORS origin at deploy, and an automated Deno+Postgres test for the function.

## Suggested Review Order

**Security & data model (start here)**

- RLS on all three tables with no anon policies (default deny) — the whole guest-privacy posture.
  [`0001_init.sql:29`](../../supabase/migrations/0001_init.sql#L29)
- The advisory status RPC — `SECURITY DEFINER`, returns only window status, hides sensitive columns.
  [`0001_init.sql:40`](../../supabase/migrations/0001_init.sql#L40)
- The only trusted write path: window gate + server-set 25/5 allotment + opaque token.
  [`join-event/index.ts:45`](../../supabase/functions/join-event/index.ts#L45)
- Pure, unit-tested rules the function delegates to.
  [`join-rules.ts:11`](../../supabase/functions/_shared/join-rules.ts#L11)

**Client data layer**

- Status mapping (uuid pre-check, pending/ended/error) + typed join error decoding.
  [`api.ts:28`](../../src/lib/api.ts#L28)
- Opaque token persistence, guarded against blocked storage.
  [`guestSession.ts:14`](../../src/lib/guestSession.ts#L14)

**Guest UI**

- Join flow state machine (already-joined hydration, submit, error mapping, aria-live).
  [`Join.tsx:26`](../../src/screens/Join.tsx#L26)
- Route wiring.
  [`App.tsx:9`](../../src/App.tsx#L9)

**Tests (peripheral)**

- `api.ts` branch coverage added during review.
  [`api.test.ts:1`](../../src/lib/api.test.ts#L1)
