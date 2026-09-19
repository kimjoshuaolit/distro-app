# Epic 1 Context: The Guest Experience — scan, shoot, never lose a shot

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A wedding guest scans a QR, joins with a first name, and shoots a fixed roll of 25 retro photos + 5 short clips like a disposable camera — every capture final, the remaining count always visible, and every shot durable on-device the instant it's taken so nothing is lost on weak venue wifi. This epic also stands up the entire foundation the rest of the app ships onto: the Vite + React + TypeScript SPA, the Kodak Sunset design system, the Supabase `events`/`guests`/`shots` data model with RLS, the `join-event` and `issue-upload-url` Edge Functions, the IndexedDB capture-and-upload pipeline, and a Cloudflare Pages/R2 deployment. It delivers the guest's whole journey end to end while the couple/operator surfaces come in Epics 2–3.

## Stories

- Story 1.1: Project foundation & deployed shell
- Story 1.2: Guest joins from the QR link
- Story 1.3: Take retro photos
- Story 1.4: Record short video clips
- Story 1.5: Offline-safe upload & server-enforced limit
- Story 1.6: View my own roll

## Requirements & Constraints

- **No install, mobile web.** The experience opens in the guest's phone browser (iOS Safari + Android Chrome) with no app install — QR scan to first shot in seconds; the first-name field is the only gate.
- **Fixed allotment, final captures.** Each guest gets exactly 25 photos + 5 clips. Captures are final — no delete, no retake. Remaining counts are always on screen; hitting zero for a type disables it with a clear "roll finished" state. The allotment is enforced server-side, not on client trust.
- **Never lose a shot (the #1 risk).** Capture must tolerate weak/intermittent connectivity and never drop a captured shot. The shutter is never blocked on the network.
- **Video is short and self-limiting.** Clips auto-stop at 10s; stopping earlier keeps the clip (any length ≤10s).
- **Retro aesthetic.** Photos get grain + warm grade + a burned-in event-local date stamp baked into the stored image so results feel like a FunSaver. Video gets only a light grade / date stamp for MVP. No filters or editing beyond the fixed retro style.
- **Privacy.** A guest can view only their own roll; no guest can reach another guest's shots. Media is never on a public/guessable URL.
- **Cost & capacity.** ~2,500 photos + ~500 clips total must fit a personal budget; client-side compression before store and upload is the lever. Handle ~100 guests active across an evening.

## Technical Decisions

- **Paradigm: local-first SPA over Supabase (BaaS) with a thin trusted-function boundary.** The React client captures, stores durably, and renders offline. Supabase = Postgres + Auth + RLS. Edge Functions own every privileged write. Media blobs live in Cloudflare R2, never in Postgres.
- **AD-1 — Durable before uploaded.** On shutter, compressed media is written to IndexedDB *synchronously, before any network call*, and is renderable from local storage. Upload is a separate retrying background step. No feature gates capture on connectivity.
- **AD-2 — Private media via signed URLs.** R2 objects are never public. Every blob read/write uses a short-lived signed URL issued only after an authz check. R2 credentials never reach the client.
- **AD-3 — Reads via RLS client; privileged writes via Edge Functions only.** Client reads go through the RLS-scoped Supabase client. Anything that grants access, spends quota, or changes event/release state goes through an Edge Function.
- **AD-4 — 25/5 allotment is server-authoritative.** `issue-upload-url` checks remaining count and rejects overage. The client counter is UX only.
- **AD-5 — Two identity tiers.** Guests are unauthenticated, identified by an opaque per-device token; the guest row + allotment are created **server-side by `join-event`** (client never fabricates a guest/quota) and the token is stored in localStorage. Couple/operator use Supabase Auth magic link (Epics 2–3). RLS scopes a guest to their own roll only.
- **AD-6 — Single-owner data model.** `Event 1—N Guest 1—N Shot`. Postgres holds metadata + R2 keys + attribution; blobs only in R2.
- **AD-8 — Retro baked on photos client-side; video stays light.** Retro processing must never block the AD-1 durable write.

**Conventions:**
- React components PascalCase (`CameraScreen.tsx`); hooks `useX.ts`; Edge Functions kebab-case (`issue-upload-url`).
- Entities `Event`/`Guest`/`Shot` singular; Postgres tables snake_case plural (`events`, `guests`, `shots`). UUID v4 for all ids.
- R2 object key = `events/<eventId>/<guestId>/<shotId>` + file extension.
- Shot `type` ∈ `photo` | `clip`; `upload_status` ∈ `local` | `uploaded`. Dates stored UTC ISO-8601; burned-in stamp is event-local, display-only.
- Edge Function errors: JSON `{ error: { code, message } }`; never leak R2 creds.
- Config: R2 keys + service role live only in Edge Function env; client gets only the Supabase anon key + public URL.

**Stack (pinned):** Node 22 LTS · React 19.2.x · Vite 8.0.x · TypeScript 5.x · @supabase/supabase-js 2.113.x · Supabase (hosted) · Cloudflare R2 + Pages. Browser APIs: getUserMedia/MediaRecorder (capture), IndexedDB (buffer), Canvas (photo retro). Greenfield Vite scaffold — no paid starter. Single production env + local dev, no staging.

**Source tree (target):**
```
src/
  screens/   # guest G1–G4 (couple/operator screens in later epics)
  capture/   # getUserMedia, compression, retro canvas, IndexedDB buffer, upload queue
  lib/       # supabase client, api wrappers, auth
  ui/        # design-system components
supabase/
  functions/ # join-event, issue-upload-url (others in later epics)
  migrations/# events, guests, shots + RLS
public/
```

## UX & Interaction Patterns

- **Design system "Kodak Sunset" (Story 1.1 delivers as CSS variables).** Colors: gold `#F5C518` (brand/chrome/counter), kodakRed `#E1341E` (shutter + commit only), cream `#FBF3DE` (paper), ink `#2B2A26` (text on cream), amber `#C4622D`, stampOrange `#FF8A1E` (date-stamp glow), viewfinderBg `#1A120C` (camera body), onDark `#FBF3DE`. Type: Anton/Archivo Black display (poster caps, titles, counter), Archivo body (min 16px), DSEG7/monospace for the date stamp only. 8pt grid (steps 4/8/12/16/24/32/48). Rounded scale sm 6 / md 12 / lg 20 / pill 999. Mostly flat/paper; the shutter is the one tactile raised control.
- **Component set (built across the epic):** button, shutter, counter, dateStamp, nameTag, viewfinder, filmFrame, rollThumb, toast, permissionPrompt, uploadIndicator. (montageStage is Epic 2.)
- **Guest camera layout:** full-bleed viewfinder with thin gold corner brackets; slim top status bar (name + counter); bottom control cluster (shutter centered, photo/video toggle beside), one-thumb reach. Counter format `18 · 3` (photos · clips), turns amber near-empty, red at last shot — never color-alone.
- **Instant-commit interaction:** one tap = one final capture, no approve step; flash + shutter sound (respect silent mode) + counter tick as feedback.
- **Photos render as film frames:** ~4:3 cream border, grain + burned-in orange date stamp bottom-right; tuned so faces stay flattering.
- **State patterns per surface:** default, capturing, committing, full/finished, no-permission (friendly on-brand pre-prompt → OS prompt → recovery screen if denied), offline/uploading (non-blocking "your shots are safe / keep this open until all saved"), error, empty roll.
- **Voice:** warm, playful host tone; never scold a guest for a "wasted" shot. Specific copy for welcome, name entry, near-empty, final shot, offline reassurance.
- **Accessibility floor:** body ≥16px, shutter ≥56px / other controls ≥44px, labeled controls for screen readers, plain-language permission explainer, one-handed operation.
- **Responsive:** portrait phone primary (~360–430px).

## Cross-Story Dependencies

- **1.1 is the substrate** — the deployed shell + design tokens every later story builds on.
- **1.2 stands up Supabase** (`events`/`guests`/`shots` + RLS, `join-event`) and issues the device token that 1.3–1.6 all rely on for identity/attribution.
- **1.3 builds the capture + IndexedDB + retro pipeline** that 1.4 (video) reuses and extends.
- **1.5 adds the upload queue + `issue-upload-url`** (server-authoritative cap, AD-4) and the roll-finished state; depends on shots existing in IndexedDB from 1.3/1.4.
- **1.6 reads own roll** from local + uploaded via RLS; depends on the data model (1.2) and captures (1.3–1.5).
- Each story is independently shippable in sequence and must not depend on a *later* story in the epic.
