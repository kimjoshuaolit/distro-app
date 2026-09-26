# Epic 3 Context: The Operator Console

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Kim, the best man, is both the operator and the human montage editor. He needs a small private console so he can run the one event:
- **Before the wedding:** sign in, configure the event (the couple's emails, names, the event window) and print the table-card QR.
- **During the night:** open and close the capture window, and glance at participation.
- **Afterwards:** download every roll in bulk and cut the hero montage in his own tools.

The epic turns what is currently seed-data and script work into a real, privileged surface. It adds the third identity tier, an operator on a Supabase Auth magic link, with elevated rights over events. It must not weaken any guest or couple boundary built in Epics 1–2.

## Stories

- Story 3.1: Operator login & event setup
- Story 3.2: QR generation & window control
- Story 3.3: Participation dashboard
- Story 3.4: Download all media

## Requirements & Constraints

- **Operator scope.** The operator can:
  - generate a printable QR;
  - open and close the event window;
  - see basic participation (who joined, roughly how much each captured);
  - download all media for editing.
- **Event setup.** The operator creates and edits an event: the couple's email(s), display names, and window dates.
- **Server-enforced window.** Opening or closing the window must be enforced server-side (join and capture/upload refuse outside it), not just hidden in the UI.
- **Privacy.**
  - Only the couple and the operator can reach the collection.
  - Guest rolls are never cross-visible.
  - No media is ever public or guessable.
  - Guests never see operator or couple surfaces.
- **The app never edits video.** Download-all only exports, organized so each roll is identifiable by guest. The finished montage is hosted, not made.
- **Scale and budget.** One wedding (a single production environment, no staging), about 100 guests, and roughly 2,500 photos plus 500 clips to export. The budget is personal.
- **Reliability first.** Nothing in the console may risk guest capture on the night.

## Technical Decisions

- **Operator identity (AD-5).** Couple and operator both authenticate with a Supabase Auth magic link. Guests stay on an opaque device token. RLS grants:
  - operator: manage the event and download everything;
  - couple: read everything of their event and set release.
- **Privileged writes (AD-3).**
  - Any write that grants access or changes event, window or release state goes through an Edge Function, never a direct client write.
  - Migration 0006 revoked all client INSERT/UPDATE/DELETE/TRUNCATE on `events`, so event writes are service-role only, behind a function that checks the operator.
  - Reads stay on the RLS-scoped client.
- **Existing gate pattern to mirror.** An Edge Function reads the target through RLS with the caller's JWT (`decideCoupleAccess` in `_shared/couple-rules.ts`), then writes with the service role. Couple identity is JWT email plus an inbox-proving `amr` (2.1). Operator identity should be at least as strict.
- **Signed URLs only (AD-2).** Every blob read, including bulk export, uses a short-lived signed URL issued after an authorization check. R2 credentials never reach the client.
- **Data model (AD-6).** `Event 1—N Guest 1—N Shot`.
  - `events` holds the window (`window_open`/`window_close`), `montage_key`, `released`.
  - Couple emails live in `event_couples`, at most 2 per event.
  - R2 keys are `events/<eventId>/<guestId>/<shotId>.<ext>`.
- **Conventions.**
  - Edge Functions are kebab-case (planned: `close-event`, `download-all`) and return errors as `{ error: { code, message } }`.
  - Dates are stored in UTC ISO-8601; the burned-in date stamp is event-local and display-only.
  - Screens live in `src/screens/` (O1 Setup, O2 Dashboard).
  - Secrets stay in Edge Function env.
- **Guest QR.** It encodes the Pages URL plus the event token (the existing join route `/j/:eventId`).

## UX & Interaction Patterns

- **Two operator surfaces.**
  - **O1 Setup:** configure the event, set the window, generate and print the QR.
  - **O2 Dashboard:** participation at a glance, plus download-all.
- **Key flow (KF-3).** Kim opens Setup and sets the window from the ceremony to the end of the afterparty. He generates the QR and prints table cards (the climax), glances at the Dashboard during the night, and downloads everything afterwards.
- **Look and feel.** Keep the Kodak Sunset tokens, but this is Kim's utility console: plain, fast and glanceable, not the loud camera skin and not premium gloss. Warm, human microcopy with no error-shaming. The accessibility floor is body text ≥16px, controls ≥44px and labeled controls.
- **Printable QR.** It should produce a print-friendly table card.

## Cross-Story Dependencies

- **3.1 comes first.** Operator sign-in and the operator check gate everything in 3.2–3.4.
- **3.2 builds on 3.1.** It needs the configured event; window control changes behavior Epic 1 already enforces at join and upload.
- **3.3 and 3.4 need 3.1** and read across all of an event's guests and shots, as the couple tier does (2.2). 3.4 adds bulk signed export (`download-all`).
- **Tools that exist today and are superseded later.** The montage upload is an operator CLI script today (2.3); an in-app upload button was deferred to this epic. Couple emails and events are currently seeded by hand, and 3.1 replaces that.
- **Open product call, logged as deferred.** Should couple read access wait for delivery (after `window_close` or an operator "delivered" flag)? This epic's event state is the natural home for that switch.
