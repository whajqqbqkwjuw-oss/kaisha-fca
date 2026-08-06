'use strict';

/**
 * Example: Forward Message
 *
 * Forwards an existing message (identified by its ID and source thread) to
 * one or more destination threads.  Attachments are re-downloaded and
 * re-uploaded automatically.
 *
 * Usage:
 *   MESSAGE_ID=<message_id> \
 *   SOURCE_THREAD=<source_thread_id> \
 *   DEST_THREADS="threadA,threadB" \
 *   node examples/forward-message.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const messageID    = process.env.MESSAGE_ID;
  const sourceThread = process.env.SOURCE_THREAD;
  const rawDests     = process.env.DEST_THREADS ?? '';

  if (!messageID || !sourceThread || !rawDests) {
    console.error('Set MESSAGE_ID, SOURCE_THREAD, and DEST_THREADS before running this example.');
    process.exit(1);
  }

  const destThreadIDs = rawDests.split(',').map((s) => s.trim()).filter(Boolean);

  if (destThreadIDs.length === 0) {
    console.error('DEST_THREADS must contain at least one thread ID.');
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

  const results = await client.api.forwardMessage(messageID, sourceThread, destThreadIDs);

  console.log(`\nForwarded message ${messageID} to ${results.length} thread(s):\n`);
  for (const r of results) {
    console.log(`  Thread ${r.threadID} → new message ID: ${r.messageID}`);
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
