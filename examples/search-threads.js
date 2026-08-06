'use strict';

/**
 * Example: Search Threads
 *
 * Searches Messenger conversations (threads) by name or participant name and
 * prints the matching results.
 *
 * Usage:
 *   QUERY="family" LIMIT=10 node examples/search-threads.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const query = process.env.QUERY;
  const limit = parseInt(process.env.LIMIT ?? '10', 10);

  if (!query) {
    console.error('Set the QUERY environment variable before running this example.');
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

  const results = await client.api.searchThreads(query, { limit });

  if (results.length === 0) {
    console.log(`No threads found matching "${query}".`);
    client.disconnect();
    return;
  }

  console.log(`\nThread search results for "${query}" (${results.length}):\n`);

  for (const t of results) {
    const type    = t.isGroup ? '[Group]' : '[DM]   ';
    const unread  = t.unreadCount > 0 ? ` [${t.unreadCount} unread]` : '';
    const preview = t.lastMessage
      ? `"${t.lastMessage.slice(0, 55)}${t.lastMessage.length > 55 ? '…' : ''}"`
      : '(no messages)';

    console.log(`${type} ${t.name || t.threadID}${unread}`);
    console.log(`  Thread ID:    ${t.threadID}`);
    console.log(`  Participants: ${t.participantIDs.length}`);
    console.log(`  Last message: ${preview}`);
    console.log();
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
