# `scheduler` — Personal Scheduling Tool
### A self-hosted Calendly replacement built for jeffgray.co

---

## Overview

A lightweight, open-source scheduling tool deployed at `cal.jeffgray.co`. Guests
pick a meeting type, choose an available time slot, and submit their details. The
app creates a Google Calendar event and sends confirmation emails to both parties.

No database. Google Calendar is the source of truth.

Open-sourced under MIT. Config and credentials are never committed.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Astro (static) | Zero JS by default, clean component model, perfect Netlify fit |
| Styling | CSS custom properties + themes | Configurable per-deployment, no build complexity |
| API | Netlify Functions (Node.js ESM) | Already on Netlify, no extra infra |
| Calendar | Google Calendar API (`googleapis`) | Single source of truth for availability + bookings |
| Email | Resend | Clean API, generous free tier |
| License | MIT | Most permissive |

---

## Repository Structure

```
scheduler/
├── netlify/
│   └── functions/
│       ├── availability.js       # GET — returns open slots for a date range
│       └── book.js               # POST — creates GCal event + sends emails
├── src/
│   ├── layouts/
│   │   └── Base.astro            # Loads theme, sets meta
│   ├── pages/
│   │   ├── index.astro           # Meeting type selection
│   │   └── [type].astro          # Booking flow (multi-step, client-side state)
│   ├── components/
│   │   ├── MeetingCard.astro     # Card on index page
│   │   ├── SlotPicker.astro      # Date + time slot selection
│   │   ├── BookingForm.astro     # Name, email, custom questions
│   │   └── Confirmation.astro    # Post-booking success state
│   ├── styles/
│   │   ├── base.css              # Layout, typography, component styles (uses vars)
│   │   └── themes/
│   │       ├── minimal.css       # Clean, monochrome
│   │       ├── warm.css          # Earthy tones
│   │       └── dark.css          # Dark mode
│   └── lib/
│       ├── config.js             # Loads + validates config, exports typed object
│       └── slots.js              # Pure slot-generation logic (shared with function)
├── config.example.js             # Committed — template with placeholder values
├── config.js                     # NOT committed — real deployment config
├── .env.example                  # Committed — lists required env vars, no values
├── .env                          # NOT committed — real credentials
├── .gitignore
├── astro.config.mjs
├── netlify.toml
├── package.json
├── README.md
└── LICENSE                       # MIT
```

---

## Configuration

### `config.js` (gitignored)

```js
export default {
  theme: 'minimal',           // 'minimal' | 'warm' | 'dark'

  owner: {
    name: 'Jeff Gray',
    email: 'jeff@jeffgray.co',
    timezone: 'America/Los_Angeles',
  },

  availability: {
    days: [1, 2, 3, 4, 5],   // 0 = Sunday, 6 = Saturday
    startHour: 9,             // 9am in owner timezone
    endHour: 17,              // 5pm in owner timezone
    bufferMinutes: 15,        // gap between meetings
  },

  meetingTypes: [
    {
      slug: 'intro',
      name: 'Intro Call',
      duration: 30,           // minutes
      description: 'A quick chat to get acquainted.',
      questions: [
        { id: 'context', label: 'What would you like to discuss?', required: true },
      ],
    },
    {
      slug: 'strategy',
      name: 'Strategy Session',
      duration: 60,
      description: 'Deep dive on your business or product challenges.',
      questions: [
        { id: 'company', label: 'Tell me about your company or project.', required: true },
        { id: 'goals', label: 'What are you hoping to achieve?', required: false },
      ],
    },
  ],
}
```

