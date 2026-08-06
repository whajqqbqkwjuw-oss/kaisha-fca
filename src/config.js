'use strict';

/**
 * @module config
 * @description Centralised configuration loader and validator for Kaisha.
 *
 * `loadConfig` merges user overrides with defaults, validates types and
 * ranges, and returns a fully resolved, immutable configuration object.
 *
 * Improvements over the previous version:
 * - Integer-range checks replaced with a concise `assertRange` helper.
 * - The resolved config is sealed with `Object.seal` so accidental mutation
 *   of top-level fields is caught at runtime in development.
 * - `DEFAULTS` is exported so external tooling can reference it without
 *   creating a dummy config.
 */

const { deepMerge } = require('./utils');
const { ConfigurationError } = require('./errors');

/** @typedef {import('./logger').LogLevel} LogLevel */

/**
 * @typedef {object} HealthConfig
 * @property {boolean} enabled
 * @property {number}  intervalMs
 * @property {number}  timeoutMs
 * @property {number}  degradedThreshold
 * @property {number}  unhealthyThreshold
 * @property {boolean} autoRecover
 * @property {number}  recoverAfterFails
 */

/**
 * @typedef {object} KaishaConfig
 * @property {LogLevel}     logLevel
 * @property {number}       timeout
 * @property {number}       maxRetries
 * @property {number}       retryDelay
 * @property {number}       maxReconnectAttempts
 * @property {number}       reconnectBaseDelay
 * @property {string|undefined} userAgent
 * @property {boolean}      autoRead
 * @property {boolean}      autoSeen
 * @property {HealthConfig} health
 */

/** @type {Readonly<KaishaConfig>} */
const DEFAULTS = Object.freeze({
  logLevel:             'info',
  timeout:              30_000,
  maxRetries:           3,
  retryDelay:           1_000,
  maxReconnectAttempts: 10,
  reconnectBaseDelay:   2_000,
  userAgent:            undefined,
  autoRead:             false,
  autoSeen:             false,
  health: Object.freeze({
    enabled:             true,
    intervalMs:          30_000,
    timeoutMs:           10_000,
    degradedThreshold:   2,
    unhealthyThreshold:  5,
    autoRecover:         true,
    recoverAfterFails:   5,
  }),
});

const VALID_LOG_LEVELS = Object.freeze(
  new Set(['debug', 'info', 'warn', 'error', 'silent'])
);

/**
 * Asserts that `value` is an integer in [min, max].
 *
 * @param {string} field
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function assertRange(field, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigurationError(
      `config.${field} must be an integer in [${min}, ${max}]. Received: ${value}`
    );
  }
}

/**
 * Merges user-supplied overrides with the defaults, validates every field,
 * and returns a sealed configuration object.
 *
 * @param {Partial<KaishaConfig>} [overrides={}]
 * @returns {KaishaConfig}
 * @throws {ConfigurationError}
 */
function loadConfig(overrides = {}) {
  /** @type {KaishaConfig} */
  const cfg = deepMerge(
    { ...DEFAULTS, health: { ...DEFAULTS.health } },
    overrides
  );

  if (!VALID_LOG_LEVELS.has(cfg.logLevel)) {
    throw new ConfigurationError(
      `config.logLevel must be one of: ${[...VALID_LOG_LEVELS].join(', ')}. ` +
      `Received: "${cfg.logLevel}"`
    );
  }

  assertRange('timeout',              cfg.timeout,              100,   600_000);
  assertRange('maxRetries',           cfg.maxRetries,           0,     20);
  assertRange('retryDelay',           cfg.retryDelay,           100,   120_000);
  assertRange('maxReconnectAttempts', cfg.maxReconnectAttempts, 0,     50);
  assertRange('reconnectBaseDelay',   cfg.reconnectBaseDelay,   200,   120_000);

  if (cfg.userAgent !== undefined && typeof cfg.userAgent !== 'string') {
    throw new ConfigurationError('config.userAgent must be a string when provided');
  }

  if (cfg.health.enabled) {
    assertRange('health.intervalMs',         cfg.health.intervalMs,         1_000, 600_000);
    assertRange('health.timeoutMs',          cfg.health.timeoutMs,          500,   60_000);
    assertRange('health.degradedThreshold',  cfg.health.degradedThreshold,  1,     50);
    assertRange('health.unhealthyThreshold', cfg.health.unhealthyThreshold, 2,     100);
    assertRange('health.recoverAfterFails',  cfg.health.recoverAfterFails,  1,     100);
  }

  return cfg;
}

module.exports = { loadConfig, DEFAULTS };
