'use strict';

/**
 * @module cache
 * @description In-memory Cache Manager for Kaisha.
 *
 * Provides a standalone, dependency-free, TTL-aware cache that any internal
 * module can import without touching the encrypted `EncryptedCache` in
 * `src/secure.js`.  The two are complementary:
 *
 *   - `CacheManager`   — fast, in-process, volatile.  Used for thread info,
 *                        user profiles, and any data fetched repeatedly within
 *                        a single session.
 *   - `EncryptedCache` — persistent, AES-256-GCM encrypted, survives restarts.
 *
 * Design choices:
 * - Expired entries are evicted lazily on `get()` and eagerly by an optional
 *   periodic sweep to prevent unbounded growth.
 * - The sweep timer is `unref()`-ed so it does not block Node.js from exiting.
 * - All public methods are synchronous except `getOrFetch`, which accepts an
 *   async loader function.
 * - `CacheManager` is not tied to any specific Kaisha API; it is a pure
 *   utility class.
 */

const { ConfigurationError } = require('./errors');

/**
 * @typedef {object} CacheEntry
 * @property {unknown}      value
 * @property {number|null}  expiresAt - Unix ms timestamp, or `null` for no expiry.
 * @property {number}       createdAt - Unix ms timestamp of insertion.
 * @property {number}       hits      - Number of times this entry was returned.
 */

/**
 * @typedef {object} CacheStats
 * @property {number} size    - Number of non-expired entries currently held.
 * @property {number} hits    - Total cache hits since creation.
 * @property {number} misses  - Total cache misses since creation.
 * @property {number} evictions - Total entries evicted (expired + manual delete).
 */

/**
 * @typedef {object} CacheManagerOptions
 * @property {number}  [defaultTtlMs=0]   - Default TTL in milliseconds.
 *   `0` means no expiry unless overridden per entry.
 * @property {number}  [maxSize=0]        - Maximum number of entries (0 = unlimited).
 *   When the limit is reached the oldest entry is evicted first (LRU-lite).
 * @property {number}  [sweepIntervalMs=0] - How often (ms) the cache performs a
 *   background sweep to evict expired entries.  `0` disables the sweep.
 */

/**
 * @typedef {object} CacheManager
 * @property {function} set         - Stores a value.
 * @property {function} get         - Retrieves a value (or `undefined`).
 * @property {function} has         - Returns `true` when key is present and unexpired.
 * @property {function} delete      - Removes a single entry.
 * @property {function} clear       - Removes all entries.
 * @property {function} getOrFetch  - Returns cached value or calls a loader to populate it.
 * @property {function} stats       - Returns a `CacheStats` snapshot.
 * @property {function} keys        - Returns all non-expired keys.
 * @property {function} stop        - Stops the background sweep timer.
 */

/**
 * Creates a CacheManager instance.
 *
 * @param {CacheManagerOptions} [options={}]
 * @returns {CacheManager}
 *
 * @example
 * const cache = createCacheManager({ defaultTtlMs: 60_000, maxSize: 500 });
 *
 * cache.set('user:123', { name: 'Alice' });
 * const user = cache.get('user:123');                   // { name: 'Alice' }
 *
 * // Async population
 * const thread = await cache.getOrFetch('thread:456', () => api.fetchThreadInfo('456'));
 */
