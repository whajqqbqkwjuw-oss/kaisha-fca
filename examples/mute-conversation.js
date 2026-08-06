'use strict';

/**
 * Example: Mute and Unmute Conversation
 *
 * Mutes a thread for a configurable number of seconds, then unmutes it.
 * Pass MUTE_SECONDS=-1 to mute indefinitely.
 * Pass UNMUTE=0 to skip the unmute step.
 *
 * Usage:
 *   THREAD_ID=<thread_id> MUTE_SECONDS=3600 node examples/mute-conversation.js
 *   THREAD_ID=<thread_id> MUTE_SECONDS=-1 UNMUTE=0 node examples/mute-conversation.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID   = process.env.THREAD_ID;
  const muteSecs   = parseInt(process.env.MUTE_SECONDS ?? '3600', 10);
  const doUnmute   = process.env.UNMUTE !== '0';

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

  const duration = muteSecs === -1 ? 'indefinitely' : `for ${muteSecs}s`;
  await client.api.muteConversation(threadID, muteSecs);
  console.log(`Thread ${threadID} muted ${duration}.`);

  if (doUnmute) {
    await new Promise((r) => setTimeout(r, 2_000));
    await client.api.unmuteConversation(threadID);
    console.log(`Thread ${threadID} unmuted.`);
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
