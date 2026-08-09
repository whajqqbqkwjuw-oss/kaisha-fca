'use strict';

/**
 * Example: Request Manager
 *
 * Demonstrates using the RequestManager attached to a live Kaisha client:
 *   - Calling cachedPost to fetch user info with caching
 *   - Inspecting cache statistics
 *   - Manually invalidating a cache entry
 *   - Using client.request.graphql
 *
 * Usage:
 *   node examples/request-manager.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const sessionPath = path.resolve(__dirname, '../session.json');
  if (!fs.existsSync(sessionPath)) {
    console.error(`session.json not found. Run examples/login.js first.`);
    process.exit(1);
  }

  const appstate = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  const client   = await kaisha.login(
    { type: 'appstate', appstate },
    { logLevel: 'info' }
  );

  const userID = client.session.data.userID;
  console.log('Authenticated as user:', userID);

  // ── cachedPost — first call hits the network ──────────────────────────────
  const userInfo1 = await client.request.cachedPost(
    `user:${userID}`,
    'https://www.facebook.com/chat/user_info/',
    { ids: `[${userID}]`, fields: 'name,picture,gender,vanity' }
  );
  console.log('User info (from network):', userInfo1);

  // ── cachedPost — second call returns from cache ───────────────────────────
  const userInfo2 = await client.request.cachedPost(
    `user:${userID}`,
    'https://www.facebook.com/chat/user_info/',
    { ids: `[${userID}]`, fields: 'name,picture,gender,vanity' }
  );
  console.log('User info (from cache):', userInfo2);

  // ── Cache statistics ──────────────────────────────────────────────────────
  const stats = client.request.cacheStats();
  console.log('Cache stats:', stats);
  // { size: 1, hits: 1, misses: 1, evictions: 0 }

  // ── Manual invalidation ───────────────────────────────────────────────────
  client.request.invalidate(`user:${userID}`);
  const statsAfter = client.request.cacheStats();
  console.log('Cache stats after invalidation:', statsAfter);
  // { size: 0, … evictions: 1 }

  // ── clearCache ────────────────────────────────────────────────────────────
  client.request.clearCache();
  console.log('Cache cleared. Stats:', client.request.cacheStats());

  client.disconnect();
  console.log('\nRequest manager example complete.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
