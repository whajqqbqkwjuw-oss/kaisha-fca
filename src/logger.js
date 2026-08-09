'use strict';

/**
 * @module logger
 * @description Structured, namespaced, coloured logger for Kaisha.
 *
 * Improvements over the previous version:
 * - `formatValue` handles `BigInt`, `Symbol`, and `undefined` explicitly.
 * - `child` loggers inherit the parent's minimum level integer, not the
 *   string, so level lookups cannot drift when the parent string is not in
 *   `LEVELS`.
 * - `withFields` creates a logger that prepends structured key-value pairs to
 *   every line, useful for per-request tracing.
 * - All internal constants are frozen.
 */

/** @type {Readonly<Record<string, number>>} */
const LEVELS = Object.freeze({ debug: 0, info: 1, warn: 2, error: 3, silent: 4 });

/** @type {Readonly<Record<string, string>>} */
const CLR = Object.freeze({
  reset: '\x1b[0m', bold: '\x1b[1m',
  grey:  '\x1b[90m',
  debug: '\x1b[36m',
  info:  '\x1b[32m',
  warn:  '\x1b[33m',
  error: '\x1b[31m',
});

/**
 * Bright ANSI colours that cycle to produce the rainbow effect on every
 * log line.  Order: red → orange/yellow → green → cyan → blue → magenta.
 *
 * @type {readonly string[]}
 */
const RAINBOW = Object.freeze([
  '\x1b[91m', // bright red
  '\x1b[33m', // yellow (no bright-yellow in 8-colour; this reads as orange)
  '\x1b[93m', // bright yellow
  '\x1b[92m', // bright green
  '\x1b[96m', // bright cyan
  '\x1b[94m', // bright blue
  '\x1b[95m', // bright magenta
]);

/** Module-level counter so every write() call gets the next rainbow colour. */
let _rainbowIdx = 0;

/** @returns {string} The next ANSI colour code in the rainbow cycle. */
function nextRainbow() {
  const c = RAINBOW[_rainbowIdx % RAINBOW.length];
  _rainbowIdx++;
  return c;
}

/**
 * @typedef {'debug'|'info'|'warn'|'error'|'silent'} LogLevel
 *
 * @typedef {object} Logger
 * @property {function(...unknown): void} debug
 * @property {function(...unknown): void} info
 * @property {function(...unknown): void} warn
 * @property {function(...unknown): void} error
 * @property {function(string): Logger}   child
 * @property {function(Record<string, unknown>): Logger} withFields
 */

/**
 * Converts a value to a log-safe string representation.
 *
 * @param {unknown} v
 * @returns {string}
 */
function formatValue(v) {
  if (v === undefined)        return 'undefined';
  if (v === null)             return 'null';
  if (typeof v === 'string')  return v;
  if (typeof v === 'bigint')  return `${v}n`;
  if (typeof v === 'symbol')  return v.toString();
  if (v instanceof Error)     return `${v.name}: ${v.message}`;
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v, (_, val) => (typeof val === 'bigint' ? `${val}n` : val));
    } catch { return '[Circular]'; }
  }
  return String(v);
}

/**
 * Creates a logger.
 *
 * @param {object}   [opts={}]
 * @param {string}   [opts.namespace='Kaisha'] - Bracket-enclosed label shown on every line.
 * @param {LogLevel} [opts.level='info']       - Minimum level to emit.
 * @param {number}   [opts._minLevel]          - Internal: resolved minimum level integer.
 * @param {Record<string, unknown>} [opts._fields] - Internal: extra key-value pairs to prefix.
 * @returns {Logger}
 */
function createLogger({
  namespace  = 'Kaisha',
  level      = 'info',
  _minLevel,
  _fields,
} = {}) {
  const minLevel = _minLevel ?? (LEVELS[level] ?? LEVELS.info);

  // Pre-format the structured field string (if any) once at creation time
  const fieldStr = _fields && Object.keys(_fields).length > 0
    ? ` ${Object.entries(_fields).map(([k, v]) => `${k}=${formatValue(v)}`).join(' ')}`
    : '';

  /**
   * @param {'debug'|'info'|'warn'|'error'} lvl
   * @param {unknown[]} args
   */
  function write(lvl, args) {
    if ((LEVELS[lvl] ?? 0) < minLevel) return;
    const rainbow = nextRainbow();
    const col = CLR[lvl];
    const ts  = `${CLR.grey}${new Date().toISOString()}${CLR.reset}`;
    const tag = `${rainbow}${CLR.bold}[${namespace}]${CLR.reset}`;
    const lbl = `${col}${CLR.bold}${lvl.toUpperCase().padEnd(5)}${CLR.reset}`;
    const msg = `${rainbow}${args.map(formatValue).join(' ')}${CLR.reset}`;
    process.stdout.write(`${ts} ${tag} ${lbl}${fieldStr} ${msg}\n`);
  }

  return {
    debug(...a) { write('debug', a); },
    info(...a)  { write('info',  a); },
    warn(...a)  { write('warn',  a); },
    error(...a) { write('error', a); },

    /**
     * Creates a child logger whose namespace is `${parent}:${name}`.
     * Inherits the parent's level.
     *
     * @param {string} name
     * @returns {Logger}
     */
    child(name) {
      return createLogger({
        namespace: `${namespace}:${name}`,
        _minLevel: minLevel,
        _fields,
      });
    },

    /**
     * Creates a sibling logger that prepends structured key-value fields to
     * every log line.  Useful for per-request or per-thread tracing.
     *
     * @param {Record<string, unknown>} fields
     * @returns {Logger}
     *
     * @example
     * const log = logger.withFields({ threadID: '123', attempt: 1 });
     * log.info('Sending message');
     * // → … [Kaisha:API] INFO  threadID=123 attempt=1 Sending message
     */
    withFields(fields) {
      return createLogger({
        namespace,
        _minLevel: minLevel,
        _fields:   { ...(_fields ?? {}), ...fields },
      });
    },
  };
}

module.exports = { createLogger };
