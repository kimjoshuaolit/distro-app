---
title: 'Story 2.2 — Browse the private collection, attributed by name'
type: 'feature'
created: '2026-09-24'
status: 'done'
review_loop_iteration: 0
baseline_commit: '3a791dc8ff78e68c7c47672d7e7a85f32e4799ad'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-1-couple-secure-login.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A signed-in couple (2.1) lands on a placeholder. They need to see every guest's roll, attributed by first name (FR14), with media that is only ever served through short-lived signed URLs issued after a couple-tier check (AD-2, FR13, NFR3).

**Approach:** The granted view of `/reveal/:eventId` becomes a **roll shelf** (user choice): one cream-bordered print per guest with a cover, "Rosa's roll" and a shot count, sorted A–Z. Tapping a print opens `/reveal/:eventId/roll/:guestId`, that guest's contact sheet with the full-frame viewer (clips get retro at playback, as in 1.6). Metadata comes through the couple RLS from 2.1. Media URLs come from a new `issue-couple-view-urls` Edge Function that authorizes the caller's JWT against the event before signing.

## Boundaries & Constraints

**Always:**
- Only `uploaded` shots appear.
- Couple authorization is decided by RLS, via the caller's own JWT, never a client claim (AD-3).
- `r2_key` never reaches the client.
- Signed GETs live ≤10 minutes. They are cached and refreshed before expiry or after a media error (rate-limited), reusing `createViewUrlCache`.
- Images lazy-load, and nothing is signed until it is needed: covers when the shelf opens, a roll's shots when it opens.
- Softened reveal skin, 16px text, 44px targets, and a keyboard/screen-reader-operable viewer. Laptop width gets a wider grid.

**Ask First:** Downloads (Epic 3). Any couple write (release is 2.4). Generating thumbnails or derived media.

