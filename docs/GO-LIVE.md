# Go-live runbook

Everything to take dispo-retro-cam from your laptop to the wedding, in order.
Each step says **where** (a dashboard or a terminal in this repo) and **how you
know it worked**. Budget an evening for steps 1–8, then a weekend afternoon for
the rehearsal (step 9).

> Keep the secrets out of git. The only secrets file is
> `supabase/functions/.env.production`. It is gitignored, so never paste its
> contents into a commit, chat or ticket.

Throughout, **`<origin>`** is your site's address with no trailing slash, e.g.
`https://dispo-retro-cam.pages.dev` or `https://camera.yourdomain.com`.

---

## 0. Accounts you need

| Service | What for | Cost at this size |
|---|---|---|
| **Supabase** | Database, sign-in, Edge Functions | Free tier works, but see "pausing" below |
| **Cloudflare** | R2 (photo and video storage) + Pages (the site) | Pages is free. R2 is free up to 10 GB, then about $0.015 per GB per month. Enabling R2 needs a payment method on file. |
| **An email sender** (recommended: **Resend**) | Sign-in links for you and the couple | Free tier is plenty |

- **The email sender.** Supabase's built-in email only sends a few messages an
  hour and may only deliver to your own team. A sign-in link that never arrives
  on reveal day is the failure to avoid.
- **How much storage?** Photos are about 0.5 MB each and clips about 5–15 MB, so
  100 guests × (25 photos + 5 clips) comes to roughly **3–8 GB**, plus the
  montage. That's around the free tier: pennies at worst.
- **Supabase free-tier pausing.** Free projects are **paused after about a week
  with no activity**, and a paused project means guests can't join and the
  reveal link fails until you un-pause it in the dashboard.
  - Either upgrade to **Pro** for the weeks from the rehearsal through the
    reveal (you can downgrade after),
  - or make sure something touches the project at least every few days, for
    example by running `npm run smoke:prod`.
  - Either way, open the dashboard the morning of the wedding and the morning
    of the reveal, and check it says **Active**.

**On your laptop:** Node **22.18 or newer** (`node --version`). The
`npm run …:prod` scripts run TypeScript files directly.

---

## 1. Cloudflare Pages: get the site's address first

Many later settings need `<origin>`, so do this first.

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**,
   then pick this repo.
2. Build settings:
   - Framework preset: **None**.
   - Build command: `npm run build`.
   - Output directory: `dist`.
3. Environment variables (Production):
   - `NODE_VERSION` = `22`.
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`: leave them for now; you fill them in at step 2.
4. Deploy, and note the address (`https://<project>.pages.dev`). If you want your
   own domain, add it under **Custom domains** now. Whichever you'll put on
   the QR is `<origin>`.

✅ `<origin>` opens the app's placeholder page. (It can't talk to Supabase yet.)

## 2. Supabase project + database

1. supabase.com → **New project**. Pick the region closest to the wedding.
   Save the database password somewhere safe.
2. **Project Settings → API**: copy the **Project URL**, the **anon key** and the
   **service_role key**.
3. Back in **Cloudflare Pages → Settings → Environment variables**, set:
   - `VITE_SUPABASE_URL` = the Project URL;
   - `VITE_SUPABASE_ANON_KEY` = the anon key.

   Then **redeploy**: Vite bakes these in at build time.
4. In this repo:

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

   `db push` applies migrations 0001–0010. It does **not** load `seed.sql`, so
   no test events reach production.

✅ `db push` lists all ten migrations as applied.

## 3. Supabase Auth settings

`supabase/config.toml` only configures your local stack. On the hosted project,
each of these is a dashboard setting.

1. **Authentication → URL Configuration**
   - **Site URL** = `<origin>`. The operator's email wording keys off
     `<Site URL>/operator`, so this must be exact.
   - **Redirect URLs**: add `<origin>/operator` and `<origin>/reveal/**`.
2. **Authentication → Hooks → Before User Created**: enable it, type
   **Postgres**, function `public.before_user_created_hook`. This hook is the
   real gate: only emails on a couple list or the operator list can get an
   account.
3. **Authentication → Sign In / Providers → Email**:
   - Email provider: enabled.
   - **Confirm email: ON**. Story 2.1's security relies on this.
   - **Secure email change: ON**.
