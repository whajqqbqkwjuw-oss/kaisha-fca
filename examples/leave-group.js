'use strict';

/**
 * Example: Leave Group
 *
 * Removes the authenticated user from a group conversation thread.
 * After leaving, the client will no longer receive events for that thread.
 *
 * Usage:
 *   THREAD_ID=<group_thread_id> node examples/leave-group.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID = process.env.THREAD_ID;

  if (!threadID) {
    console.error('Set THREAD_ID before running this example.');
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

  // Fetch name before leaving so we can confirm in the output
  const info = await client.api.fetchThreadInfo(threadID);
  console.log(`Leaving group: "${info.name || threadID}"`);

  await client.api.leaveGroup(threadID);
  console.log(`Successfully left group thread ${threadID}`);

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
