'use strict';

/**
 * Example: Change Group Photo
 *
 * Uploads a local image file and sets it as the group conversation photo.
 *
 * Usage:
 *   THREAD_ID=<group_thread_id> IMAGE_PATH=/path/to/photo.jpg \
 *     node examples/group-photo.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID  = process.env.THREAD_ID;
  const imagePath = process.env.IMAGE_PATH;

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

  await client.api.changeGroupPhoto(threadID, {
    data:     resolvedImage,
    filename: path.basename(resolvedImage),
  });

  console.log(`Group photo for thread ${threadID} updated using: ${resolvedImage}`);

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
