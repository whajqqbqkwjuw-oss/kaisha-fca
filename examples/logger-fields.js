'use strict';

/**
 * Example: Logger withFields
 *
 * Demonstrates the new `withFields()` method on the logger, which prepends
 * structured key-value pairs to every log line for request tracing.
 *
 * Usage:
 *   node examples/logger-fields.js
 */

const { createLogger } = require('../src/logger');

function main() {
  const logger = createLogger({ namespace: 'Example', level: 'debug' });

  // Plain logger
  logger.info('Application started');

  // Child logger — inherits parent level and namespace
  const apiLogger = logger.child('API');
  apiLogger.debug('Fetching thread list');

  // withFields — adds threadID and attempt to every subsequent line
  const reqLogger = apiLogger.withFields({ threadID: '123456789', attempt: 1 });
  reqLogger.info('Sending message');
  reqLogger.warn('Rate limit approaching');
  reqLogger.error('Failed to send attachment');

  // Nested: child of a withFields logger
  const uploadLogger = reqLogger.child('Upload');
  uploadLogger.debug('Uploading 2 files');

  // Another withFields call adds more fields
  const traceLogger = logger.withFields({ traceID: 'abc-123' });
  traceLogger.info('Health check passed');

  console.log('\nLogger example complete.');
}

main();
