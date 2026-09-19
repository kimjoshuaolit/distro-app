# dispo-retro-cam

A digital disposable camera for wedding guests — scan a QR, get a fixed roll of
25 retro photos + 5 short clips, shoot the day like film. Guest rolls collect
into a private, couple's-eyes-only gallery delivered later as a montage-first
reveal.

Built with **Vite + React + TypeScript**, deployed on **Cloudflare Pages**, with
**Supabase** (Postgres, Auth, Edge Functions, RLS) and **Cloudflare R2** for
media (wired up in later stories).

## Requirements

- **Node 22+** (Node 20 is EOL). Check with `node --version`.

## Local development

```bash
npm install
npm run dev      # start the dev server (Vite prints the local URL)
```

Other scripts:

```bash
npm run build    # type-check (tsc -b) then build to dist/
npm run preview  # serve the production build locally
npm run lint     # run ESLint
```

## Configuration

Client-safe config is read from `VITE_`-prefixed environment variables. Copy
`.env.example` to `.env` for local dev (the real values arrive in Story 1.2):

```bash
cp .env.example .env
```

`.env` is gitignored. Secrets (Supabase service-role key, R2 credentials) never
live in the client — only in Supabase Edge Function env.

## Deploy to Cloudflare Pages

The app is a static SPA. To publish it (needs your Cloudflare account):

**Option A — connect the Git repo (recommended):**

1. Push this repo to GitHub/GitLab.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**.
3. Framework preset: **Vite**. Build command: `npm run build`. Build output
   directory: `dist`.
4. Add any `VITE_*` environment variables under the project's settings.
5. Deploy. Cloudflare gives you a public `*.pages.dev` HTTPS URL.

**Option B — direct upload with Wrangler:**

```bash
npm run build
npx wrangler pages deploy dist
```

Client-side routing is handled by `public/_redirects` (`/* /index.html 200`), so
deep links and refreshes on any route serve the app instead of 404-ing.
