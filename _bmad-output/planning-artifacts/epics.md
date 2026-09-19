---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - prds/prd-dispo-retro-cam-2026-09-01/prd.md
  - prds/prd-dispo-retro-cam-2026-09-01/addendum.md
  - architecture/architecture-dispo-retro-cam-2026-09-01/ARCHITECTURE-SPINE.md
  - ux-designs/ux-dispo-retro-cam-2026-09-01/DESIGN.md
  - ux-designs/ux-dispo-retro-cam-2026-09-01/EXPERIENCE.md
---

# dispo-retro-cam - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for dispo-retro-cam, decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: Scanning the QR opens the experience in the phone browser with no install.
FR2: The guest enters a first name (optional last initial) before shooting; the name is attached to their roll for attribution.
FR3: Each guest is granted an allotment of 25 photos + 5 video clips.
FR4: Capture is only active during a defined event window that the operator can open/close.
FR5: Guests capture photos via the device camera; each photo decrements the remaining photo count.
FR6: Guests capture short video clips, auto-capped at 10 seconds and auto-stopping; each clip decrements the remaining clip count.
FR7: Captures are final — no delete, no retake. Remaining counts are always visible.
FR8: When an allotment reaches zero, that capture type is disabled with a clear "roll finished" state.
FR9: A retro film aesthetic (grain, warm grade, burned-in date stamp) is applied so results feel like a disposable camera.
FR10: Front/back camera toggle; no filters/editing tools beyond the fixed retro style at capture time.
FR11: A guest can view their own captured roll (photos + clips).
FR12: A guest can never see another guest's roll.
FR13: All guest rolls collect into a single private collection accessible only to the couple (and operator).
FR14: The couple's view shows all rolls, attributed by guest first name.
FR15: The collection is couple's-eyes-only by default; the couple controls whether/what gets released publicly.
FR16: Delivery is later, not same-day; the couple receives a montage-first reveal after the event.
FR17: The montage supports two paths: a hand-edited hero cut and a simple auto-assembled fallback.
FR18: The operator can generate the QR, open/close the event window, see basic participation, and download all media.

### NonFunctional Requirements

NFR1: One-shot reliability — capture must tolerate weak/intermittent connectivity and never lose a captured shot.
NFR2: No-install reach — works on guests' own phones across iOS Safari and Android Chrome without installation.
NFR3: Privacy & data — media private to the couple; guest rolls not cross-visible; a clear retention/cleanup policy after delivery.
NFR4: Cost fits a personal budget — ~2,500 photos + ~500 short videos must fit an individual's budget.
NFR5: Low friction — QR-scan to first shot in seconds; the name field is the only gate.
NFR6: Capacity — handle ~100 guests active across an evening without failing at peak moments.

### Additional Requirements

Derived from ARCHITECTURE-SPINE.md (build substrate). No formal third-party starter template; greenfield scaffold.

- Greenfield init: Vite 8.0 + React 19.2 SPA + TypeScript on Node 22+ (standard Vite scaffold, not a paid/opinionated starter). → Epic 1, Story 1.
- Supabase project setup: Postgres + Auth (magic link) + Edge Functions + Row-Level Security.
- Cloudflare R2 bucket (private media) + Cloudflare Pages deploy target.
- Data model: `events`, `guests`, `shots` tables with RLS policies; single-owner Event→Guest→Shot (AD-6).
- Edge Functions (the only privileged-write path, AD-3): `join-event` (creates guest + allotment, AD-5), `issue-upload-url` (enforces 25/5 cap, AD-4), `close-event`, `set-release`, `download-all`.
- Local-first capture pipeline (AD-1): compress → write to IndexedDB synchronously before network → per-shot background upload queue with retry.
- Media access via short-lived signed URLs only; R2 credentials server-side only (AD-2).
- Two identity tiers (AD-5): guest = opaque device token (no login); couple/operator = Supabase Auth magic link.
- Retro processing boundary (AD-8): baked into photos client-side; light grade/date-stamp only on video for MVP.
- Montage boundary (AD-7): app hosts one finished montage video + provides bulk download-all; no in-app video editing (auto-fallback reel deferred).
- Single production environment + local dev; no staging.

### UX Design Requirements

Extracted from DESIGN.md (visual identity) and EXPERIENCE.md (behavior).

