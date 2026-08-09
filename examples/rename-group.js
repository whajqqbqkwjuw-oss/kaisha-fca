'use strict';

/**
 * Example: Rename Group
 *
 * Changes the display name of a group conversation thread.
 *
 * Usage:
 *   THREAD_ID=<group_thread_id> NAME="New Group Name" node examples/rename-group.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID = process.env.THREAD_ID;
  const name     = process.env.NAME;

  if (!threadID || !name) {
    console.error('Set both THREAD_ID and NAME before running this example.');
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

  await client.api.renameGroup(threadID, name);
  console.log(`Group thread ${threadID} renamed to "${name}"`);

  const info = await client.api.fetchThreadInfo(threadID);
  console.log('Confirmed new name:', info.name);

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
