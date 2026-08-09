'use strict';

/**
 * Example: Plugin System
 *
 * Demonstrates how to write a Kaisha plugin that extends the client with a
 * custom command router, registers event listeners, and exposes new methods.
 *
 * The example plugin "CommandRouterPlugin" listens for messages starting with
 * a configurable prefix and dispatches them to registered command handlers.
 *
 * Usage:
 *   THREAD_ID=<any_thread_id> node examples/plugin-system.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

// ── Plugin Definition ─────────────────────────────────────────────────────

/**
 * CommandRouterPlugin — routes messages beginning with a prefix to handlers.
 *
 * @type {import('../src/plugins').KaishaPlugin}
 */
const CommandRouterPlugin = {
  name:    'CommandRouterPlugin',
  version: '1.0.0',

  install(client, options) {
    const prefix   = options.prefix ?? '!';
    const commands = new Map();

    /**
     * Registers a command handler.
     *
     * @param {string}   name - Command name without prefix.
     * @param {function} fn   - Called with (event, args[]) when matched.
     */
    function registerCommand(name, fn) {
      commands.set(name.toLowerCase(), fn);
    }

    // Listen for messages and route matching ones
    client.events.on('message', async (event) => {
      if (!event.body.startsWith(prefix)) return;

      const [rawCmd, ...args] = event.body.slice(prefix.length).trim().split(/\s+/);
      const cmdName = rawCmd.toLowerCase();

      if (commands.has(cmdName)) {
        try {
          await commands.get(cmdName)(event, args);
        } catch (err) {
          console.error(`Command "${cmdName}" threw an error:`, err.message);
        }
      }
    });

    // Expose the registerCommand helper on the client
    client.registerCommand = registerCommand;

    console.log(`CommandRouterPlugin installed (prefix: "${prefix}")`);
  },
};

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const sessionPath = path.resolve(__dirname, '../session.json');
  if (!fs.existsSync(sessionPath)) {
    console.error(`session.json not found at ${sessionPath}. Run examples/login.js first.`);
    process.exit(1);
  }

  const appstate = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  const client   = await kaisha.login(
    { type: 'appstate', appstate },
    { logLevel: 'debug' }
  );

  // Install the plugin before calling listen()
  await client.use(CommandRouterPlugin, { prefix: '!' });

  // Register commands using the helper the plugin attached to the client
  client.registerCommand('ping', async (event) => {
    await client.api.replyMessage(event.threadID, 'Pong!', event.messageID);
  });

  client.registerCommand('info', async (event) => {
    const thread = await client.api.fetchThreadInfo(event.threadID);
    const info   = `Thread: ${thread.name || event.threadID} | Participants: ${thread.participantIDs.length}`;
    await client.api.sendMessage(event.threadID, info);
  });

  client.registerCommand('echo', async (event, args) => {
    const text = args.join(' ');
    if (text) await client.api.sendMessage(event.threadID, text);
  });

  client.events.on('ready', () => {
    console.log('Client ready — send "!ping", "!info", or "!echo <text>" to a thread.');
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
