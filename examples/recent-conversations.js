'use strict';

/**
 * Example: Fetch Recent Conversations
 *
 * Fetches the most recently active conversations sorted by last message
 * timestamp (newest first) and prints a summary of each thread.
 *
 * Usage:
 *   LIMIT=10 node examples/recent-conversations.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const limit = parseInt(process.env.LIMIT ?? '10', 10);

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

  const threads = await client.api.fetchRecentConversations({ limit });

  if (threads.length === 0) {
    console.log('No recent conversations found.');
    client.disconnect();
    return;
  }

  console.log(`\nRecent conversations (${threads.length}, newest first):\n`);

  for (const t of threads) {
    const type    = t.isGroup ? '[Group]' : '[DM]   ';
    const unread  = t.unreadCount > 0 ? ` [${t.unreadCount} unread]` : '';
    const ts      = t.lastTimestamp > 0
      ? new Date(t.lastTimestamp).toLocaleString()
      : 'unknown';
    const preview = t.lastMessage
      ? `"${t.lastMessage.slice(0, 55)}${t.lastMessage.length > 55 ? '…' : ''}"`
      : '(no messages)';

    console.log(`${type} ${t.name || t.threadID}${unread}`);
    console.log(`  Thread ID:    ${t.threadID}`);
    console.log(`  Last active:  ${ts}`);
    console.log(`  Last message: ${preview}`);
    console.log();
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
