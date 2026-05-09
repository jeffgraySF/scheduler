# scheduler

A self-hosted, single-user scheduling tool — a lightweight Calendly replacement.
Built with Astro, Netlify Functions, and Google Calendar as the source of truth.
No database.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## How it works

Guests pick a meeting type, choose a time slot, and submit their details. The
app creates a Google Calendar event (which sends invites to both parties) and
sends confirmation emails via Resend. Availability is derived from your Google
Calendar's free/busy state in real time.

## Prerequisites

- Node.js 20+
- A Google Cloud project with the Calendar API enabled
- A Resend account (free tier is fine)
- A Netlify account
- (Optional) A custom domain on Netlify DNS

## Setup

### 1. Clone and install

```bash
git clone https://github.com/jeffgraySF/scheduler
cd scheduler
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Two layers of configuration:

- **`/config.js`** (committed) holds the structural defaults: theme,
  availability, booking window, meeting types. Edit it to customize the
  shape of your deployment.
- **`.env`** (gitignored, local only) and your Netlify env hold per-deployment
  values: owner identity (required) and any optional overrides. Anything in
  env wins over `/config.js`.

Required env vars: `SCHEDULER_OWNER_NAME`, `SCHEDULER_OWNER_EMAIL`,
`SCHEDULER_OWNER_TIMEZONE`. See `.env.example` for the full list including
optional overrides like `SCHEDULER_THEME` and `SCHEDULER_MEETING_TYPES`
(JSON).

### 3. Google Calendar OAuth

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a project.
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** → External, fill in the basics, add your own email as a test user, then **Publish App** (this avoids 7-day refresh-token expiry).
4. **APIs & Services → Credentials** → Create OAuth client ID → Web Application → add `http://localhost:3000` as an authorized redirect URI.
5. Copy `Client ID` and `Client Secret` into `.env`.
6. Run the one-time auth flow:

   ```bash
   npm run get-token
   ```

   A browser window opens for you to authorize. The script prints a `GOOGLE_REFRESH_TOKEN` — add it to `.env`.

### 4. Resend

1. Sign up at [resend.com](https://resend.com), create an API key.
2. Add it to `.env` as `RESEND_API_KEY`.
3. For dev, leave `RESEND_FROM=onboarding@resend.dev`. For production, verify your sending domain and set `RESEND_FROM=scheduler@yourdomain.com`.

### 5. Run locally

```bash
npm install -g netlify-cli
npm run dev
```

Visit `http://localhost:8888`.

## Deploy

Push to GitHub, then in Netlify:

1. **Add new site → Import from Git** — pick the repo.
2. Build settings auto-detect from `netlify.toml`.
3. **Site settings → Environment variables** — add everything from `.env` (do NOT commit it). At minimum: the three `SCHEDULER_OWNER_*` vars, the four `GOOGLE_*` vars, and the two `RESEND_*` vars.
4. **Domain management → Add custom domain** — point your subdomain at the site.

After this, every `git push` triggers a fresh deploy automatically.

## Customization

The pattern: edit `/config.js` for things you want everyone (incl. open-source
forks) to inherit; set env vars for per-deployment overrides.

### Meeting types

Edit `meetingTypes` in `/config.js`. Each entry needs:

- `slug` — URL path (`/intro`)
- `name` — display name
- `duration` — minutes
- `description` — shown on the home page
- `questions` — array of `{ id, label, required }` shown on the booking form

To override per-deployment without touching code, set
`SCHEDULER_MEETING_TYPES` to a JSON array.

### Themes

Drop a CSS file into `src/styles/themes/` defining the standard CSS custom
properties (see `minimal.css` for the full list), then change `theme` in
`/config.js` (or set `SCHEDULER_THEME`) to the filename (without `.css`).
Built-in: `minimal`, `warm`, `dark`.

### Availability

Edit `availability` in `/config.js`:

- `days` — array of weekday numbers (0 = Sunday)
- `startHour` / `endHour` — in owner's timezone
- `bufferMinutes` — gap between meetings

To block specific dates (vacation, etc.), just create a busy event on your
Google Calendar — the freebusy check will skip those times automatically.

For per-deployment overrides, set `SCHEDULER_AVAILABILITY` to a JSON object.

## Architecture notes

- **No database.** Google Calendar is the source of truth for both
  availability and bookings.
- **Race protection** is best-effort: the booking endpoint pre-checks
  freebusy, then post-insert reconciles by listing events tagged with a
  unique booking ID. If two bookings collide, the earliest `created`
  timestamp wins; the loser self-deletes and returns 409. Not bulletproof
  (GCal list-after-write has tiny replication lag), but plenty for personal
  traffic volume.
- **Static frontend.** Astro builds to plain HTML/CSS/JS — no SSR, no React.
  The booking flow uses a single page with vanilla-JS step state.

## License

MIT — see [LICENSE](./LICENSE).
