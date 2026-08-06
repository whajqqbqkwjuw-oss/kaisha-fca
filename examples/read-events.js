'use strict';

/**
 * Example: Read / Seen Events
 *
 * Connects to the MQTT broker and listens for message:seen events, which are
 * emitted whenever someone reads (marks as seen) a thread you share with them.
 *
 * Usage:
 *   node examples/read-events.js
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
    console.log('Connected. Listening for read/seen events…\n');
  });

  /**
   * Seen event payload:
   * {
   *   type:      'message:seen'
   *   threadID:  string
   *   readerID:  string
   *   messageID: string
   *   timestamp: number
   * }
   */
  client.events.on('message:seen', (event) => {
    const ts      = new Date(event.timestamp).toLocaleTimeString();
    const msgInfo = event.messageID ? ` (last seen message: ${event.messageID})` : '';
    console.log(
      `[Seen] ${event.readerID} read thread ${event.threadID} at ${ts}${msgInfo}`
    );
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
