'use strict';

/**
 * @module secure
 * @description AES-256-GCM encrypted storage, credential vault, local cache,
 * token manager, and session backup / restore.
 *
 * All encryption uses Node.js built-in `crypto`.  Zero additional dependencies.
 *
 * Improvements:
 * - `SessionError` / `ConfigurationError` used instead of plain `Error`.
 * - Atomic writes use `fs.renameSync` (same drive guarantee).
 * - Cache TTL expiry is checked lazily on `get` (no background sweeper needed).
 * - All public functions have complete JSDoc.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { SessionError, ConfigurationError } = require('./errors');

const ALGO        = 'aes-256-gcm';
const KEY_LEN     = 32;
const IV_LEN      = 16;
const TAG_LEN     = 16;
const SALT_LEN    = 32;
const PBKDF2_ITER = 210_000;
const PBKDF2_HASH = 'sha512';
const VERSION     = 1;

/**
 * @param {string} passphrase
 * @param {Buffer} salt
 * @returns {Buffer}
 */
function deriveKey(passphrase, salt) {
  return crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITER, KEY_LEN, PBKDF2_HASH);
}

/**
 * Encrypts a UTF-8 string using AES-256-GCM.
 *
 * Envelope: [1B version][32B salt][16B IV][16B auth-tag][N bytes ciphertext]
 *
 * @param {string} plaintext
 * @param {string} passphrase
 * @returns {Buffer}
 */
function encrypt(plaintext, passphrase) {
  const salt   = crypto.randomBytes(SALT_LEN);
  const iv     = crypto.randomBytes(IV_LEN);
  const key    = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const body   = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), salt, iv, cipher.getAuthTag(), body]);
}

/**
 * Decrypts an envelope produced by `encrypt`.
 *
 * @param {Buffer} envelope
 * @param {string} passphrase
 * @returns {string}
 * @throws {ConfigurationError} on wrong passphrase or corrupted data.
 */
function decrypt(envelope, passphrase) {
  if (envelope.length < 1 + SALT_LEN + IV_LEN + TAG_LEN) {
    throw new ConfigurationError('Encrypted envelope is too short to be valid');
  }
  let o = 0;
  const ver  = envelope[o++];
  if (ver !== VERSION) throw new ConfigurationError(`Unsupported file version: ${ver}`);
  const salt = envelope.slice(o, o += SALT_LEN);
  const iv   = envelope.slice(o, o += IV_LEN);
  const tag  = envelope.slice(o, o += TAG_LEN);
  const body = envelope.slice(o);
  const key  = deriveKey(passphrase, salt);
  const dc   = crypto.createDecipheriv(ALGO, key, iv);
  dc.setAuthTag(tag);
  try {
    return Buffer.concat([dc.update(body), dc.final()]).toString('utf8');
  } catch {
    throw new ConfigurationError('Decryption failed: wrong passphrase or corrupted data');
  }
}

/**
 * @param {string} filePath
 * @param {Buffer} data
 */
