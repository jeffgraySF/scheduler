// Layered config loader.
//
// Merges environment variables on top of the structural defaults from
// /config.js. PII fields (owner.*) are required via env — there are no
// code defaults for them. Other fields are optional env overrides.
//
// Throws loudly at module-load time if anything required is missing —
// better to fail at startup than serve a broken booking flow.

import 'dotenv/config';
import defaults from '../../config.js';

function requireEnv(key) {
  const v = process.env[key];
  if (!v) {
    throw new Error(`Missing required env var: ${key}. See .env.example.`);
  }
  return v;
}

function envJson(key) {
  const raw = process.env[key];
  if (!raw) return undefined;
  try { return JSON.parse(raw); }
  catch (e) { throw new Error(`Env var ${key} must be valid JSON: ${e.message}`); }
}

function envNum(key) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`Env var ${key} must be a number, got "${raw}"`);
  return n;
}

const merged = {
  theme:             process.env.SCHEDULER_THEME    || defaults.theme,
  language:          process.env.SCHEDULER_LANGUAGE || defaults.language,
  bookingWindowDays: envNum('SCHEDULER_BOOKING_WINDOW_DAYS') ?? defaults.bookingWindowDays,
  availability:      envJson('SCHEDULER_AVAILABILITY')       ?? defaults.availability,
  meetingTypes:      envJson('SCHEDULER_MEETING_TYPES')      ?? defaults.meetingTypes,
  owner: {
    name:     requireEnv('SCHEDULER_OWNER_NAME'),
    email:    requireEnv('SCHEDULER_OWNER_EMAIL'),
    timezone: requireEnv('SCHEDULER_OWNER_TIMEZONE'),
  },
};

validate(merged);

export const config = merged;

export function getMeetingType(slug) {
  return config.meetingTypes.find((m) => m.slug === slug);
}

function validate(c) {
  for (const f of ['startHour', 'endHour', 'bufferMinutes']) {
    if (typeof c.availability[f] !== 'number') {
      throw new Error(`availability.${f} must be a number`);
    }
  }
  if (!Array.isArray(c.availability.days) || c.availability.days.length === 0) {
    throw new Error('availability.days must be a non-empty array');
  }
  if (!Array.isArray(c.meetingTypes) || c.meetingTypes.length === 0) {
    throw new Error('meetingTypes must be a non-empty array');
  }
  for (const mt of c.meetingTypes) {
    for (const f of ['slug', 'name', 'duration', 'description']) {
      if (mt[f] === undefined || mt[f] === null) {
        throw new Error(`Meeting type missing field "${f}": ${JSON.stringify(mt)}`);
      }
    }
    if (typeof mt.duration !== 'number' || mt.duration <= 0) {
      throw new Error(`Meeting type "${mt.slug}" duration must be a positive number`);
    }
  }
  const slugs = c.meetingTypes.map((m) => m.slug);
  if (new Set(slugs).size !== slugs.length) {
    throw new Error('meetingTypes have duplicate slugs');
  }
}
