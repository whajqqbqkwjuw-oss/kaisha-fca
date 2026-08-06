'use strict';

/**
 * @module health
 * @description Connection health monitoring and automatic session recovery.
 *
 * Improvements:
 * - `ConnectionError` is thrown on permanent failure.
 * - `unref()` called on the interval timer (Node.js 22 compatible).
 * - Recovery re-uses the existing `connect` pathway instead of duplicating it.
 * - `report()` returns a frozen snapshot to prevent mutation by callers.
 */

const { sleep } = require('./utils');
const { ConnectionError } = require('./errors');

/**
 * @typedef {'healthy'|'degraded'|'unhealthy'|'recovering'} HealthStatus
 *
 * @typedef {object} HealthReport
 * @property {HealthStatus} status
 * @property {boolean}      isConnected
 * @property {number}       consecutiveFails
 * @property {number}       totalChecks
 * @property {number}       totalFailures
 * @property {number}       uptimeMs
 * @property {number}       lastCheckAt
 * @property {number}       lastSuccessAt
 *
 * @typedef {object} HealthMonitorOptions
 * @property {number}   [intervalMs=30000]
 * @property {number}   [timeoutMs=10000]
 * @property {number}   [degradedThreshold=2]
 * @property {number}   [unhealthyThreshold=5]
 * @property {boolean}  [autoRecover=true]
 * @property {number}   [recoverAfterFails=5]
 * @property {function} [onStatusChange]
 * @property {function} [recoverFn]
 *
 * @typedef {object} HealthMonitorInstance
 * @property {function} start
 * @property {function} stop
 * @property {function} report
 * @property {function} check
 */

/**
 * @param {object} opts
 * @param {function}                    opts.isConnected
 * @param {import('./logger').Logger}   opts.logger
 * @param {HealthMonitorOptions}        [opts.config={}]
 * @returns {HealthMonitorInstance}
 */
function createHealthMonitor({ isConnected, logger, config = {} }) {
  const {
    intervalMs         = 30_000,
    timeoutMs          = 10_000,
    degradedThreshold  = 2,
    unhealthyThreshold = 5,
    autoRecover        = true,
    recoverAfterFails  = 5,
    onStatusChange,
    recoverFn,
  } = config;

  let timerHandle      = null;
  let startedAt        = null;
  let currentStatus    = /** @type {HealthStatus} */ ('healthy');
  let consecutiveFails = 0;
  let totalChecks      = 0;
  let totalFailures    = 0;
  let lastCheckAt      = 0;
  let lastSuccessAt    = 0;
  let recovering       = false;

  /** @param {number} fails @returns {HealthStatus} */
  function classify(fails) {
    if (fails < degradedThreshold)  return 'healthy';
    if (fails < unhealthyThreshold) return 'degraded';
    return 'unhealthy';
  }

  /** @returns {Readonly<HealthReport>} */
  function report() {
    return Object.freeze({
      status:           currentStatus,
      isConnected:      isConnected(),
      consecutiveFails,
      totalChecks,
      totalFailures,
      uptimeMs:         startedAt !== null ? Date.now() - startedAt : 0,
      lastCheckAt,
      lastSuccessAt,
    });
  }

  /** @returns {Promise<Readonly<HealthReport>>} */
  async function check() {
    totalChecks++;
    lastCheckAt = Date.now();

    let ok = false;
    try {
      ok = await Promise.race([
        Promise.resolve(isConnected()),
        sleep(timeoutMs).then(() => false),
      ]);
    } catch {
      ok = false;
    }

    const prev = currentStatus;

    if (ok) {
      consecutiveFails = 0;
      lastSuccessAt    = Date.now();
      currentStatus    = 'healthy';
    } else {
      consecutiveFails++;
      totalFailures++;
      currentStatus = recovering ? 'recovering' : classify(consecutiveFails);
      logger.warn(`Health check failed — ${consecutiveFails} consecutive fail(s), status: ${currentStatus}`);
    }

    const snap = report();
    if (currentStatus !== prev && typeof onStatusChange === 'function') {
      try { onStatusChange(snap); } catch { /* listener errors must not crash the monitor */ }
    }

    if (
      !ok && autoRecover && typeof recoverFn === 'function' &&
      consecutiveFails >= recoverAfterFails && !recovering
    ) {
      recovering    = true;
      currentStatus = 'recovering';
      logger.info('Health monitor triggering automatic session recovery…');

      try {
        await recoverFn(report());
        consecutiveFails = 0;
        lastSuccessAt    = Date.now();
        currentStatus    = 'healthy';
        logger.info('Automatic session recovery succeeded');
      } catch (err) {
        currentStatus = 'unhealthy';
        logger.error(`Automatic session recovery failed: ${err.message}`);
        throw new ConnectionError(
          `Session recovery failed: ${err.message}`,
          { cause: err }
        );
      } finally {
        recovering = false;
        try { if (typeof onStatusChange === 'function') onStatusChange(report()); } catch { /* ignore */ }
      }
    }

    return report();
  }

  function start() {
    if (timerHandle !== null) return;
    startedAt        = Date.now();
    consecutiveFails = 0;
    totalChecks      = 0;
    totalFailures    = 0;
    lastCheckAt      = 0;
    lastSuccessAt    = 0;
    currentStatus    = 'healthy';

    timerHandle = setInterval(async () => {
      try { await check(); } catch (err) {
        logger.error(`Health monitor check error: ${err.message}`);
      }
    }, intervalMs);

    timerHandle.unref?.();
    logger.info(`Health monitor started (interval: ${intervalMs}ms)`);
  }

  function stop() {
    if (timerHandle !== null) {
      clearInterval(timerHandle);
      timerHandle = null;
      logger.info('Health monitor stopped');
    }
  }

  return { start, stop, report, check };
}

module.exports = { createHealthMonitor };
