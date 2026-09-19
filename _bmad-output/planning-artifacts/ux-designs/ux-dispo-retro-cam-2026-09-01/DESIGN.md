---
title: "dispo-retro-cam — Visual Design Spine"
status: final
created: 2026-09-01
updated: 2026-09-01
sources:
  - ../../prds/prd-dispo-retro-cam-2026-09-01/prd.md
colors:
  # Brand — "Kodak Sunset"
  gold: "#F5C518"          # primary brand, chrome accents, counter
  kodakRed: "#E1341E"      # shutter, primary actions
  cream: "#FBF3DE"         # paper / light surface
  ink: "#2B2A26"           # primary text on cream
  amber: "#C4622D"         # warm secondary accent
  stampOrange: "#FF8A1E"   # date-stamp glow
  # Camera environment
  viewfinderBg: "#1A120C"  # dark camera body / capture backdrop
  onDark: "#FBF3DE"        # text/icons on the dark camera
  # Reveal (softened warm variant)
  revealBg: "#20130C"      # deep warm brown for montage stage
  revealSurface: "#FBF3DE"
  revealAccent: "#F5C518"  # gold leads; red is used sparingly here
  # Functional
  success: "#6E8B3D"
  error: "#B23A2E"
  muted: "#8A8177"
  hairline: "#E4D8BE"
typography:
  displayFamily: "Anton, 'Archivo Black', Impact, sans-serif"   # chunky poster display
  bodyFamily: "'Archivo', -apple-system, system-ui, sans-serif" # clean body
  stampFamily: "'DSEG7', 'Courier New', monospace"              # 7-seg / mono date stamp
  scale:
    display: "2.25rem"
    h1: "1.5rem"
    h2: "1.15rem"
    body: "1rem"
    small: "0.8rem"
    counter: "1.5rem"
rounded:
  none: "0"
  sm: "6px"
  md: "12px"
  lg: "20px"
  pill: "999px"
spacing:
  base: "8px"        # 8pt grid; steps 4/8/12/16/24/32/48
components: [button, shutter, counter, dateStamp, nameTag, viewfinder, filmFrame, rollThumb, montageStage, toast, permissionPrompt, uploadIndicator]
---

# Brand & Style

**Kodak Sunset** — a digital disposable camera that looks like the yellow-and-red FunSaver you actually held. Warm, cheerful, unmistakably analog. Every guest, including the 60-year-old aunt, should recognize "disposable camera" in under a second. The joy is in the constraint and the nostalgia, never in slickness.

**Personality:** nostalgic, generous, a little playful. Cheap-in-a-good-way — like a party favor, not a premium app.
**Voice cue for visuals:** poster-bold headlines, warm paper, a glowing orange date stamp in the corner of every shot.
**Two moods, one family:** the **guest camera** is full-warmth and bold (red shutter, gold chrome, dark camera body). The **couple's reveal** is the *softened* variant — cream and gold lead, red is used sparingly — so the emotional payoff feels intimate, not loud. `[ASSUMPTION]`

# Colors

| Role | Token | Hex |
|---|---|---|
| Brand / primary | `{colors.gold}` | #F5C518 |
| Action / shutter | `{colors.kodakRed}` | #E1341E |
| Paper surface | `{colors.cream}` | #FBF3DE |
| Text on paper | `{colors.ink}` | #2B2A26 |
| Warm accent | `{colors.amber}` | #C4622D |
| Date-stamp glow | `{colors.stampOrange}` | #FF8A1E |
| Camera body / capture bg | `{colors.viewfinderBg}` | #1A120C |
| Text on camera | `{colors.onDark}` | #FBF3DE |
| Reveal stage bg | `{colors.revealBg}` | #20130C |

Usage: gold is the signature — chrome, counter, framing. Red is reserved for the **shutter and primary commit actions**; do not spread it as a generic accent. The date stamp always glows orange over the shot, bottom-right.

# Typography

- **Display** `{typography.displayFamily}` — chunky poster caps for the wordmark, screen titles, the counter. High-impact, friendly.
- **Body** `{typography.bodyFamily}` — clean, legible at arm's length on a phone in low reception light.
- **Stamp** `{typography.stampFamily}` — 7-segment / monospace for the date stamp only. Never for reading text.
- Minimum body size 16px (older guests, dim venue). Generous line-height.

# Layout & Spacing

8pt grid (`{spacing.base}`). Portrait mobile only — thumb-reachable controls in the bottom third. The camera screen is a full-bleed viewfinder with a slim top status bar (name + counter) and a bottom control cluster (shutter centered, photo/video toggle beside it). Chrome is minimal so the shot is the hero.

# Elevation & Depth

Mostly flat, paper-like. One tactile exception: the **shutter button** gets a raised, physical treatment (ring + subtle inner shadow) so it feels like a real camera button. Toasts and the permission prompt lift on a soft warm shadow. No heavy Material elevation.

# Shapes

- App chrome: soft rounds (`{rounded.md}`–`{rounded.lg}`).
- Shutter: perfect circle (`{rounded.pill}`).
- **Photos render as film frames** — square-ish 4:3 with a thin cream border and rounded-none corners, like a real print. `[ASSUMPTION]` 4:3; could be square.
- Roll thumbnails: small prints in a contact-sheet grid.

# Components

- **shutter** — large red circle, gold ring, tactile press; disabled → desaturated when allotment is 0.
- **counter** — always visible, top status bar; display font; format `18 · 3` (photos · clips) with tiny labels. Turns amber near-empty, red at last shot.
- **dateStamp** — orange glowing 7-seg date, bottom-right of every captured frame; fixed to event date.
- **nameTag** — guest first name, small, on the camera status bar and on their roll.
- **viewfinder** — full-bleed live camera; thin gold corner brackets.
- **filmFrame** — the print treatment (cream border + grain + stamp) applied to captured photos.
- **montageStage** — the reveal player; softened palette, cinematic letterboxing, one big Play.
- **uploadIndicator** — quiet "your shots are safe" cue (see EXPERIENCE.md offline behavior).
- **permissionPrompt** — friendly camera/mic access explainer, on-brand, before the OS prompt.

# Do's and Don'ts

- **Do** make it look cheap-and-cheerful on purpose; lean into the FunSaver nostalgia.
- **Do** keep the shot the hero — minimal chrome over the viewfinder.
- **Do** reserve red for the shutter and commit actions only.
- **Don't** add slick gradients, glassmorphism, or premium-app polish — it fights the concept.
- **Don't** let the date stamp or grain make photos unpleasant to look at; charm, not damage.
- **Don't** use the loud full-warmth palette on the couple's reveal — soften it.
