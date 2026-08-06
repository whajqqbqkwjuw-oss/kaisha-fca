'use strict';

/**
 * Example: Fetch Group List
 *
 * Fetches all group conversations from the authenticated user's inbox and
 * prints a summary of each group thread.
 *
 * Usage:
 *   LIMIT=20 node examples/group-list.js
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

  const groups = await client.api.fetchGroupList({ limit });

  if (groups.length === 0) {
    console.log('No group conversations found.');
    client.disconnect();
    return;
  }

  console.log(`\nGroup conversations (${groups.length}):\n`);

  for (const g of groups) {
    const unread  = g.unreadCount > 0 ? ` [${g.unreadCount} unread]` : '';
    const preview = g.lastMessage
      ? `"${g.lastMessage.slice(0, 50)}${g.lastMessage.length > 50 ? '…' : ''}"`
      : '(no messages)';

    console.log(`${g.name || '(unnamed group)'}${unread}`);
    console.log(`  Thread ID:    ${g.threadID}`);
    console.log(`  Participants: ${g.participantIDs.length}`);
    console.log(`  Last message: ${preview}`);
    console.log();
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
