'use strict';

/**
 * Example: Typing Indicator
 *
 * Sends a typing indicator to a thread for 3 seconds, then stops it and
 * sends a message — simulating a realistic human interaction.
 *
 * Usage:
 *   THREAD_ID=<thread_id> node examples/typing.js
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

  // Start typing indicator
  await client.api.startTyping(threadID);
  console.log('Typing indicator started. Waiting 3 seconds…');

  await new Promise((r) => setTimeout(r, 3_000));

  // Stop typing indicator
  await client.api.stopTyping(threadID);
  console.log('Typing indicator stopped.');

  // Send the actual message
  const result = await client.api.sendMessage(threadID, 'Hello! I was just typing…');
  console.log('Message sent. ID:', result.messageID);

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
