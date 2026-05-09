// Copy this to config.js and fill in your values. config.js is gitignored.

export default {
  // Active theme. Add new themes by dropping a CSS file into src/styles/themes/.
  theme: 'minimal', // 'minimal' | 'warm' | 'dark'

  owner: {
    name: 'Your Name',
    email: 'you@yourdomain.com',
    timezone: 'America/New_York', // IANA timezone string
  },

  availability: {
    days: [1, 2, 3, 4, 5], // 0 = Sunday, 6 = Saturday
    startHour: 9,           // 9am in owner timezone
    endHour: 17,            // 5pm in owner timezone (last slot ends by this)
    bufferMinutes: 15,      // gap between meetings
  },

  // How far in advance guests can book (days from today).
  bookingWindowDays: 30,

  meetingTypes: [
    {
      slug: 'intro',
      name: 'Intro Call',
      duration: 30, // minutes
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
