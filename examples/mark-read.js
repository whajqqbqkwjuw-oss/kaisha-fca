'use strict';

/**
 * Example: Mark Conversation as Read / Unread
 *
 * Loads an appstate, then marks a thread as read and immediately back to
 * unread to demonstrate both API methods.
 *
 * Usage:
 *   THREAD_ID=<thread_id> node examples/mark-read.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID = process.env.THREAD_ID;

  if (!threadID) {
    console.error('Set the THREAD_ID environment variable before running this example.');
    process.exit(1);
  }

  const sessionPath = path.resolve(__dirname, '../session.json');
  if (!fs.existsSync(sessionPath)) {
    console.error(`session.json not found at ${sessionPath}. Run examples/login.js first.`);
    process.exit(1);
  }

  const appstate = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  const client   = await kaisha.login(
    { type: 'appstate', appstate },
    { logLevel: 'info' }
  );

  console.log('Authenticated as user:', client.session.data.userID);

  // Mark as read
  await client.api.markAsRead(threadID);
  console.log(`Thread ${threadID} marked as read.`);

  // Wait a moment then mark as unread
  await new Promise((r) => setTimeout(r, 1500));

  await client.api.markAsUnread(threadID);
  console.log(`Thread ${threadID} marked as unread.`);

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
