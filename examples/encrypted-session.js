'use strict';

/**
 * Example: Encrypted Session Storage
 *
 * Demonstrates three workflows:
 *
 *   1. Login normally, then save the session to an encrypted file.
 *   2. Load the session from the encrypted file on the next run (no re-login).
 *   3. Use EncryptedCache to cache user profile data with a TTL.
 *
 * The encrypted files use AES-256-GCM with PBKDF2-derived keys.
 * Only the passphrase you supply can decrypt them.
 *
 * Usage:
 *   # First run — login and save
 *   PASSPHRASE="my-secret" node examples/encrypted-session.js
 *
 *   # Subsequent runs — load from encrypted file (no credentials needed)
 *   PASSPHRASE="my-secret" node examples/encrypted-session.js
 */

const path   = require('path');
const kaisha = require('../src/index');
const {
  createSecureStorage,
  createEncryptedCache,
  backupSession,
  restoreSession,
} = require('../src/secure');

const SESSION_FILE = path.resolve(__dirname, '../session.enc');
const CACHE_FILE   = path.resolve(__dirname, '../cache.enc');
const PASSPHRASE   = process.env.PASSPHRASE;

async function main() {
  if (!PASSPHRASE) {
    console.error('Set the PASSPHRASE environment variable before running this example.');
    process.exit(1);
  }

  const sessionStorage = createSecureStorage(SESSION_FILE, PASSPHRASE);
  const cache          = createEncryptedCache(CACHE_FILE, PASSPHRASE);

  let client;

  if (sessionStorage.exists()) {
    // ── Load from encrypted session ─────────────────────────────────────
    console.log('Encrypted session found. Loading without re-login…');

    const sessionData = restoreSession(SESSION_FILE, PASSPHRASE);

    // Convert the stored session data back into an appstate array so we can
    // log in through the standard appstate pathway
    const appstate = Object.entries(sessionData.cookies ?? {}).map(([name, value]) => ({
      name,
      value,
      domain: '.facebook.com',
      path:   '/',
      secure: true,
    }));

    client = await kaisha.login(
      { type: 'appstate', appstate },
      { logLevel: 'info' }
    );

    console.log('Logged in as user:', client.session.data.userID);

    // Try loading cached profile
    if (cache.exists()) {
      try {
        cache.load();
        const cached = cache.get(`profile:${client.session.data.userID}`);
        if (cached) {
          console.log('Cached profile:', cached.name, `(${cached.gender})`);
        }
      } catch {
        console.log('Cache file could not be decrypted — may be from a different passphrase.');
      }
    }

  } else {
    // ── First run: login with appstate from session.json ─────────────────
    const fs          = require('fs');
    const sessionPath = path.resolve(__dirname, '../session.json');

    if (!fs.existsSync(sessionPath)) {
      console.error(`session.json not found at ${sessionPath}. Run examples/login.js first.`);
      process.exit(1);
    }

    const appstate = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

    client = await kaisha.login(
      { type: 'appstate', appstate },
      { logLevel: 'info' }
    );

    console.log('Logged in as user:', client.session.data.userID);

    // Save encrypted session backup
    backupSession(client.session, SESSION_FILE, PASSPHRASE);
    console.log(`Session encrypted and saved to ${SESSION_FILE}`);

    // Fetch and cache the profile with a 1-hour TTL
    try {
      const profile = await client.api.fetchUserProfile(client.session.data.userID);
      cache.set(`profile:${client.session.data.userID}`, profile, 3600);
      cache.save();
      console.log(`Profile for ${profile.name} cached to ${CACHE_FILE}`);
    } catch (err) {
      console.warn('Could not fetch profile for caching:', err.message);
    }
  }

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
