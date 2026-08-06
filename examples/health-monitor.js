'use strict';

/**
 * Example: Connection Health Monitoring
 *
 * Connects to the Messenger MQTT broker and runs the built-in health monitor,
 * which checks connection state every 30 seconds (configurable) and
 * automatically recovers the session if the connection drops.
 *
 * The example shows:
 *   - Reading the health report programmatically
 *   - Responding to status-change events
 *   - Triggering a manual health check
 *   - Configuring auto-recovery thresholds
 *
 * Usage:
 *   node examples/health-monitor.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const sessionPath = path.resolve(__dirname, '../session.json');
  if (!fs.existsSync(sessionPath)) {
    console.error(`session.json not found at ${sessionPath}. Run examples/login.js first.`);
    process.exit(1);
  }

  const appstate = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

  const client = await kaisha.login(
    { type: 'appstate', appstate },
    {
      logLevel: 'debug',
      health: {
        enabled:            true,
        intervalMs:         15_000,   // check every 15 seconds
        timeoutMs:          8_000,    // 8 second per-check timeout
        degradedThreshold:  2,        // 2 fails → 'degraded'
        unhealthyThreshold: 4,        // 4 fails → 'unhealthy'
        autoRecover:        true,
        recoverAfterFails:  4,        // trigger recovery after 4 consecutive fails
      },
    }
  );

  console.log('Authenticated as user:', client.session.data.userID);

  // ── Event listeners ───────────────────────────────────────────────────────
  client.events.on('ready', () => {
    console.log('\n✓ Connected and listening.\n');

    // Print initial health report
    printReport(client.health.report());
  });

  client.events.on('disconnected', (code) => {
    console.log(`\n⚠ Disconnected (code ${code}). Reconnection in progress…`);
  });

  client.events.on('reconnecting', () => {
    console.log('↻ Reconnecting…');
  });

  client.events.on('error', (err) => {
    console.error('✗ Fatal error:', err.message);
    process.exit(1);
  });

  client.events.on('message', (event) => {
    console.log(`[Message] ${event.senderID}: ${event.body.slice(0, 60)}`);
  });

  // ── Periodic report printout ──────────────────────────────────────────────
  const reportInterval = setInterval(() => {
    const r = client.health.report();
    printReport(r);

    if (r.status === 'unhealthy') {
      console.warn('⚠ Connection is unhealthy. Auto-recovery is in progress if enabled.');
    }
  }, 30_000);

  reportInterval.unref();

  // ── Manual check 5 seconds after connecting ───────────────────────────────
  setTimeout(async () => {
    console.log('\nRunning manual health check…');
    const r = await client.health.check();
    console.log(`Manual check result: ${r.status} (isConnected: ${r.isConnected})`);
  }, 5_000);

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  process.on('SIGINT', () => {
    console.log('\nShutting down…');
    clearInterval(reportInterval);
    client.disconnect();
    process.exit(0);
  });

  await client.listen();
}

/**
 * Pretty-prints a HealthReport to the console.
 *
 * @param {import('../src/health').HealthReport} r
 */
function printReport(r) {
  const uptime  = Math.floor(r.uptimeMs / 1000);
  const lastOk  = r.lastSuccessAt > 0
    ? new Date(r.lastSuccessAt).toLocaleTimeString()
    : 'never';

  console.log('─────────────────────────────────');
  console.log(`Health status:   ${r.status.toUpperCase()}`);
  console.log(`Connected:       ${r.isConnected}`);
  console.log(`Uptime:          ${uptime}s`);
  console.log(`Total checks:    ${r.totalChecks}`);
  console.log(`Total failures:  ${r.totalFailures}`);
  console.log(`Consec. fails:   ${r.consecutiveFails}`);
  console.log(`Last success:    ${lastOk}`);
  console.log('─────────────────────────────────\n');
}

main().catch((err) => {
  console.error('Startup error:', err.message);
  process.exit(1);
});
