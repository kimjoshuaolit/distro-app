---
title: 'Go-live readiness — origin-locked functions, prod smoke test, runbook'
type: 'chore'
created: '2026-10-02'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'bea8325cc19fea00977d1b867151082121dd9a96'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** All 14 stories are built but have only ever run against the local stack. Going live means several account-side steps (Supabase, Cloudflare R2 and Pages, an email sender), each easy to miss. A miss is silent until a guest's upload fails at the wedding. On top of that, every Edge Function still answers browsers from any origin (`*`), which was deferred to "once the Pages URL exists".

**Approach:** Three deliverables that together make one goal, a deploy Kim can verify:
1. **Origin-locked functions.** Every Edge Function answers browsers only from the origins in a new `ALLOWED_ORIGINS` secret. When it's unset (local dev), they keep answering `*`.
2. **`npm run smoke:prod`.** One command, reading `supabase/functions/.env.production`, that checks the live deploy and prints a pass/fail line per item.
3. **`docs/GO-LIVE.md`.** An ordered runbook for the account steps, then the smoke test, then a real-phone dress rehearsal.

## Boundaries & Constraints

**Always:**
- **CORS lives in one shared wrapper (`_shared/cors.ts`)** used by all 10 functions.
  - It reads the request's `Origin`. When `ALLOWED_ORIGINS` (comma-separated, trimmed, no trailing slash) is set: a listed origin is echoed back with `Vary: Origin`; any other origin gets no `Access-Control-Allow-Origin` header.
  - Unset or empty → `*`, exactly as today.
  - Each function's other CORS headers (allowed headers, including `x-device-token`, and methods) and its status codes are unchanged.
- **The smoke test never prints a secret or a signed URL.** It cleans up the R2 test object it writes, and it exits non-zero if any check fails. It checks:
  1. **Migrations applied:** the newest function (`operator_export_shots`) exists.
  2. **Operator:** at least one row in `operators`.
  3. **Functions deployed:** each of the 10 answers something other than 404.
  4. **Function CORS:** a preflight from `APP_ORIGIN` is allowed, and one from a foreign origin is not.
  5. **R2:** a signed PUT, GET and DELETE round-trip with the `.env.production` keys.
  6. **R2 CORS:** a preflight from `APP_ORIGIN` allows PUT and GET.
  7. **Site:** `APP_ORIGIN/j/<random>` serves the app shell.
- **The runbook:**
  - is ordered: accounts → Supabase → email sender → R2 → Pages → secrets → operator → smoke → rehearsal;
  - names every dashboard setting that `config.toml` only applies locally: Site URL and redirects, the `before_user_created` hook, both email templates and their subject, confirmations on, custom SMTP, and the rate limit;
  - includes a dress-rehearsal checklist and a "night-of" checklist.

**Ask First:** Any change to app behaviour beyond CORS. Picking a specific email provider or domain on Kim's behalf; the runbook recommends one and uses placeholders.

**Never:** Committing real secrets or `.env.production`. Running anything against production from this session. Treating CORS as authorization (the existing gates stay the only access control).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Local dev | `ALLOWED_ORIGINS` unset, any Origin | `Access-Control-Allow-Origin: *` (unchanged) | N/A |
| Prod, the site | `ALLOWED_ORIGINS=https://cam.example.com`, Origin matches | header echoes the origin + `Vary: Origin` | N/A |
| Prod, foreign site | Origin `https://evil.example` | no ACAO header (the browser blocks the read); status unchanged | N/A |
| List formatting | `" https://a.com/ , https://b.com"` | both match (trimmed, trailing slash ignored) | N/A |
| Smoke, all good | live deploy correct | every line ✓, exit 0 | N/A |
| Smoke, R2 CORS missing | bucket has no CORS rule | that line ✗ with a fix hint, exit 1 | the test object is still deleted |
| Smoke, env missing | `APP_ORIGIN` or R2 keys absent | lists the missing names, exit 1, nothing is called | N/A |

</frozen-after-approval>

## Code Map