**Never:** Public or unsigned bucket URLs. Showing guests' device tokens or allotments. A montage (2.3). Guest-facing changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Shelf | event with guests' uploaded shots | one print per guest A–Z: cover, "Rosa's roll", "12 photos · 2 clips" | cover URL fails → print keeps name/count, blank cover |
| Not yet shot/uploaded | guest with zero uploaded shots | guest not shown | N/A |
| Same first name | two guests "Ana" | "Ana's roll" and "Ana's roll · 2" (by join order) | N/A |
| Nothing uploaded | no uploaded shots in event | gentle "Your guests' rolls are still developing" | N/A |
| Open a roll | tap print | contact sheet in capture order, numbered; viewer with swipe/keys; clips via RetroPlayback | unknown/other-event guestId → "That roll isn't here" + back to shelf |
| Signed URLs | EF with couple JWT, ≤30 shot ids of this event | `{urls:{shotId:url}, expiresIn:600}`; ids not in event / not uploaded omitted | anon, other couple, password session → 403; bad body/>30/non-uuid → 400 |
| Large event | >1000 uploaded shots | all loaded (paged reads past PostgREST `max_rows`) | read fails → retry state, never a blank shelf |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0004_couple_access.sql:90,196` — `couple_event_ids()` and the couple SELECT policies; `shots` column grants lack `id`.
- `supabase/functions/issue-view-urls/index.ts` — EF shape to copy (cors/json/fail, service role, `toViewUrlMap`, `presignGet`); `_shared/view-rules.ts` (`MAX_VIEW_IDS=30`, `VIEW_TTL_SECONDS`, validation pattern, vitest-tested); `_shared/join-rules.ts` `isUuid`.
- `supabase/config.toml:18` — `max_rows = 1000`.
- `src/lib/api.ts` — `parseFunctionError`, `FUNCTION_TIMEOUT_MS`, `issueViewUrls` pattern; `supabase.functions.invoke` sends the session JWT automatically.
- `src/roll/rollSession.ts` — `createViewUrlCache(fetchUrls, now)`, `viewerState`, `ViewItem`; `src/roll/useRoll.ts` shows the expiry-refresh and media-error rate-limit wiring to mirror.
- `src/ui/RollViewer.tsx` (props `items,index,total,onIndex,onClose,onMediaError`), `src/ui/RetroPlayback.tsx`; `src/screens/Roll.tsx` `Tile` + `Roll.css` frame styles (camera skin — restyle for reveal).
- `src/screens/Reveal.tsx:286` granted view; `src/couple/useCoupleSession.ts` gate; `src/App.tsx` routes.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0005_couple_collection.sql` -- grant `select (id)` on `shots` to authenticated; `couple_viewable_shot_keys(p_event_id uuid, p_shot_ids uuid[])` returns `(shot_id, r2_key)` for uploaded shots of that event's guests, executable by service_role only -- signing inputs stay server-side.
- [x] `supabase/functions/_shared/view-rules.ts` -- `validateCoupleViewRequest` (`eventId` uuid, 1–30 unique uuid `shotIds`) -- tested validation.
- [x] `supabase/functions/issue-couple-view-urls/index.ts` -- a user-scoped client (anon key + the caller's `Authorization`) reads the event through RLS; no row → 403 `not_couple`. Then the service role calls `couple_viewable_shot_keys`, signs in parallel, and returns `{urls, expiresIn}` -- AD-2 couple tier.
- [x] `src/lib/api.ts` -- `getCollection(eventId)` (guests `id,first_name,created_at` for the event, plus uploaded shots `id,guest_id,type,captured_at` filtered to those guest ids, paged by 1000) and `issueCoupleViewUrls(eventId, ids)`, both with timeouts -- data access.
- [x] `src/couple/buildCollection.ts` -- pure: group into rolls (label with duplicate suffix, counts, cover = first photo else first clip, capture-ordered frames, NaN-safe), drop empty rolls, sort A–Z then join order -- testable shaping.
- [x] `src/couple/useCollection.ts` -- loads the collection; signs covers (chunks of 30) and the open roll's shots through `createViewUrlCache`; refreshes before expiry and on a rate-limited media error; retry on failure -- thin hook.
- [x] `src/couple/RollShelf.tsx`, `src/couple/CoupleRoll.tsx` + `.css`; `src/screens/Reveal.tsx`, `src/App.tsx` -- shelf in the granted view (empty state replaces the placeholder), roll route under the same gate, back to shelf, viewer with `total`, focus returned to the last-viewed frame -- the UI.
- [x] Tests -- `supabase/tests/couple_collection.test.sql` (key fn scope/grants, `id` visible to couple not anon); `view-rules.test.ts`; `src/couple/buildCollection.test.ts` (matrix rows 1–4); `api.test.ts` (paging, guest filter, EF errors); EF verified live.

**Implementation notes (deviations and additions to the plan above):**
- **Routing:** `/reveal/:eventId/roll/:guestId` is a child route of `/reveal/:eventId` in `App.tsx`, and the child elements are `null`. Both views render inside one `Reveal`, so they share one gate and one collection load, and moving between the shelf and a roll never refetches. The collection remounts per `(eventId, sessionEpoch)`, so one couple's rolls never linger for the next.
- **Reads (`getCollection`):** guests are paged too, not just shots. Every page is ordered by `id`, so paging is stable. Shots are filtered with `in('guest_id', …)` in chunks of 100 guest ids (`COLLECTION_GUEST_CHUNK`), so the request URL stays short on big events. The filter also keeps out rows that are RLS-visible for another reason, such as a guest roll on the same phone. If any page fails, the whole call throws, and the screen shows "Try again" rather than a partial or blank shelf.
- **Key function (`couple_viewable_shot_keys`):**
  - It is `security invoker`: its only caller is `service_role`, so definer rights added nothing. It requires `r2_key is not null`.
  - It returns nothing for more than 30 ids, matching the function's request limit.
  - `shots.id` is granted to `authenticated` only, so anon, including a guest reading their own roll, still cannot read it.
  - A new check constraint, `shots_uploaded_has_key` (`upload_status <> 'uploaded' or r2_key is not null`), makes "uploaded means an object key exists" an invariant. `reserve_shot` already sets the key, so existing data complies. The pgTAP fixture `theo-2` (uploaded, no key) now has a key.
- **Validation:** `validateCoupleViewRequest` lowercases ids, because Postgres returns them lowercase and the response map is keyed by them. It refuses repeated ids, in any case, with a 400 rather than merging them.
- **EF gate (`_shared/couple-rules.ts`):** the pure `decideCoupleAccess({ hasAuthHeader, data, error, status })` returns `proceed | not_couple | server_error`. No header, no visible row, or a PostgREST 401/403 gives `not_couple` (403). Any other read error gives `server_error` (500). `index.ts` calls it before any key lookup or signing.
- **EF hardening:**
  - Missing `SUPABASE_URL`, `SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY` returns a clear 500 instead of crashing on `!`.
  - Event-read, key-lookup and presign errors go to `console.error` with only name, code, message and the shot id: no tokens, no R2 keys.
- **Partial signing:** `toCoupleViewUrlMap` signs each row with `Promise.allSettled`, omits failures and reports them by shot id; the client retries missing ids. When every row fails (for example, missing R2 config), the EF returns 500 `server_error` rather than an empty 200, so an outage isn't silent. The guest `toViewUrlMap` keeps its all-or-nothing behavior.
- **`createViewUrlCache.nextExpiry(ids?)`:** this optional argument narrows the refresh timer to the URLs currently on screen. It is backward compatible, and `useRoll` is unchanged.
- **Signing orchestration (`src/couple/collectionSigning.ts`, pure, node-tested with fake timers):**
  - `useCollection` is a thin shell around it.
  - **Load:** `runLoad`, `loadFor` and `loadKey` key each load by `(eventId, attempt)`. A stale result never shows, and "Try again" goes loading → ready.
  - **Signer:** `createCollectionSigner` signs the on-screen ids in batches of `MAX_VIEW_IDS`, imported from `_shared/view-rules.ts` and asserted equal in a test.
  - **Concurrency:** at most 4 requests are in flight (FIFO). Queued batches for a roll the couple has left are dropped.
  - **Retries:** ids a round didn't return, whether the whole round failed or only part of it, are retried on a 5s → 10s → 20s → 40s → 60s backoff. The delay stays at 60s after that, for as long as the page is open.
  - **Expiry refresh:** only held, on-screen links drive the refresh before expiry, and a refresh re-signs only the stale ids.
  - **Media errors:** these are rate-limited to one re-sign per 15s, and errors inside the window get one trailing re-sign when it ends. After 3 forced re-signs a shot becomes `unavailable`: the tile shows as unavailable, and the shot is never asked for again, not even by a refresh. A successful load resets its budget.
  - Online/visible events still trigger a refresh.
- **No `src` swap under loaded media:**
  - `useLoadedSrc` keeps the URL an element loaded with (`onLoad`, or `onLoadedMetadata` for video) and never retries a URL that errored.
  - In the viewer, `CoupleRoll` pins the URL the current element loaded with. This uses new *optional* `onMediaLoad` / `onLoaded` props on `RollViewer` / `RetroPlayback`. The guest My Roll doesn't pass them, so its behavior is unchanged.
  - Fresh URLs reach only elements that haven't loaded, mount later, or reported an error.
- **Namesake numbering:** namesakes are numbered by join order across all of the event's guests with that (collated) name, including guests with nothing uploaded, so a label never changes when an earlier namesake uploads later. As a result, a lone visible second Ana reads "Ana's roll · 2".
- **Clip covers:** the first frame of the signed clip (`<video preload="metadata">` with `#t=0.1`) serves as the cover, so no thumbnails are generated (Ask First respected).
- **Deep links and focus:**
  - `/reveal/:e/roll/:g` shows a roll-level "Developing this roll…" heading while loading, and "We couldn't bring this roll in" with "Try again" on failure. Both keep the "All rolls" link.
  - The page heading is focused when a state appears, unless the couple has already moved focus.
  - Closing the viewer focuses the last-viewed frame, in an effect after the commit that lifts `inert`. Live verification found the earlier rAF version could leave focus on `<body>`. The same effect covers the viewer closing because its shot became unavailable, falling back to the heading.
  - `onIndex` out of range goes through `closeViewer()`.
  - The shelf focuses the print for `state.fromGuest` once rolls exist, then replaces the history entry with `state: null`, so a reload or Back/Forward can't steal focus.
  - The guest `Roll.tsx` still uses rAF and was not touched.
- **Cosmetic fix:** the back link's arrow uses a flex `gap`, because the trailing space in its span collapsed inside `inline-flex`.
- **Verified live** (local stack; functions served with `--env-file`; private `shots` bucket recreated after `db reset`):
  - **Deviation:** guests and uploads were seeded through the real `join-event` → `issue-upload-url` → PUT → `confirm-upload` path with a node script and ffmpeg-made JPEGs and an MP4, not with the in-browser synthetic camera. The seed was Rosa (3 photos and 1 clip), Ana (2 photos), a second Ana (1 clip), Theo (joined, no shots) and Ben (reserved, never uploaded).
  - **The couple EF passed 18/18 checks:**
    - All uploaded ids were signed, and the reserved-only id was omitted.
    - `expiresIn` was 600 and the URLs carried `X-Amz-Expires=600` with a signature.
    - A signed GET returned 200 `image/jpeg`, and the same object unsigned returned 403.
    - The response had no `r2_key`.
    - The event 2 couple got 403 `not_couple` for event 1, and `{}` when asking with event 1 ids under event 2.
    - Anon got 403, and a password session for a listed email got 403.
    - More than 30 ids, a non-uuid id, a bad event id or a non-JSON body each got 400.
    - An event 2 couple REST read of event 1 shots returned 0 rows.
  - **UI (signed in via the Mailpit link):**
    - The shelf showed "Ana's roll", "Ana's roll · 2" and "Rosa's roll · 3 photos · 1 clip". Theo and Ben were absent.
    - One EF call signed only the covers, and every media URL was signed.
    - The roll showed frames 01–04 in capture order.
    - The viewer worked with ←/→/Esc, and the clip played through RetroPlayback with its date stamp.
    - Focus returned correctly (see Focus above), and the shelf covers were served from the cache.
    - An unknown guest id showed "That roll isn't here".
    - At 375px: 2 columns, no horizontal scroll, 16px text.
  - **Large event:** 1,100 uploaded rows for one guest loaded as "1100 photos", with shots read over 2 pages. The missing objects left a blank cover with the name and count kept, and opening the roll signed all 1,100 frames in 37 calls. The rows were deleted afterwards.
  - In dev, StrictMode double-mounts, so the collection read shows up twice in the network log. Production reads once.
  - **Re-verification after the review patches:**
    - `npm run test` passed 254 tests, and lint and build are clean.
    - `db reset` + `test:db` passed 155 tests, with `couple_collection` going from 17 to 31. The new cases:
      - the invoker check and service_role calls;
      - per-event keys for a couple listed on two events;
      - the 30/31-id cap;
      - the constraint on insert and update;
      - password, no-amr and empty-amr sessions reading 0 shot ids.
    - The EF re-check passed 18/18. On a later re-run, 2 checks failed only because of fixture state from the first run: a same-password 422 and 3 extra seeded shots. The password-session 403 was confirmed directly.
    - **Forced refresh:** with the EF TTL temporarily set to 90s (reverted afterwards), a 45s clip played in the viewer from 4s to its end.
      - Its `currentSrc` was unchanged, there was no `loadstart`, and `currentTime` rose steadily while 5 refresh calls went out underneath it.
      - Tiles kept their loaded URLs, with no re-downloads.
      - A viewer image mounted afterwards got the newest URL.
    - **Deep link:** with the couple's `guests.first_name` grant temporarily revoked, the deep link showed "Developing this roll…" then the error state (back link, alert, Try again, heading focused). After re-granting, "Try again" went loading → ready.
    - **Back to shelf:** "All rolls" focused Lena's print, and `history.state.usr` became `null`.
    - **Bulk roll:** 300 object-less uploaded rows were signed with at most 4 concurrent EF calls. With tiles forced to eager loading in the hidden pane, all 300 became "unavailable" after the cap, and no EF calls followed in the next 40s. The rows were deleted afterwards.

**Acceptance Criteria:**
- Given a signed-in couple, when they open their reveal, then every guest with uploaded shots appears by first name and each roll opens to its photos and clips.
- Given any media on the shelf or in a roll, when inspected in the network log, then every URL is a signed, expiring R2 URL obtained from `issue-couple-view-urls`.
- Given a couple of event A, when they call the function or read rows for event B, then they get nothing.

## Design Notes

Shots are addressed by `shots.id`, because `client_shot_id` is only unique per guest. The EF authorizes by reading through RLS with the caller's token instead of re-implementing the couple rules, so the 2.1 `amr`/email logic stays the single source of truth.

## Verification

**Commands:**
- `npm run test`, `npm run lint`, `npm run build` -- green.
- `npx supabase db reset` then `npm run test:db` -- all suites pass. Recreate the `shots` bucket afterwards.

**Manual checks:**
- Serve functions (`docker rm -f supabase_edge_runtime_dispo-retro-cam` first). Upload shots as 2+ guests with the synthetic camera (one sharing a first name), sign in as the couple via Mailpit, and check the shelf, the roll, the viewer and clip playback. The network log must show only signed URLs. A couple of event 2 must get a 403.

## Suggested Review Order

**Couple-tier media signing (AD-2) — start here**

- The only server gate: read the event with the caller's own JWT; no row, no links.
  [`index.ts:82`](../../supabase/functions/issue-couple-view-urls/index.ts#L82)

- Gate decision as a pure, tested rule: no header / no row / 401/403 → not_couple.
  [`couple-rules.ts:24`](../../supabase/functions/_shared/couple-rules.ts#L24)

- Keys only for uploaded shots of this event's guests; service_role only, ≤30 ids.
  [`0005_couple_collection.sql:27`](../../supabase/migrations/0005_couple_collection.sql#L27)

- Per-row signing: one bad key drops one tile, not a whole batch.
  [`view-rules.ts:47`](../../supabase/functions/_shared/view-rules.ts#L47)

- Shots addressed by `id` (client ids are only unique per guest); uploaded implies keyed.
  [`0005_couple_collection.sql:11`](../../supabase/migrations/0005_couple_collection.sql#L11)

**Shaping the shelf**

- Group by guest, stable namesake numbers by join order, A–Z, empty rolls dropped.
  [`buildCollection.ts:76`](../../src/couple/buildCollection.ts#L76)

- Paged reads past `max_rows`, shots filtered to this event's guests.
  [`api.ts:282`](../../src/lib/api.ts#L282)

**Keeping links fresh without flicker**

- Pure signer: on-screen ids only, backoff retries, trailing re-sign, per-id cap, ≤4 in flight.
  [`collectionSigning.ts:103`](../../src/couple/collectionSigning.ts#L103)

- Batch size is the server's own limit, not a copy.
  [`collectionSigning.ts:51`](../../src/couple/collectionSigning.ts#L51)

- Loaded media keeps its URL, so refreshes never reload images or restart clips.
  [`useLoadedSrc.ts:12`](../../src/couple/useLoadedSrc.ts#L12)

- Thin hook wiring the signer to React.
  [`useCollection.ts:32`](../../src/couple/useCollection.ts#L32)

**UI**

- Roll shelf: prints with cover, "Rosa's roll", counts; focus returns to the last roll.
  [`RollShelf.tsx:66`](../../src/couple/RollShelf.tsx#L66)

- A guest's contact sheet + viewer; unknown roll → "That roll isn't here".
  [`CoupleRoll.tsx:99`](../../src/couple/CoupleRoll.tsx#L99)

- Roll route nested under the same Reveal gate.
  [`App.tsx:24`](../../src/App.tsx#L24)

- Optional load callback on the shared viewer; guest My Roll unaffected.
  [`RollViewer.tsx:14`](../../src/ui/RollViewer.tsx#L14)

**Tests**

- Signer behaviour with fake timers: retries, caps, concurrency, stale loads.
  [`collectionSigning.test.ts:98`](../../src/couple/collectionSigning.test.ts#L98)

- Gate decision cases for the Edge Function.
  [`couple-rules.test.ts:7`](../../supabase/functions/_shared/couple-rules.test.ts#L7)

- Shelf shaping: matrix rows 1–4.
  [`buildCollection.test.ts:17`](../../src/couple/buildCollection.test.ts#L17)

- pgTAP: key function scope/grants, amr sessions, per-event isolation, the constraint.
  [`couple_collection.test.sql:9`](../../supabase/tests/couple_collection.test.sql#L9)