UX-DR1: Implement "Kodak Sunset" design tokens as CSS variables — colors (gold #F5C518, kodakRed #E1341E, cream #FBF3DE, ink #2B2A26, amber #C4622D, stampOrange #FF8A1E, viewfinderBg #1A120C, revealBg #20130C), typography (Anton/Archivo display, Archivo body, monospace stamp), 8pt spacing, rounded scale.
UX-DR2: Build the component set with specified behavior + visuals — shutter, counter, dateStamp, nameTag, viewfinder, filmFrame, rollThumb, montageStage, toast, uploadIndicator, permissionPrompt.
UX-DR3: Retro effect on captured photos (grain + warm grade + burned-in event-local date stamp), tuned so faces stay flattering; video gets light grade/date stamp only for MVP.
UX-DR4: Guest camera layout — full-bleed viewfinder, slim top status bar (name + counter), bottom control cluster (shutter centered, photo/video toggle), one-thumb reach; full-warmth palette.
UX-DR5: Couple reveal (C1) — softened warm variant, montage-first stage with a single Play, rolls attributed by name beneath; comfortable laptop layout allowed.
UX-DR6: Voice & microcopy — warm/playful host tone; specific strings for welcome, name entry, near-empty, final shot, offline reassurance; never scold for a "wasted" shot.
UX-DR7: State patterns per capture surface — default, capturing, committing, full/finished, no-permission (friendly pre-prompt → OS prompt → recovery), offline/uploading (non-blocking), error, empty roll.
UX-DR8: Accessibility floor — body ≥16px, shutter ≥56px / controls ≥44px, not color-alone for near-empty, plain-language permission explainer, one-handed operation, labeled controls for screen readers.
UX-DR9: Responsive — portrait phone primary (~360–430px); couple reveal also comfortable on laptop.
UX-DR10: Instant-commit interaction — one tap = one final capture (no approve step); flash + shutter sound (respect silent mode) + counter tick as feedback.

### FR Coverage Map

FR1: Epic 1 - QR opens no-install web app
FR2: Epic 1 - Guest first-name entry, attached to roll
FR3: Epic 1 - 25 photos + 5 clips allotment
FR4: Epic 1 - Event window exists/open for capture (richer ops in Epic 3)
FR5: Epic 1 - Photo capture decrements count
FR6: Epic 1 - Video clip capture (≤10s), decrements count
FR7: Epic 1 - Captures final, counts visible
FR8: Epic 1 - Allotment zero → roll-finished state
FR9: Epic 1 - Retro film aesthetic on photos
FR10: Epic 1 - Front/back toggle, fixed retro style
FR11: Epic 1 - Guest views own roll
FR12: Epic 1 - Guest cannot see others' rolls
FR13: Epic 2 - Private collection (couple + operator)
FR14: Epic 2 - Couple view, attributed by name
FR15: Epic 2 - Couple's-eyes-only default + release control
FR16: Epic 2 - Later, montage-first reveal
FR17: Epic 2 - Montage (hosted hero cut; auto-fallback deferred)
FR18: Epic 3 - Operator: QR, participation, download-all

## Epic List

### Epic 1: The Guest Experience — scan, shoot, never lose a shot
A guest scans the QR, joins with their name, and shoots their 25-photo / 5-clip retro roll (final-shot rule, live counter, roll-finished state) with every capture durable offline and uploaded per-shot, then can view their own roll. Stands up the whole foundation (Vite+React+Supabase+R2, events/guests/shots data model, join-event + issue-upload-url Edge Functions, IndexedDB capture pipeline, Kodak Sunset tokens + camera components) plus a minimal event + open window so capture has a context.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, FR12
**NFRs:** NFR1, NFR2, NFR4, NFR5, NFR6

### Epic 2: The Couple's Reveal & Private Collection
The couple logs in via Supabase magic link, gets the montage-first reveal, then browses every roll attributed by guest name — private by default, with release control. Includes hosting the finished montage video the reveal plays and signed-URL viewing of all media.
**FRs covered:** FR13, FR14, FR15, FR16, FR17
**NFRs:** NFR3

### Epic 3: The Operator Console
The operator creates and configures the event, generates the printable QR, opens/closes the event window, watches participation during the night, and downloads all media to cut the montage.
**FRs covered:** FR18 (plus richer FR4 event-window operations)
**NFRs:** NFR3

## Epic 1: The Guest Experience — scan, shoot, never lose a shot

A guest scans the QR, joins with their name, and shoots their 25-photo / 5-clip retro roll with every capture durable offline, then views their own roll. This epic also stands up the foundation for the whole app.

### Story 1.1: Project foundation & deployed shell

As the builder,
I want a deployed Vite + React app shell styled with the Kodak Sunset design tokens,
So that every later story ships onto a live, on-brand foundation.

**Acceptance Criteria:**

**Given** a fresh repo
**When** the project is scaffolded with Vite 8 + React 19 + TypeScript on Node 22+
**Then** it builds and runs locally, and a placeholder route renders
**And** the Kodak Sunset tokens (colors, typography, 8pt spacing, rounded scale from DESIGN.md) exist as CSS variables used by a base app shell

**Given** the built app
**When** it is deployed to Cloudflare Pages
**Then** it is reachable at a public URL over HTTPS on a mobile browser (covers NFR2)

### Story 1.2: Guest joins from the QR link

As a wedding guest,
I want to scan the QR and enter my first name,
So that I get my own camera roll tied to me.

**Acceptance Criteria:**

**Given** the Supabase project with `events`, `guests`, `shots` tables and RLS, and a seeded event with an open window
**When** a guest opens the QR URL (event token in the link)
**Then** a warm welcome screen loads with no install (FR1) and prompts for a first name (FR2)

**Given** a guest submits a first name
**When** the `join-event` Edge Function runs
**Then** it creates a guest row with an allotment of 25 photos + 5 clips (FR3), returns an opaque device token stored locally, and the name is attached to the roll

**Given** the event window is closed or the event token is invalid
**When** a guest opens the link
**Then** they see a clear "not open" / "invalid" message and cannot join (FR4)

### Story 1.3: Take retro photos

As a guest,
I want to take photos with a live viewfinder and a visible counter,
So that I can shoot the wedding like a disposable camera.

**Acceptance Criteria:**

**Given** a joined guest
**When** they reach the camera
**Then** a friendly permission pre-prompt precedes the OS camera prompt; if denied, a recovery screen explains how to re-enable (UX-DR7); if granted, a full-bleed viewfinder shows with a front/back toggle (FR10)

**Given** the viewfinder is live and photos remain
**When** the guest taps the shutter
**Then** exactly one photo is captured (one tap = one final shot, no approve step, flash + tick feedback, respecting silent mode — UX-DR10), the retro effect (grain + warm grade + burned-in event-local date stamp) is baked into the stored image (FR9), the photo is written to IndexedDB immediately, and the photo counter decrements by one (FR5)

**Given** a captured photo
**When** the guest looks for a way to delete or retake it
**Then** there is no such control — captures are final (FR7), and the remaining counts stay visible

### Story 1.4: Record short video clips

As a guest,
I want to record short clips,
So that I can capture moving moments within my limit.

**Acceptance Criteria:**

**Given** a guest on the camera with clips remaining
**When** they switch to video and start recording
**Then** recording auto-stops at 10 seconds (FR6), a light grade + date stamp is applied, the clip is written to IndexedDB, and the clip counter decrements by one

**Given** the guest is recording
**When** they stop before 10 seconds
**Then** the clip is kept (any length up to 10s) and counted

### Story 1.5: Offline-safe upload & server-enforced limit

As a guest on weak venue wifi,
I want my shots saved and uploaded reliably,
So that nothing I capture is lost.

**Acceptance Criteria:**

**Given** shots stored in IndexedDB
**When** the app is online
**Then** each shot uploads individually via a short-lived signed R2 URL issued by `issue-upload-url`, with automatic retry on failure (AD-1, AD-2), and an uploadIndicator shows "your shots are saved / N uploaded" (UX-DR7)

**Given** the guest has no signal
**When** they capture
**Then** capture still works and shots remain safe locally; the app never blocks the shutter on network, and shows an honest "keep this open until all saved" nudge

**Given** a guest at their limit (25 photos or 5 clips)
**When** they attempt another capture of that type
**Then** the `issue-upload-url` function rejects overage (server-authoritative, AD-4), that capture type is disabled, and a "roll finished" state is shown (FR8)

### Story 1.6: View my own roll

As a guest,
I want to see the shots I have taken,
So that I can enjoy my roll without seeing anyone else's.

**Acceptance Criteria:**

**Given** a guest who has captured shots
**When** they open "My Roll"
**Then** their photos and clips show as a contact-sheet grid (from local + uploaded), tappable to full-frame (FR11)

**Given** any guest
**When** they are on My Roll
**Then** RLS ensures they can load only their own roll — no other guest's shots are reachable (FR12)

**Given** a guest who has not captured yet
**When** they open My Roll
**Then** a gentle empty state is shown

## Epic 2: The Couple's Reveal & Private Collection

The couple logs in, gets a montage-first reveal, and browses every roll attributed by name — private by default, with release control.

### Story 2.1: Couple secure login

As one of the couple,
I want to log in with a one-time email link,
So that only we can reach our private collection.

**Acceptance Criteria:**

**Given** the couple's email is authorized for their event
**When** they request access and click the Supabase magic link
**Then** they are authenticated and RLS grants them read access to all rolls in their event only (AD-5, FR13, NFR3)

**Given** an unauthenticated or unauthorized visitor
**When** they try to open the collection or reveal
**Then** access is denied

### Story 2.2: Browse the private collection, attributed by name

As one of the couple,
I want to see all our guests' shots grouped by who took them,
So that we can relive the day from our people's eyes.

**Acceptance Criteria:**

**Given** an authenticated couple member
**When** they open the collection
**Then** all rolls are shown attributed by guest first name (FR14), with media loaded via short-lived signed URLs only (AD-2)

**Given** the collection
**When** media is displayed
**Then** it is never served from a public/guessable URL, honoring couple's-eyes-only (FR13, NFR3)

### Story 2.3: Montage-first reveal

As one of the couple,
I want a montage to play before I browse,
So that the reveal feels like a moment, not a file dump.

**Acceptance Criteria:**

**Given** a finished montage video has been uploaded and hosted as the event's reveal asset
**When** the couple opens the reveal (C1)
**Then** the softened-palette stage plays the montage with a single Play, before the full collection is offered beneath it (FR16, FR17 hero cut, UX-DR5)

**Given** no montage video is uploaded yet
**When** the couple opens the reveal
**Then** they see a graceful "your reveal is being prepared" state rather than an error

### Story 2.4: Release control

As one of the couple,
I want to control whether our collection can be shared,
So that it stays private until we choose otherwise.

**Acceptance Criteria:**

**Given** an authenticated couple member
**When** they toggle the release setting
**Then** the `set-release` Edge Function updates the event's released flag; default is private (FR15)

**Given** the released flag is off
**When** anyone without couple/operator access tries to view
**Then** they cannot (the public-sharing surface itself is deferred per architecture Deferred list)

## Epic 3: The Operator Console

The operator creates and runs the event, generates the QR, controls the window, watches participation, and downloads all media to cut the montage.

### Story 3.1: Operator login & event setup

As the operator,
I want to log in and configure the event,
So that the app is ready for the wedding.

**Acceptance Criteria:**

**Given** the operator's authorized email
**When** they log in via magic link
**Then** they get an elevated role and can create/edit an event (couple email, display names, window dates) (AD-5, FR4)

### Story 3.2: QR generation & window control

As the operator,
I want a printable QR and open/close control,
So that guests can join only during the event.

**Acceptance Criteria:**

**Given** a configured event
**When** the operator generates the QR
**Then** a printable QR encoding the join URL + event token is produced (FR18)

**Given** the operator
**When** they open or close the event window
**Then** guest joining/capture is enabled or disabled accordingly (FR4), enforced server-side

### Story 3.3: Participation dashboard

As the operator,
I want to see participation during the night,
So that I know the game is working.

**Acceptance Criteria:**

**Given** an open event
**When** the operator opens the dashboard
**Then** they see who has joined and rough per-guest capture counts, refreshed on load (FR18)

### Story 3.4: Download all media

As the operator,
I want to download every roll in bulk,
So that I can edit the hero montage in my own tools.

**Acceptance Criteria:**

**Given** an authenticated operator
**When** they trigger download-all
**Then** the `download-all` Edge Function provides access to all event media in bulk (FR18, AD-7), organized so rolls are identifiable by guest

**Given** the app
**When** download-all runs
**Then** the app performs no in-app video editing — it only exports (AD-7)