- `supabase/functions/*/index.ts` (10 files) -- each has a module-level `cors` with `'Access-Control-Allow-Origin': '*'` used by `json()` and the `OPTIONS` reply. Drop ACAO from it and wrap the handler: `Deno.serve(withCors(async (req) => …))`.
- `supabase/functions/issue-view-urls/index.ts` -- its allowed headers include `x-device-token` (keep them).
- `scripts/upload-montage.ts` + `scripts/montage-rules.ts` `readMontageEnv` -- the pattern for env-file scripts (`node --env-file-if-exists=…`, aws4fetch signing, never echoing URLs).
- `package.json` scripts -- add `smoke:prod`.
- `supabase/config.toml:154-263` -- the local-only auth settings the runbook must reproduce on the hosted dashboard.
- `supabase/functions/.env.example` -- add `ALLOWED_ORIGINS` and `APP_ORIGIN`.
- `public/_redirects` -- SPA fallback already present (the smoke test checks it).
- `README.md:66-76` -- the stale "Deploying the backend (later)" section; point it at `docs/GO-LIVE.md`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/functions/_shared/cors.ts` (+ test) -- `parseAllowedOrigins`, `allowedOrigin(origin, list)` and `withCors(handler, readEnv)`, with no Deno imports so the node tests can run it.
- [x] `supabase/functions/*/index.ts` (10) -- use `withCors`; remove the literal `*`.
- [x] `scripts/smoke-rules.ts` (+ test) -- `readSmokeEnv`, the function list, and pure result checks (`judgeFunction`, `judgeCors`, `judgeShell`, `formatReport`).
- [x] `scripts/smoke.ts`; `package.json` `smoke:prod` -- the IO.
- [x] `docs/GO-LIVE.md`; `supabase/functions/.env.example`; `README.md` -- the runbook, env docs, and a link to the runbook.

**Acceptance Criteria:**
- Given the local stack with `ALLOWED_ORIGINS` set to `http://localhost:5173`, when the app runs, then join, upload, roll, reveal and console calls all still work. A preflight from another origin gets no ACAO header.
- Given `ALLOWED_ORIGINS` unset, when any function is called, then the behaviour is byte-for-byte today's.
- Given `smoke:prod` pointed at the local stack (a `.env.production` stand-in), when run, then each check reports ✓ or ✗ with a hint, and the exit code matches.

## Spec Change Log

- **Review round 1 (patch only; no intent gap; no high security findings):**
  - **CORS wrapper:**
    - A `*` entry means everyone; entries are normalized to their origin, so a pasted URL with a path still matches.
    - A handler that throws answers a readable JSON 500 with CORS headers, never an opaque browser CORS failure.
    - `Vary: Origin` is merged, never duplicated.
  - **Smoke test** (the reviewers showed it could say Ready over broken functions):
    - It preflights **every** function, not just `join-event`. A 5xx is "failing", and a 404 counts as "not deployed" only when it isn't one of our typed errors (`join-event` answers 404 for an unknown event).
    - It probes with the service key, with one retry for a cold start.
    - **New checks:** the Function secrets via `supabase secrets list` (`R2_*` and `ALLOWED_ORIGINS`, never `R2_SERVER_ENDPOINT`); the live bundle points at this Supabase project; Auth email on with Confirm email ON (`/auth/v1/settings`); the database API accepts `x-device-token` from the site; PUT CORS includes `content-type`.
    - **Hints:** a bad key, an outage and the real cause are told apart.
    - **Robustness:** every step is guarded, so one crash is reported in place; the test object is always deleted; APP_ORIGIN must be a bare origin.
    - **Severity:** the site refused is a ✗ that blocks; allowing everyone is a ⚠ that doesn't.
  - **Tests keep the lists honest:** `SMOKE_FUNCTIONS` must match `supabase/functions/`; `LATEST_MIGRATION` must be the newest file and create the probed function; every function must use `Deno.serve(withCors(`.
  - **Runbook:**
    - New sections: Supabase free-tier pausing (it could break the reveal), a realistic R2 estimate (3–8 GB), the R2 payment method, Node 22.18+ for the scripts, and where to find the event id.
    - New: "Changing or adding a domain" (all six places) and "If something breaks on the night" (unset ALLOWED_ORIGINS, Pages rollback, function redeploy, restoring a paused project).
    - The rate-limit wording is fixed, and the stale secrets header in `.env.example` is corrected.

## Design Notes

- **A wrapper, not ten edits of copy-pasted header logic.** It rewrites only `Access-Control-Allow-Origin` and `Vary` on whatever the handler returns, including the `OPTIONS` reply, so every status and body stays as reviewed in its story.
- **Why CORS still matters** when every function also checks a JWT or device token: it stops another website from scripting a visitor's browser against these endpoints. For example, `join-event` takes no auth beyond the anon key and creates guests.

## Verification

**Commands:**
- `npm run test`, `npm run lint`, `npm run build` -- green.
- `npm run test:db` -- unchanged (no migrations).

**Manual checks:**
- Serve the functions locally with `ALLOWED_ORIGINS=http://localhost:5173`. Preflights from localhost are allowed and from evil.example are not. A guest can join, shoot and upload in the browser, and the console still works.
- Serve without the variable: `*`.
- Run `smoke:prod` against a local stand-in env.

**Implementation notes:**
- **Process:** implemented inline, with the full three-reviewer review. The verification-gap reviewer found the "only join-event is checked" gap. Every finding is patched and re-verified.
- **Gates:** 497 vitest; 10 pgTAP suites / 322 assertions (no migrations); lint clean; build OK. The guest bundle is unchanged at 546.9 kB.
- **Local Kong answers function CORS itself.** It replies to preflights and stamps `*` on responses, so locally every function looks open. Hosted Supabase leaves CORS to the function, which is why the wrapper exists. The wrapper was verified by calling the edge runtime directly inside Docker (`supabase_db` container → `supabase_edge_runtime:8081`):
  - the site's origin is echoed with `Vary: Origin`;
  - `evil.example` gets no allow-origin header;
  - checked before and after the review patches.
- **App flows:** join, issue-upload-url and issue-view-urls from the browser at `localhost:5173` all succeed through the full stack, with `ALLOWED_ORIGINS` set.
- **`smoke:prod` against a local stand-in** (a production build served by `vite preview` on :4173): **Ready, 19 of 21 checks**. The 2 ⚠ are local-only: no linked project to list secrets from, and Kong's `*`.
  - A wrong service key reports "refused — check SUPABASE_SERVICE_ROLE_KEY".
  - Missing env names are listed without calling anything.
  - Against the Vite dev server (no bundle), the site-config ✗ fired as designed.
  - The test object is gone afterwards.
- **Can't be verified until real accounts exist:** the hosted gateway's behaviour, the R2 CORS rule itself, the email sender, and the hook. The smoke test covers the first two on the night; the runbook covers the rest.

## Suggested Review Order

**Function CORS — start here (touches every Edge Function)**

- One wrapper: allow-list from ALLOWED_ORIGINS, unset = `*`, throws → readable 500.
  [`cors.ts:57`](../../supabase/functions/_shared/cors.ts#L57)

- Origin matching: normalized, `*` entry, no partial-host matches.
  [`cors.ts:39`](../../supabase/functions/_shared/cors.ts#L39)

- A typical function: ACAO dropped from its own headers, handler wrapped.
  [`join-event/index.ts:24`](../../supabase/functions/join-event/index.ts#L24)

**The smoke test**

- Every function's CORS: site refused blocks, everyone-allowed warns.
  [`smoke-rules.ts:110`](../../scripts/smoke-rules.ts#L110)

- Deployed vs missing vs crashing (our typed 404s count as deployed).
  [`smoke-rules.ts:90`](../../scripts/smoke-rules.ts#L90)

- Secrets present, local-only endpoint absent; bundle built against this project; Confirm email ON.
  [`smoke-rules.ts:221`](../../scripts/smoke-rules.ts#L221)

- Guarded steps; the R2 test object is always cleaned up.
  [`smoke.ts:59`](../../scripts/smoke.ts#L59)

**The runbook**

- Step 8 (what the smoke test proves and what it can't), domains, night-of emergencies.
  [`GO-LIVE.md:195`](../../docs/GO-LIVE.md#L195)

**Tests**

- Lists kept in step with the repo (functions, newest migration, every function wrapped).
  [`smoke-rules.test.ts:50`](../../scripts/smoke-rules.test.ts#L50)
