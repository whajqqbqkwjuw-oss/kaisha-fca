'use strict';

/**
 * Example: Typing Events
 *
 * Connects to the MQTT broker and listens for real-time typing indicator
 * events from all threads.  Prints who is typing (or stopped typing) and
 * in which thread.
 *
 * Usage:
 *   node examples/typing-events.js
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
    console.log('Connected. Listening for typing events…\n');
  });

  /**
   * Typing event payload:
   * {
   *   type:      'typing'
   *   threadID:  string
   *   senderID:  string
   *   isTyping:  boolean
   *   isGroup:   boolean
   * }
   */
  client.events.on('typing', (event) => {
    const threadType = event.isGroup ? 'group' : 'DM';
    const status     = event.isTyping ? 'started typing' : 'stopped typing';
    console.log(`[Typing] ${event.senderID} ${status} in ${threadType} thread ${event.threadID}`);
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
