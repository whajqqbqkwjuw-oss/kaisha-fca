'use strict';

/**
 * Example: Fetch Message History
 *
 * Fetches and prints the most recent messages from a thread, then
 * demonstrates pagination by fetching the next older page.
 *
 * Usage:
 *   THREAD_ID=<thread_id> LIMIT=20 node examples/message-history.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID = process.env.THREAD_ID;
  const limit    = parseInt(process.env.LIMIT ?? '20', 10);

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

  // ── Page 1: most recent messages ─────────────────────────────────────
  const page1 = await client.api.fetchMessageHistory(threadID, { limit });

  console.log(`\nPage 1 — ${page1.messages.length} message(s) (newest first):\n`);

  for (const msg of page1.messages) {
    const ts          = new Date(msg.timestamp).toLocaleString();
    const preview     = msg.body.slice(0, 60) || '(attachment/sticker)';
    const unsent      = msg.isUnsent ? ' [UNSENT]' : '';
    const attachCount = msg.attachments.length > 0 ? ` [${msg.attachments.length} attachment(s)]` : '';
    const reply       = msg.replyToMessageID ? ` (reply to ${msg.replyToMessageID})` : '';
    console.log(`[${ts}] ${msg.senderID}${unsent}${reply}`);
    console.log(`  ${preview}${msg.body.length > 60 ? '…' : ''}${attachCount}`);
    console.log();
  }

  // ── Page 2: older messages (if available) ────────────────────────────
  if (page1.hasMore && page1.nextBefore !== null) {
    console.log('Fetching next page (older messages)…\n');

    const page2 = await client.api.fetchMessageHistory(threadID, {
      limit,
      before: page1.nextBefore,
    });

    console.log(`Page 2 — ${page2.messages.length} message(s):\n`);
    for (const msg of page2.messages) {
      const ts      = new Date(msg.timestamp).toLocaleString();
      const preview = msg.body.slice(0, 60) || '(attachment/sticker)';
      console.log(`[${ts}] ${msg.senderID}: ${preview}${msg.body.length > 60 ? '…' : ''}`);
    }
  } else {
    console.log('No older messages available.');
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
