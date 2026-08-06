'use strict';

/**
 * Example: Send Image
 *
 * Uploads a local image file and sends it to a Messenger thread with an
 * optional caption.  Demonstrates the sendImage convenience API.
 *
 * Usage:
 *   THREAD_ID=<thread_id> IMAGE_PATH=/path/to/photo.jpg \
 *     CAPTION="Check this out!" node examples/send-image.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID  = process.env.THREAD_ID;
  const imagePath = process.env.IMAGE_PATH;
  const caption   = process.env.CAPTION ?? '';

  if (!threadID || !imagePath) {
    console.error('Set both THREAD_ID and IMAGE_PATH before running this example.');
    process.exit(1);
  }

  const resolvedImage = path.resolve(imagePath);
  if (!fs.existsSync(resolvedImage)) {
    console.error(`Image file not found: ${resolvedImage}`);
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

  const result = await client.api.sendImage(
    threadID,
    {
      data:     resolvedImage,
      filename: path.basename(resolvedImage),
    },
    caption
  );

  console.log(`Image sent to thread ${threadID}`);
  console.log(`Message ID: ${result.messageID}`);

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
