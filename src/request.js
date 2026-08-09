'use strict';

/**
 * @module request
 * @description Request Manager for Kaisha.
 *
 * Sits between the API layer and `src/http.js`, providing:
 *
 *   - Automatic `fb_dtsg` / session-token injection into every POST body.
 *   - Consistent stripping of Facebook's `for(;;);` anti-hijacking prefix.
 *   - Integration with `RetryManager` so that all API requests benefit from
 *     the same configurable retry policy without duplicating the logic in
 *     every `api.js` method.
 *   - A lightweight per-request in-memory cache (via `CacheManager`) for
 *     idempotent GET-equivalent requests such as `fetchUserInfo` or
 *     `fetchThreadInfo`.
 *
 * The `HttpClient` in `src/http.js` still owns low-level cookie management
 * and raw Axios configuration.  `RequestManager` is a higher-level facade
 * that understands Facebook's API conventions.
 */

const { toQueryString } = require('./utils');
const { createRetryManager } = require('./retry');
const { createCacheManager } = require('./cache');
const { NetworkError } = require('./errors');

const FB_BASE = 'https://www.facebook.com';

const JSON_HEADERS = Object.freeze({
  'content-type':       'application/x-www-form-urlencoded',
  'x-fb-friendly-name': 'MessengerRequest',
  'x-requested-with':   'XMLHttpRequest',
  'referer':            `${FB_BASE}/`,
  'origin':             FB_BASE,
});

/**
 * @typedef {object} RequestManagerOptions
 * @property {number} [maxRetries=3]     - Passed to the internal RetryManager.
 * @property {number} [retryDelay=1000]  - Base backoff delay (ms).
 * @property {number} [cacheTtlMs=30000] - Default TTL for cached responses (ms).
 *   Set to `0` to disable caching entirely.
 * @property {number} [maxCacheSize=200] - Maximum number of cached entries.
 *
 * @typedef {object} RequestManager
 * @property {function} post        - Posts a form-encoded body and returns parsed JSON.
 * @property {function} cachedPost  - Like `post` but caches the result for the TTL.
 * @property {function} graphql     - Executes a Facebook GraphQL query.
 * @property {function} buildBody   - Builds a signed form body for the session.
 * @property {function} parseFB     - Strips the `for(;;);` prefix and parses JSON.
 * @property {function} cacheStats  - Returns the cache statistics snapshot.
 * @property {function} invalidate  - Removes a specific key from the cache.
 * @property {function} clearCache  - Empties the entire request cache.
 */

/**
 * Creates a RequestManager.
 *
 * @param {import('./session').Session}   session
 * @param {import('./http').HttpClient}   httpClient
 * @param {import('./logger').Logger}     logger
 * @param {RequestManagerOptions}         [options={}]
 * @returns {RequestManager}
 *
 * @example
 * const rm = createRequestManager(session, httpClient, logger, {
 *   maxRetries:  3,
 *   cacheTtlMs:  60_000,
 *   maxCacheSize: 200,
 * });
 *
 * const data = await rm.post(
 *   'https://www.facebook.com/chat/user_info/',
 *   { ids: '[123]', fields: 'name,picture' }
 * );
 *
 * // Cached — second call returns from cache
 * const threadInfo = await rm.cachedPost(
 *   `thread:${threadID}`,
 *   'https://www.facebook.com/chat/thread_info/',
 *   { id: threadID }
 * );
 */
