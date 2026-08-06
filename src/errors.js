'use strict';

/**
 * @module errors
 * @description Typed error hierarchy for Kaisha.
 *
 * Using specific error classes lets consumers catch individual failure
 * categories without fragile string-matching.
 *
 * All classes accept an optional `{ cause }` options object (ES2022 error
 * chaining) so the original underlying error is always available.
 *
 * Improvements:
 * - `toJSON()` method on every class for structured logging / serialisation.
 * - `RateLimitError` added for Facebook 429 / rate-limit responses.
 * - `ValidationError` added for API argument validation failures.
 */

/**
 * Base class for all Kaisha errors.
 */
class KaishaError extends Error {
  /**
   * @param {string}  message
   * @param {{ cause?: Error }} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = new.target.name;
    // Capture V8 stack trace when available
    if (Error.captureStackTrace) Error.captureStackTrace(this, new.target);
  }

  /**
   * Returns a plain-object representation suitable for JSON serialisation.
   *
   * @returns {{ name: string, message: string, cause?: string }}
   */
  toJSON() {
    const obj = { name: this.name, message: this.message };
    if (this.cause instanceof Error) obj.cause = this.cause.message;
    return obj;
  }
}

/** Thrown when authentication fails (bad credentials, expired session, etc.). */
class AuthenticationError extends KaishaError {}

/** Thrown when an HTTP request fails after all retry attempts. */
class NetworkError extends KaishaError {
  /**
   * @param {string}  message
   * @param {number}  [statusCode]
   * @param {{ cause?: Error }} [options]
   */
  constructor(message, statusCode, options) {
    super(message, options);
    /** @type {number|undefined} */
    this.statusCode = statusCode;
  }

  toJSON() {
    return { ...super.toJSON(), statusCode: this.statusCode };
  }
}

/**
 * Thrown when Facebook returns HTTP 429 or an explicit rate-limit response.
 * Extends `NetworkError` so existing `instanceof NetworkError` checks still
 * catch it.
 */
class RateLimitError extends NetworkError {
  /**
   * @param {string}  message
   * @param {number}  [retryAfterMs] - Suggested wait before retrying (ms).
   * @param {{ cause?: Error }} [options]
   */
  constructor(message, retryAfterMs, options) {
    super(message, 429, options);
    /** @type {number|undefined} */
    this.retryAfterMs = retryAfterMs;
  }

  toJSON() {
    return { ...super.toJSON(), retryAfterMs: this.retryAfterMs };
  }
}

/** Thrown when the MQTT connection cannot be established or maintained. */
class ConnectionError extends KaishaError {}

/** Thrown when a session file cannot be read, decrypted, or validated. */
class SessionError extends KaishaError {}

/** Thrown when a plugin violates its expected contract. */
class PluginError extends KaishaError {
  /**
   * @param {string}  message
   * @param {string}  [pluginName]
   * @param {{ cause?: Error }} [options]
   */
  constructor(message, pluginName, options) {
    super(message, options);
    /** @type {string|undefined} */
    this.pluginName = pluginName;
  }

  toJSON() {
    return { ...super.toJSON(), pluginName: this.pluginName };
  }
}

/** Thrown when a configuration value is invalid. */
class ConfigurationError extends KaishaError {}

/** Thrown when an attachment upload or download fails. */
class AttachmentError extends KaishaError {}

/** Thrown when an API argument fails validation. */
class ValidationError extends KaishaError {
  /**
   * @param {string}  message
   * @param {string}  [field] - The argument or field name that failed.
   * @param {{ cause?: Error }} [options]
   */
  constructor(message, field, options) {
    super(message, options);
    /** @type {string|undefined} */
    this.field = field;
  }

  toJSON() {
    return { ...super.toJSON(), field: this.field };
  }
}

module.exports = {
  KaishaError,
  AuthenticationError,
  NetworkError,
  RateLimitError,
  ConnectionError,
  SessionError,
  PluginError,
  ConfigurationError,
  AttachmentError,
  ValidationError,
};
