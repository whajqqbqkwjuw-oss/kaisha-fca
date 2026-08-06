'use strict';

/**
 * Example: Archive and Unarchive Conversation
 *
 * Archives a thread (hides it from the main inbox), then unarchives it after
 * a short delay to restore it.
 *
 * Pass UNARCHIVE=0 to only archive without restoring.
 *
 * Usage:
 *   THREAD_ID=<thread_id> node examples/archive-conversation.js
 *   THREAD_ID=<thread_id> UNARCHIVE=0 node examples/archive-conversation.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID   = process.env.THREAD_ID;
  const doUnarchive = process.env.UNARCHIVE !== '0';

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

  // Archive
  await client.api.archiveConversation(threadID);
  console.log(`Thread ${threadID} archived.`);

  if (doUnarchive) {
    await new Promise((r) => setTimeout(r, 2_000));

    await client.api.unarchiveConversation(threadID);
    console.log(`Thread ${threadID} unarchived.`);
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
