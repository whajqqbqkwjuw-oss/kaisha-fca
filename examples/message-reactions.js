'use strict';

/**
 * Example: Message Reactions and Reaction Removal
 *
 * Demonstrates adding a reaction to a message, then removing it using both
 * the generic reactToMessage API and the dedicated removeReaction convenience
 * method.
 *
 * Usage:
 *   THREAD_ID=<thread_id> MESSAGE_ID=<message_id> EMOJI="😍" \
 *     node examples/message-reactions.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID  = process.env.THREAD_ID;
  const messageID = process.env.MESSAGE_ID;
  const emoji     = process.env.EMOJI ?? '👍';

  if (!threadID || !messageID) {
    console.error('Set both THREAD_ID and MESSAGE_ID before running this example.');
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

  // Add reaction
  await client.api.reactToMessage(messageID, threadID, emoji);
  console.log(`Reaction "${emoji}" added to message ${messageID}`);

  // Wait briefly so the reaction registers before removing
  await new Promise((r) => setTimeout(r, 1_500));

  // Remove reaction using the dedicated convenience method
  await client.api.removeReaction(messageID, threadID);
  console.log(`Reaction removed from message ${messageID}`);

  // Add a different reaction to show reactToMessage with '' also removes
  await client.api.reactToMessage(messageID, threadID, '❤️');
  console.log('Added "❤️" reaction');

  await new Promise((r) => setTimeout(r, 1_500));

  await client.api.reactToMessage(messageID, threadID, '');
  console.log('Reaction cleared via reactToMessage with empty string');

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
