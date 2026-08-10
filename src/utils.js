'use strict';

/**
 * @module utils
 * @description Shared utility functions used across all Kaisha modules.
 *
 * Every function in this module is a pure helper with no side-effects and no
 * external dependencies.  All modules import from here — do NOT introduce
 * imports that create circular dependencies.
 */

// ── Async ─────────────────────────────────────────────────────────────────────

/**
 * Returns a Promise that resolves after `ms` milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Random ────────────────────────────────────────────────────────────────────

/**
 * Returns a random integer in the range [min, max] (both inclusive).
 *
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Returns a random alphanumeric string of the given length.
 * Suitable for client identifiers and nonces; not for secrets.
 *
 * @param {number} length
 * @returns {string}
 */
function randomString(length) {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ── String ────────────────────────────────────────────────────────────────────

/**
 * Extracts the substring of `str` that lies between the first occurrence of
 * `startStr` and the next occurrence of `endStr` after it.
 * Returns `null` when either delimiter cannot be found.
 *
 * @param {string} str
 * @param {string} startStr
 * @param {string} endStr
 * @returns {string | null}
 */
function between(str, startStr, endStr) {
  if (typeof str !== 'string') return null;

  const s = str.indexOf(startStr);
  if (s === -1) return null;

  const from = s + startStr.length;
  const e = str.indexOf(endStr, from);
  if (e === -1) return null;

  return str.slice(from, e);
}

// ── JSON ──────────────────────────────────────────────────────────────────────

/**
 * Attempts to parse `str` as JSON.
 * Returns the parsed value on success, `null` on any error.
 *
 * @param {string} str
 * @returns {object | null}
 */
function tryParseJSON(str) {
  if (typeof str !== 'string') return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// ── Object ────────────────────────────────────────────────────────────────────

/**
 * Deep-merges `source` into `target` and returns a new object.
 * Arrays in `source` replace arrays in `target` (no concatenation).
 * Only plain objects are merged recursively; all other types are replaced.
 *
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} source
 * @returns {Record<string, unknown>}
 */
function deepMerge(target, source) {
  const result = Object.assign({}, target);

  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = result[key];

    const bothPlainObjects =
      sv !== null &&
      sv !== undefined &&
      typeof sv === 'object' &&
      !Array.isArray(sv) &&
      tv !== null &&
      tv !== undefined &&
      typeof tv === 'object' &&
      !Array.isArray(tv);

    if (bothPlainObjects) {
      result[key] = deepMerge(
        /** @type {Record<string, unknown>} */ (tv),
        /** @type {Record<string, unknown>} */ (sv)
      );
    } else if (sv !== undefined) {
      result[key] = sv;
    }
  }

  return result;
}

// ── HTTP / Cookies ────────────────────────────────────────────────────────────

/**
 * Serialises a cookie jar into the string format for the HTTP Cookie header.
 * Entries with undefined or null values are omitted.
 *
 * @param {Record<string, string>} jar
 * @returns {string}
 */
function serializeCookies(jar) {
  return Object.entries(jar)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

/**
 * Parses an array of raw Set-Cookie header strings into a plain object
 * mapping cookie names to their values.  Directive attributes (Path, Domain,
 * Expires, Secure, HttpOnly, SameSite) are ignored.
 *
 * @param {string[]} setCookieHeaders
 * @returns {Record<string, string>}
 */
function parseCookies(setCookieHeaders) {
  const result = Object.create(null);

  for (const header of setCookieHeaders) {
    if (typeof header !== 'string') continue;

    const parts = header.split(';');
    const namePart = parts[0].trim();
    const eqIdx = namePart.indexOf('=');
    if (eqIdx === -1) continue;

    const name = namePart.slice(0, eqIdx).trim();
    const value = namePart.slice(eqIdx + 1);

    if (name) {
      result[name] = value;
    }
  }

  return result;
}

// ── Backoff ───────────────────────────────────────────────────────────────────

/**
 * Computes an exponential-backoff delay with optional random jitter.
 *
 * Formula: min(base * 2^(attempt-1) + randomJitter, max)
 *
 * @param {number} attempt     - 1-based attempt number.
 * @param {number} [base=1000]  - Base delay in milliseconds.
 * @param {number} [max=30000]  - Maximum delay ceiling in milliseconds.
 * @param {number} [jitter=0]   - Upper bound for random jitter in milliseconds.
 * @returns {number}
 */
function exponentialBackoff(attempt, base = 1_000, max = 30_000, jitter = 0) {
  const exp = base * Math.pow(2, attempt - 1);
  const jitterValue = jitter > 0 ? Math.floor(Math.random() * jitter) : 0;
  return Math.min(exp + jitterValue, max);
}

// ── Query string ──────────────────────────────────────────────────────────────

/**
 * Converts a plain object into a URL-encoded query / form-body string.
 * Entries with undefined or null values are omitted.
 * All other values are coerced to strings before encoding.
 *
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
function toQueryString(params) {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null
  );

  return new URLSearchParams(
    entries.map(([k, v]) => [k, String(v)])
  ).toString();
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  sleep,
  randomInt,
  randomString,
  between,
  tryParseJSON,
  deepMerge,
  serializeCookies,
  parseCookies,
  exponentialBackoff,
  toQueryString,
};