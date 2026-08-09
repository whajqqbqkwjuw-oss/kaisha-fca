'use strict';

/**
 * Example: Download Attachments
 *
 * Fetches the most recent messages from a thread, collects all attachment
 * download URLs, and saves them to a local directory.
 *
 * Usage:
 *   THREAD_ID=<thread_id> DEST_DIR=./downloads node examples/download-attachment.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID = process.env.THREAD_ID;
  const destDir  = process.env.DEST_DIR ?? './downloads';

  if (!threadID) {
    console.error('Set THREAD_ID before running this example.');
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

  // Fetch recent messages and collect downloadable attachments
  const history = await client.api.fetchMessageHistory(threadID, { limit: 30 });

  const items = [];
  for (const msg of history.messages) {
    for (const att of msg.attachments) {
      if (att.url) {
        items.push({ url: att.url, filename: att.filename || undefined });
      }
    }
  }

  if (items.length === 0) {
    console.log('No downloadable attachments found in the last 30 messages.');
    client.disconnect();
    return;
  }

  console.log(`Found ${items.length} attachment(s). Downloading to ${path.resolve(destDir)}…\n`);

  const results = await client.api.downloadAttachments(items, { destDir });

  for (const r of results) {
    const sizeKB = (r.size / 1024).toFixed(1);
    console.log(`✓ ${r.filename} (${sizeKB} KB) → ${r.savedTo}`);
  }

  console.log(`\nAll attachments saved to: ${path.resolve(destDir)}`);

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
