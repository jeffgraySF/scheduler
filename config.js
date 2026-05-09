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
  theme: 'minimal',                  // override: SCHEDULER_THEME
  language: 'en',                    // override: SCHEDULER_LANGUAGE (reserved — no i18n yet)
  bookingWindowDays: 30,             // override: SCHEDULER_BOOKING_WINDOW_DAYS

  availability: {                    // override: SCHEDULER_AVAILABILITY (JSON)
    days: [1, 2, 3, 4, 5],           // 0 = Sunday, 6 = Saturday
    startHour: 9,
    endHour: 17,
    bufferMinutes: 15,
  },

  meetingTypes: [                    // override: SCHEDULER_MEETING_TYPES (JSON)
    {
      slug: 'intro',
      name: 'Intro Call',
      duration: 30,
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
};
