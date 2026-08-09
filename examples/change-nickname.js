'use strict';

/**
 * Example: Change Group Nickname
 *
 * Changes the in-thread nickname for a participant.  Pass an empty string
 * as NICKNAME to clear an existing nickname.
 *
 * Usage:
 *   THREAD_ID=<thread_id> USER_ID=<user_id> NICKNAME="Cool Name" \
 *     node examples/change-nickname.js
 *
 *   # Clear a nickname:
 *   THREAD_ID=<thread_id> USER_ID=<user_id> NICKNAME="" \
 *     node examples/change-nickname.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID = process.env.THREAD_ID;
  const userID   = process.env.USER_ID;
  const nickname = process.env.NICKNAME ?? '';

  if (!threadID || !userID) {
    console.error('Set both THREAD_ID and USER_ID before running this example.');
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

  await client.api.changeNickname(threadID, userID, nickname);

  if (nickname) {
    console.log(`Nickname for user ${userID} in thread ${threadID} set to "${nickname}"`);
  } else {
    console.log(`Nickname for user ${userID} in thread ${threadID} cleared`);
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
