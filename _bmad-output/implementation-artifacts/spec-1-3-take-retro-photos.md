---
title: 'Story 1.3 — Take retro photos'
type: 'feature'
created: '2026-09-19'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'f18c6fe06ea7c8218d074f8b93d3615085ec43a3'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-2-guest-joins-from-qr.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A joined guest can't shoot yet. They need a real disposable-camera capture: a viewfinder, a one-tap final photo with the retro look baked in, saved on-device instantly so nothing is lost, with a live count.

**Approach:** Build the guest Camera surface — friendly permission pre-prompt → `getUserMedia` viewfinder (front/back toggle) → one-tap shutter that bakes the retro effect (warm grade + grain + burned-in event-local date stamp) into a compressed JPEG, writes it to IndexedDB synchronously before any network, and decrements a live client counter. Captures are final. Photos only.

## Boundaries & Constraints

**Always:**
- Durable-before-network (AD-1): on shutter, bake + write the photo to IndexedDB synchronously; never gate capture on connectivity.
- Retro is baked into the stored image client-side (AD-8): warm grade + grain + event-local date stamp; tuned to stay flattering; intensities in named constants.
- One tap = one final photo (UX-DR10): no preview/approve/delete/retake; flash + counter tick feedback.
- If the IndexedDB write fails, do NOT decrement and surface an error — never show a shot as taken that wasn't saved.
- Client counter is UX only (AD-4); decrement locally; reaching zero disables the shutter with a "roll finished (photos)" state. Server stays the authority (1.5).
- Compress before store (~1600px long edge, JPEG) to fit budget (NFR4).
- Camera requires a guest session for the event; no session → redirect to join.
- a11y/layout (UX-DR4/8): portrait full-bleed viewfinder, slim top status (name + counter), bottom control cluster; shutter ≥56px, other controls ≥44px, labeled.
- Conventions: components PascalCase, hooks `useX`, capture code under `src/capture`, UI under `src/ui`.

**Never:**
- No video (1.4), no upload / signed URLs / server-side cap enforcement (1.5), no own-roll gallery (1.6), no couple/operator surfaces.
- No delete/retake, and no filters beyond the fixed retro style.
- No new runtime dependencies (raw IndexedDB + Canvas + getUserMedia only; a test-only devDep is allowed).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error Handling |
|----------|--------------|-------------------|----------------|
| Permission granted | user taps "turn on camera", allows | full-bleed viewfinder; front/back toggle works | — |
| Permission denied | user denies OS prompt | on-brand recovery screen with re-enable steps; no crash | NotAllowedError handled |
| No camera / unsupported | no device or no getUserMedia | friendly "camera unavailable" message | NotFoundError / unsupported handled |
| Shutter, photos left | tap shutter | one photo baked (grade+grain+stamp), written to IndexedDB, counter −1, flash+tick | write fails → error shown, counter unchanged |
| Photos at zero | photosRemaining = 0 | shutter disabled; "roll finished" (photos) state | — |
| Front/back toggle | tap toggle | stream switches facingMode; viewfinder updates | switch fails → keep current stream |
| No guest session | open `/c/:token` with no session | redirect to `/j/:token` | — |

</frozen-after-approval>

## Code Map

Continuity from 1.1/1.2 (`done`): tokens in `src/styles/tokens.css`; `guestSession` (`getGuestSession`/`saveGuestSession`) in `src/lib/guestSession.ts`; Join `joined` state in `src/screens/Join.tsx`; routes in `src/App.tsx`; vitest harness + `fake`-style stubbing pattern from `src/lib/*.test.ts`.

- `src/capture/db.ts` -- (new) IndexedDB wrapper: `putShot`, `getShotsByEvent`, `countByType`.
- `src/capture/retro.ts` -- (new) pure pixel transforms + date-stamp draw + `bakePhoto` orchestrator.
- `src/capture/capturePhoto.ts` -- (new) video frame → bake → putShot → shot meta.
- `src/capture/useCamera.ts` -- (new) getUserMedia hook (permission/stream/facingMode/switch/stop).
- `src/ui/Counter.tsx`, `src/ui/Shutter.tsx` -- (new) status counter + tactile shutter.
- `src/screens/Camera.tsx` + `Camera.css` -- (new) the camera surface.
- `src/lib/guestSession.ts` -- add `updateRemaining(eventId, patch)`.
- `src/App.tsx` -- add `/c/:eventToken` route.
- `src/screens/Join.tsx` -- `joined` state links to the camera.
- `package.json` -- add test-only `fake-indexeddb`.

## Tasks & Acceptance

