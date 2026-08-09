'use strict';

/**
 * Example: Listen for Messages
 *
 * Loads an appstate from ./session.json, connects to the Messenger MQTT
 * broker, and prints all incoming messages to the console.  Replies to any
 * message that starts with "!ping" with "Pong!".
 *
 * Usage:
 *   node examples/listen.js
 */

const path   = require('path');
const fs     = require('fs');
const http = require('http');

const PORT = process.env.PORT || 3000;

const healthServer = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Kaisha is running');
});

healthServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Health server listening on port ${PORT}`);
});
const kaisha = require('../src/index');

async function main() {
  const appstatePath = path.resolve(__dirname, '../appstate.json');

if (!fs.existsSync(appstatePath)) {
  console.error(`appstate.json not found at ${appstatePath}.`);
  process.exit(1);
}

const appstate = JSON.parse(fs.readFileSync(appstatePath, 'utf8'));

if (!Array.isArray(appstate)) {
  console.error('Invalid appstate.json format. Expected an array of cookies.');
  process.exit(1);
}

console.log(`Loaded ${appstate.length} appstate cookies.`);

  const client = await kaisha.login(
    { type: 'appstate', appstate },
    { logLevel: 'debug' }
  );

  console.log('Authenticated as user:', client.session.data.userID);

  client.events.on('ready', () => {
    console.log('Kaisha is connected and listening for messages.');
  });

  client.events.on('message', async (event) => {
    console.log(`[Message] ${event.senderID} → Thread ${event.threadID}: ${event.body}`);

    if (event.body.toLowerCase().startsWith('!ping')) {
      try {
        await client.api.replyMessage(event.threadID, 'Pong!', event.messageID);
        console.log('Replied with Pong!');
      } catch (err) {
        console.error('Failed to reply:', err.message);
      }
    }
  });

  client.events.on('message:react', (event) => {
    console.log(
      `[Reaction] ${event.senderID} reacted ${event.reaction} to message ${event.messageID}`
    );
  });

  client.events.on('message:unsend', (event) => {
    console.log(
      `[Unsend] ${event.senderID} unsent message ${event.messageID} in thread ${event.threadID}`
    );
  });

  client.events.on('disconnected', (code) => {
    console.warn(`Disconnected (code ${code}), reconnection in progress…`);
  });

  client.events.on('reconnecting', () => {
    console.log('Attempting to reconnect…');
  });

  client.events.on('error', (err) => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });

  // Graceful shutdown
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