function createRequestManager(session, httpClient, logger, {
  maxRetries   = 3,
  retryDelay   = 1_000,
  cacheTtlMs   = 30_000,
  maxCacheSize = 200,
} = {}) {
  const retry = createRetryManager({
    maxAttempts: maxRetries,
    baseDelayMs: retryDelay,
    onRetry(err, attempt, delay) {
      logger.warn(`Request retry ${attempt}/${maxRetries} in ${delay}ms: ${err.message}`);
    },
  });

  const cache = createCacheManager({
    defaultTtlMs:    cacheTtlMs,
    maxSize:         maxCacheSize,
    sweepIntervalMs: cacheTtlMs > 0 ? Math.min(cacheTtlMs * 2, 120_000) : 0,
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Computes the `jazoest` CSRF companion value for a given DTSG token.
   * Facebook requires this alongside every form POST.
   *
   * @param {string} dtsg
   * @returns {string}
   */
  function computeJazoest(dtsg) {
    let sum = 0;
    for (let i = 0; i < dtsg.length; i++) sum += dtsg.charCodeAt(i);
    return `2${sum}`;
  }

  /**
   * Builds a URL-encoded form body that includes the mandatory Facebook session
   * tokens plus any caller-supplied extra fields.
   *
   * @param {Record<string, string|number|boolean>} [extra={}]
   * @returns {string}
   */
  function buildBody(extra = {}) {
    return toQueryString({
      fb_dtsg:    session.data.dtsg,
      fb_dtsg_ag: session.data.fbDtsgAg,
      jazoest:    computeJazoest(session.data.dtsg),
      __user:     session.data.userID,
      __a:        '1',
      __dyn:      '',
      __csr:      '',
      __req:      'a',
      __hs:       '',
      dpr:        '1',
      __ccg:      'GOOD',
      lsd:        session.data.siteData,
      ...extra,
    });
  }

  /**
   * Strips Facebook's `for(;;);` JSON hijacking prefix and parses the body.
   *
   * @param {string|unknown} raw
   * @returns {unknown}
   * @throws {NetworkError} When the body cannot be parsed as JSON.
   */
  function parseFB(raw) {
    const text    = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const cleaned = text.replace(/^for\s*\(;;\);/, '');
    try {
      return JSON.parse(cleaned);
    } catch (err) {
      throw new NetworkError(
        `Failed to parse Facebook API response: ${err.message}`,
        undefined,
        { cause: err }
      );
    }
  }

  /**
   * Posts a signed form body to `url` and returns the parsed response object.
   * Retries on network errors using the internal RetryManager.
   *
   * @param {string}                              url
   * @param {Record<string,string|number|boolean>} [extra={}] - Extra body fields.
   * @param {Record<string,string>}               [headers={}] - Extra request headers.
   * @returns {Promise<unknown>}
   */
  async function post(url, extra = {}, headers = {}) {
    const body = buildBody(extra);

    return retry.execute(async () => {
      const res = await httpClient.post(url, body, {
        headers: { ...JSON_HEADERS, ...headers },
      });

      if (res.status >= 400) {
        throw new NetworkError(
          `POST ${url} returned HTTP ${res.status}`,
          res.status
        );
      }

      return parseFB(res.data);
    });
  }

  /**
   * Like `post`, but caches the result under `cacheKey` for `ttlMs`
   * milliseconds.  Subsequent calls with the same key return the cached value
   * without hitting the network.
   *
   * @param {string}  cacheKey
   * @param {string}  url
   * @param {Record<string,string|number|boolean>} [extra={}]
   * @param {number}  [ttlMs] - Overrides `cacheTtlMs`; `0` = no expiry.
   * @returns {Promise<unknown>}
   */
  function cachedPost(cacheKey, url, extra = {}, ttlMs) {
    return cache.getOrFetch(cacheKey, () => post(url, extra), ttlMs);
  }

  /**
   * Executes a Facebook GraphQL query using the standard graph-API endpoint.
   *
   * @param {string} docID     - Facebook internal document / query ID.
   * @param {object} variables - Query variables.
   * @returns {Promise<unknown>}
   */
  async function graphql(docID, variables) {
    const raw = await post(
      `${FB_BASE}/api/graphql/`,
      { doc_id: docID, variables: JSON.stringify(variables) }
    );

    // GraphQL responses may be newline-delimited; take the first JSON object.
    if (typeof raw === 'string') {
      const firstLine = raw.split('\n').find((l) => l.trim().startsWith('{'));
      if (!firstLine) {
        throw new NetworkError('GraphQL response contained no JSON object');
      }
      const parsed = JSON.parse(firstLine);
      if (parsed.errors?.length) {
        throw new NetworkError(`GraphQL error: ${parsed.errors[0].message}`);
      }
      return parsed.data ?? parsed;
    }

    /** @type {any} */
    const typed = raw;
    if (typed.errors?.length) {
      throw new NetworkError(`GraphQL error: ${typed.errors[0].message}`);
    }
    return typed.data ?? typed;
  }

  // ── Cache management ──────────────────────────────────────────────────────

  /**
   * Removes a specific key from the request cache.
   *
   * @param {string} key
   */
  const invalidate = (key) => cache.delete(key);

  /** Empties the entire request cache. */
  const clearCache = () => cache.clear();

  /** @returns {import('./cache').CacheStats} */
  const cacheStats = () => cache.stats();

  return {
    post,
    cachedPost,
    graphql,
    buildBody,
    parseFB,
    cacheStats,
    invalidate,
    clearCache,
  };
}

module.exports = { createRequestManager };