### `.env` (gitignored)

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_CALENDAR_ID=primary
RESEND_API_KEY=
```

---

## Theming

Each theme is a CSS file that defines the full set of custom properties. `base.css`
uses only these variables — no hardcoded colors anywhere.

```css
/* Example: src/styles/themes/minimal.css */
:root {
  --color-bg:          #ffffff;
  --color-surface:     #f5f5f5;
  --color-border:      #e0e0e0;
  --color-primary:     #111111;
  --color-primary-fg:  #ffffff;
  --color-text:        #111111;
  --color-text-muted:  #666666;
  --color-success:     #16a34a;
  --color-error:       #dc2626;

  --radius:            4px;
  --font-family:       'Inter', system-ui, sans-serif;
  --font-size-base:    16px;
}
```

The active theme file is imported in `Base.astro` based on `config.theme`. All
three theme files must define the same variables.

---

## Pages & User Flow

### `/` — Meeting Type Selection
- Renders one `MeetingCard` per entry in `config.meetingTypes`
- Each card shows: name, duration, description
- Links to `/[slug]`
- No API calls on this page

### `/[type]` — Booking Flow
A single Astro page with client-side multi-step state (vanilla JS or minimal
Astro islands — no React needed).

**Step 1: Date selection**
- Calendar UI showing next 30 days
- Disabled: past dates, days outside `config.availability.days`
- On date select → fetch `/.netlify/functions/availability?type=intro&date=2025-05-10&tz=America/Chicago`
- Display returned slots as buttons

**Step 2: Time slot selection**
- Slots returned from availability function
- Displayed in guest's local timezone (detect via `Intl.DateTimeFormat`)
- On slot select → advance to step 3

**Step 3: Booking form**
- Fields: name (required), email (required)
- Dynamic fields from `meetingType.questions`
- Submit → POST to `/.netlify/functions/book`
- Show loading state during submit

**Step 4: Confirmation**
- Success message with date/time (in guest timezone)
- "Add to calendar" link (Google Calendar URL scheme)
- Note that a confirmation email has been sent

---

## Netlify Functions

### `GET /.netlify/functions/availability`

**Query params:**
- `type` — meeting type slug
- `date` — ISO date string (`2025-05-10`)
- `tz` — guest timezone string (`America/Chicago`)

**Logic:**
1. Look up meeting type from config (duration, buffer)
2. Compute candidate slots for the requested date based on owner availability
3. Call Google Calendar API `freebusy` query for owner's calendar
4. Filter out slots that overlap with busy blocks (including buffer)
5. Return remaining slots in UTC (client converts to guest timezone for display)

**Response:**
```json
{
  "slots": [
    "2025-05-10T16:00:00.000Z",
    "2025-05-10T16:45:00.000Z"
  ],
  "timezone": "America/Los_Angeles"
}
```

**Error cases:** invalid type slug → 400, GCal API failure → 500

---

### `POST /.netlify/functions/book`

**Request body:**
```json
{
  "type": "intro",
  "slot": "2025-05-10T16:00:00.000Z",
  "name": "Jane Smith",
  "email": "jane@example.com",
  "timezone": "America/Chicago",
  "answers": {
    "context": "I'd love to discuss your advisory work."
  }
}
```

**Logic:**
1. Validate all fields present and type slug valid
2. Pre-insert freebusy check — return 409 early if slot already taken
3. Create Google Calendar event with `extendedProperties.private.bookingId = <uuid>`:
   - Summary: `[Meeting type name] with [Guest name]`
   - Start/end: slot time + duration
   - Attendees: owner email + guest email (GCal sends its own invite to both)
   - Description: answers to custom questions, guest timezone
4. **Post-insert reconciliation** (race-condition guard): list all events
   overlapping the slot window. If more than one booking event exists, keep the
   one with the earliest `created` timestamp; the others delete themselves and
   return 409. This gives first-write-wins semantics without a database.
5. Send confirmation email to guest via Resend
6. Send notification email to owner via Resend

**Response:**
```json
{
  "ok": true,
  "eventId": "abc123",
  "slot": "2025-05-10T16:00:00.000Z"
}
```

**Error cases:** slot taken → 409 (client shows "slot no longer available, please
pick another"), validation failure → 400, GCal/Resend failure → 500

---

## Google Calendar Auth Setup

One-time local setup. Not part of the deployed app.

1. Create a project in Google Cloud Console
2. Enable the Google Calendar API
3. Create OAuth 2.0 credentials (type: Web Application)
4. Add `http://localhost:3000` as an authorized redirect URI
5. Run the one-time auth script (include in repo as `scripts/get-token.js`):
   - Opens browser OAuth flow
   - Exchanges code for tokens
   - Prints refresh token to console
6. Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` in `.env`
7. Set `GOOGLE_CALENDAR_ID=primary` (or the specific calendar email address)

The app uses the refresh token to obtain short-lived access tokens at runtime.
Refresh tokens do not expire unless explicitly revoked.

Include `scripts/get-token.js` in the repo — it's safe to commit (no secrets).

---

## Email Templates

Both emails are plain HTML, styled to match the active theme color palette.
Pass theme colors into Resend as template variables, or just hardcode simple
inline styles for v1.

**Guest confirmation:**
- Subject: `Your [Meeting Type] with Jeff Gray is confirmed`
- Body: date/time (in guest timezone), Google Calendar add link, Jeff's info

**Owner notification:**
- Subject: `New booking: [Meeting Type] with [Guest Name]`
- Body: slot time (in owner timezone), guest name + email, answers to questions

---

## Slot Generation Logic (`src/lib/slots.js`)

Shared between the Netlify function and (optionally) client-side pre-filtering.

```js
// Pure function — no I/O
// Returns array of UTC ISO strings for candidate slots on a given date
export function generateCandidateSlots({ date, availability, durationMinutes, ownerTimezone }) {
  // 1. Convert date to owner-local midnight
  // 2. Walk from startHour to endHour in (duration + buffer) increments
  // 3. Return each slot start as UTC ISO string
}
```

Keep timezone math here only, not in the function handler.

---

## Deployment

### `netlify.toml`
```toml
[build]
  command = "npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "20"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
```

### Subdomain Setup
In Netlify: add custom domain `cal.jeffgray.co`
In DNS (wherever jeffgray.co is managed): add CNAME `cal` → Netlify subdomain

### Environment Variables
Set all `.env` variables in Netlify → Site Settings → Environment Variables.
Do not set them in `netlify.toml`.

---

## Open Source Hygiene

### `.gitignore` must include:
```
.env
config.js
.netlify/
dist/
node_modules/
```

### `config.example.js`
Committed with all keys present, values replaced with descriptive placeholders:
```js
// Copy this to config.js and fill in your values
export default {
  theme: 'minimal',             // 'minimal' | 'warm' | 'dark'
  owner: {
    name: 'Your Name',
    email: 'you@yourdomain.com',
    timezone: 'America/New_York',
  },
  // ...
}
```

### README must cover:
1. What it is and a screenshot
2. Prerequisites (Google Cloud project, Resend account, Netlify account)
3. Clone → configure → get-token script → deploy steps
4. How to add meeting types
5. How to add/modify themes
6. MIT license badge

### No personal data in committed files:
- No real email addresses
- No calendar IDs
- No names in source (only in config.example.js as placeholders)

---

## Out of Scope (v1)

- Cancellation / rescheduling (largest edge case surface area — defer)
- Admin UI for config editing
- Multi-user support
- Payment collection
- Recurring availability exceptions (e.g., vacation blocks) — workaround: block off GCal directly

---

## Known Edge Cases to Handle

- **Double-booking race:** pre-check freebusy + post-insert reconciliation. Each booking is tagged with a `bookingId` extended property. After insert, list events in the slot window — if multiple booking events exist, the one with the earliest `created` wins; later ones self-delete and return 409. Best-effort (GCal list-after-write has tiny replication lag) but catches >99% of races without a database.
- **Timezone display:** always detect guest timezone client-side via `Intl`; never assume
- **GCal cold start on Neon:** N/A — no database. GCal API latency is ~200-400ms, well within Netlify's 10s limit
- **Build minutes:** Astro builds are fast (~1-2 min). Not a concern on Netlify free tier
- **Config validation:** `src/lib/config.js` should throw a clear error at startup if required fields are missing, so misconfiguration fails loudly

---

## Development Setup

```bash
git clone https://github.com/[username]/scheduler
cd scheduler
npm install
cp config.example.js config.js       # then edit config.js
cp .env.example .env                  # then fill in credentials
node scripts/get-token.js             # one-time Google OAuth
npm run dev                           # Astro dev server + Netlify functions
```

Requires `netlify-cli` for local function execution:
```bash
npm install -g netlify-cli
netlify dev                           # instead of npm run dev
```
