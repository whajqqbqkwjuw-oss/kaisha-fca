'use strict';

/**
 * Example: Send Document
 *
 * Uploads a local document file and sends it to a Messenger thread with an
 * optional caption.
 *
 * Supported document types: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, ZIP,
 * and any other file type Facebook accepts.
 *
 * Usage:
 *   THREAD_ID=<thread_id> DOC_PATH=/path/to/report.pdf \
 *     CAPTION="Please review this document." node examples/send-document.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID = process.env.THREAD_ID;
  const docPath  = process.env.DOC_PATH;
  const caption  = process.env.CAPTION ?? '';

  if (!threadID || !docPath) {
    console.error('Set both THREAD_ID and DOC_PATH before running this example.');
    process.exit(1);
  }

  const resolvedDoc = path.resolve(docPath);
  if (!fs.existsSync(resolvedDoc)) {
    console.error(`Document file not found: ${resolvedDoc}`);
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

  const result = await client.api.sendDocument(
    threadID,
    {
      data:     resolvedDoc,
      filename: path.basename(resolvedDoc),
    },
    caption
  );

  console.log(`Document sent to thread ${threadID}.`);
  console.log(`Message ID: ${result.messageID}`);

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
