'use strict';

/**
 * Example: Message Search
 *
 * Searches for messages in a thread matching a query string and prints the
 * results with sender names, timestamps, and attachment counts.
 *
 * Usage:
 *   THREAD_ID=<thread_id> QUERY="hello" LIMIT=20 node examples/message-search.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID = process.env.THREAD_ID;
  const query    = process.env.QUERY;
  const limit    = parseInt(process.env.LIMIT ?? '20', 10);

  if (!threadID || !query) {
    console.error('Set both THREAD_ID and QUERY before running this example.');
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

  const results = await client.api.searchMessages(threadID, query, { limit });

  if (results.length === 0) {
    console.log(`No messages found matching "${query}" in thread ${threadID}.`);
  } else {
    console.log(`\nFound ${results.length} message(s) matching "${query}":\n`);
    for (const msg of results) {
      const ts          = new Date(msg.timestamp).toLocaleString();
      const attachCount = msg.attachments.length;
      const preview     = msg.body.slice(0, 80) || '(no text)';

      console.log(`[${ts}] ${msg.senderName || msg.senderID}`);
      console.log(`  ID:   ${msg.messageID}`);
      console.log(`  Body: ${preview}${msg.body.length > 80 ? '…' : ''}`);
      if (attachCount > 0) {
        console.log(`  Attachments: ${attachCount}`);
      }
      console.log();
    }
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
