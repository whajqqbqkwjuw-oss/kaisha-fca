'use strict';

/**
 * Example: Session Backup and Restore
 *
 * Demonstrates backing up a live session to an encrypted file, then restoring
 * it so a new Kaisha client can be created without a fresh login.
 *
 * Workflow:
 *   1. Login using session.json
 *   2. Encrypt and back up the session
 *   3. Restore the session from the backup
 *   4. Create a second client from the restored session
 *   5. Verify both clients share the same user ID
 *
 * Usage:
 *   PASSPHRASE="my-secret" node examples/session-backup.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');
const {
  backupSession,
  restoreSession,
  createSession,
} = require('../src/secure');

const BACKUP_FILE = path.resolve(__dirname, '../session-backup.enc');
const PASSPHRASE  = process.env.PASSPHRASE;

async function main() {
  if (!PASSPHRASE) {
    console.error('Set PASSPHRASE before running this example.');
    process.exit(1);
  }

  const sessionPath = path.resolve(__dirname, '../session.json');
  if (!fs.existsSync(sessionPath)) {
    console.error(`session.json not found at ${sessionPath}. Run examples/login.js first.`);
    process.exit(1);
  }

  const appstate = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

  // ── Step 1: Login ─────────────────────────────────────────────────────────
  console.log('Logging in…');
  const client1 = await kaisha.login(
    { type: 'appstate', appstate },
    { logLevel: 'info' }
  );
  console.log('Client 1 logged in as:', client1.session.data.userID);

  // ── Step 2: Back up the session ───────────────────────────────────────────
  backupSession(client1.session, BACKUP_FILE, PASSPHRASE);
  console.log(`Session backed up (encrypted) to: ${BACKUP_FILE}`);
  console.log(`  Backed up at: ${new Date().toISOString()}`);

  client1.disconnect();

  // ── Step 3 & 4: Restore and create a second client ────────────────────────
  console.log('\nRestoring session from backup…');
  const restoredData = restoreSession(BACKUP_FILE, PASSPHRASE);

  // restoreSession returns raw SessionData; rebuild the appstate array from it
  const restoredAppstate = Object.entries(restoredData.cookies ?? {}).map(
    ([name, value]) => ({
      name,
      value,
      domain: '.facebook.com',
      path:   '/',
      secure: true,
    })
  );

  const client2 = await kaisha.login(
    { type: 'appstate', appstate: restoredAppstate },
    { logLevel: 'info' }
  );

  console.log('Client 2 (from backup) logged in as:', client2.session.data.userID);

  // ── Step 5: Verify ────────────────────────────────────────────────────────
  const match = client2.session.data.userID === restoredData.userID;
  console.log(`\nUser ID match: ${match ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Original backed-up user: ${restoredData.userID}`);
  console.log(`  Restored session user:   ${client2.session.data.userID}`);
  console.log(`  Backed up at:            ${new Date(restoredData._backedUpAt).toISOString()}`);

  client2.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
