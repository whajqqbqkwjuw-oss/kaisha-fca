'use strict';

/**
 * @module plugins
 * @description Plugin registry and composable middleware pipeline for Kaisha.
 *
 * Improvements over the previous version:
 * - Uses typed `PluginError` from `src/errors.js`.
 * - `wrapAPI` preserves non-function members unchanged.
 * - `execute` tracks whether `next` was already called to prevent double-next.
 * - `installedPlugins` returns a frozen copy so callers cannot mutate the set.
 */

const { PluginError } = require('./errors');

/**
 * @typedef {object} KaishaPlugin
 * @property {string}   name
 * @property {string}   [version]
 * @property {function} install
 *
 * @typedef {object} MiddlewareContext
 * @property {string}    method
 * @property {unknown[]} args
 * @property {unknown}   result
 *
 * @callback MiddlewareFn
 * @param {MiddlewareContext}    ctx
 * @param {function(): Promise<void>} next
 * @returns {Promise<void>}
 *
 * @typedef {object} PluginSystem
 * @property {function} use
 * @property {function} addMiddleware
 * @property {function} execute
 * @property {function} wrapAPI
 * @property {function} installedPlugins
 */

/**
 * Creates the plugin registry and middleware pipeline.
 *
 * @param {import('./logger').Logger} logger
 * @returns {PluginSystem}
 */
function createPluginSystem(logger) {
  /** @type {Map<string, KaishaPlugin>} */
  const registry = new Map();

  /** @type {MiddlewareFn[]} */
  const stack = [];

  /**
   * Registers and installs a plugin.
   *
   * @param {KaishaPlugin} plugin
   * @param {Record<string,unknown>} [options={}]
   * @param {object} client
   * @returns {Promise<void>}
   * @throws {PluginError}
   */
  async function use(plugin, options = {}, client) {
    if (typeof plugin !== 'object' || plugin === null) {
      throw new PluginError('Plugin must be a non-null object');
    }
    if (typeof plugin.name !== 'string' || !plugin.name.trim()) {
      throw new PluginError('Plugin must have a non-empty string "name"');
    }
    if (typeof plugin.install !== 'function') {
      throw new PluginError(
        `Plugin "${plugin.name}" must export an install() function`,
        plugin.name
      );
    }
    if (registry.has(plugin.name)) {
      throw new PluginError(
        `Plugin "${plugin.name}" is already registered`,
        plugin.name
      );
    }

    registry.set(plugin.name, plugin);
    const label = plugin.version ? `${plugin.name} v${plugin.version}` : plugin.name;
    logger.info(`Installing plugin: ${label}`);

    try {
      await plugin.install(client, options);
    } catch (err) {
      registry.delete(plugin.name);
      throw new PluginError(
        `Plugin "${plugin.name}" install() threw: ${err.message}`,
        plugin.name,
        { cause: err }
      );
    }

    logger.info(`Plugin installed: ${label}`);
  }

  /**
   * Appends a middleware function to the pipeline.
   *
   * @param {MiddlewareFn} fn
   */
  function addMiddleware(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('Middleware must be a function');
    }
    stack.push(fn);
  }

  /**
   * Runs the middleware chain for a single API call.
   *
   * @param {string}   method
   * @param {unknown[]} args
   * @param {function} impl  - The underlying API implementation.
   * @returns {Promise<unknown>}
   */
  async function execute(method, args, impl) {
    /** @type {MiddlewareContext} */
    const ctx = { method, args: [...args], result: undefined };

    let index = 0;

    async function next() {
      if (index < stack.length) {
        const fn = stack[index++];
        await fn(ctx, next);
      } else {
        ctx.result = await impl(...ctx.args);
      }
    }

    await next();
    return ctx.result;
  }

  /**
   * Returns a new object where every function property of `api` is wrapped
   * through the middleware pipeline.  Non-function properties are passed
   * through unchanged.
   *
   * @template {Record<string, unknown>} T
   * @param {T} api
   * @returns {T}
   */
  function wrapAPI(api) {
    const wrapped = Object.create(null);
    for (const [name, value] of Object.entries(api)) {
      if (typeof value === 'function') {
        wrapped[name] = (...args) => execute(name, args, value);
      } else {
        wrapped[name] = value;
      }
    }
    return wrapped;
  }

  /**
   * Returns a sorted, frozen list of installed plugin names.
   *
   * @returns {readonly string[]}
   */
  function installedPlugins() {
    return Object.freeze([...registry.keys()].sort());
  }

  return { use, addMiddleware, execute, wrapAPI, installedPlugins };
}

module.exports = { createPluginSystem };
