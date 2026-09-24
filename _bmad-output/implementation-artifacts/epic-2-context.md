# Epic 2 Context: The Couple's Reveal & Private Collection

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

After the wedding, the couple logs in with a Supabase magic link and gets a reveal that feels like a moment, not a file dump. A finished montage plays first. After it, the couple can browse every guest's roll, each labeled by first name ("Rosa's roll"). The collection is visible only to the couple and the operator by default, and the couple controls a release flag. This epic delivers the product's main emotional payoff: the insider view of the wedding, seen through the guests' eyes. It builds on the Epic 1 foundation (the data model, RLS, R2 and signed URLs) and adds the second identity tier (authenticated couple), read access across all rolls in one event, a hosted montage asset and release state.

## Stories

- Story 2.1: Couple secure login
- Story 2.2: Browse the private collection, attributed by name
- Story 2.3: Montage-first reveal
- Story 2.4: Release control

## Requirements & Constraints

- **Private collection.** All guest rolls from an event collect into one collection. Only the couple and the operator can reach it. Unauthenticated or unauthorized visitors are denied access to both the collection and the reveal.
- **Attributed by name.** The couple sees every roll (photos and clips), grouped and labeled by guest first name.
- **Private by default, couple controls release.** The event's `released` flag defaults to off. The couple can toggle it. This epic does not build a public-sharing surface. With the flag off, nobody without couple or operator access can view anything.
- **Montage first, delivered later.** Delivery happens days after the event, not the same day, and the wait is part of the ritual. The montage plays before the collection is offered.
- **Montage scope.** For the MVP, the reveal plays one hand-edited hero cut that was made outside the app and is hosted by the app. The auto-assembled fallback reel is deferred. If no montage has been uploaded yet, show a friendly "your reveal is being prepared" state, never an error.
- **Media privacy.** No media is ever served from a public or guessable URL.
- **Retention.** The planning docs require a clear retention and cleanup policy after delivery but have not decided it. There is no purge job in this epic.

## Technical Decisions

- **AD-5, two identity tiers.** The couple (and the operator) authenticate with Supabase Auth magic link. Guests stay token-based. RLS gives the couple read access to all rows of **their event only**, plus the right to set release. No guest path can read across rolls. The Epic 1 guest-only RLS must stay intact.
- **AD-2, signed URLs only.** R2 objects are never public. Every blob read, including collection thumbnails, clips and the montage, uses a short-lived signed URL. The URL is issued only after an authorization check, and the couple may receive URLs for the whole event. R2 credentials never reach the client.
- **AD-3, reads and writes.** Collection reads go through the RLS-scoped Supabase client. Changing release state is a privileged write, so it goes **only** through the `set-release` Edge Function, never as a direct client update.
- **AD-6, data model.** `Event 1—N Guest 1—N Shot`. Relevant fields:
  - `events`: `couple_owner`, `montage_key` (the R2 key of the hosted montage) and `released` (bool, default false).
  - `guests`: `first_name`, used for attribution.
  - `shots`: `type` (`photo` or `clip`), `r2_key`, `upload_status` and `captured_at`.
- **AD-7, the app does not edit video.** The app's montage job is only to host one finished montage video per event, which the reveal plays (bulk download-all is Epic 3). No in-app or automatic montage generation.
- **Conventions (unchanged from Epic 1):**
  - Edge Functions are kebab-case (`set-release`) and return errors as `{ error: { code, message } }`.
  - R2 keys follow `events/<eventId>/<guestId>/<shotId>.<ext>`.
  - Dates are stored in UTC ISO-8601.
  - The couple session is a Supabase Auth session. All authorization happens through RLS and Edge Function checks, never through client trust.
- **Screens:**
  - C1 Reveal and C2 Collection live in `src/screens/`.
  - Auth helpers live in `src/lib/`.
  - The `set-release` function lives in `supabase/functions/`.
  - New RLS policies go in `supabase/migrations/`.

## UX & Interaction Patterns

- **Softened warm variant (not the loud camera skin).**
  - Stage background: `revealBg #20130C`.
  - Cream (`#FBF3DE`) and gold (`#F5C518`) lead.
  - Red is used sparingly, only for commit actions.
  - The amber `#C4622D` kicker is used for small labels.
  - The mood is intimate and quiet, with no premium-app gloss.
- **C1 Reveal layout:**
  - A small kicker ("Your wedding · developed") and a title ("From your people").
  - A `montageStage` with cinematic letterboxing and **one big Play**.
  - A caption nudging the couple to press play before scrolling.
  - Beneath the stage, roll tiles: small cream-bordered prints labeled with guest names, with an overflow tile (for example "+97").
- **C2 Collection:** every roll labeled by name, where the couple browses media and controls release. Photos render as film frames: a 4:3 cream border with the baked-in date stamp.
- **Flow (KF-2):** open the link, see a calm stage, press Play and watch the montage, then open the collection roll by roll, then decide privately whether to release.
- **Responsive:** phone-first, but C1 and C2 should also be comfortable on a laptop, so a wider layout is allowed.
- **Accessibility and voice:**
  - Body text is at least 16px, controls at least 44px, and all controls are labeled.
  - The copy uses a warm host tone. Empty or "not ready" states are gentle, never error-like.

## Cross-Story Dependencies

- **Epic 1 is the substrate.** It provides the `events`/`guests`/`shots` schema, guest RLS, R2 storage with uploaded shots and signed-URL issuance, and the design tokens. `revealBg` is already part of the token set.
- **2.1 comes first.** Its magic-link session and couple-scoped RLS gate everything in 2.2–2.4.
- **2.2 needs 2.1.** It reads all event rolls through RLS and needs a signed-URL read path that authorizes the couple tier.
- **2.3 needs 2.1.** It depends on `events.montage_key` pointing to a hosted montage in R2. None of the Epic 2 stories defines who uploads the montage or how, so treat it as a gap to settle when building 2.3. The "being prepared" state covers the case where no montage exists.
- **2.4 needs 2.1** and adds the `set-release` Edge Function.
- **Couple email and event setup:** Story 3.1 (operator event setup) is where the couple email and event details are configured. Until then, Epic 2 must work against the minimal event from Epic 1 with an authorized couple email.
- **Operator access:** the operator's matching access to the collection comes from Epic 3.
