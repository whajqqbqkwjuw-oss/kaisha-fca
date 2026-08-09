'use strict';

/**
 * Example: Send Voice Message
 *
 * Uploads a local audio file and sends it as a voice message to a thread.
 * Supported formats: OGG, M4A, AAC, MP3.
 *
 * Usage:
 *   THREAD_ID=<thread_id> AUDIO_PATH=/path/to/voice.ogg node examples/send-voice.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID  = process.env.THREAD_ID;
  const audioPath = process.env.AUDIO_PATH;

  if (!threadID || !audioPath) {
    console.error('Set both THREAD_ID and AUDIO_PATH before running this example.');
    process.exit(1);
  }

  const resolvedAudio = path.resolve(audioPath);
  if (!fs.existsSync(resolvedAudio)) {
    console.error(`Audio file not found: ${resolvedAudio}`);
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

  const result = await client.api.sendVoiceMessage(threadID, {
    data:     resolvedAudio,
    filename: path.basename(resolvedAudio),
  });

  console.log(`Voice message sent to thread ${threadID}.`);
  console.log(`Message ID: ${result.messageID}`);

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
