---
title: "dispo-retro-cam — Product Requirements Document"
status: final
created: 2026-09-01
updated: 2026-09-01
owner: Kimjo
---

# dispo-retro-cam — PRD

## 1. Overview

**dispo-retro-cam** is a digital disposable-camera *game* for wedding guests, built as a personal gift from the best man (Kimjo) to the couple. A guest scans a QR code, enters their first name, and receives a limited roll — **25 photos + 5 short video clips** — to shoot the wedding intentionally, the way you'd use a real film camera. Every guest's roll flows into a private collection only the couple can see, delivered **after** the event as a reveal built around a **montage**.

The point is not coverage — the couple already hired a photographer and videographer. The point is the **insider POV**: the wedding as their loved ones actually saw it, from where they were standing. This gift was **explicitly requested by the groom** (he pointed at a reel of exactly this idea), so it is a commissioned gift, not a speculative one.

**Constraints that shape everything below:** one solo builder, a hard **November** deadline, a budget wedding (~100 guests), and a **single unrepeatable event** — there is no second take.

## 2. Goals & Success

**Primary goal:** The couple experiences a genuine, moving reveal — the montage lands as *a moment*, not a file dump — and feels seen by their people.

The **wait is intentional**, not a limitation: like real film, the days between the wedding and the reveal are part of the ritual — anticipation, then payoff. Delivery is designed as a build-up to the montage, never an apology for being late.

**Success looks like:**
- The couple watches the montage and it *feels made*, not auto-dumped (the forge flagged this as make-or-break).
- A meaningful share of guests actually participate (see counter-metric).
- **Zero loss** of any media a guest captured — every shot that was taken survives to delivery.
- Delivered within roughly **one week** of the wedding.

**Counter-metrics (guardrails):**
- The app is a *side layer*, not the event. Success is **not** guests glued to phones — if the game pulls people out of being present, it has failed even with high capture counts.
- Onboarding friction must not cause guests to abandon at the name-entry step.

## 3. Users & Context

- **Guests** (~100, intimate wedding) — shoot on their *own* phones, no app install, varied tech comfort (some older relatives). Must be able to go from QR to first shot in seconds.
- **The couple** — the recipients. They receive the private collection + montage reveal, and control whether anything is released publicly.
- **Kimjo (operator/editor)** — generates the QR, runs the event window, and — critically — is the **human editor** who cuts the hero montage after the wedding.

## 4. User Journeys

**UJ-1 — Tita Rosa shoots the ceremony.** Rosa, an aunt in her 50s, sees a small table card with a QR code. She points her phone camera at it; a web page opens — no app store, no download. It asks her first name; she types "Rosa" and taps start. She sees a simple camera with a counter: *25 photos, 5 clips left*. She takes a photo of the couple at the altar — the counter drops to 24. She can't retake it, and that's the point. Later at the reception she films a 8-second clip of the first dance. When she's used everything, the screen tells her the roll is finished and thanks her.

**UJ-2 — The couple's reveal.** A week after the wedding, the couple gets a link from Kimjo. They open it on the couch. It doesn't dump a folder of 2,500 files — a **montage plays first**: their people's shots and clips, cut together. Only afterward can they scroll the full collection, roll by roll, seeing each one attributed — *"Rosa's roll," "Kuya Ben's roll."* They decide later whether to release any of it publicly.

## 5. Scope

**In scope (MVP):**
- QR → no-install web capture with name entry and a per-guest 25/5 limit.
- Final-shot capture (photo + short video), roll view, private collection.
- Couple's private collection view, attributed by name.
- Montage reveal: one **hand-edited hero cut** + one **simple auto-assembled fallback**.

**Out of scope (for this version):**
- Same-day / instant delivery (consciously rejected — see §7).
- Native iOS/Android apps.
- Smart/AI auto-editing of the montage.
- Public social sharing features, guest accounts/logins, cross-guest visibility.

## 6. Functional Requirements

### Feature A — Guest onboarding & access
- **FR1** Scanning the QR opens the experience in the phone's browser with **no install**.
- **FR2** The guest enters a **first name** (optional last initial) before shooting; the name is attached to their roll for attribution.
- **FR3** Each guest is granted an allotment of **25 photos + 5 video clips**.
- **FR4** Capture is only active during a defined **event window**. `[ASSUMPTION]` Kimjo can open/close the window (from ceremony through afterparty).

