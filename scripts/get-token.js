// One-time OAuth flow to get a Google Calendar refresh token.
// Run: `npm run get-token`
//
// Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.

import http from 'node:http';
import { URL } from 'node:url';
import { exec } from 'node:child_process';
import 'dotenv/config';
import { google } from 'googleapis';

const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/calendar.events'],
});

console.log('\nOpening Google OAuth in your browser...');
console.log('If it does not open, visit this URL manually:\n');
console.log(authUrl);
console.log();

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, REDIRECT_URI);
    const code = reqUrl.searchParams.get('code');
    if (!code) {
      res.writeHead(400); res.end('No code in request');
      return;
    }
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<h2>All set — you can close this tab.</h2>');

    if (!tokens.refresh_token) {
      console.error('\nNo refresh_token returned. This usually means you have already');
      console.error('granted consent. Revoke access at https://myaccount.google.com/permissions');
      console.error('then re-run this script.');
      process.exit(1);
    }

    console.log('\n✓ Got refresh token. Add this to your .env file:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log();
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Token exchange failed:', err);
    res.writeHead(500); res.end('Token exchange failed (see terminal)');
    process.exit(1);
  }
});

server.listen(REDIRECT_PORT, () => {
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32' ? 'start'
            : 'xdg-open';
  exec(`${cmd} "${authUrl}"`);
});
