'use strict';

/**
 * Example: Secure Credential Storage
 *
 * Demonstrates storing Facebook credentials (email and password) in an
 * encrypted vault so they never appear as plain text on disk.
 *
 * First run: stores the credentials from environment variables.
 * Subsequent runs: loads credentials from the vault and logs in.
 *
 * Usage:
 *   # Store credentials
 *   PASSPHRASE="my-secret" EMAIL="you@example.com" PASSWORD="secret" \
 *     node examples/secure-credentials.js
 *
 *   # Login using stored credentials (no EMAIL / PASSWORD needed)
 *   PASSPHRASE="my-secret" node examples/secure-credentials.js
 */

const path   = require('path');
const kaisha = require('../src/index');
const { createCredentialVault } = require('../src/secure');

const VAULT_FILE = path.resolve(__dirname, '../credentials.enc');
const PASSPHRASE = process.env.PASSPHRASE;

async function main() {
  if (!PASSPHRASE) {
    console.error('Set PASSPHRASE before running this example.');
    process.exit(1);
  }

  const vault = createCredentialVault(VAULT_FILE, PASSPHRASE);

  if (process.env.EMAIL && process.env.PASSWORD) {
    // ── Store credentials ─────────────────────────────────────────────────
    vault.set('email',    process.env.EMAIL);
    vault.set('password', process.env.PASSWORD);
    vault.save();
    console.log(`Credentials encrypted and saved to ${VAULT_FILE}`);
    console.log('Re-run without EMAIL/PASSWORD to login using stored credentials.');
    return;
  }

  // ── Load and use stored credentials ──────────────────────────────────────
  if (!vault.exists()) {
    console.error(
      `Vault not found at ${VAULT_FILE}.\n` +
      'Run with EMAIL and PASSWORD set first to store your credentials.'
    );
    process.exit(1);
  }

  vault.load();

  const email    = vault.get('email');
  const password = vault.get('password');

  if (!email || !password) {
    console.error('Vault is missing email or password entries.');
    process.exit(1);
  }

  console.log(`Loaded credentials for: ${email}`);

  const client = await kaisha.login(
    { type: 'email', email, password },
    { logLevel: 'info' }
  );

  console.log('Logged in as user:', client.session.data.userID);

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
