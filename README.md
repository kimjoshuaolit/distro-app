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
`.env.example` to `.env` for local dev:

```bash
cp .env.example .env
```

`.env` is gitignored. Secrets (Supabase service-role key, R2 credentials) never
live in the client — only in Supabase Edge Function env.

## Supabase local development

Backend (Postgres, RLS, Edge Functions) runs locally via the Supabase CLI on
Docker. **Prerequisite: Docker Desktop running.** The CLI is a dev dependency,
so use `npx supabase`.

```bash
npx supabase start                       # boot local Postgres + Auth + Edge runtime (first run pulls images)
npx supabase db reset                    # apply migrations + seed.sql (a fresh DB)
npx supabase status                      # prints the local API URL + anon key
npx supabase functions serve join-event  # serve the Edge Function locally
```

Put the **API URL** and **anon key** from `supabase status` into `.env` as
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, then run `npm run dev`.

The seed creates three test events:
- **open** — `/j/00000000-0000-0000-0000-000000000001`
- **ended** (window passed) — `/j/00000000-0000-0000-0000-000000000002`
- **not yet open** (future window) — `/j/00000000-0000-0000-0000-000000000003`

Stop the stack with `npx supabase stop`.

### Deploying the backend to a hosted project (later)

When you're ready to go live (needs a Supabase account):

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push                     # apply migrations to the cloud DB
npx supabase functions deploy join-event
```

Then set the hosted project's URL + anon key as the app's production env vars.

## Hosting the montage (operator only)

The couple's reveal plays one finished montage that you cut in your own editor.
The app never edits video (AD-7), and the couple never uploads it; it's their
surprise. When the cut is ready:

```bash
npm run montage:upload -- <eventId> <file.mp4|.mov|.webm>        # local stack
npm run montage:upload:prod -- <eventId> <file.mp4|.mov|.webm>   # production
```

The script uploads the file under a fresh key, then points the event at it.
If anything fails, the current montage is left untouched. Running it again
replaces the montage; the old file is kept.

It reads server credentials from a gitignored env file, never from the app:
`supabase/functions/.env` (local) or `supabase/functions/.env.production`
(prod). Each needs these variables:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_REGION`

See `supabase/functions/.env.example`. Locally, `R2_ENDPOINT` must be the
host address `http://127.0.0.1:54321/storage/v1/s3`, not `host.docker.internal`.
The couple's `/reveal/<eventId>` link uses the same `eventId`.

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
