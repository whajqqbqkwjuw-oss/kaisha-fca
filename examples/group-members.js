'use strict';

/**
 * Example: Add and Remove Group Members
 *
 * Demonstrates adding one or more members to a group thread, then removing
 * a single member.
 *
 * Usage:
 *   THREAD_ID=<group_thread_id> ADD_IDS="444,555" REMOVE_ID="444" \
 *     node examples/group-members.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID  = process.env.THREAD_ID;
  const rawAddIDs = process.env.ADD_IDS ?? '';
  const removeID  = process.env.REMOVE_ID ?? '';

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

  // Add members
  if (rawAddIDs) {
    const addIDs = rawAddIDs.split(',').map((id) => id.trim()).filter(Boolean);
    await client.api.addMembers(threadID, addIDs);
    console.log(`Added members [${addIDs.join(', ')}] to thread ${threadID}`);
  }

  // Remove a member
  if (removeID) {
    await client.api.removeMember(threadID, removeID);
    console.log(`Removed member ${removeID} from thread ${threadID}`);
  }

  // Show current participants
  const participants = await client.api.fetchThreadParticipants(threadID);
  console.log(`\nCurrent participants (${participants.length}):`);
  for (const p of participants) {
    const admin = p.isAdmin ? ' [admin]' : '';
    console.log(`  ${p.name}${admin} — ID: ${p.id}`);
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
