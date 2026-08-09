'use strict';

/**
 * Example: Fetch Friend List
 *
 * Loads an appstate and retrieves the authenticated user's friend list.
 * Prints each friend's name, ID, and username.
 *
 * Usage:
 *   LIMIT=100 node examples/friend-list.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const limit = parseInt(process.env.LIMIT ?? '500', 10);

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

  const friends = await client.api.fetchFriendList({ limit });

  if (friends.length === 0) {
    console.log('No friends returned. The endpoint may not be available for this account type.');
  } else {
    console.log(`\nFriend list (${friends.length} friends):\n`);
    for (const f of friends) {
      const username = f.vanity ? ` (@${f.vanity})` : '';
      console.log(`${f.name}${username}`);
      console.log(`  ID:     ${f.id}`);
      console.log(`  Gender: ${f.gender}`);
      console.log(`  Pic:    ${f.profilePictureURL || '(none)'}`);
      console.log();
    }
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
