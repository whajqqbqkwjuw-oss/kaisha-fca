'use strict';

/**
 * @module kaisha
 * @description Kaisha — Facebook Messenger Library v1.2.0
 *
 * Entry point.  Exports `login` and every public utility so consumers can
 * import precisely what they need.
 *
 * @author Aldwin Padronia
 * @license MIT
 * @version 1.2.0
 */

const { createLogger } = require('./logger');
const { createHttpClient } = require('./http');
const { createSession, loadFromAppState } = require('./session');
const { loginWithCredentials, loginWithAppState } = require('./login');
const { createMqttManager } = require('./mqtt');
const { createAPI } = require('./api');
const { attachListener } = require('./listener');
const { KaishaEventEmitter } = require('./events');
const { createPluginSystem } = require('./plugins');
const { createHealthMonitor } = require('./health');
const { loadConfig } = require('./config');
const { createRequestManager } = require('./request');
const { createCacheManager } = require('./cache');
const { createRetryManager } = require('./retry');
const {
  createSecureStorage,
  createCredentialVault,
  createEncryptedCache,
  createTokenManager,
  backupSession,
  restoreSession,
} = require('./secure');
const errors = require('./errors');

/**
 * @typedef {object} KaishaClient
 * @property {KaishaEventEmitter}                   events
 * @property {import('./api').MessengerAPI}          api
 * @property {import('./session').Session}           session
 * @property {import('./plugins').PluginSystem}      plugins
 * @property {import('./health').HealthMonitorInstance} health
 * @property {import('./request').RequestManager}   request
 * @property {function(): Promise<void>}            listen
 * @property {function(): void}                     disconnect
 * @property {function(): boolean}                  isConnected
 * @property {function(import('./plugins').KaishaPlugin, object=): Promise<void>} use
 * @property {function(import('./plugins').MiddlewareFn): void} addMiddleware
 */

/**
 * Creates and connects a Kaisha Messenger client.
 *
 * @param {import('./login').KaishaCredentials}          credentials
 * @param {Partial<import('./config').KaishaConfig>}     [configOverrides={}]
 * @returns {Promise<KaishaClient>}
 *
 * @throws {import('./errors').AuthenticationError}
 * @throws {import('./errors').SessionError}
 * @throws {import('./errors').ConfigurationError}
 *
 * @example
 * const { login } = require('./src');
 * const client = await login({ type: 'appstate', appstate });
 * await client.listen();
 * client.events.on('message', (e) => console.log(e.body));
 */
