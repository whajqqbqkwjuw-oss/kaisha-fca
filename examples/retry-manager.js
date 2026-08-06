'use strict';

/**
 * Example: Retry Manager
 *
 * Demonstrates the standalone RetryManager:
 *   - Retrying a flaky async function
 *   - Custom shouldRetry predicate
 *   - Per-attempt timeout
 *   - wrap() convenience helper
 *
 * Usage:
 *   node examples/retry-manager.js
 */

const { createRetryManager } = require('../src/retry');

async function main() {
  // ── Basic retry ───────────────────────────────────────────────────────────
  const retry = createRetryManager({
    maxAttempts: 4,
    baseDelayMs: 200,
    jitterMs: 50,
    onRetry(err, attempt, delay) {
      console.log(`  Retry ${attempt}: ${err.message} — waiting ${delay}ms`);
    },
  });

  let callCount = 0;

  const result = await retry.execute(async () => {
    callCount++;
    if (callCount < 3) throw new Error(`Simulated transient failure #${callCount}`);
    return 'success';
  });

  console.log(`Result: "${result}" after ${callCount} attempt(s)`);

  // ── Custom shouldRetry predicate ──────────────────────────────────────────
  const onlyNetworkErrors = createRetryManager({
    maxAttempts: 3,
    baseDelayMs: 100,
    shouldRetry: (err) => err.message.startsWith('Network'),
    onRetry: (err, n) => console.log(`  [onlyNetwork] retry ${n}: ${err.message}`),
  });

  try {
    await onlyNetworkErrors.execute(() => {
      throw new TypeError('Validation error — should NOT be retried');
    });
  } catch (err) {
    console.log(`Caught (expected): ${err.message}`);
  }

  // ── Per-attempt timeout ───────────────────────────────────────────────────
  const withTimeout = createRetryManager({
    maxAttempts: 2,
    baseDelayMs: 100,
    timeoutMs: 150,
    onRetry: (err, n) => console.log(`  [timeout] retry ${n}: ${err.message}`),
  });

  try {
    await withTimeout.execute(
      () => new Promise((resolve) => setTimeout(resolve, 500))
    );
  } catch (err) {
    console.log(`Timed-out error (expected): ${err.message}`);
  }

  // ── wrap() ────────────────────────────────────────────────────────────────
  const quickRetry = createRetryManager({ maxAttempts: 2, baseDelayMs: 50 });

  let wrapCount = 0;
  const flaky = quickRetry.wrap((x) => {
    wrapCount++;
    if (wrapCount === 1) throw new Error('first call fails');
    return `wrapped result: ${x}`;
  });

  const wrapped = await flaky('hello');
  console.log(`Wrapped result: "${wrapped}" (calls: ${wrapCount})`);

  console.log('\nRetry example complete.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
