'use strict';

/**
 * @module session
 * @description Session state management: stores cookies, tokens, user identity
 * and provides serialisation so sessions can be saved and restored.
 *
 * Improvements:
 * - `SessionError` is thrown on validation failure instead of plain `Error`.
 * - `save` / `loadSession` use `fs.promises` for Node 22 style (sync fallback
 *   kept for compatibility with existing `save()` call sites that are not async).
 */

const fs = require('fs');
const path = require('path');
const { SessionError } = require('./errors');

/**
 * @typedef {object} SessionData
 * @property {Record<string,string>} cookies
 * @property {string} userID
 * @property {string} clientID
 * @property {string} dtsg
 * @property {string} fbDtsgAg
 * @property {string} siteData
 * @property {number} createdAt
 */

/**
 * @typedef {object} Session
 * @property {SessionData} data
 * @property {function} getCookie
 * @property {function} mergeCookies
 * @property {function} toJSON
 * @property {function} isValid
 * @property {function} save
 */

/**
 * Creates a Session container from initial data.
 *
 * @param {Partial<SessionData>} [initial={}]
 * @returns {Session}
 */
function createSession(initial = {}) {
  /** @type {SessionData} */
  const data = {
    cookies: {},
    userID: '',
    clientID: '',
    dtsg: '',
    fbDtsgAg: '',
    siteData: '',
    createdAt: Date.now(),
    ...initial,
  };

  /** @param {string} name @returns {string|undefined} */
  const getCookie = (name) => data.cookies[name];

  /** @param {Record<string,string>} c */
  const mergeCookies = (c) => Object.assign(data.cookies, c);

  /** @returns {SessionData} */
  const toJSON = () => JSON.parse(JSON.stringify(data));

  /** @returns {boolean} */
  const isValid = () =>
    typeof data.userID === 'string' && data.userID.length > 0 &&
    typeof data.cookies === 'object' && Object.keys(data.cookies).length > 0 &&
    typeof data.dtsg === 'string' && data.dtsg.length > 0;

  /**
   * Saves the session to a JSON file (synchronous atomic write).
   *
   * @param {string} filePath
   */
  function save(filePath) {
    const resolved = path.resolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const tmp = `${resolved}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(toJSON(), null, 2), 'utf8');
    fs.renameSync(tmp, resolved);
  }

  return { data, getCookie, mergeCookies, toJSON, isValid, save };
}

/**
 * Loads a session from a JSON file.
 *
 * @param {string} filePath
 * @returns {Session}
 * @throws {SessionError}
 */
function loadSession(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new SessionError(`Session file not found: ${resolved}`);
  }
  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    const data = JSON.parse(raw);
    return createSession(data);
  } catch (err) {
    throw new SessionError(`Failed to load session from ${resolved}: ${err.message}`, { cause: err });
  }
}

/**
 * Creates a Session from an appstate cookie array (browser-exported format).
 *
 * @param {Array<{name:string, value:string, [k:string]:unknown}>} appstate
 * @returns {Session}
 * @throws {SessionError}
 */
function loadFromAppState(appstate) {
  if (!Array.isArray(appstate)) {
    throw new SessionError('appstate must be an array of cookie objects');
  }

  const cookies = Object.create(null);

for (const entry of appstate) {
  if (!entry || typeof entry !== 'object') continue;

  const cookieName = entry.name || entry.key;

  if (typeof cookieName === 'string' && typeof entry.value === 'string') {
    cookies[cookieName] = entry.value;
  }
}

  if (!cookies['c_user']) {
    throw new SessionError(
      'Invalid appstate: missing required "c_user" cookie (user ID)'
    );
  }

  return createSession({ cookies, userID: cookies['c_user'] });
}

module.exports = { createSession, loadSession, loadFromAppState };
