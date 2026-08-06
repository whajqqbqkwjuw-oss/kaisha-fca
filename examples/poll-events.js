'use strict';

/**
 * Example: Poll Events
 *
 * Connects to the MQTT broker and listens for poll events emitted when
 * someone creates a poll, votes on a poll option, or updates a poll in
 * a Messenger group conversation.
 *
 * Usage:
 *   node examples/poll-events.js
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
    console.log('Connected. Listening for poll events…\n');
  });

  /**
   * Poll event payload:
   * {
   *   type:      'poll'
   *   threadID:  string
   *   actorID:   string
   *   action:    'create' | 'vote' | 'update'
   *   pollID:    string
   *   question:  string
   *   options:   Array<{ optionID, text, voterIDs }>
   *   timestamp: number
   * }
   */
  client.events.on('poll', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();

    console.log(`[${ts}] [poll:${event.action}] thread=${event.threadID}`);
    console.log(`  Actor:    ${event.actorID}`);
    console.log(`  Poll ID:  ${event.pollID || '(unknown)'}`);
    console.log(`  Question: "${event.question || '(no question text)'}"`);

    if (event.options.length > 0) {
      console.log('  Options:');
      for (const opt of event.options) {
        const votes = opt.voterIDs.length;
        const label = votes === 1 ? 'vote' : 'votes';
        console.log(`    [${opt.optionID}] "${opt.text}" — ${votes} ${label}`);
        if (opt.voterIDs.length > 0) {
          console.log(`      Voters: ${opt.voterIDs.join(', ')}`);
        }
      }
    } else {
      console.log('  Options: (none parsed)');
    }

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
