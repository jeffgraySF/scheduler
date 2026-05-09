// Loads and validates the user-supplied config.js at module-load time.
// Throws loudly if anything is missing — better to fail at startup than serve
// a broken booking flow.

import userConfig from '../../config.js';

const required = {
  'theme': 'string',
  'owner.name': 'string',
  'owner.email': 'string',
  'owner.timezone': 'string',
  'availability.days': 'array',
  'availability.startHour': 'number',
  'availability.endHour': 'number',
  'availability.bufferMinutes': 'number',
  'bookingWindowDays': 'number',
  'meetingTypes': 'array',
};

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function check(obj) {
  for (const [path, type] of Object.entries(required)) {
    const value = get(obj, path);
    if (value === undefined || value === null) {
      throw new Error(`config.js is missing required field: ${path}`);
    }
    const actual = Array.isArray(value) ? 'array' : typeof value;
    if (actual !== type) {
      throw new Error(`config.js field "${path}" should be ${type}, got ${actual}`);
    }
  }

  if (!Array.isArray(obj.meetingTypes) || obj.meetingTypes.length === 0) {
    throw new Error('config.js meetingTypes must be a non-empty array');
  }

  for (const mt of obj.meetingTypes) {
    for (const f of ['slug', 'name', 'duration', 'description']) {
      if (mt[f] === undefined || mt[f] === null) {
        throw new Error(`Meeting type missing field "${f}": ${JSON.stringify(mt)}`);
      }
    }
    if (typeof mt.duration !== 'number' || mt.duration <= 0) {
      throw new Error(`Meeting type "${mt.slug}" duration must be a positive number`);
    }
  }

  const slugs = obj.meetingTypes.map((m) => m.slug);
  if (new Set(slugs).size !== slugs.length) {
    throw new Error('config.js meetingTypes have duplicate slugs');
  }
}

check(userConfig);

export const config = userConfig;

export function getMeetingType(slug) {
  return config.meetingTypes.find((m) => m.slug === slug);
}
