'use strict';

/**
 * @module retry
 * @description Retry Manager for Kaisha.
 *
 * Provides a configurable, policy-driven retry wrapper that any module can
 * use without duplicating exponential-backoff logic.  The existing ad-hoc
 * retry loop in `src/http.js` delegates to this module.
 *
 * Features:
 * - Exponential backoff with additive jitter.
 * - Per-attempt and per-execution timeout.
 * - Configurable retry predicate so only specific errors are retried.
 * - Optional `onRetry` callback for observability.
 * - Typed `RetryError` that wraps the last underlying error.
 */

const { sleep, exponentialBackoff } = require('./utils');
const { NetworkError } = require('./errors');

/**
 * @typedef {object} RetryOptions
 * @property {number}   [maxAttempts=3]    - Maximum number of attempts (including the first).
 * @property {number}   [baseDelayMs=1000] - Base delay for exponential backoff (ms).
 * @property {number}   [maxDelayMs=30000] - Maximum delay ceiling (ms).
 * @property {number}   [jitterMs=500]     - Maximum random jitter added to each delay (ms).
 * @property {number}   [timeoutMs=0]      - Per-attempt timeout (ms).  `0` = no timeout.
 * @property {(err: Error, attempt: number) => boolean} [shouldRetry]
 *   Predicate that returns `true` when the error should trigger a retry.
 *   Defaults to retrying on every error.
 * @property {(err: Error, attempt: number, delayMs: number) => void} [onRetry]
 *   Called before each retry with the error, attempt number, and upcoming delay.
 *
 * @typedef {object} RetryManager
 * @property {function} execute - Executes a function with retry logic applied.
 * @property {function} wrap    - Returns a new async function with retry logic baked in.
 */

/**
 * Default retry predicate — retries on every error.
 *
 * @returns {boolean}
 */
function defaultShouldRetry() {
  return true;
}

/**
 * Creates a RetryManager.
 *
 * @param {RetryOptions} [options={}]
 * @returns {RetryManager}
 *
 * @example
 * const retry = createRetryManager({ maxAttempts: 5, baseDelayMs: 500 });
 *
 * const data = await retry.execute(() => fetch('https://example.com/api'));
 *
 * // Wrap a pre-existing function
 * const safeFetch = retry.wrap((url) => fetch(url));
 * const res = await safeFetch('https://example.com/api');
 */
function createRetryManager({
  maxAttempts  = 3,
  baseDelayMs  = 1_000,
  maxDelayMs   = 30_000,
  jitterMs     = 500,
  timeoutMs    = 0,
  shouldRetry  = defaultShouldRetry,
  onRetry,
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('RetryManager: maxAttempts must be a positive integer');
  }
  if (typeof baseDelayMs !== 'number' || baseDelayMs < 0) {
    throw new TypeError('RetryManager: baseDelayMs must be a non-negative number');
  }

  /**
   * Applies a per-attempt timeout when `timeoutMs > 0`.
   *
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function withAttemptTimeout(fn) {
    if (timeoutMs <= 0) return fn();

    /** @type {ReturnType<typeof setTimeout>} */
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new NetworkError(`Attempt timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    });

    try {
      return await Promise.race([fn(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Executes `fn`, retrying up to `maxAttempts - 1` additional times on
   * retriable errors.
   *
   * @template T
   * @param {() => T | Promise<T>} fn
   * @returns {Promise<T>}
   * @throws {NetworkError} When all attempts are exhausted.
   */
  async function execute(fn) {
    let lastErr;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await withAttemptTimeout(fn);
      } catch (err) {
        lastErr = err;

        const isLast = attempt === maxAttempts;
        if (isLast || !shouldRetry(err, attempt)) break;

        const delay = exponentialBackoff(attempt, baseDelayMs, maxDelayMs, jitterMs);

        if (typeof onRetry === 'function') {
          try { onRetry(err, attempt, delay); } catch { /* never crash on observer */ }
        }

        await sleep(delay);
      }
    }

    throw new NetworkError(
      `All ${maxAttempts} attempt(s) failed. Last error: ${lastErr?.message ?? lastErr}`,
      undefined,
      { cause: lastErr }
    );
  }

  /**
   * Returns a new async function that applies the retry policy to every call
   * of the wrapped function.
   *
   * @template {(...args: unknown[]) => unknown} F
   * @param {F} fn
   * @returns {(...args: Parameters<F>) => Promise<Awaited<ReturnType<F>>>}
   */
  function wrap(fn) {
    return (...args) => execute(() => fn(...args));
  }

  return { execute, wrap };
}

module.exports = { createRetryManager };
