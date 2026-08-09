'use strict';

/**
 * @module events
 * @description Typed event emitter for Kaisha's internal and public event bus.
 *
 * Design choices:
 * - Uses `Set` for O(1) add / delete of listeners.
 * - Validates every event name against a frozen registry.
 * - Emitting an unregistered event throws `TypeError` immediately.
 * - `emit` never throws on listener errors; errors are swallowed silently so
 *   one bad listener cannot break the dispatch loop.
 */

/** @type {ReadonlySet<string>} */
const VALID_EVENTS = new Set([
  'message',        'message:unsend', 'message:react',  'message:reply',
  'connected',      'disconnected',   'reconnecting',   'error',          'ready',
  'typing',         'message:seen',
  'participant:join','participant:leave',
  'admin:promote',  'admin:demote',
  'group:name',     'group:photo',    'group:emoji',
  'poll',           'presence',
  'reply',          'unsend',         'seen',
  'thread:update',  'nickname:change','emoji:change',   'theme:change',
  'user:added',     'user:removed',
  'approval:mode',  'approval:request',
  'call',
]);

/**
 * @typedef {string} KaishaEvent
 */

class KaishaEventEmitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._on   = new Map();
    /** @type {Map<string, Set<Function>>} */
    this._once = new Map();
  }

  /**
   * Registers a persistent listener.
   *
   * @param {KaishaEvent} event
   * @param {Function}    listener
   * @returns {this}
   */
  on(event, listener) {
    this._assert(event);
    if (!this._on.has(event)) this._on.set(event, new Set());
    this._on.get(event).add(listener);
    return this;
  }

  /**
   * Registers a one-time listener; removed automatically after first call.
   *
   * @param {KaishaEvent} event
   * @param {Function}    listener
   * @returns {this}
   */
  once(event, listener) {
    this._assert(event);
    if (!this._once.has(event)) this._once.set(event, new Set());
    this._once.get(event).add(listener);
    return this;
  }

  /**
   * Removes a registered listener (persistent or one-time).
   *
   * @param {KaishaEvent} event
   * @param {Function}    listener
   * @returns {this}
   */
  off(event, listener) {
    this._on.get(event)?.delete(listener);
    this._once.get(event)?.delete(listener);
    return this;
  }

  /**
   * Invokes all listeners for `event`.  One-time listeners are removed before
   * invocation to prevent double-removal races.  Listener errors are caught
   * and re-emitted as `'error'` events; if no error listener is registered
   * the error is written to stderr and swallowed.
   *
   * @param {KaishaEvent} event
   * @param {...unknown}  args
   * @returns {boolean} `true` if at least one listener was invoked.
   */
  emit(event, ...args) {
    let invoked = false;

    const persistent = this._on.get(event);
    if (persistent) {
      for (const fn of persistent) {
        try   { fn(...args); invoked = true; }
        catch (err) { this._handleListenerError(err); }
      }
    }

    const once = this._once.get(event);
    if (once) {
      const fns = [...once];
      once.clear();
      for (const fn of fns) {
        try   { fn(...args); invoked = true; }
        catch (err) { this._handleListenerError(err); }
      }
    }

    return invoked;
  }

  /**
   * Removes all listeners for `event`, or for every event when omitted.
   *
   * @param {KaishaEvent} [event]
   * @returns {this}
   */
  removeAllListeners(event) {
    if (event) {
      this._on.delete(event);
      this._once.delete(event);
    } else {
      this._on.clear();
      this._once.clear();
    }
    return this;
  }

  /**
   * Returns the names of all valid events.
   *
   * @returns {string[]}
   */
  eventNames() {
    return [...VALID_EVENTS];
  }

  /**
   * Returns the number of listeners registered for `event`.
   *
   * @param {KaishaEvent} event
   * @returns {number}
   */
  listenerCount(event) {
    return (this._on.get(event)?.size ?? 0) +
           (this._once.get(event)?.size ?? 0);
  }

  /** @private */
  _assert(event) {
    if (!VALID_EVENTS.has(event)) {
      throw new TypeError(
        `Unknown Kaisha event: "${event}". ` +
        `Valid events: ${[...VALID_EVENTS].sort().join(', ')}`
      );
    }
  }

  /** @private */
  _handleListenerError(err) {
    if (this._on.has('error') || this._once.has('error')) {
      this.emit('error', err);
    } else {
      process.stderr.write(`[KaishaEventEmitter] Unhandled listener error: ${err?.message ?? err}\n`);
    }
  }
}

module.exports = { KaishaEventEmitter, VALID_EVENTS };