function atomicWrite(filePath, data) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmp = `${resolved}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, resolved);
}

/**
 * @param {string} filePath
 * @returns {Buffer|null}
 */
function safeRead(filePath) {
  const r = path.resolve(filePath);
  return fs.existsSync(r) ? fs.readFileSync(r) : null;
}

// ─── SecureStorage ────────────────────────────────────────────────────────────

/**
 * @typedef {object} SecureStorage
 * @property {function} save
 * @property {function} load
 * @property {function} exists
 * @property {function} delete
 */

/**
 * Creates an AES-256-GCM encrypted file store.
 *
 * @param {string} filePath
 * @param {string} passphrase
 * @returns {SecureStorage}
 */
function createSecureStorage(filePath, passphrase) {
  _assertStorageArgs(filePath, passphrase);

  return {
    /** @param {unknown} value */
    save(value) {
      atomicWrite(filePath, encrypt(JSON.stringify(value), passphrase));
    },
    /** @returns {unknown} */
    load() {
      const buf = safeRead(filePath);
      if (!buf) throw new SessionError(`Encrypted file not found: ${path.resolve(filePath)}`);
      return JSON.parse(decrypt(buf, passphrase));
    },
    /** @returns {boolean} */
    exists() { return fs.existsSync(path.resolve(filePath)); },
    delete()  {
      const r = path.resolve(filePath);
      if (fs.existsSync(r)) fs.unlinkSync(r);
    },
  };
}

// ─── CredentialVault ─────────────────────────────────────────────────────────

/**
 * @typedef {object} CredentialVault
 * @property {function} set
 * @property {function} get
 * @property {function} remove
 * @property {function} clear
 * @property {function} save
 * @property {function} load
 * @property {function} exists
 */

/**
 * Creates an encrypted key-value credential vault.
 *
 * @param {string} filePath
 * @param {string} passphrase
 * @returns {CredentialVault}
 */
function createCredentialVault(filePath, passphrase) {
  const storage = createSecureStorage(filePath, passphrase);
  /** @type {Map<string,string>} */
  const map = new Map();

  return {
    set(key, value) {
      if (typeof key !== 'string' || !key.trim()) throw new TypeError('key must be a non-empty string');
      map.set(key, String(value));
    },
    get(key)    { return map.get(key); },
    remove(key) { map.delete(key); },
    clear()     { map.clear(); },
    save()      { storage.save(Object.fromEntries(map)); },
    load() {
      const obj = /** @type {Record<string,string>} */ (storage.load());
      map.clear();
      for (const [k, v] of Object.entries(obj)) map.set(k, String(v));
    },
    exists() { return storage.exists(); },
  };
}

// ─── EncryptedCache ───────────────────────────────────────────────────────────

/**
 * @typedef {object} EncryptedCache
 * @property {function} set
 * @property {function} get
 * @property {function} has
 * @property {function} delete
 * @property {function} clear
 * @property {function} save
 * @property {function} load
 */

/**
 * @param {number|null} expiresAt
 * @returns {boolean}
 */
function isExpired(expiresAt) {
  return expiresAt !== null && Date.now() > expiresAt;
}

/**
 * Creates an encrypted local cache with per-entry TTL.
 *
 * @param {string} filePath
 * @param {string} passphrase
 * @returns {EncryptedCache}
 */
function createEncryptedCache(filePath, passphrase) {
  const storage = createSecureStorage(filePath, passphrase);
  /** @type {Map<string, {value:unknown, expiresAt:number|null}>} */
  const map = new Map();

  return {
    set(key, value, ttlSeconds) {
      map.set(key, {
        value,
        expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
      });
    },
    get(key) {
      const e = map.get(key);
      if (!e) return undefined;
      if (isExpired(e.expiresAt)) { map.delete(key); return undefined; }
      return e.value;
    },
    has(key) { return this.get(key) !== undefined; },
    delete(key) { map.delete(key); },
    clear() { map.clear(); },
    save() {
      const now = Date.now();
      const snap = {};
      for (const [k, e] of map) {
        if (!isExpired(e.expiresAt)) snap[k] = e;
      }
      storage.save(snap);
    },
    load() {
      const snap = /** @type {Record<string,{value:unknown,expiresAt:number|null}>} */ (storage.load());
      map.clear();
      for (const [k, e] of Object.entries(snap)) {
        if (!isExpired(e.expiresAt)) map.set(k, e);
      }
    },
  };
}

// ─── TokenManager ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} TokenManager
 * @property {function} setToken
 * @property {function} getToken
 * @property {function} isExpired
 * @property {function} removeToken
 * @property {function} save
 * @property {function} load
 */

/**
 * Creates an encrypted token manager.
 *
 * @param {string} filePath
 * @param {string} passphrase
 * @returns {TokenManager}
 */
function createTokenManager(filePath, passphrase) {
  const storage = createSecureStorage(filePath, passphrase);
  /** @type {Map<string, {value:string, expiresAt:number|null}>} */
  const tokens = new Map();

  return {
    setToken(name, value, ttlSeconds) {
      tokens.set(name, {
        value: String(value),
        expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
      });
    },
    getToken(name) {
      const e = tokens.get(name);
      if (!e) return null;
      if (isExpired(e.expiresAt)) { tokens.delete(name); return null; }
      return e.value;
    },
    isExpired(name) { return this.getToken(name) === null; },
    removeToken(name) { tokens.delete(name); },
    save() {
      const now = Date.now();
      const snap = {};
      for (const [n, e] of tokens) {
        if (!isExpired(e.expiresAt)) snap[n] = e;
      }
      storage.save(snap);
    },
    load() {
      const snap = /** @type {Record<string,{value:string,expiresAt:number|null}>} */ (storage.load());
      tokens.clear();
      for (const [n, e] of Object.entries(snap)) {
        if (!isExpired(e.expiresAt)) tokens.set(n, e);
      }
    },
  };
}

// ─── Session backup / restore ─────────────────────────────────────────────────

/**
 * Backs up a live session to an encrypted file.
 *
 * @param {import('./session').Session} session
 * @param {string}                      filePath
 * @param {string}                      passphrase
 */
function backupSession(session, filePath, passphrase) {
  if (!session || typeof session.toJSON !== 'function') {
    throw new SessionError('backupSession: session must be a valid Kaisha Session object');
  }
  createSecureStorage(filePath, passphrase).save({
    ...session.toJSON(),
    _backedUpAt: Date.now(),
  });
}

/**
 * Restores session data from an encrypted backup file.
 *
 * @param {string} filePath
 * @param {string} passphrase
 * @returns {import('./session').SessionData & { _backedUpAt: number }}
 * @throws {SessionError}
 */
function restoreSession(filePath, passphrase) {
  const data = /** @type {any} */ (createSecureStorage(filePath, passphrase).load());
  if (!data || typeof data.userID !== 'string') {
    throw new SessionError('restoreSession: backup file does not contain a valid session');
  }
  return data;
}

/** @private */
function _assertStorageArgs(filePath, passphrase) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new ConfigurationError('createSecureStorage: filePath must be a non-empty string');
  }
  if (typeof passphrase !== 'string' || !passphrase.length) {
    throw new ConfigurationError('createSecureStorage: passphrase must be a non-empty string');
  }
}

module.exports = {
  createSecureStorage,
  createCredentialVault,
  createEncryptedCache,
  createTokenManager,
  backupSession,
  restoreSession,
};
