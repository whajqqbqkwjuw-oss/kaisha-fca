'use strict';

/**
 * Example: Presence Events
 *
 * Connects to the MQTT broker and listens for presence events emitted when
 * contacts come online or go offline.  Also demonstrates listening for
 * message:seen events in the same session since both arrive on the same MQTT
 * topic (/orca_presence).
 *
 * Presence availability depends on the platform and the user's privacy
 * settings.  The event will not be fired for users who have disabled the
 * "Active Status" feature.
 *
 * Usage:
 *   node examples/presence-events.js
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
    console.log('Connected. Listening for presence and seen events…\n');
  });

  /**
   * Presence event payload:
   * {
   *   type:       'presence'
   *   userID:     string
   *   isActive:   boolean  — true = online / active now
   *   lastActive: number   — ms timestamp of last activity (0 if unavailable)
   * }
   */
  client.events.on('presence', (event) => {
    const status = event.isActive ? 'ONLINE' : 'OFFLINE';
    const lastTs = event.lastActive > 0
      ? `last active ${new Date(event.lastActive).toLocaleTimeString()}`
      : 'last active time unavailable';

    console.log(`[Presence] ${event.userID} → ${status} (${lastTs})`);
  });

  /**
   * Seen event payload (also delivered via /orca_presence):
   * {
   *   type:      'message:seen'
   *   threadID:  string
   *   readerID:  string
   *   messageID: string
   *   timestamp: number
   * }
   */
  client.events.on('message:seen', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();
    const msgInfo = event.messageID ? ` (msg: ${event.messageID})` : '';
    console.log(`[Seen]     ${event.readerID} read thread ${event.threadID} at ${ts}${msgInfo}`);
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
