'use strict';

/**
 * Example: Middleware
 *
 * Demonstrates two middleware functions:
 *
 *  1. Logger middleware — logs every API call with its method name, arguments,
 *     timing, and the result summary.
 *
 *  2. Rate-limiter middleware — enforces a minimum interval between sendMessage
 *     calls to prevent hitting Facebook's spam limits.
 *
 * Usage:
 *   THREAD_ID=<thread_id> node examples/middleware.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const threadID = process.env.THREAD_ID;

  if (!threadID) {
    console.error('Set the THREAD_ID environment variable before running this example.');
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

  // ── Middleware 1: API call logger ─────────────────────────────────────
  client.addMiddleware(async (ctx, next) => {
    const start = Date.now();
    console.log(`[Middleware] → ${ctx.method}(${ctx.args.map((a) => JSON.stringify(a)).join(', ')})`);
    await next();
    const ms = Date.now() - start;
    console.log(`[Middleware] ← ${ctx.method} completed in ${ms}ms`);
  });

  // ── Middleware 2: sendMessage rate limiter ────────────────────────────
  let lastSendTime = 0;
  const MIN_SEND_INTERVAL_MS = 1_000;

  client.addMiddleware(async (ctx, next) => {
    if (ctx.method === 'sendMessage') {
      const now    = Date.now();
      const elapsed = now - lastSendTime;
      if (elapsed < MIN_SEND_INTERVAL_MS) {
        const wait = MIN_SEND_INTERVAL_MS - elapsed;
        console.log(`[RateLimiter] sendMessage throttled — waiting ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
      lastSendTime = Date.now();
    }
    await next();
  });

  // ── Test: send two messages in quick succession ───────────────────────
  console.log('Sending two messages quickly — rate limiter will throttle the second…\n');

  const [r1, r2] = await Promise.all([
    client.api.sendMessage(threadID, 'Middleware message 1'),
    client.api.sendMessage(threadID, 'Middleware message 2'),
  ]);

  console.log('\nResults:');
  console.log(`  Message 1 ID: ${r1.messageID}`);
  console.log(`  Message 2 ID: ${r2.messageID}`);

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
