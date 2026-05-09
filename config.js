// Structural defaults for the scheduler.
//
// This file is checked into the repo. It contains no PII and no secrets —
// just the shape of the deployment (theme, schedule, meeting types).
//
// Per-deployment values come from environment variables, which override
// anything here. See .env.example for the full list. The merge happens in
// src/lib/config.js.
//
// Required env vars: SCHEDULER_OWNER_NAME, SCHEDULER_OWNER_EMAIL,
// SCHEDULER_OWNER_TIMEZONE.

export default {
  theme: 'warm',                  // override: SCHEDULER_THEME
  language: 'en',                    // override: SCHEDULER_LANGUAGE (reserved — no i18n yet)
  bookingWindowDays: 30,             // override: SCHEDULER_BOOKING_WINDOW_DAYS

  availability: {                    // override: SCHEDULER_AVAILABILITY (JSON)
    days: [1, 2, 3, 4, 5],           // 0 = Sunday, 6 = Saturday
    startHour: 8,
    endHour: 17,
    bufferMinutes: 0,
  },

  meetingTypes: [                    // override: SCHEDULER_MEETING_TYPES (JSON)
    {
      slug: 'thirty',
      name: '30 minutes',
      duration: 30,
      description: 'A thirty-minute call',
      questions: [
        { id: 'context', label: 'What would you like to discuss?', required: true },
      ],
    },
    {
      slug: 'sixty',
      name: '60 minutes',
      duration: 60,
      description: 'A sixty-minute call',
      questions: [
        { id: 'context', label: 'What would you like to discuss?', required: true },
      ],
    },
  ],
};
