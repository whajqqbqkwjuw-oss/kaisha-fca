'use strict';

/**
 * Example: Create Group
 *
 * Creates a new Messenger group thread with a given set of participants and
 * an optional name, then sends an introductory message.
 *
 * Usage:
 *   PARTICIPANT_IDS="111,222,333" GROUP_NAME="My Group" node examples/create-group.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const rawIDs    = process.env.PARTICIPANT_IDS;
  const groupName = process.env.GROUP_NAME ?? '';

  if (!rawIDs) {
    console.error(
      'Set PARTICIPANT_IDS as a comma-separated list of user IDs.\n' +
      'Example: PARTICIPANT_IDS="111,222,333" node examples/create-group.js'
    );
    process.exit(1);
  }

  const participantIDs = rawIDs.split(',').map((id) => id.trim()).filter(Boolean);

  if (participantIDs.length < 2) {
    console.error('Provide at least 2 participant IDs to create a group.');
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

  const result = await client.api.createGroup(participantIDs, groupName);

  console.log('\nGroup created:');
  console.log(`  Thread ID:    ${result.threadID}`);
  console.log(`  Name:         ${result.name || '(unnamed)'}`);
  console.log(`  Participants: ${result.participantIDs.join(', ')}`);

  if (result.threadID) {
    await client.api.sendMessage(result.threadID, 'Hello everyone! 👋 This group was created with Kaisha.');
    console.log('Introductory message sent.');
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