### Feature B — Capture (the disposable camera)
- **FR5** Guests capture photos via the device camera; each photo decrements the remaining photo count.
- **FR6** Guests capture short video clips, **auto-capped at 10 seconds** `[ASSUMPTION]` and auto-stopping; each clip decrements the remaining clip count.
- **FR7** **Captures are final** — no delete, no retake. The remaining counts are always visible (e.g., *"18 photos · 3 clips left"*).
- **FR8** When an allotment reaches zero, that capture type is disabled with a clear **"roll finished"** state.
- **FR9** `[ASSUMPTION]` A **retro film aesthetic** is applied (e.g., grain, subtle flash look, date stamp) so results feel like a disposable camera — this is core to the "retro" in the name. *(Open: how far to push it — see §9.)*
- **FR10** `[ASSUMPTION]` Front/back camera toggle; no filters/editing tools beyond the fixed retro style at capture time.

### Feature C — Guest roll view
- **FR11** A guest can view **their own** captured roll (their photos + clips).
- **FR12** A guest can **never** see another guest's roll.

### Feature D — Collection & couple delivery
- **FR13** All guest rolls collect into a **single private collection** accessible only to the couple (and Kimjo as operator).
- **FR14** The couple's view shows **all rolls, attributed by guest first name**.
- **FR15** The collection is **couple's-eyes-only by default**; the couple controls whether and what gets released publicly.
- **FR16** Delivery is **later, not same-day**; the couple receives a **montage-first reveal** after the event.
- **FR17** The montage supports **two paths**: (a) a **hand-edited hero cut** (Kimjo's curated montage — the centerpiece), and (b) a **simple auto-assembled fallback** — chronological, one music track, no smart editing. `[ASSUMPTION]` Montage production/hosting may live outside the capture app; the app's core job is capture + collect + safely store.

### Feature E — Operator controls (Kimjo)
- **FR18** Kimjo can generate the QR/printable code, open and close the event window, see basic participation (who's joined, roughly how much captured), and **download all media** for editing.

## 7. Non-Functional Requirements

- **NFR1 — One-shot reliability (highest priority).** The wedding cannot be re-run. Capture must **tolerate weak or intermittent venue connectivity** and **never lose a captured shot**. `[ASSUMPTION]` Media buffers locally on the device and uploads when a connection is available; a guest losing signal mid-reception must not lose their roll.
- **NFR2 — No-install reach.** Must work on guests' own phones across **iOS Safari and Android Chrome** without installation.
- **NFR3 — Privacy & data.** Media is private to the couple; guest rolls are not cross-visible; a clear **retention/cleanup** policy after delivery. `[ASSUMPTION]` media deleted or archived a set period after hand-off.
- **NFR4 — Cost fits a personal budget.** ~100 guests × (25 photos + 5 clips) ≈ **~2,500 photos + ~500 short videos**. Storage, upload, and hosting must fit an individual's budget. `[ASSUMPTION]` inexpensive object storage + video compression.
- **NFR5 — Low friction.** QR-scan to first shot in **seconds**; the name field is the only gate.
- **NFR6 — Capacity.** Handle ~100 guests active across an evening without failing at peak moments (ceremony, first dance).

## 8. Constraints & Assumptions

- **Solo builder**, hard **November** deadline. `[ASSUMPTION]` exact wedding date TBD — drives the real freeze date.
- **Budget-conscious**; no paid team, minimal recurring cost.
- **Single unrepeatable event** — reliability beats features.
- Real photographer/videographer already cover the formal shoot; this is deliberately a **complement**, not a replacement.

## 9. Open Questions & Risks

**Open questions (to close before/at architecture):**
1. **Exact wedding date** and the event window (start/end) → sets the true deadline.
2. **How retro?** (FR9) — light date-stamp only, or full grain/flash filter? Affects both feel and build effort.
3. **Where is the montage produced** — inside the app, or Kimjo edits in his own tools and just hosts the result? (FR17)
4. **Retention** — how long is media kept after the couple receives it? (NFR3)
5. **Public release mechanism** — if the couple chooses to release, how? (FR15) — may be post-MVP.

**Carried risks (from the forge):**
- **R1 — Montage quality is make-or-break.** "Junk is charm" for scrolling a roll, but the *montage* is the emotional peak; the hand-edited hero cut (FR17a) is the mitigation. Keep the auto path deliberately dumb to avoid auto-slop.
- **R2 — Adoption.** The insider-POV thins out if few guests participate. Mitigation is off-app: best-man announcement + table cards, not a product feature.

---
*Companion: `addendum.md` holds technical-how and mechanism notes deferred from this PRD.*
