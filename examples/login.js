'use strict';

/**
 * Example: Email and Password Login
 *
 * Demonstrates authenticating with Facebook using email and password,
 * then saving the session to disk for later reuse.
 *
 * Usage:
 *   EMAIL=you@example.com PASSWORD=yourpassword node examples/login.js
 */

const path  = require('path');
const kaisha = require('../src/index');

async function main() {
  const email    = process.env.EMAIL;
  const password = process.env.PASSWORD;

  if (!email || !password) {
    console.error('Set EMAIL and PASSWORD environment variables before running this example.');
    process.exit(1);
  }

  const client = await kaisha.login(
    { type: 'email', email, password },
    { logLevel: 'info' }
  );

  console.log('Logged in as user:', client.session.data.userID);

  // Save session to disk so it can be reused with appstate login
  const sessionPath = path.resolve(__dirname, '../session.json');
  const cookies = client.session.data.cookies;

  // Convert cookie map to appstate array format for compatibility
  const appstate = Object.entries(cookies).map(([name, value]) => ({
    name,
    value,
    domain: '.facebook.com',
    path: '/',
    secure: true,
    httpOnly: name === 'xs' || name === 'c_user',
  }));

  require('fs').writeFileSync(
    sessionPath,
    JSON.stringify(appstate, null, 2),
    'utf8'
  );

  console.log(`Session saved to ${sessionPath}`);

  client.disconnect();
}

main().catch((err) => {
  console.error('Login failed:', err.message);
  process.exit(1);
});