**Execution:**
- [x] `src/capture/db.ts` -- open a `drc` IndexedDB with a `shots` store keyed by `id`, index on `eventId`; `putShot(shot)`, `getShotsByEvent(eventId)`, `countByType(eventId, type)`; promise-wrapped, errors rejected.
- [x] `src/capture/retro.ts` -- pure `applyWarmGrade(data)` and `applyGrain(data, seed)` on `Uint8ClampedArray` (clamped, deterministic with seed); `drawDateStamp(ctx, date, w, h)`; `bakePhoto(source, opts)` → downscale to ~1600px long edge, grade, grain, stamp, export JPEG `Blob`; intensities as `RETRO_*` constants.
- [x] `src/capture/capturePhoto.ts` -- given a `<video>` + guest/event ids: draw frame → `bakePhoto` → build shot `{id, eventId, guestId, type:'photo', blob, capturedAt, uploadStatus:'local'}` → `putShot`; return the shot meta (throws on write failure).
- [x] `src/capture/useCamera.ts` -- hook exposing `{ permission, stream, facingMode, start, switchCamera, stop, error }`; map `NotAllowedError`→denied, `NotFoundError`/unsupported→unavailable; stop tracks on unmount.
- [x] `src/ui/Counter.tsx` -- `NN · N` (photos · clips) in display font; amber near-empty, red at last; labeled for SR.
- [x] `src/ui/Shutter.tsx` -- large tactile red/gold shutter, ≥56px, disabled+desaturated at 0.
- [x] `src/screens/Camera.tsx` + `Camera.css` -- redirect if no session; pre-prompt → viewfinder + top status (name + counter) + bottom cluster (shutter, front/back); flash + tick on capture; denied/unavailable recovery; roll-finished when photos = 0.
- [x] `src/lib/guestSession.ts` -- `updateRemaining(eventId, { photosRemaining?, clipsRemaining? })` merges into the stored session.
- [x] `src/App.tsx` -- add `/c/:eventToken` → `Camera`.
- [x] `src/screens/Join.tsx` -- `joined` state shows a "Start shooting" action to `/c/:eventToken`.
- [x] `package.json` -- add devDep `fake-indexeddb` for db tests.
- [x] tests -- `retro.test.ts` (grade warms + clamps; grain deterministic per seed + bounded), `db.test.ts` (putShot/getShotsByEvent/countByType via fake-indexeddb), `guestSession.test.ts` (updateRemaining merge).

**Acceptance Criteria:**
- Given a joined guest reaching the camera, when they grant permission, then a full-bleed viewfinder shows with a working front/back toggle; when they deny, then an on-brand recovery screen explains how to re-enable (FR10, UX-DR7).
- Given the viewfinder with photos remaining, when the guest taps the shutter, then exactly one photo is captured (no approve step), the retro effect is baked into the stored image, the photo is written to IndexedDB immediately, and the photo counter decrements by one (FR5, FR9, AD-1, AD-8, UX-DR10).
- Given a captured photo, when the guest looks for delete/retake, then no such control exists (FR7) and the remaining counts stay visible.
- Given photosRemaining is 0, when on the camera, then the shutter is disabled with a roll-finished state.

## Design Notes

- Pipeline order: downscale → warm grade → grain → date stamp → JPEG. Grade stays gentle so faces stay flattering; `RETRO_*` constants are the tuning surface (AD-8 says tune against real device output).
- Silent mode: the web can't read the iOS hardware mute switch; the shutter sound is best-effort WebAudio — flash + counter tick are the primary feedback.
- Live camera capture (getUserMedia) can't be exercised in the automated browser here (no real camera); the retro + IndexedDB pipeline is unit-tested and the UI states are screenshot-verified, with the on-device shoot verified by the user on a phone.

## Verification

**Commands:**
- `npm run test` -- retro, db, and guestSession unit tests pass (all deterministic matrix logic).
- `npm run build` / `npm run lint` -- exit 0.

**Manual checks:**
- `/c/<seed-open-id>` after joining: pre-prompt renders; denying shows the recovery screen; viewfinder layout + top counter + bottom controls render in portrait.
- On a real phone: grant camera → shoot → flash + counter −1 → photo present in IndexedDB with the retro look baked in; no delete/retake control; shutter disables at 0.

## Spec Change Log

- Review (patches, no loopback): hardened the capture flow (synchronous `capturingRef` guard + ref-based count so rapid taps can't over-store; spend a shot only after the durable write confirms; clamp at 0); gated the shutter until the video frame is ready (no black-frame capture); added an in-flight guard in `useCamera` and surfaced its error on the unavailable screen; hang-proofed `db.ts` (`onblocked`/`onabort`); extracted a pure `photoLevel` (adds a `done` state, fixes "0 last!") ; added `capturePhoto.test.ts` (durability contract) and `counterLevel.test.ts`. Deferred (deferred-work.md): reconcile counter with the durable store (with 1.5), front-camera mirror convention, a "camera busy" state, and a jsdom+RTL component-test harness.

## Suggested Review Order

**Capture reliability (start here — NFR1)**

- One tap = one durably-stored shot; the counter is spent only after the write confirms.
  [`Camera.tsx:52`](../../src/screens/Camera.tsx#L52)
- Durable-before-network store; throws on failure so a lost shot is never counted.
  [`capturePhoto.ts:9`](../../src/capture/capturePhoto.ts#L9)
- IndexedDB buffer — transaction-commit durability, hang-proofed open/read.
  [`db.ts:29`](../../src/capture/db.ts#L29)

**Retro bake (AD-8)**

- Pure, deterministic pixel transforms + date stamp; canvas orchestration exports the JPEG.
  [`retro.ts:22`](../../src/capture/retro.ts#L22)

**Camera hardware**

- getUserMedia lifecycle: request/switch/stop, in-flight guard, error mapping.
  [`useCamera.ts:15`](../../src/capture/useCamera.ts#L15)

**UI**

- Viewfinder layout, permission states, flash, roll-finished.
  [`Camera.tsx:96`](../../src/screens/Camera.tsx#L96)
- Counter cue (color AND label) via the pure `photoLevel`.
  [`counterLevel.ts:4`](../../src/ui/counterLevel.ts#L4)

**Tests (peripheral)**

- Durability contract + counter-cue logic.
  [`capturePhoto.test.ts:1`](../../src/capture/capturePhoto.test.ts#L1)
