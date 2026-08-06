'use strict';

/**
 * Example: Cache Manager
 *
 * Demonstrates the standalone CacheManager:
 *   - Basic set / get with a TTL
 *   - getOrFetch (async population)
 *   - Cache statistics
 *   - Manual invalidation
 *   - Background sweep
 *
 * Usage:
 *   node examples/cache-manager.js
 */

const { createCacheManager } = require('../src/cache');

async function main() {
  // Create a cache: 5-second default TTL, max 100 entries, sweep every 10 s
  const cache = createCacheManager({
    defaultTtlMs: 5_000,
    maxSize: 100,
    sweepIntervalMs: 10_000,
  });

  // ── Basic set / get ───────────────────────────────────────────────────────
  cache.set('greeting', 'Hello, Kaisha!');
  console.log('get greeting:', cache.get('greeting')); // Hello, Kaisha!
  console.log('has greeting:', cache.has('greeting')); // true

  // ── Per-entry TTL override ────────────────────────────────────────────────
  cache.set('short', 'gone soon', 100); // 100 ms TTL
  await new Promise((r) => setTimeout(r, 200));
  console.log('short (expired):', cache.get('short')); // undefined

  // ── getOrFetch ────────────────────────────────────────────────────────────
  let fetchCount = 0;

  async function expensiveLoader() {
    fetchCount++;
    await new Promise((r) => setTimeout(r, 50)); // simulate async work
    return { data: 'loaded', fetchedAt: Date.now() };
  }

  const first = await cache.getOrFetch('expensive', expensiveLoader, 30_000);
  const second = await cache.getOrFetch('expensive', expensiveLoader, 30_000);

  console.log('First fetch result:', first);
  console.log('Second call hits cache (fetchCount should be 1):', fetchCount); // 1

  // ── Keys ──────────────────────────────────────────────────────────────────
  console.log('Live keys:', cache.keys());

  // ── Statistics ────────────────────────────────────────────────────────────
  const s = cache.stats();
  console.log('Stats:', s);
  // { size: 2, hits: 1+, misses: 1, evictions: 1 }

  // ── Invalidation ──────────────────────────────────────────────────────────
  cache.delete('greeting');
  console.log('After delete, has greeting:', cache.has('greeting')); // false

  // ── Clear all ─────────────────────────────────────────────────────────────
  cache.clear();
  console.log('After clear, keys:', cache.keys()); // []
  console.log('After clear, stats:', cache.stats()); // size: 0

  // Stop the background sweep timer before exiting
  cache.stop();
  console.log('\nCache example complete.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
