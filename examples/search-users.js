'use strict';

/**
 * Example: Search Users
 *
 * Loads an appstate and searches Messenger for users matching a query.
 *
 * Usage:
 *   QUERY="John Doe" LIMIT=10 node examples/search-users.js
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

  const results = await client.api.searchUsers(query, { limit });

  if (results.length === 0) {
    console.log(`No results found for "${query}".`);
  } else {
    console.log(`\nSearch results for "${query}" (${results.length}):\n`);
    for (const r of results) {
      console.log(`[${r.type}] ${r.name}`);
      console.log(`       ID:       ${r.id}`);
      console.log(`       Username: ${r.vanity || '(none)'}`);
      console.log(`       Picture:  ${r.profilePictureURL || '(none)'}`);
      console.log();
    }
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
