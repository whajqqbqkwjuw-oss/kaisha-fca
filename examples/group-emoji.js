'use strict';

/**
 * Example: Change Group Emoji
 *
 * Changes the emoji icon (conversation theme) for a Messenger thread.
 *
 * Usage:
 *   THREAD_ID=<thread_id> EMOJI="🔥" node examples/group-emoji.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID = process.env.THREAD_ID;
  const emoji    = process.env.EMOJI;

  if (!threadID || !emoji) {
    console.error('Set both THREAD_ID and EMOJI before running this example.');
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

  await client.api.changeGroupEmoji(threadID, emoji);
  console.log(`Thread ${threadID} emoji changed to "${emoji}"`);

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
