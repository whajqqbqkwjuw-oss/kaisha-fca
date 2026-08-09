'use strict';

/**
 * Example: Fetch Unread Conversations
 *
 * Fetches conversations that have at least one unread message and prints
 * a summary of each, ordered by unread count descending.
 *
 * Usage:
 *   LIMIT=20 node examples/unread-conversations.js
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

  const threads = await client.api.fetchUnreadConversations({ limit });

  if (threads.length === 0) {
    console.log('No unread conversations found. Your inbox is clear!');
    client.disconnect();
    return;
  }

  // Sort by unread count descending for a useful default display order
  threads.sort((a, b) => b.unreadCount - a.unreadCount);

  console.log(`\nUnread conversations (${threads.length}):\n`);

  for (const t of threads) {
    const type    = t.isGroup ? '[Group]' : '[DM]   ';
    const preview = t.lastMessage
      ? `"${t.lastMessage.slice(0, 60)}${t.lastMessage.length > 60 ? '…' : ''}"`
      : '(no preview)';

    console.log(`${type} ${t.name || t.threadID} — ${t.unreadCount} unread`);
    console.log(`  Thread ID:    ${t.threadID}`);
    console.log(`  Last message: ${preview}`);
    console.log();
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
