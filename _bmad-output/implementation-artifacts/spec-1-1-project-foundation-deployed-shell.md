---
title: 'Story 1.1 — Project foundation & deployed shell'
type: 'feature'
created: '2026-09-19'
status: 'done'
review_loop_iteration: 0
baseline_commit: '4b825dc642cb6eb9a060e54bf8d69288fbee4904' # empty tree — no commits yet (unborn main)
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** dispo-retro-cam has planning artifacts but no code. Every later story needs a running, on-brand app to ship onto — a scaffold, the "Kodak Sunset" design tokens, and a live public URL.

**Approach:** Scaffold a Vite 8 + React 19.2 + TypeScript SPA on Node 22+, define the Kodak Sunset design tokens as CSS variables consumed by a base app shell that renders a branded placeholder route, and prepare a Cloudflare Pages deployment (build config + SPA fallback) so the human can connect their account and publish it over HTTPS.

## Boundaries & Constraints

**Always:**
- Pin the locked stack: React 19.2.x, Vite 8.0.x, TypeScript 5.x, react-router-dom (current). Node 22+.
- Design tokens live as CSS custom properties in one tokens stylesheet; every color/type/spacing value used by the shell references a token, never a hard-coded hex.
- Token values match DESIGN.md exactly (gold #F5C518, kodakRed #E1341E, cream #FBF3DE, ink #2B2A26, amber #C4622D, stampOrange #FF8A1E, viewfinderBg #1A120C, revealBg #20130C; Anton/Archivo Black display, Archivo body ≥16px, monospace stamp; 8pt spacing steps 4/8/12/16/24/32/48; rounded sm6/md12/lg20/pill999).
- File/naming conventions per architecture: components PascalCase, hooks `useX.ts`.
- Client config exposes only client-safe values (Supabase anon key + public URL) via `VITE_`-prefixed env; secrets never in client. Document in `.env.example` only — no real values committed.
- SPA client routing must survive deep-link refresh on Cloudflare Pages (a `/* -> /index.html 200` fallback).

**Ask First:**
- Connecting a real Cloudflare Pages account and running the first live deploy — this requires the human's Cloudflare credentials; the agent prepares config and instructions but does not create accounts or deploy.
- Adding any dependency beyond the pinned stack + react-router-dom.

**Never:**
- No Supabase/R2 wiring, auth, camera, capture, or data model — those are Stories 1.2+.
- No component library, CSS framework, or design-system tooling (Tailwind, MUI, etc.) — plain CSS variables only.
- No dark/light theme switching — the app commits to the Kodak Sunset palette.
- No secrets or `.env` committed (only `.env.example`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Local dev | `npm run dev` | Vite serves; placeholder route renders branded shell using tokens | N/A |
| Production build | `npm run build` | Type-checks and builds to `dist/` with no errors | Build fails loud on TS/lint error |
| Deep-link refresh on Pages | GET `/anything` on deployed SPA | `_redirects` serves `index.html`; app boots | 404 only if asset truly missing |
| Mobile browser load | Deployed HTTPS URL on a phone | Shell renders legibly in portrait, body ≥16px | N/A |

</frozen-after-approval>

## Code Map

Greenfield — nearly everything is created here. Existing/relevant:

- `.gitignore` -- already excludes `node_modules`, `dist/`, `.env*` (keeps `.env.example`); no change needed.
- `_bmad-output/planning-artifacts/ux-designs/.../DESIGN.md` -- source of truth for token values.
- `_bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md` -- stack pins, source-tree shape, naming conventions.
- (to create) `src/styles/tokens.css` -- the Kodak Sunset CSS variables; consumed everywhere.
- (to create) `src/App.tsx`, `src/main.tsx`, `src/screens/` -- shell + placeholder route.

## Tasks & Acceptance

**Execution:**
- [x] Scaffold the project -- run `npm create vite@latest` (react-ts template) in place, then pin `react`/`react-dom` to 19.2.x, `vite` to 8.0.x, `typescript` to 5.x in `package.json`; add `react-router-dom`; keep scripts `dev`/`build`/`preview`/`lint`. Install and confirm the versions resolved.
- [x] `index.html` -- set title "dispo-retro-cam", mobile viewport (`width=device-width, initial-scale=1, viewport-fit=cover`), preconnect + load Google Fonts (Anton, Archivo, Archivo Black); keep `#root`.
- [x] `src/styles/tokens.css` -- define all Kodak Sunset tokens as `:root` CSS custom properties (colors, type families, type scale, spacing steps, rounded scale) per DESIGN.md.
- [x] `src/styles/global.css` -- minimal reset; `body` uses `--cream` background, `--ink` text, Archivo body font, base size 16px, system-friendly line-height; `#root` full-height.
- [x] `src/main.tsx` -- React 19 `createRoot`; import tokens + global css; wrap app in `BrowserRouter`.
- [x] `src/App.tsx` -- `<Routes>` with one route `/` rendering the placeholder screen (route foundation for later stories).
- [x] `src/screens/Placeholder.tsx` -- on-brand shell: Anton wordmark, gold/cream/ink from tokens, a short warm line; visibly exercises the tokens; portrait-friendly.
- [x] `public/_redirects` -- `/*    /index.html   200` for Cloudflare Pages SPA fallback.
- [x] `.env.example` -- commented `VITE_SUPABASE_URL=` and `VITE_SUPABASE_ANON_KEY=` placeholders documenting the client-safe config convention (no values).
- [x] `README.md` -- run/build instructions + a Cloudflare Pages deploy section (framework preset Vite, build `npm run build`, output `dist`, SPA fallback note) for the human to connect their account.

**Acceptance Criteria:**
- Given a fresh clone, when `npm install && npm run build` runs, then it type-checks and builds `dist/` with no errors.
- Given `npm run dev`, when the browser opens `/`, then a branded placeholder shell renders using only token-referenced styles (no stray hard-coded hex in shell markup).
- Given the built app deployed to Cloudflare Pages by the human, when it is opened over HTTPS on a mobile browser, then it loads legibly in portrait and deep-link refresh does not 404 (covers NFR2).

## Verification

**Commands:**
- `npm install` -- expected: resolves with react 19.2.x, vite 8.0.x, typescript 5.x (verify in lockfile).
- `npm run build` -- expected: exits 0, emits `dist/index.html` + assets.
- `npm run dev` -- expected: serves locally; `/` renders the branded shell.
- `npm run lint` -- expected: exits 0 (if lint script present from template).

**Manual checks:**
- `src/styles/tokens.css` contains every DESIGN.md color/type/spacing value; shell components reference `var(--token)` not literals.
- Deployed URL (human step): loads over HTTPS on a phone in portrait; refresh on a sub-path still boots the app.

## Suggested Review Order

**Design system (the story's core deliverable)**

- Entry point: every Kodak Sunset value from DESIGN.md as one `:root` token set.
  [`tokens.css:7`](../../src/styles/tokens.css#L7)
- Base shell defaults — cream ground, ink text, 16px body floor — all via tokens.
  [`global.css:12`](../../src/styles/global.css#L12)

**App shell & routing**

- Branded placeholder that visibly exercises the tokens (wordmark, counter, viewfinder, shutter, date stamp).
  [`Placeholder.tsx:5`](../../src/screens/Placeholder.tsx#L5)
- Scoped styles — every color/space/radius is a `var(--token)`, no literals.
  [`Placeholder.css:1`](../../src/screens/Placeholder.css#L1)
- Route foundation; catch-all falls back to the shell instead of a blank page.
  [`App.tsx:6`](../../src/App.tsx#L6)
- React 19 root wrapped in `BrowserRouter`; tokens + global CSS imported here.
  [`main.tsx:8`](../../src/main.tsx#L8)

**Deploy & config**

- Mobile viewport, SVG favicon, and Google Fonts (Anton/Archivo) for the display + body faces.
  [`index.html:6`](../../index.html#L6)
- SPA fallback so deep-link refresh on Cloudflare Pages serves the app, not a 404.
  [`_redirects:1`](../../public/_redirects#L1)
- Locked stack pins (React 19 / Vite 8 / TS 5.x) + scripts.
  [`package.json:20`](../../package.json#L20)
- Run/build steps + the human-run Cloudflare Pages deploy procedure.
  [`README.md:41`](../../README.md#L41)

**Tooling (peripheral)**

- ESLint 10 flat config; plugins registered as objects (react-hooks v7's bundled config is ESLint-10-incompatible).
  [`eslint.config.js:8`](../../eslint.config.js#L8)
