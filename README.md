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

Open `.env` and fill in the three required owner fields right now:

```
SCHEDULER_OWNER_NAME=Your Name
SCHEDULER_OWNER_EMAIL=you@example.com
SCHEDULER_OWNER_TIMEZONE=America/New_York
```

You'll add Google and Resend credentials in the next two steps; leave those
blank for now.

**How configuration is structured:**

- **`/config.js`** (committed) holds the *shape* of your deployment: theme,
  availability hours, booking window, meeting types. Edit this file when
  you want to change how the app behaves for everyone using your fork.
- **Environment variables** (in `.env` locally, in Netlify in production)
  hold per-deployment values. Owner identity above is required; optional
  overrides like `SCHEDULER_THEME` and `SCHEDULER_MEETING_TYPES` (JSON)
  let you change behavior without editing code.

Anything in env wins over `/config.js`. See `.env.example` for the full
list of optional overrides and the [Customization](#customization) section
below for examples.

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

For most changes: **edit `/config.js`, commit, push.** Netlify auto-deploys
on push, so the change is live in a minute or two.

### Change the theme

Open `/config.js` and change the `theme` value:

```js
theme: 'minimal',  // change to 'warm' or 'dark'
```

Save, commit, push. Done.

Built-in themes: `minimal` (clean, monochrome), `warm` (earthy), `dark`.

To create a new theme, copy `src/styles/themes/minimal.css` to a new file
(e.g. `ocean.css`), edit the colors, then set `theme: 'ocean'` in
`/config.js`.

### Add or edit a meeting type

Edit the `meetingTypes` array in `/config.js`. Each entry has:

- `slug` — URL path (e.g. `slug: 'coffee'` lives at `/coffee`)
- `name` — display name on the home page card
- `duration` — minutes
- `description` — shown on the home page card
- `questions` — array of follow-up questions on the booking form, each
  `{ id, label, required }`

Add a new object to the array, save, commit, push. The new meeting type
appears on the home page automatically.

### Adjust availability hours

Edit `availability` in `/config.js`:

```js
availability: {
  days: [1, 2, 3, 4, 5],   // 0 = Sunday, 6 = Saturday
  startHour: 9,             // first slot starts at 9am
  endHour: 17,              // last slot ends by 5pm
  bufferMinutes: 15,        // gap between back-to-back meetings
},
```

All times are in your timezone (the `SCHEDULER_OWNER_TIMEZONE` env var).

**To block specific dates (vacation, holidays):** don't edit config — just
create a busy event on your Google Calendar covering those dates. The
availability endpoint queries freebusy in real time, so blocked times
disappear from the booking grid automatically.

**Which calendars count as busy:** every calendar you have currently
*shown* in your Gmail/Google Calendar left sidebar (`selected: true` in
Google's API). Work Gmail, school schedules, family calendars, kids'
sports — anything visible in your UI blocks the matching time. Hide a
calendar in Gmail to stop it from blocking; show it to start. No code
or config change required.

The booking event itself is always written to the calendar identified
by `GOOGLE_CALENDAR_ID` (defaults to `primary`).

### Per-deployment overrides without editing code

Every field in `/config.js` can also be overridden via an env var. Useful
if you fork the project and want a different theme/schedule/meeting types
without maintaining a code diff:

| Field | Env var | Format |
|---|---|---|
| `theme` | `SCHEDULER_THEME` | string |
| `bookingWindowDays` | `SCHEDULER_BOOKING_WINDOW_DAYS` | number |
| `availability` | `SCHEDULER_AVAILABILITY` | JSON object |
| `meetingTypes` | `SCHEDULER_MEETING_TYPES` | JSON array |

Env values win over `/config.js`. Set them in Netlify Dashboard → Site
configuration → Environment variables, then trigger a redeploy.

## Architecture notes

- **No database.** Google Calendar is the source of truth for both
  availability and bookings.
- **Multi-calendar conflict checking.** The freebusy query runs across
  every calendar the owner has shown in their Google Calendar UI
  (`selected: true`), aggregated into a single busy set. The booking
  event is written to the calendar identified by `GOOGLE_CALENDAR_ID`.
- **Auto-generated Google Meet links.** Every booked event includes a
  Meet link (via `conferenceData.createRequest` on the GCal insert),
  visible in the calendar invite both parties receive.
- **Race protection** is best-effort: the booking endpoint pre-checks
  freebusy, then post-insert reconciles by listing events tagged with a
  unique booking ID. If two bookings collide, the earliest `created`
  timestamp wins; the loser self-deletes and returns 409. Not bulletproof
  (GCal list-after-write has tiny replication lag), but plenty for personal
  traffic volume.
- **Reply-To pattern.** The branded sender (`RESEND_FROM`) is used as
  the `From:` for confirmation/notification emails, but `Reply-To:` is
  set to the other party — the guest's confirmation replies go to the
  owner's inbox, and the owner's notification replies go straight to the
  guest. Same pattern Calendly uses.
- **One-click accept/decline.** The owner notification email contains
  HMAC-signed Accept and Decline links. Accept patches the owner's
  attendee `responseStatus` so the guest sees confirmation; Decline
  goes through a confirmation page (POST) before deleting the event
  with `sendUpdates: 'all'`, so the guest gets a cancellation. Requires
  `SCHEDULER_SIGNING_SECRET`.
- **Static frontend.** Astro builds to plain HTML/CSS/JS — no SSR, no React.
  The booking flow uses a single page with vanilla-JS step state.

## License

MIT — see [LICENSE](./LICENSE).
