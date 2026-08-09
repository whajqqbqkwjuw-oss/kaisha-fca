'use strict';

/**
 * Example: Group Events
 *
 * Connects to the MQTT broker and listens for all group-related real-time
 * events:
 *
 *   participant:join  — someone was added to a group
 *   participant:leave — someone left or was removed
 *   admin:promote     — a participant was made admin
 *   admin:demote      — an admin was demoted
 *   group:name        — the group name was changed
 *   group:photo       — the group photo was changed
 *   group:emoji       — the group emoji was changed
 *
 * Usage:
 *   node examples/group-events.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
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

  client.events.on('ready', () => {
    console.log('Connected. Listening for group events…\n');
  });

  /**
   * Participant join
   * {
   *   type:      'participant:join'
   *   threadID:  string
   *   actorID:   string   — who added them
   *   addedIDs:  string[] — who joined
   *   timestamp: number
   * }
   */
  client.events.on('participant:join', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();
    console.log(`[${ts}] [participant:join] thread=${event.threadID}`);
    console.log(`  Added by: ${event.actorID}`);
    console.log(`  Joined:   ${event.addedIDs.join(', ')}`);
    console.log();
  });

  /**
   * Participant leave
   * {
   *   type:       'participant:leave'
   *   threadID:   string
   *   actorID:    string
   *   removedIDs: string[]
   *   timestamp:  number
   * }
   */
  client.events.on('participant:leave', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();
    console.log(`[${ts}] [participant:leave] thread=${event.threadID}`);
    console.log(`  Actor:   ${event.actorID}`);
    console.log(`  Removed: ${event.removedIDs.join(', ')}`);
    console.log();
  });

  /**
   * Admin promoted
   * {
   *   type:      'admin:promote'
   *   threadID:  string
   *   actorID:   string
   *   targetID:  string
   *   timestamp: number
   * }
   */
  client.events.on('admin:promote', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();
    console.log(`[${ts}] [admin:promote] thread=${event.threadID}`);
    console.log(`  By:     ${event.actorID}`);
    console.log(`  Promoted: ${event.targetID}`);
    console.log();
  });

  /**
   * Admin demoted
   * {
   *   type:      'admin:demote'
   *   threadID:  string
   *   actorID:   string
   *   targetID:  string
   *   timestamp: number
   * }
   */
  client.events.on('admin:demote', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();
    console.log(`[${ts}] [admin:demote] thread=${event.threadID}`);
    console.log(`  By:     ${event.actorID}`);
    console.log(`  Demoted: ${event.targetID}`);
    console.log();
  });

  /**
   * Group name changed
   * {
   *   type:      'group:name'
   *   threadID:  string
   *   actorID:   string
   *   name:      string
   *   timestamp: number
   * }
   */
  client.events.on('group:name', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();
    console.log(`[${ts}] [group:name] thread=${event.threadID}`);
    console.log(`  Changed by: ${event.actorID}`);
    console.log(`  New name:   "${event.name}"`);
    console.log();
  });

  /**
   * Group photo changed
   * {
   *   type:      'group:photo'
   *   threadID:  string
   *   actorID:   string
   *   photoURL:  string
   *   timestamp: number
   * }
   */
  client.events.on('group:photo', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();
    console.log(`[${ts}] [group:photo] thread=${event.threadID}`);
    console.log(`  Changed by: ${event.actorID}`);
    console.log(`  Photo URL:  ${event.photoURL || '(no URL)'}`);
    console.log();
  });

  /**
   * Group emoji changed
   * {
   *   type:      'group:emoji'
   *   threadID:  string
   *   actorID:   string
   *   emoji:     string
   *   timestamp: number
   * }
   */
  client.events.on('group:emoji', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();
    console.log(`[${ts}] [group:emoji] thread=${event.threadID}`);
    console.log(`  Changed by: ${event.actorID}`);
    console.log(`  New emoji:  "${event.emoji}"`);
    console.log();
  });

  client.events.on('error', (err) => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down…');
    client.disconnect();
    process.exit(0);
  });

  await client.listen();
}

main().catch((err) => {
  console.error('Startup error:', err.message);
  process.exit(1);
});
