'use strict';

/**
 * Example: Quote Reply
 *
 * Sends a quote-reply to a specific message, embedding a preview of the
 * original text above the reply content.
 *
 * Usage:
 *   THREAD_ID=<thread_id> \
 *   MESSAGE_ID=<message_id_to_quote> \
 *   QUOTE_TEXT="Original message text" \
 *   REPLY="My reply here" \
 *   node examples/quote-reply.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID  = process.env.THREAD_ID;
  const messageID = process.env.MESSAGE_ID;
  const quoteText = process.env.QUOTE_TEXT ?? '';
  const reply     = process.env.REPLY;

  if (!threadID || !messageID || !reply) {
    console.error('Set THREAD_ID, MESSAGE_ID, and REPLY before running this example.');
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

  const result = await client.api.quoteReply(
    threadID,
    messageID,
    quoteText,
    reply
  );

  console.log(`Quote-reply sent to thread ${threadID}.`);
  console.log(`New message ID: ${result.messageID}`);

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
