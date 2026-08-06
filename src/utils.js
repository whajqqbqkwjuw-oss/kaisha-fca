'use strict';

/**
 * @module utils
 * @description Pure utility helpers shared across Kaisha's internal modules.
 *
 * All functions are side-effect-free unless explicitly documented otherwise.
 * No module-level state is maintained.
 */

/**
 * Pauses execution for the given number of milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns a random integer in the closed interval [min, max].
 * Not suitable for cryptographic use.
 *
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generates a random alphanumeric string of the requested length.
 * Uses pre-allocated arrays to avoid O(n²) string concatenation.
 *
 * @param {number} length
 * @returns {string}
 */
function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const codes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    codes[i] = chars.charCodeAt(Math.floor(Math.random() * chars.length));
  }
  return String.fromCharCode(...codes);
}

/**
 * Parses an array of raw `Set-Cookie` header strings into a name→value map.
 * Cookie attributes (Path, Domain, Secure, HttpOnly, etc.) are discarded.
 *
 * Uses `Object.create(null)` to produce a prototype-free map so that
 * crafted cookie names such as `__proto__` cannot pollute the prototype chain.
 *
 * @param {string[]} cookieHeaders
 * @returns {Record<string, string>}
 */
function parseCookies(cookieHeaders) {
  const jar = Object.create(null);
  for (const header of cookieHeaders) {
    const end = header.indexOf(';');
    const pair = end === -1 ? header : header.slice(0, end);
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) jar[name] = value;
  }
  return jar;
}

/**
 * Serialises a cookie map into a single `Cookie` request header value.
 *
 * @param {Record<string, string>} cookieMap
 * @returns {string}
 */
function serializeCookies(cookieMap) {
  const entries = Object.entries(cookieMap);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Deeply merges `sources` into `target` (mutates target).
 *
 * - Plain objects are merged recursively.
 * - Arrays and primitives in a source overwrite the corresponding target value.
 * - `null` source values overwrite target values.
 * - `undefined` source values are skipped (target value is preserved).
 *
 * @param {object}    target
 * @param {...object} sources
 * @returns {object}
 */
function deepMerge(target, ...sources) {
  for (const source of sources) {
    if (source === null || typeof source !== 'object') continue;
    for (const key of Object.keys(source)) {
      const sv = source[key];
      if (sv === undefined) continue;
      if (
        sv !== null &&
        typeof sv === 'object' &&
        !Array.isArray(sv) &&
        typeof target[key] === 'object' &&
        target[key] !== null &&
        !Array.isArray(target[key])
      ) {
        deepMerge(target[key], sv);
      } else {
        target[key] = sv;
      }
    }
  }
  return target;
}

/**
 * Parses a JSON string, returning `fallback` on any error.
 *
 * @template T
 * @param {string} raw
 * @param {T}      [fallback=null]
 * @returns {T|null}
 */
function tryParseJSON(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Converts a plain object into a `application/x-www-form-urlencoded` string.
 *
 * @param {Record<string, string|number|boolean>} params
 * @returns {string}
 */
function toQueryString(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Returns the substring between `start` and `end` in `str`.
 * Returns `null` when either delimiter is absent.
 *
 * @param {string} str
 * @param {string} start
 * @param {string} end
 * @returns {string|null}
 */
function between(str, start, end) {
  const si = str.indexOf(start);
  if (si === -1) return null;
  const from = si + start.length;
  const ei = str.indexOf(end, from);
  if (ei === -1) return null;
  return str.slice(from, ei);
}

/**
 * Races `promise` against a timeout, rejecting with a descriptive `Error`
 * when the timeout expires first.
 *
 * @param {Promise<unknown>} promise
 * @param {number}           ms
 * @returns {Promise<unknown>}
 */
function withTimeout(promise, ms) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

/**
 * Computes an exponential-backoff delay with additive random jitter.
 *
 * @param {number} attempt    - 1-based attempt number.
 * @param {number} baseMs     - Base delay in milliseconds.
 * @param {number} [maxMs=30000]
 * @param {number} [jitterMs=500]
 * @returns {number}
 */
function exponentialBackoff(attempt, baseMs, maxMs = 30_000, jitterMs = 500) {
  const delay = Math.min(baseMs * 2 ** (attempt - 1), maxMs);
  return delay + randomInt(0, jitterMs);
}

module.exports = {
  sleep,
  randomInt,
  randomString,
  parseCookies,
  serializeCookies,
  deepMerge,
  tryParseJSON,
  toQueryString,
  between,
  withTimeout,
  exponentialBackoff,
};