function createCacheManager({
  defaultTtlMs = 0,
  maxSize = 0,
  sweepIntervalMs = 0,
} = {}) {
  if (typeof defaultTtlMs !== 'number' || defaultTtlMs < 0) {
    throw new ConfigurationError('CacheManager: defaultTtlMs must be a non-negative number');
  }
  if (typeof maxSize !== 'number' || maxSize < 0) {
    throw new ConfigurationError('CacheManager: maxSize must be a non-negative number');
  }
  if (typeof sweepIntervalMs !== 'number' || sweepIntervalMs < 0) {
    throw new ConfigurationError('CacheManager: sweepIntervalMs must be a non-negative number');
  }

  /** @type {Map<string, CacheEntry>} Insertion-ordered for LRU eviction. */
  const store = new Map();

  let totalHits = 0;
  let totalMisses = 0;
  let totalEvictions = 0;
  let sweepTimer = null;

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Returns `true` when `entry` has passed its expiry deadline.
   *
   * @param {CacheEntry} entry
   * @returns {boolean}
   */
  function expired(entry) {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  /**
   * Evicts the oldest (first-inserted) entry in the store.
   * Used when `maxSize` is exceeded.
   */
  function evictOldest() {
    const firstKey = store.keys().next().value;
    if (firstKey !== undefined) {
      store.delete(firstKey);
      totalEvictions++;
    }
  }

  /**
   * Removes all expired entries from the store.
   * Called by the optional background sweep and exposed publicly via `sweep()`.
   */
  function sweep() {
    for (const [key, entry] of store) {
      if (expired(entry)) {
        store.delete(key);
        totalEvictions++;
      }
    }
  }

  // ── Optional background sweep ─────────────────────────────────────────────

  if (sweepIntervalMs > 0) {
    sweepTimer = setInterval(sweep, sweepIntervalMs);
    if (sweepTimer.unref) sweepTimer.unref();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Stores `value` under `key`.
   *
   * @param {string}  key
   * @param {unknown} value
   * @param {number}  [ttlMs] - Per-entry TTL override (ms).  `0` = no expiry.
   *   Falls back to `defaultTtlMs` when omitted.
   */
  function set(key, value, ttlMs) {
    if (typeof key !== 'string' || !key) {
      throw new ConfigurationError('CacheManager.set: key must be a non-empty string');
    }

    const effectiveTtl = ttlMs !== undefined ? ttlMs : defaultTtlMs;
    const expiresAt = effectiveTtl > 0 ? Date.now() + effectiveTtl : null;

    // Evict oldest entry when the size cap is reached (only if key is new)
    if (maxSize > 0 && !store.has(key) && store.size >= maxSize) {
      evictOldest();
    }

    store.set(key, { value, expiresAt, createdAt: Date.now(), hits: 0 });
  }

  /**
   * Returns the cached value for `key`, or `undefined` when absent or expired.
   *
   * @param {string} key
   * @returns {unknown}
   */
  function get(key) {
    const entry = store.get(key);
    if (!entry) {
      totalMisses++;
      return undefined;
    }
    if (expired(entry)) {
      store.delete(key);
      totalEvictions++;
      totalMisses++;
      return undefined;
    }
    entry.hits++;
    totalHits++;
    return entry.value;
  }

  /**
   * Returns `true` when `key` is present in the cache and has not expired.
   *
   * @param {string} key
   * @returns {boolean}
   */
  function has(key) {
    return get(key) !== undefined;
  }

  /**
   * Removes the entry for `key`.  No-op when the key is absent.
   *
   * @param {string} key
   */
  function del(key) {
    if (store.has(key)) {
      store.delete(key);
      totalEvictions++;
    }
  }

  /**
   * Removes all entries from the cache.
   */
  function clear() {
    totalEvictions += store.size;
    store.clear();
  }

  /**
   * Returns the cached value for `key`.  When the key is absent or expired,
   * calls `loader()` to produce the value, stores it, and returns it.
   *
   * @template T
   * @param {string}           key
   * @param {() => T | Promise<T>} loader
   * @param {number}           [ttlMs]
   * @returns {Promise<T>}
   */
  async function getOrFetch(key, loader, ttlMs) {
    const cached = get(key);
    if (cached !== undefined) return /** @type {T} */ (cached);

    const value = await loader();
    set(key, value, ttlMs);
    return value;
  }

  /**
   * Returns all non-expired keys currently in the cache.
   *
   * @returns {string[]}
   */
  function keys() {
    const result = [];
    for (const [key, entry] of store) {
      if (!expired(entry)) result.push(key);
    }
    return result;
  }

  /**
   * Returns a snapshot of the current cache statistics.
   *
   * @returns {CacheStats}
   */
  function stats() {
    // Count only non-expired entries for the `size` field
    let live = 0;
    for (const entry of store.values()) {
      if (!expired(entry)) live++;
    }
    return { size: live, hits: totalHits, misses: totalMisses, evictions: totalEvictions };
  }

  /**
   * Stops the background sweep timer (if one is running).
   * Call this when the cache is no longer needed to allow clean process exit.
   */
  function stop() {
    if (sweepTimer !== null) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }

  return {
    set,
    get,
    has,
    delete: del,
    clear,
    getOrFetch,
    keys,
    stats,
    stop,
  };
}

module.exports = { createCacheManager };