async function login(credentials, configOverrides = {}) {
  const cfg = loadConfig(configOverrides);
  const logger = createLogger({ namespace: 'Kaisha', level: cfg.logLevel });

  logger.info('Kaisha v1.2.0 initializing…');

  const httpClient = createHttpClient({
    timeout: cfg.timeout,
    maxRetries: cfg.maxRetries,
    retryDelay: cfg.retryDelay,
    userAgent: cfg.userAgent,
    logger: logger.child('HTTP'),
  });

  let session;

  if (credentials.type === 'email') {
    if (!credentials.email || !credentials.password) {
      throw new errors.AuthenticationError(
        'credentials.email and credentials.password are required for email login'
      );
    }
    session = await loginWithCredentials({ email: credentials.email, password: credentials.password },
      httpClient,
      logger.child('Login')
    );
  } else if (credentials.type === 'appstate') {
    if (!Array.isArray(credentials.appstate)) {
      throw new errors.AuthenticationError(
        'credentials.appstate must be an array for appstate login'
      );
    }
    session = await loginWithAppState(
      credentials.appstate,
      httpClient,
      logger.child('Login')
    );
  } else {
    throw new errors.AuthenticationError(
      `Unknown credentials.type: "${credentials.type}". Use "email" or "appstate".`
    );
  }

  if (!session.isValid()) {
    throw new errors.SessionError(
      'Authentication succeeded but session validation failed'
    );
  }

  // Build the request manager — used by api.js and exposed on the client
  const requestManager = createRequestManager(
    session,
    httpClient,
    logger.child('Request'),
    {
      maxRetries: cfg.maxRetries,
      retryDelay: cfg.retryDelay,
      cacheTtlMs: 30_000,
      maxCacheSize: 200,
    }
  );

  const emitter = new KaishaEventEmitter();
  const pluginSystem = createPluginSystem(logger.child('Plugins'));
  const rawAPI = createAPI(session, httpClient, logger.child('API'));
  const api = pluginSystem.wrapAPI(rawAPI);

  const mqttManager = createMqttManager(session, logger.child('MQTT'), {
    maxReconnectAttempts: cfg.maxReconnectAttempts,
    reconnectBaseDelay: cfg.reconnectBaseDelay,
  });

  attachListener(mqttManager, emitter, session.data.userID, logger.child('Listener'));

  // ── Auto-read ─────────────────────────────────────────────────────────────
  if (cfg.autoRead || cfg.autoSeen) {
    emitter.on('message', async (event) => {
      try {
        await api.markAsRead(event.threadID);
      } catch (err) {
        logger.warn(`Auto-read failed for thread ${event.threadID}: ${err.message}`);
      }
    });
  }

  // ── Health monitor ────────────────────────────────────────────────────────
  const hc = cfg.health;

  const healthMonitor = createHealthMonitor({
    isConnected: mqttManager.isConnected,
    logger: logger.child('Health'),
    config: {
      intervalMs: hc.intervalMs,
      timeoutMs: hc.timeoutMs,
      degradedThreshold: hc.degradedThreshold,
      unhealthyThreshold: hc.unhealthyThreshold,
      autoRecover: hc.autoRecover,
      recoverAfterFails: hc.recoverAfterFails,

      onStatusChange(r) {
        logger.warn(`Connection health changed: ${r.status}`);
        if (r.status !== 'healthy') emitter.emit('reconnecting');
      },

      async recoverFn() {
        logger.info('Recovery: reconnecting MQTT…');
        mqttManager.disconnect();
        await new Promise((resolve, reject) => {
          mqttManager.connect(
            () => { emitter.emit('connected');
              resolve(); },
            () => {},
            reject
          );
        });
      },
    },
  });

  // ── Client ────────────────────────────────────────────────────────────────

  /** @returns {Promise<void>} */
  function listen() {
    return new Promise((resolve, reject) => {
      mqttManager.connect(
        () => {
          if (hc.enabled) healthMonitor.start();
          emitter.emit('connected');
          emitter.emit('ready');
          resolve();
        },
        (code) => {
          emitter.emit('disconnected', code);
          if (!mqttManager.isConnected()) emitter.emit('reconnecting');
        },
        (err) => {
          emitter.emit('error', err);
          reject(err);
        }
      );
    });
  }

  function disconnect() {
    healthMonitor.stop();
    mqttManager.disconnect();
    requestManager.clearCache();
    emitter.removeAllListeners();
    logger.info('Kaisha client disconnected');
  }

  /**
   * @param {import('./plugins').KaishaPlugin} plugin
   * @param {object} [opts={}]
   */
  const use = (plugin, opts = {}) => pluginSystem.use(plugin, opts, client);

  /** @param {import('./plugins').MiddlewareFn} fn */
  const addMiddleware = (fn) => pluginSystem.addMiddleware(fn);

  /** @type {KaishaClient} */
  const client = {
    events: emitter,
    api,
    session,
    plugins: pluginSystem,
    health: healthMonitor,
    request: requestManager,
    listen,
    disconnect,
    isConnected: mqttManager.isConnected,
    use,
    addMiddleware,
  };

  logger.info(`Kaisha client ready (user: ${session.data.userID})`);
  return client;
}

module.exports = {
  // Primary
  login,
  // Session
  createSession,
  loadFromAppState,
  // Managers (public utility APIs)
  createCacheManager,
  createRetryManager,
  createRequestManager,
  // Security
  createSecureStorage,
  createCredentialVault,
  createEncryptedCache,
  createTokenManager,
  backupSession,
  restoreSession,
  // Logger
  createLogger,
  // Typed errors
  ...errors,
};
