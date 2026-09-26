---
title: 'Story 3.1 — Operator login & event setup'
type: 'feature'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'ff167b075820a6f85a4f1f14cac3770a6665be53'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-4-release-control.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Events and couple emails exist only as hand-written seed SQL. Kim (the operator) has no sign-in and no way to set up the real wedding (FR4 setup, AD-5 operator tier).

**Approach:**
- Add a third identity tier: an `operators` email allow-list that is never committed with real emails. Kim adds himself once per environment with `npm run operator:add -- <email>`.
- An operator is a magic-link session for a listed email. The same inbox-proving `amr` rule as the couple applies.
- `/operator` gives Kim sign-in, a list of events, and create/edit for one event: the couple names (e.g. "Ana & Ben", shown only in the console for now), 0–2 couple emails, and the window open/close.
- Every write goes through a new `save-event` Edge Function: the operator is checked with the caller's JWT, then the service role runs one atomic SQL function.

## Boundaries & Constraints

**Always:**
- Operator status is decided only in the database: `is_operator()` checks the JWT email against `operators` and requires an inbox-proven `amr`. It shares one helper with `couple_event_ids()` so the two rules can't drift.
- The `before_user_created` hook admits operator emails as well as couple emails.
- `operators` is invisible to every client role.
- Operator RLS reads all events plus `event_couples`; couples still see only their own. No client writes to either table.
- `save-event` validates everything:
  - names are trimmed, 1–80 characters;
  - windows are ISO timestamps with close after open;
  - there are 0–2 emails, normalized and distinct.
- Saving is one transaction (event row plus its couple list), and the result is the saved event id.
- Datetimes are entered in Kim's local time and stored in UTC.
- Controls are at least 44px, labeled, with 16px text.

**Ask First:** Deleting events. Operator access to guests/shots/media (3.3/3.4). Showing couple names on guest or couple screens. More than one operator in the UI.

**Never:** A client write path to `events`, `event_couples` or `operators`. A real email in the repo (seed uses `@example.test`). Password sign-in for operators.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Operator signs in | listed email, magic link | lands on `/operator` event list | unlisted email → "That email isn't on the operator list." |
| Signed in, not operator | couple or password session | "This console is for the operator" + sign out | N/A |
| Create event | names, window, 0–2 emails, no `eventId` | event + couples saved; opens its edit page | 400 with field-level message |
| Edit event | `eventId` + changed fields/emails | row updated; removed emails lose couple access immediately | unknown id → 404 `not_found` |
| Bad input | empty/81-char names, close ≤ open, 3 emails, duplicate/invalid email | 400 `bad_request`, nothing written | form shows which field |
| Non-operator calls `save-event` | anon / couple / password session | 403 `not_operator`, nothing written | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0004_couple_access.sql:90` `couple_event_ids()` -- extract its claims/amr logic into `inbox_proven_email()`; `:148` hook -- also allow `operators`; `:39-42` the `event_couples` lockdown pattern to copy for `operators`; `:180` the `events` column grant (add `couple_names`).
- `supabase/migrations/0006_release_control.sql` -- client writes on `events` are already revoked; keep it that way.
- `supabase/functions/set-release/index.ts` -- the EF shape to copy. Here the gate is `asCaller.rpc('is_operator')` → pure `decideOperatorAccess` (mirror `_shared/couple-rules.ts`).
- `src/lib/coupleAuth.ts` -- reuse `normalizeEmail`, `isValidEmail`, `mapOtpError`, `parseAuthRedirectError`, `signOut`; the operator link redirects to `/operator`.
- `src/couple/useCoupleSession.ts` + `coupleGate.ts` -- auth-listener/hash-clearing pattern; the operator version is simpler (no event check): session → `is_operator` RPC → granted | denied | error+retry.
- `scripts/upload-montage.ts` + `scripts/montage-rules.ts` + `package.json:16` -- operator-script pattern and env-file loading for `operator:add`.
- `supabase/templates/magic_link.html`, `confirmation.html` -- couple-worded. Branch on `{{ if .Data.operator }}` (user_metadata; the operator sign-in passes `data: { operator: true }`) for a plain "Sign in to the operator console" email.
- `src/App.tsx` -- add `/operator`, `/operator/events/new`, `/operator/events/:eventId`. `supabase/seed.sql` -- add `kim.operator@example.test` to `operators` and `couple_names` to the seeded events.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0007_operator.sql` -- `operators` table (locked down); `inbox_proven_email()`, `couple_event_ids()` rebased on it; `is_operator()` (executable by authenticated); hook admits operators; `events.couple_names` (+ grant); operator SELECT policies on `events` and `event_couples` (+ select grant); `operator_save_event(...)` security definer, service_role-only, atomic upsert + replace couples, raises on unknown id -- the data tier.
- [x] `supabase/functions/_shared/operator-rules.ts` (+ test) -- `decideOperatorAccess`, `validateSaveEventRequest` -- tested rules.
- [x] `supabase/functions/save-event/index.ts` -- gate, then `rpc('operator_save_event')` → `{ eventId }`; 400/403/404/500 -- the only write path.
- [x] `src/lib/operatorApi.ts` (+ test) -- `requestOperatorLink`, `isOperator`, `listEvents`, `getEvent` (event + emails), `saveEvent` (typed `OperatorError`) -- data access.
- [x] `src/operator/` -- `operatorGate.ts` (+ test), `useOperatorSession.ts`, `localTime.ts` (+ test: ISO ↔ `datetime-local`), `EventForm.tsx`; `src/screens/Operator.tsx` + `.css`; `src/App.tsx` routes -- the console (sign-in, list, create/edit, guest join link + couple reveal link shown on the edit page).
- [x] `scripts/operator-rules.ts` (+ test), `scripts/add-operator.ts`; `package.json` `operator:add` / `operator:add:prod`; README section -- Kim adds himself.
- [x] `supabase/templates/*.html`, `supabase/seed.sql` -- operator email wording; dev operator.
- [x] `supabase/tests/operator.test.sql` -- `is_operator` (listed + otp → true; password amr / unlisted / anon → false); `operators` unreadable; the operator reads all events + couples while a couple still sees only theirs; no client writes; `operator_save_event` not executable by clients; create/edit/replace-emails/max-two/unknown-id behavior; hook admits operator, still refuses strangers -- the invariants.

