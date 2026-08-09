'use strict';

/**
 * Example: Send Multiple Attachments
 *
 * Uploads multiple files (images, documents, etc.) and sends them in a single
 * Messenger message with an optional caption.
 *
 * Provide file paths as a comma-separated list in FILES.
 *
 * Usage:
 *   THREAD_ID=<thread_id> \
 *     FILES="/path/a.jpg,/path/b.png,/path/doc.pdf" \
 *     CAPTION="Here are your files!" \
 *     node examples/send-attachments.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID = process.env.THREAD_ID;
  const rawFiles = process.env.FILES ?? '';
  const caption  = process.env.CAPTION ?? '';

  if (!threadID || !rawFiles) {
    console.error('Set both THREAD_ID and FILES (comma-separated paths) before running this example.');
    process.exit(1);
  }

  const filePaths = rawFiles
    .split(',')
    .map((f) => path.resolve(f.trim()))
    .filter(Boolean);

  for (const fp of filePaths) {
    if (!fs.existsSync(fp)) {
      console.error(`File not found: ${fp}`);
      process.exit(1);
    }
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
  console.log(`Sending ${filePaths.length} attachment(s) to thread ${threadID}…`);

  const sources = filePaths.map((fp) => ({
    data:     fp,
    filename: path.basename(fp),
  }));

  const result = await client.api.sendAttachments(threadID, sources, caption);

  console.log(`Attachments sent successfully.`);
  console.log(`Message ID: ${result.messageID}`);

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
