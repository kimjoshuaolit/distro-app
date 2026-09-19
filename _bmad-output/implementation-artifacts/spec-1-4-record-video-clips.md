---
title: 'Story 1.4 — Record short video clips'
type: 'feature'
created: '2026-09-19'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'ccce0bf2a6afe444ffc2f5c8a58bbed9e7666ec1'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-3-take-retro-photos.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Guests can shoot photos but not the moving moments — laughs, toasts, first dances. They need short video clips within their 5-clip limit, captured as reliably as photos.

**Approach:** Add a photo/video mode toggle to the camera. In video mode a record button captures a clip (with audio when the mic is available), auto-stopping at 10s, and writes it to IndexedDB the instant recording ends — before any network. The clip counter decrements; captures are final. The retro grade + date stamp are applied at PLAYBACK (chosen approach), so capture stays light; clips persist their capture time for that treatment.

## Boundaries & Constraints

**Always:**
- Durable-before-network (AD-1): on stop, write the recorded clip to IndexedDB immediately; a failed write never decrements or shows success.
- Clips auto-stop at 10s; stopping earlier keeps the clip (any length ≤10s) and counts it.
- Reuse the capture foundation: same IndexedDB store with `type: 'clip'`, same `guestSession` counter pattern, same durable-first discipline as photos.
- Audio is acquired on-demand when a recording starts; if the mic is denied/unavailable, record video-only rather than blocking the clip.
- Client clip counter is UX only (AD-4); decrement locally; zero clips disables recording with a finished state. Captures are final (no delete/retake).
- Feature-detect the MediaRecorder mime type (mp4 vs webm) and store the clip's actual type.
- Retro on video = a light grade + date stamp applied at PLAYBACK (not baked), per the chosen approach and AD-8 (video stays light); clips store `capturedAt` for it.
- a11y: record control ≥56px, labeled, recording state announced; mode toggle ≥44px.

**Never:**
- No baking of effects into the clip file; no in-app trim/edit/filters (AD-7/AD-8).
- No upload / signed URLs / server cap (1.5); no clip playback or gallery UI (1.6) — clips are stored now, viewed later.
- No delete/retake.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error Handling |
|----------|--------------|-------------------|----------------|
| Start recording | video mode, clips left, tap record | recording starts, elapsed timer runs, red indicator | recorder init fails → error, no count change |
| Auto-stop at 10s | recording reaches 10s | auto-stops; clip written to IndexedDB; clip counter −1 | write fails → error, counter unchanged |
| Manual stop early | tap stop at ~4s | ≤10s clip kept, written, counter −1 | same as above |
| Mic denied/unavailable | start recording, no mic | records video-only (silent), still stored + counted | never blocks the clip |
| Clips at zero | clipsRemaining 0, video mode | record disabled; "clips finished" state | — |
| MediaRecorder unsupported | no MediaRecorder / no mime type | video mode shows "clips aren't supported here" | graceful, photo mode still works |
| Mode toggle | tap photo/video | central control switches shutter⇄record; counter unchanged | — |

</frozen-after-approval>

## Code Map

Continuity from 1.3 (`done`): `Camera.tsx`/`Camera.css` (mode + controls live here), `useCamera` (video stream), `db.putShot` + `Shot` type (`type:'clip'` already allowed), `guestSession.updateRemaining`, `Counter` (shows clips), the durable-first pattern from `capturePhoto.ts`, `retro.formatStamp` (reused by the deferred playback stamp).

- `src/capture/mediaSupport.ts` -- (new) `pickClipMimeType` with an injectable support predicate.
- `src/capture/useClipRecorder.ts` -- (new) MediaRecorder hook.
- `src/capture/captureClip.ts` -- (new) `saveClip` → `putShot(type:'clip')`.
- `src/ui/RecordButton.tsx` + `.css`, `src/ui/ModeToggle.tsx` + `.css` -- (new) controls.
- `src/screens/Camera.tsx` + `Camera.css` -- add mode state + video-mode wiring.

## Tasks & Acceptance

**Execution:**
- [ ] `src/capture/mediaSupport.ts` -- `pickClipMimeType(isSupported = MediaRecorder.isTypeSupported)` → first supported of `video/mp4`, `video/webm;codecs=vp9,opus`, `video/webm;codecs=vp8,opus`, `video/webm`, else `null`.
- [ ] `src/capture/captureClip.ts` -- `saveClip(blob, { eventId, guestId })` → build `{id, type:'clip', uploadStatus:'local', capturedAt, blob, ...}` and `putShot`; throws on write failure (no phantom clip).
- [ ] `src/capture/useClipRecorder.ts` -- hook over a video `MediaStream`: `{ recording, elapsedMs, supported, error, start(onComplete), stop() }`; on `start` try to add an on-demand mic track (video-only if it fails), pick mime, record, hard-cap at 10s (auto-stop), collect chunks, on stop build the blob and call `onComplete(blob)`; clear timers/tracks on stop and unmount.
- [ ] `src/ui/RecordButton.tsx` + `.css` -- idle vs recording (red pulse + elapsed), ≥56px, disabled at 0 clips, `aria-pressed`/label.
- [ ] `src/ui/ModeToggle.tsx` + `.css` -- photo/video segmented control, ≥44px targets, labeled.
- [ ] `src/screens/Camera.tsx` + `Camera.css` -- `mode` state; bottom cluster shows [flip] [shutter|record] [mode toggle]; video mode uses `useClipRecorder`; on clip saved → `updateRemaining` clips −1 + tick/flash feedback; clips-finished + unsupported states; durable-first (decrement only after `saveClip` resolves).
- [ ] tests -- `mediaSupport.test.ts` (mime selection incl. none-supported → null, via fake predicate); `captureClip.test.ts` (stores a `clip`/`local` shot + returns it; a rejecting `putShot` propagates).

**Acceptance Criteria:**
- Given a guest in video mode with clips remaining, when they start recording, then recording auto-stops at 10s, the clip is written to IndexedDB, and the clip counter decrements by one (FR6).
- Given the guest is recording, when they stop before 10s, then the clip is kept (any length ≤10s) and counted.
- Given the mic is denied or absent, when they record, then a silent clip is still captured and stored — capture is never blocked.
- Given a durable write failure, when a recording stops, then the counter does not decrement and an error is shown.
- Given clipsRemaining is 0, when in video mode, then recording is disabled with a finished state; captures remain final (no delete/retake).

## Design Notes

- Clips mirror the photo durability discipline: `MediaRecorder.onstop` → blob → `saveClip` (durable) → only then decrement.
- On-demand mic keeps photo-only guests mic-free and never blocks a clip if the mic is denied.
- Retro grade + date stamp for video are applied at PLAYBACK (chosen approach); the reusable overlay ships with the viewing surface (Story 1.6). Clips store `capturedAt` now so that treatment can stamp them.
- MediaRecorder mime varies (Safari `video/mp4` vs Chrome `webm`); store the actual type so playback/download are correct.

## Verification

**Commands:**
- `npm run test` -- `mediaSupport` + `captureClip` unit tests pass.
- `npm run build` / `npm run lint` -- exit 0.

**Manual checks:**
- Browser (synthetic canvas stream): switch to video → record → manual stop and 10s auto-stop each write a `clip` blob to IndexedDB and drop the clip counter by one; record disabled at 0 clips; mode toggle swaps the control.
- Real phone: audio is captured with the clip; recording works on the device camera.