**Acceptance Criteria:**
- Given Kim added via `operator:add`, when he requests a link at `/operator` and opens it, then he sees the event list and can create an event whose couple can then sign in at `/reveal/<id>`.
- Given an edit that removes a couple email, when that partner next loads the reveal, then they are denied.
- Given all existing suites, when run after 0007, then every couple and guest assertion still passes unchanged.

## Spec Change Log

- **Review round 1 (patch, no loopback) — the operator passed the couple gate (high).** The first cut gave the operator an RLS SELECT policy on `events`. But "can this session read the event row" is the couple gate in the reveal page (`getCoupleEvent`), `issue-couple-view-urls`, `issue-montage-url` and `set-release`. So the operator could open any reveal, get its montage link and flip the couple's release switch. My curl matrix covered only `save-event` and missed it.
  - **Amended:** the operator reads events through a security-definer `operator_events(p_event_id)` gated on `is_operator()`, the same pattern as `operator_couple_emails`. `events` RLS stays couple-only. That's a narrower reading of the frozen "Operator RLS reads all events": the reads are still database-scoped to the operator, just not through a policy on the gate table.
  - **Avoided:** operator access to the couple's media and release control (a spec "Ask First").
  - **KEEP:**
    - the pgTAP regression "the operator does not pass the couple gate";
    - the live check that the operator gets 403 from all three couple functions.
