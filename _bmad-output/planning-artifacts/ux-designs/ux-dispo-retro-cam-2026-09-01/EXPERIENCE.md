---
title: "dispo-retro-cam — Experience Spine"
status: final
created: 2026-09-01
updated: 2026-09-01
sources:
  - ../../prds/prd-dispo-retro-cam-2026-09-01/prd.md
  - ./DESIGN.md
---

# Foundation

- **Form-factor:** mobile web only, portrait-first. Guests use their own phones via a scanned QR — **no install**. Runs in iOS Safari and Android Chrome.
- **No UI system / framework component library assumed** — this is a bespoke, single-purpose interface. Visual identity is owned by `DESIGN.md`.
- **Three audiences, three modes:** Guest (capture), Couple (reveal + collection), Operator/Kimjo (setup + download). Guests never see couple/operator surfaces.
- **Governing principle:** the app is a *side layer* to a real wedding. Every interaction must be fast, glanceable, and get the guest back to being present. Reliability of a captured shot outranks every feature.

# Information Architecture

**Guest**
- **G1 · Arrival** — post-scan welcome + first-name entry.
- **G2 · Camera** — the disposable camera (default screen after entry).
- **G3 · My Roll** — the guest's own captured shots (contact sheet).
- **G4 · Roll Finished** — end state / thank-you when allotment is spent.

**Couple** (private, later)
- **C1 · Reveal** — montage-first stage; the montage plays before anything else.
- **C2 · Collection** — all rolls, attributed by guest name; browse/download; release controls.

**Operator (Kimjo)**
- **O1 · Setup** — generate/print QR, set event window.
- **O2 · Dashboard** — participation at a glance, download all media.

*Surface closure:* every PRD need maps to a surface — capture→G2, limit/name→G1+G2, own-roll view→G3, private collection→C2, montage reveal→C1, operator controls→O1/O2. No orphan needs, no orphan screens.

# Voice and Tone

Warm, playful, encouraging — a party host, not software. Short and human.

- Welcome: *"You've got a camera! 25 photos, 5 clips. Make 'em count."*
- Name entry: *"What should we call your roll?"*
- Near-empty: *"3 shots left — choose wisely 😌"*
- Final shot: *"That's a wrap on your roll. Thanks for shooting ❤️"*
- Offline reassurance: *"No signal? No stress — your shots are saved and will upload themselves."*
- Never scold for "wasting" a shot — junk is charm. No error-shaming, ever.

# Component Patterns (behavioral)

- **Shutter** — one tap = one capture, committed instantly, no confirm, no preview-to-approve. A quick flash + shutter sound + counter tick confirms. (Visual spec: `DESIGN.md` shutter.)
- **Photo/Video toggle** — a simple two-state switch beside the shutter; video shows a hold-or-tap-to-record with a 10s auto-stop ring. `[ASSUMPTION]` tap-to-start/auto-stop rather than press-and-hold.
- **Counter** — live, always visible; ticks down on each commit; changes color near empty (`DESIGN.md` counter).
- **Date stamp** — auto-burned into every capture; not user-editable.
- **Roll thumbnails** — contact-sheet grid; tap to view one full-frame; no delete control exists.

# State Patterns

Per capture surface, define: **default · capturing · committing · full/finished · no-permission · offline/uploading · error**.

- **Permission not granted** → friendly pre-prompt (why we need the camera) → OS prompt → if denied, a recovery screen with steps to re-enable. Guest cannot capture without it; never dead-end silently.
- **Allotment full** → shutter disabled, counter at `0 · 0`, auto-route to G4 Roll Finished.
- **Offline / weak signal** → capture still works (local-first); a quiet uploadIndicator shows "saved, will upload." Never block the shutter on network.
- **Upload retry** → automatic on reconnect; no guest action required.
- **Empty roll (G3 before shooting)** → gentle "your shots will show up here."

# Interaction Primitives