4. **Authentication → Email Templates**: for both **Magic Link** and **Confirm
   signup**:
   - Subject: `Your wedding reveal — here's your link`.
   - Body: paste the whole file, `supabase/templates/magic_link.html` and
     `supabase/templates/confirmation.html` respectively.
5. **Authentication → SMTP Settings** (with your email sender, e.g. Resend):
   - Add and verify your sending domain at the provider. It's a few DNS
     records; they show you which.
   - Host `smtp.resend.com`, port `465`, user `resend`, password = an API key,
     sender e.g. `camera@yourdomain.com`, name `dispo-retro-cam`.
6. **Authentication → Rate Limits**: raise **emails per hour** from the default
   of **2** to ~30. You need a few per day, but a rehearsal uses more than 2 an
   hour.

✅ `npm run smoke:prod` (step 8) checks email sign-in is on and **Confirm email
is ON**. It **can't** check the hook or the Site URL, so those two are proved by
step 7 (your sign-in email arrives with the operator wording) and by the
rehearsal (an email that isn't on any list is refused).

## 4. Cloudflare R2 (where the photos live)

1. **R2 → Create bucket** `dispo-retro-cam`. Leave it **private**: no public
   access and no r2.dev URL. Every read is a short-lived signed link.
2. **Bucket → Settings → CORS Policy**:

   ```json
   [
     {
       "AllowedOrigins": ["<origin>"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   - **PUT** is how guests' phones upload.
   - **GET** is how your laptop's Download all reads files.
   - Using more than one address? See "Changing or adding a domain" below.
3. **R2 → Manage R2 API Tokens → Create API token**:
   - Permission **Object Read & Write**, scoped to **this bucket only**.
   - Copy the **Access Key ID**, the **Secret Access Key**, and the S3 endpoint
     `https://<account-id>.r2.cloudflarestorage.com`.

## 5. The secrets file

Create `supabase/functions/.env.production`. It is gitignored; use
`supabase/functions/.env.example` as the guide.

```bash
# Read by the Edge Functions (step 6) and by your scripts
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=dispo-retro-cam
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_REGION=auto
ALLOWED_ORIGINS=<origin>

# Used only by your scripts (operator:add:prod, montage:upload:prod, smoke:prod)
SUPABASE_URL=<Project URL>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
APP_ORIGIN=<origin>
```

**Never** set `R2_SERVER_ENDPOINT` in production; it's a local-Docker workaround.

## 6. Edge Functions

```bash
npx supabase functions deploy
npx supabase secrets set --env-file supabase/functions/.env.production
```

The CLI skips the `SUPABASE_*` names (the platform provides those itself) and
uploads the rest. `ALLOWED_ORIGINS` locks the functions to your site.

✅ `npx supabase secrets list` shows `R2_*` and `ALLOWED_ORIGINS`.

## 7. Make yourself the operator

```bash
npm run operator:add:prod -- <your-email>
```

Then open `<origin>/operator`, send yourself a link, and sign in.

✅ The email arrives from your sender, with the **operator** wording, and the
console shows "Your events".

## 8. Smoke test

```bash
npm run smoke:prod
```

Run it from this repo after `npx supabase link` (step 2), so it can list the
function secrets. It checks:
- the database: migrations applied, an operator on the list, email sign-in on and Confirm email ON;
- every Edge Function: deployed and running (not crashing), its secrets set (`R2_*`, `ALLOWED_ORIGINS`, and never the local-only `R2_SERVER_ENDPOINT`), and answering your site and only your site;
- the database API: it accepts the guest's `x-device-token` header from your site;
- R2: a test object written, read back and deleted; CORS allowing PUT (with `content-type`) and GET from your site;
- the site: deep links like `/j/…` serve the app, and the live build points at **this** Supabase project.

Each ✗ comes with the fix. Re-run until it says **Ready**.

- **✗ "site is built against this Supabase project"**: Cloudflare Pages still
  has old or empty `VITE_` values. Set them (step 2.3) and redeploy.
- **⚠ "other sites are allowed too"**: the `ALLOWED_ORIGINS` lockdown isn't in
  effect. It's not a blocker, since every function still checks its own token,
  but re-check step 6.
- **⚠ "couldn't list them"** (the secrets): run it from the linked repo, or check
  by hand with `npx supabase secrets list`.
- **✗ "database API accepts the guest header"**: My Roll would only show shots
  still on the phone. Look at **Project Settings → API** for CORS or allowed
  headers settings and allow `x-device-token`. If there's no such setting, ask
  Supabase support (or bring it back to this project) **before** the rehearsal.

---

## 9. Dress rehearsal (real phones, real wifi)

Create a **test event** in the console (e.g. "Rehearsal"), with you plus a
second email of yours as the couple. Open it now, closing in 3 hours.

**The event id** (`<eventId>` below) is in the console page's address,
`<origin>/operator/events/<eventId>`. The event page's **Links** section also
shows the full guest and reveal links. Then:

**Guests (3–5 people, at least one iPhone and one Android):**
- [ ] Print one sheet of table cards (A4 or Letter), and scan the QR with each phone.
- [ ] Each person joins with a first name and takes photos with both cameras, front and back.
- [ ] Each records a clip, including one that hits the 10-second auto-stop.
- [ ] One phone goes into airplane mode, takes 5 photos, waits, turns wifi back on, and opens My Roll. All 5 should upload.
- [ ] One person shoots the whole roll (25 + 5): the counter hits zero, and extra shots are refused politely.
- [ ] Reload mid-roll: the counter and My Roll survive.

**You (operator):**
- [ ] Watch the **Dashboard**: guests appear, and the counts climb within a minute.
- [ ] **Close now**: open cameras lock within about a minute, joining is refused, and shots already taken still upload.
- [ ] Run **Download all** into an empty folder, then run it again: "already there".
- [ ] Host a short montage: `npm run montage:upload:prod -- <eventId> <file.mp4>`.

**Couple (your second email):**
- [ ] Open `<origin>/reveal/<eventId>`. The sign-in link arrives, the montage plays first, then the roll shelf.
- [ ] The **Okay to share** switch flips and stays.

Write down anything odd (phone model + what happened) and bring it back. The
rehearsal is for exactly that.

## 10. Before the wedding

- [ ] Create the **real event**: couple names, the couple's emails, and a window from the ceremony to the end of the afterparty.
- [ ] Print the table cards **from `<origin>`**. The page warns you if you're on localhost.
- [ ] Scan one printed card with two phones.
- [ ] Re-run `npm run smoke:prod` the day before.

## On the night

- Keep the Dashboard open on your phone: it refreshes every minute.
- If the camera should close early, use **Close now**. Shots already taken keep uploading for **7 days**.
- Guests with bad signal lose nothing. Shots wait on the phone and upload when it reconnects, as long as they open the camera or My Roll again within those 7 days.

## After

- **Download all** (Chrome or Edge on a laptop) → cut the montage → `npm run montage:upload:prod -- <eventId> <file>`.
- Check the Supabase project is **Active** (not paused), then send the couple `<origin>/reveal/<eventId>`.

---

## Changing or adding a domain

The site's address appears in **six** places. If you add a custom domain, or
switch from `*.pages.dev` to one, update all of them:

1. Cloudflare Pages → **Custom domains**.
2. R2 bucket **CORS** → `AllowedOrigins`. List every address you'll use.
3. The Function secret `ALLOWED_ORIGINS`: comma-separated, e.g.
   `https://camera.yourdomain.com,https://<project>.pages.dev`. Then re-run
   `npx supabase secrets set …`.
4. Supabase **Site URL**. Use the one the operator console is opened on: the
   operator email wording matches `<Site URL>/operator` exactly.
5. Supabase **Redirect URLs**: `/operator` and `/reveal/**` for **each** address.
6. `APP_ORIGIN` in `.env.production`. The smoke test checks one address, so run
   it once per address.

Cloudflare Pages **preview** deploys (`<hash>.<project>.pages.dev`) aren't in
the list, so they can't reach the functions. That's expected: test on the real
address.

## If something breaks on the night

- **Guests can't join or upload, and the browser console shows CORS errors.**
  The `ALLOWED_ORIGINS` lockdown is refusing your own site. The quickest fix is
  to remove the lockdown (any site is allowed again; every function still
  checks its own token):

  ```bash
  npx supabase secrets unset ALLOWED_ORIGINS
  ```

  Fix the list later.
- **A bad site deploy.** Cloudflare Pages → your project → **Deployments** →
  pick the last good one → **Rollback**.
- **A bad function deploy.** Check out the last good commit and
  `npx supabase functions deploy <name>`.
- **The project is paused.** Supabase dashboard → the project → **Restore**.
  It takes a few minutes. Shots taken meanwhile wait on the phones, and upload
  once the camera or My Roll is opened again.
