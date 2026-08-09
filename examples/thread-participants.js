'use strict';

/**
 * Example: Fetch Thread Participants
 *
 * Retrieves detailed information about every participant in a thread,
 * including admin status and nickname.
 *
 * Usage:
 *   THREAD_ID=<thread_id> node examples/thread-participants.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID = process.env.THREAD_ID;

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

  const participants = await client.api.fetchThreadParticipants(threadID);

  console.log(`\nParticipants in thread ${threadID} (${participants.length}):\n`);

  for (const p of participants) {
    const admin    = p.isAdmin   ? ' [ADMIN]'         : '';
    const nickname = p.nickname  ? ` aka "${p.nickname}"` : '';
    const username = p.vanity    ? ` (@${p.vanity})`  : '';
    console.log(`${p.name}${nickname}${username}${admin}`);
    console.log(`  ID:      ${p.id}`);
    console.log(`  Gender:  ${p.gender}`);
    console.log(`  Picture: ${p.profilePictureURL || '(none)'}`);
    console.log();
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
