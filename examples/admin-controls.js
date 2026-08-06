'use strict';

/**
 * Example: Promote and Demote Group Admin
 *
 * Promotes a participant to admin in a group thread, then (optionally) demotes
 * them back to a regular participant.  The authenticated user must already be
 * an admin of the group.
 *
 * Usage:
 *   THREAD_ID=<group_thread_id> USER_ID=<user_to_promote> \
 *     node examples/admin-controls.js
 *
 *   # Also demote after promoting:
 *   THREAD_ID=<group_thread_id> USER_ID=<user_id> DEMOTE=1 \
 *     node examples/admin-controls.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID  = process.env.THREAD_ID;
  const userID    = process.env.USER_ID;
  const alsoDemote = process.env.DEMOTE === '1';

  if (!threadID || !userID) {
    console.error('Set both THREAD_ID and USER_ID before running this example.');
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

  // Promote
  await client.api.promoteAdmin(threadID, userID);
  console.log(`User ${userID} promoted to admin in thread ${threadID}`);

  // Verify via participants list
  const participants = await client.api.fetchThreadParticipants(threadID);
  const target       = participants.find((p) => p.id === userID);
  if (target) {
    console.log(`Confirmed — ${target.name} isAdmin: ${target.isAdmin}`);
  }

  // Optionally demote
  if (alsoDemote) {
    await new Promise((r) => setTimeout(r, 1_500));
    await client.api.demoteAdmin(threadID, userID);
    console.log(`User ${userID} demoted back to participant in thread ${threadID}`);

    const updated = await client.api.fetchThreadParticipants(threadID);
    const updatedTarget = updated.find((p) => p.id === userID);
    if (updatedTarget) {
      console.log(`Confirmed — ${updatedTarget.name} isAdmin: ${updatedTarget.isAdmin}`);
    }
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
