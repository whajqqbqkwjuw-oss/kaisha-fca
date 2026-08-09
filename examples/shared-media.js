'use strict';

/**
 * Example: Fetch Shared Media
 *
 * Lists all shared media items in a thread filtered by type, with pagination
 * support.  Optionally downloads every item to a local directory.
 *
 * Usage:
 *   THREAD_ID=<thread_id> TYPE=images LIMIT=20 DOWNLOAD=1 DEST_DIR=./media \
 *     node examples/shared-media.js
 *
 * TYPE may be: images | videos | files | audio | all
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID = process.env.THREAD_ID;
  const type     = process.env.TYPE    ?? 'all';
  const limit    = parseInt(process.env.LIMIT ?? '20', 10);
  const download = process.env.DOWNLOAD === '1';
  const destDir  = process.env.DEST_DIR ?? './media';

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

  const page = await client.api.fetchSharedMedia(threadID, { type, limit, offset: 0 });

  console.log(`\nShared media in thread ${threadID} (type: ${type})`);
  console.log(`Showing ${page.items.length} of ${page.total} total item(s).\n`);

  for (const item of page.items) {
    const sizeKB = item.filesize > 0 ? ` (${(item.filesize / 1024).toFixed(1)} KB)` : '';
    const dims   = item.width > 0 ? ` [${item.width}×${item.height}]` : '';
    const dur    = item.duration > 0 ? ` ${(item.duration / 1000).toFixed(1)}s` : '';
    console.log(`[${item.type}] ${item.filename || item.id}${sizeKB}${dims}${dur}`);
    console.log(`  URL: ${item.url || '(no direct URL)'}`);
    console.log();
  }

  if (page.hasMore) {
    console.log(`${page.total - page.items.length} more item(s) available. Increase LIMIT or use offset pagination.`);
  }

  // Download all items when DOWNLOAD=1
  if (download && page.items.length > 0) {
    const downloadable = page.items.filter((i) => i.url);

    if (downloadable.length === 0) {
      console.log('No items have direct download URLs.');
    } else {
      console.log(`\nDownloading ${downloadable.length} item(s) to ${path.resolve(destDir)}…\n`);

      const results = await client.api.downloadAttachments(
        downloadable.map((i) => ({ url: i.url, filename: i.filename || i.id })),
        { destDir }
      );

      for (const r of results) {
        const sizeKB = (r.size / 1024).toFixed(1);
        console.log(`✓ ${r.filename} (${sizeKB} KB) → ${r.savedTo}`);
      }
    }
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
