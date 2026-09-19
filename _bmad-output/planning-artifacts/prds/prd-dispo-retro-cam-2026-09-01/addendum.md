# Addendum — dispo-retro-cam

Technical-how and mechanism notes deferred from the PRD. These are inputs for the **architecture** step, not requirements. Nothing here is decided — they're the reasoning behind the PRD's assumptions.

## Platform / delivery mechanism
- **Web app, likely a PWA.** Camera access via the browser's `getUserMedia`/media-capture APIs. No app-store review, one codebase, instant QR-to-camera. Trade-off: browser camera control is less precise than native, and iOS Safari has quirks (permissions, video capture) worth prototyping early.
- QR encodes a URL to the guest capture page (optionally with an event token).

## One-shot reliability (NFR1) — the load-bearing mechanism
- **Local-first capture.** Buffer media on-device (IndexedDB / local storage of blobs) the instant it's captured, then upload opportunistically when connectivity allows. A guest who loses signal at the reception must not lose their roll.
- Consider a visible per-guest "X of your shots uploaded" reassurance, and a retry/resume on reconnect.
- Venue wifi/cell is the biggest real-world threat to the gift. Prototype the weak-network path before anything cosmetic.

## Storage & cost (NFR4)
- ~2,500 photos + ~500 short videos. Cheap object storage (e.g., a low-cost bucket) + aggressive but tasteful video compression (short clips help).
- Retention job to purge/archive after the couple has the final delivery.

## Montage (FR17)
- **Hero path:** Kimjo downloads all media and edits in his own tools (the app does not need editing features). The app's job ends at "collect + safely store + let Kimjo download everything."
- **Fallback path:** a dumb auto-reel — concatenate in chronological order, one music bed, fixed template. No shot selection intelligence. This exists so there's *something* even if hand-editing time runs out.

## Retro aesthetic (FR9) — options to weigh
- Cheapest: a **date stamp** overlay only.
- Medium: CSS/canvas **grain + vignette + slight color grade** applied to the stored image.
- Richer: a **flash/disposable look** with light leaks. Higher effort, more "wow." Decide against November time budget.

## Identity model
- First-name entry is not authentication — it's a label for attribution. No accounts, no passwords. A device/session token distinguishes rolls and enforces the 25/5 limit per guest.
