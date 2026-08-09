'use strict';

/**
 * Example: Fetch Thread List
 *
 * Loads an appstate, fetches the first page of inbox threads, and prints
 * a summary table to the console.
 *
 * Usage:
 *   LIMIT=20 node examples/thread-list.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const limit = parseInt(process.env.LIMIT ?? '20', 10);

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

  const threads = await client.api.fetchThreadList({ limit });

  console.log(`\nInbox threads (${threads.length}):\n`);
  for (const t of threads) {
    const type    = t.isGroup ? '[Group]' : '[DM]   ';
    const unread  = t.unreadCount > 0 ? ` (${t.unreadCount} unread)` : '';
    const preview = t.lastMessage
      ? `"${t.lastMessage.slice(0, 50)}"`
      : '(no message)';
    console.log(`${type} ${t.name || t.threadID}${unread}`);
    console.log(`       ID: ${t.threadID}`);
    console.log(`       Last: ${preview}`);
    console.log(`       Participants: ${t.participantIDs.length}`);
    console.log();
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