- **Review round 1 — email wording:** now picked by `.RedirectTo == .SiteURL + "/operator"`, not `user_metadata`. That metadata is fixed when the account is created, so a pre-existing account got the wrong wording. The client no longer sends `data`.
- **Documented deviation (matrix row 1):** an email that already has an account (e.g. a couple's) still receives a link at `/operator`, because the `before_user_created` hook only runs for new accounts. It then sees "This console is for the operator". I chose not to add an advisory "is this the operator?" check, since that would let anyone probe for the operator's email. The README says so.

## Design Notes

- An allow-list table rather than a JWT role claim keeps a single mechanism: the same hook, the same amr rule, and one pgTAP style.
- The EF asks the database `is_operator()` using the caller's JWT, then writes as the service role. That mirrors the couple gate and keeps AD-3.
- **`events` RLS is the couple gate, so it never gets an operator policy.** The operator reads through `operator_events()` and `operator_couple_emails()`.
- Emails are replaced as a set inside one function, so the max-two trigger never trips mid-edit (delete removed rows first, then insert new ones).
- The email wording branches on the redirect target. It is never authorization.

## Verification

**Commands:**
- `npm run test`, `npm run lint`, `npm run build` -- green.
- `npx supabase db reset` then `npm run test:db` -- all suites pass (recreate the `shots` bucket afterwards).

**Manual checks:**
- Serve functions (remove the edge container first; poll for about 80s).
  - Via curl: the operator's `save-event` returns 200; couple and anon get 403; bad input gets 400.
- In the browser via Mailpit:
  - The operator email has operator wording.
  - Create an event with a couple email, then sign in as that couple at its reveal.
  - Remove the email, and the couple is denied.
  - At 375px there is no horizontal scroll.

**Implementation notes:**
- Implemented inline; full three-reviewer review (blind, edge-case, verification-gap), about 2 minutes. One high finding (the couple gate, above) and about 18 smaller patches applied. Deferrals are logged in `deferred-work.md`.
- Gates: 365 vitest; 7 pgTAP suites / 254 assertions, with the couple and guest suites unchanged; lint clean; build OK.
- Live `save-event` checks:
  - operator create and edit → 200;
  - couple, no auth and anon JWT → 403;
  - three emails, a backwards window, empty names and a zoneless time → 400 with the field;
  - unknown id → 404;
  - an operator password session → 403;
  - a stranger's bad body → 403 before validation;
  - a direct PATCH as the operator is refused.
- Live checks after the fix:
  - The operator gets 403 from `set-release`, `issue-montage-url` and `issue-couple-view-urls`.
  - The operator sees "belongs to another couple" at `/reveal/…` and reads 0 `events` rows through RLS, but 3 through `operator_events()`.
  - The couple's `set-release` still returns 200.
- `operator:add`: it normalizes the email and is idempotent; bad input exits 1.
- Browser via Mailpit:
  - A stranger gets "not on the operator list".
  - The operator email has operator wording, both for a new account and for an existing one without metadata; the couple email keeps its wording.
  - Create → it stays "Saved ✓" on its edit page, and local times round-trip (Asia/Manila shown).
  - The new couple can read their event; after their email is removed they read none.
  - Validation focuses the bad field and links the error to the input; editing clears it.
  - A malformed id shows "Event not found".
  - At 375px there is no scroll, and the back link was fixed to 44px.

## Suggested Review Order

**Who is the operator — start here**

- One inbox-proof helper for both tiers; `couple_event_ids` rebased on it, `is_operator` added.
  [`0007_operator.sql:35`](../../supabase/migrations/0007_operator.sql#L35)

- Why the operator never gets an `events` policy (it's the couple gate), and the functions it reads through instead.
  [`0007_operator.sql:145`](../../supabase/migrations/0007_operator.sql#L145)

- The hook now admits operators too; strangers are still refused.
  [`0007_operator.sql:101`](../../supabase/migrations/0007_operator.sql#L101)

**The one write path**

- Gate first (`is_operator` with the caller's JWT), then validate, then the service-role RPC.
  [`save-event/index.ts:51`](../../supabase/functions/save-event/index.ts#L51)

- Atomic create/update plus replacing the couple set (removed emails go first for the max-two trigger).
  [`0007_operator.sql:193`](../../supabase/migrations/0007_operator.sql#L193)

- Shared rules: access decision, save-error mapping, and validation (zoned ISO, names, 0–2 emails).
  [`operator-rules.ts:26`](../../supabase/functions/_shared/operator-rules.ts#L26)

**The console**

- Session → `is_operator` check → view; a 401 signs out; a failed sign-out shows the error screen.
  [`useOperatorSession.ts:20`](../../src/operator/useOperatorSession.ts#L20)

- Reads go through operator functions, never `events` RLS; a malformed id is "not found".
  [`operatorApi.ts:66`](../../src/lib/operatorApi.ts#L66)

- The form: local time ↔ UTC, untouched times saved back exactly, created-event continuity, accessible errors.
  [`EventForm.tsx:74`](../../src/operator/EventForm.tsx#L74)

- Sign-in, the list, and the denied/error screens.
  [`Operator.tsx:208`](../../src/screens/Operator.tsx#L208)

**Peripherals**

- Operator email wording, branched on the redirect.
  [`magic_link.html:18`](../../supabase/templates/magic_link.html#L18)

- `operator:add` and its rules; README checklist for going live.
  [`add-operator.ts:14`](../../scripts/add-operator.ts#L14)

- pgTAP: the operator can't pass the couple gate; `save_event` behaviour; the hook.
  [`operator.test.sql:57`](../../supabase/tests/operator.test.sql#L57)
