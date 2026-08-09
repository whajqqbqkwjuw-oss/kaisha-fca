'use strict';

/**
 * Example: Send a Message
 *
 * Loads an appstate from ./session.json and sends a text message to a thread.
 *
 * Usage:
 *   THREAD_ID=<thread_id> MESSAGE="Hello!" node examples/send-message.js
 */

const path    = require('path');
const fs      = require('fs');
const kaisha  = require('../src/index');

async function main() {
  const threadID = process.env.THREAD_ID;
  const message  = process.env.MESSAGE || 'Hello from Kaisha!';

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

  const client = await kaisha.login(
    { type: 'appstate', appstate },
    { logLevel: 'info' }
  );

  console.log('Authenticated as user:', client.session.data.userID);

  const result = await client.api.sendMessage(threadID, message);
  console.log('Message sent. ID:', result.messageID);

  const threadInfo = await client.api.fetchThreadInfo(threadID);
  console.log('Thread info:', {
    name:         threadInfo.name,
    isGroup:      threadInfo.isGroup,
    participants: threadInfo.participantIDs.length,
  });

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