- **Instant commit** — captures are final; the interaction models real film (no undo). This is a deliberate constraint, communicated warmly, not a limitation to apologize for.
- **One-thumb operation** — shutter and toggle in the bottom third.
- **Minimal taps** — QR → name → shooting in **≤ 2 taps + one text entry**.
- **Feedback on every commit** — flash, sound `[ASSUMPTION]` (respect silent mode), counter tick.

# Accessibility Floor

- Body text ≥ 16px; high contrast text on cream and on the dark camera (`DESIGN.md` pairs meet WCAG AA).
- Shutter target ≥ 56px; all controls ≥ 44px.
- Not color-alone: near-empty state uses text ("3 left") plus color.
- Camera/mic permission explained in plain language before the OS asks.
- Works one-handed; no gestures a non-technical guest wouldn't guess. Captions/labels on all controls for screen readers.

# Offline & Reliability (invented — product-critical)

The wedding is unrepeatable; a lost shot is a lost memory. Behavior:
- Every capture is written to on-device storage **before** any upload attempt.
- Uploads happen opportunistically in the background; the guest is never made to wait.
- The guest sees a low-key "X of your shots uploaded" reassurance, never a blocking spinner.
- On reconnect, pending shots upload automatically. Closing the tab must not lose already-captured shots. `[ASSUMPTION]` best-effort within browser storage limits — see architecture.

# Retro Effect (invented — core to the concept)

- A film treatment (grain + warm grade + burned-in date stamp) is applied to captured photos, in the Dazz-Cam spirit but tasteful — charm, not damage.
- `[ASSUMPTION]` effect is applied at/after capture and baked into the stored image, so guest and couple both see the retro result. Strength tuned so faces stay lovely.
- Open: exact intensity and whether video gets the same grade — see PRD open questions.

# Key Flows

**KF-1 — Tita Rosa shoots the ceremony (climax: the first committed shot).**
1. Rosa points her phone at the table-card QR.
2. A warm page opens — no install. *"You've got a camera!"*
3. She types "Rosa" → taps Start.
4. Friendly camera-permission pre-prompt → she allows.
5. The viewfinder fills her screen; counter reads `25 · 5`.
6. **Climax:** she frames the couple at the altar and taps the red shutter. Flash, tick — `24 · 5`. It's committed. She can't retake it, and that's the magic.
7. Later she films an 8-second first-dance clip; the ring auto-stops at 10s.
8. When empty, G4 thanks her.

**KF-2 — The couple's reveal (climax: the montage plays).**
1. A week later, the couple opens Kimjo's link on the couch.
2. The stage is calm, softened-warm — not the loud camera skin.
3. **Climax:** one Play. The montage runs — their people's shots and clips, cut together. They watch it before they can browse anything.
4. Afterward, the Collection opens: every roll, labeled by name — *"Rosa's roll," "Ben's roll."*
5. They decide, privately, whether to release any of it.

**KF-3 — Kimjo sets up (climax: the printed QR).**
1. Kimjo opens Setup, sets the event window (start → afterparty end).
2. He generates the QR and **climax:** prints the table cards.
3. During the night he glances at the Dashboard — who's joined, roughly how much shot.
4. After, he downloads all media to cut the montage.

# Inspiration & Anti-patterns

- **Inspiration:** GuestCam (frictionless event scan-and-collect), Dazz Cam (retro film treatment + date stamp).
- **Anti-patterns to avoid:** login walls, feed/social mechanics, likes, filters carousel, anything that turns guests into scrollers. No premium-app slickness. No "you wasted a shot" scolding.

# Responsive & Platform

- Single breakpoint mindset: **portrait phone**. Design for ~360–430px width.
- Landscape: tolerate, don't optimize; keep the shutter reachable.
- The couple's reveal (C1/C2) may also be opened on a laptop — allow a comfortable wider layout there. `[ASSUMPTION]`
