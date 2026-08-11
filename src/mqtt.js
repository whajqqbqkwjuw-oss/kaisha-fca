'use strict';

/**
 * @module mqtt
 * @description
 * Low-level MQTT-over-WebSocket transport for Messenger realtime events.
 *
 * This module builds MQTT packets directly and does not depend on an MQTT
 * client library or any existing Messenger wrapper library.
 *
 * MQTT protocol: 3.1.1 (protocol name "MQTT" / protocol level 4)
 * Transport: WebSocket (wss) via the ws package
 * Endpoint: wss://edge-chat.messenger.com/chat
 *
 * Connect flags used: 0x82
 *   Bit 7 = Username flag (0x80) — authentication JSON is in the username field
 *   Bit 1 = Clean Session (0x02)
 *
 * Prior bug: the code used 0x42 which set the Password flag (bit 6 = 0x40)
 * instead of the Username flag (bit 7 = 0x80).  The Messenger broker
 * authenticates via the username field; sending the credentials as the
 * password field causes CONNACK returnCode=5 (Not Authorized).
 */

const WebSocket = require('ws');
const { sleep, randomInt } = require('./utils');

const MQTT_HOST = 'wss://edge-chat.messenger.com/chat';

const MQTT_KEEPALIVE         = 60;
const MQTT_CONNECT_TIMEOUT   = 20_000;
const MQTT_HANDSHAKE_CLOSE_CODE = 1002;

/*
 * MQTT packet type constants (first nibble of first byte).
 */
const CONNECT_PACKET_TYPE   = 0x10;
const SUBSCRIBE_PACKET_TYPE = 0x82;
const PINGREQ_PACKET_TYPE   = 0xC0;

/*
 * MQTT connect flags byte.
 *
 * MQTT 3.1 flags byte layout (MSB → LSB):
 *   Bit 7: Username flag  = 0x80
 *   Bit 6: Password flag  = 0x40
 *   Bit 5: Will Retain    = 0x20
 *   Bit 4: Will QoS MSB   = 0x10
 *   Bit 3: Will QoS LSB   = 0x08
 *   Bit 2: Will flag      = 0x04
 *   Bit 1: Clean Session  = 0x02
 *   Bit 0: Reserved       = 0x01 (must be 0)
 *
 * We use Username (0x80) + Clean Session (0x02) = 0x82.
 * The authentication JSON is placed in the username field of the payload.
 * No password field is sent.
 *
 * IMPORTANT: 0x42 (former value) sets Password flag (0x40) + Clean Session —
 * this is wrong and causes the Messenger broker to return CONNACK code 5.
 */
const MQTT_CONNECT_FLAGS = 0x82;  // Username + Clean Session

const DEFAULT_TOPICS = [
  '/t_ms',
  '/thread_typing',
  '/orca_typing_notifications',
  '/orca_presence',
  '/inbox',
  '/mercury',
  '/messaging_events',
  '/webrtc',
  '/br_sr',
  '/sr_res',
  '/pp',
  '/webrtc_response',
];

// ── MQTT encoding helpers ─────────────────────────────────────────────────────

/**
 * Encodes a string as an MQTT UTF-8 string (2-byte big-endian length prefix
 * followed by the UTF-8 bytes).
 *
 * @param {string} value
 * @returns {Buffer}
 */
function encodeMqttString(value) {
  const buffer = Buffer.from(String(value ?? ''), 'utf8');

  if (buffer.length > 0xffff) {
    throw new Error('MQTT string exceeds 65535 bytes');
  }

  const length = Buffer.allocUnsafe(2);
  length.writeUInt16BE(buffer.length, 0);

  return Buffer.concat([length, buffer]);
}

/**
 * Encodes the MQTT remaining-length field using the variable-length encoding
 * defined in the MQTT 3.1 specification.
 *
 * @param {number} length
 * @returns {Buffer}
 */
function encodeRemainingLength(length) {
  if (!Number.isInteger(length) || length < 0 || length > 268435455) {
    throw new Error(`Invalid MQTT remaining length: ${length}`);
  }

  const bytes = [];

  do {
    let encoded = length % 128;
    length = Math.floor(length / 128);

    if (length > 0) {
      encoded |= 0x80;
    }

    bytes.push(encoded);
  } while (length > 0);

  return Buffer.from(bytes);
}

/**
 * Decodes the MQTT variable-length remaining-length field starting at byte
 * `start` (default: 1, the byte immediately after the fixed-header type byte).
 *
 * Returns `null` when the buffer does not yet contain enough bytes to decode
 * the field (indicating a partial / incomplete packet).
 *
 * Throws when the encoding is malformed (continuation bit set on four bytes).
 *
 * @param {Buffer} buffer
 * @param {number} [start=1]
 * @returns {{ value: number, offset: number } | null}
 */
function decodeRemainingLength(buffer, start = 1) {
  let multiplier = 1;
  let value = 0;
  let offset = start;

  for (let i = 0; i < 4; i++) {
    if (offset >= buffer.length) {
      return null;
    }

    const byte = buffer[offset++];

    value += (byte & 0x7f) * multiplier;

    if ((byte & 0x80) === 0) {
      return { value, offset };
    }

    multiplier *= 128;
  }

  throw new Error('Malformed MQTT remaining-length field');
}

// ── Session identifier ────────────────────────────────────────────────────────

/**
 * Generates a unique MQTT session identifier used in both the WebSocket URL
 * `?sid=` parameter and the `mqtt_sid` field of the CONNECT username JSON.
 *
 * @returns {string}
 */
function createSessionIdentifier() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 14);
  return `${timestamp}-${random}`;
}

// ── Session value helpers ─────────────────────────────────────────────────────

/**
 * Reads a named value from `session.data`, returning `fallback` when the
 * value is absent or null.
 *
 * @param {object} session
 * @param {string} name
 * @param {string} [fallback='']
 * @returns {string}
 */
function getSessionValue(session, name, fallback = '') {
  if (!session || !session.data) return fallback;

  const value = session.data[name];

  if (value === undefined || value === null) return fallback;

  return String(value);
}

/**
 * Reads a named cookie from `session.data.cookies`.
 *
 * @param {object} session
 * @param {string} name
 * @returns {string}
 */
function getCookie(session, name) {
  const cookies =
    session &&
    session.data &&
    session.data.cookies;

  if (!cookies || typeof cookies !== 'object') return '';

  return cookies[name] == null ? '' : String(cookies[name]);
}

/**
 * URL-decodes a cookie value when it appears to be URL-encoded.
 *
 * Facebook's `xs` session cookie is URL-encoded in HTTP Set-Cookie headers
 * (e.g. `2%3AToken%3A...`).  The Messenger MQTT broker expects the raw
 * (decoded) form `2:Token:...` in the CONNECT username JSON.
 *
 * If the value does not contain a `%` character decoding is skipped.
 * If `decodeURIComponent` throws the original value is returned unchanged.
 *
 * @param {string} value
 * @returns {string}
 */
function decodeCookieValue(value) {
  if (typeof value !== 'string' || !value.includes('%')) {
    return value;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// ── Packet builders ───────────────────────────────────────────────────────────

/**
 * Builds a complete MQTT 3.1.1 CONNECT packet.
 *
 * The packet structure is:
 *   [Fixed header: type 0x10 + remaining length]
 *   [Protocol name: "MQTT" / level 4 (MQTT 3.1.1)]
 *   [Protocol level: 3]
 *   [Connect flags: 0x82 = Username + Clean Session]
 *   [Keepalive: 60 s]
 *   [Payload: client ID, username JSON]
 *
 * The username JSON carries all Messenger authentication material.
 * Authentication data is validated before packet construction.
 *
 * @param {object} session
 * @param {string} mqttSessionID
 * @returns {Buffer}
 * @throws {Error} when required authentication material is missing.
 */
function buildConnectPacket(session, mqttSessionID) {
  const userID =
    getSessionValue(session, 'userID') ||
    getCookie(session, 'c_user');

  const clientID = getSessionValue(session, 'clientID');

  /*
   * The xs cookie is the session credential used by Messenger's MQTT broker
   * for authentication.  It may be URL-encoded in the cookie jar; decode it
   * to the raw form the broker expects.
   */
  const xsRaw = getCookie(session, 'xs');
  const xs = decodeCookieValue(xsRaw);

  if (!userID) {
    throw new Error(
      'Missing userID / c_user cookie — cannot authenticate MQTT session'
    );
  }

  if (!xs) {
    throw new Error(
      'Missing xs cookie — cannot authenticate MQTT session'
    );
  }

  if (!clientID) {
    throw new Error(
      'Missing clientID — cannot construct MQTT CONNECT packet'
    );
  }

  if (!mqttSessionID) {
    throw new Error(
      'Missing MQTT session identifier — cannot construct MQTT CONNECT packet'
    );
  }

  /*
   * The username JSON is the entire authentication payload for Messenger MQTT.
   * It must be placed in the MQTT username field (connect flag bit 7 = 0x80).
   *
   * Authentication material (xs) is intentionally not logged.
   */
  const username = JSON.stringify({
    u:           userID,
    s:           xs,

    cp:          3,
    ecp:         10,

    chat_on:     true,
    fg:          false,

    d:           clientID,
    ct:          'websocket',

    /*
     * The MQTT session identifier must match the ?sid= query parameter in the
     * WebSocket URL.  Both are set to the same value generated in connect().
     */
    mqtt_sid:    mqttSessionID,

    aid:         219994525426954,   // integer, not string — broker validates JSON type

    st:          DEFAULT_TOPICS,

    pm:          [],

    dc:          '',
    no_auto_fg:  true,

    gas:         null,
    pack:        [],

    locale:      'en_US',
  });

  /*
   * MQTT 3.1.1 variable header:
   *   Protocol name:  "MQTT" (4 bytes, length-prefixed = 6 bytes total) — MQTT 3.1.1
   *   Protocol level: 4 (1 byte) — MQTT 3.1.1
   *   Connect flags:  0x82 = Username (0x80) + Clean Session (0x02)
   *   Keepalive:      60 s (2 bytes big-endian)
   *
   *   NOTE: MQTT 3.1 (MQIsdp / level 3) causes broker to return CONNACK code 21
   *   which is Messenger's proprietary "wrong protocol version" rejection.
   */
  const variableHeader = Buffer.concat([
    encodeMqttString('MQTT'),
    Buffer.from([4]),
    Buffer.from([MQTT_CONNECT_FLAGS]),
    Buffer.from([
      (MQTT_KEEPALIVE >> 8) & 0xff,
      MQTT_KEEPALIVE & 0xff,
    ]),
  ]);

  /*
   * MQTT 3.1.1 CONNECT payload (username flag set, no password flag):
   *   Client Identifier (length-prefixed UTF-8)
   *   Username / auth JSON (length-prefixed UTF-8)
   */
  const payload = Buffer.concat([
    encodeMqttString(clientID),
    encodeMqttString(username),
  ]);

  const body = Buffer.concat([variableHeader, payload]);

  return Buffer.concat([
    Buffer.from([CONNECT_PACKET_TYPE]),
    encodeRemainingLength(body.length),
    body,
  ]);
}

/**
 * Builds a MQTT SUBSCRIBE packet.
 *
 * @param {Array<{ topic: string, qos: number }>} subscriptions
 * @param {number} packetID
 * @returns {Buffer}
 */
function buildSubscribePacket(subscriptions, packetID) {
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    throw new Error('Cannot build MQTT SUBSCRIBE without topics');
  }

  const id = Buffer.allocUnsafe(2);
  id.writeUInt16BE(packetID & 0xffff, 0);

  const topicBuffers = subscriptions.map((entry) => {
    if (!entry || !entry.topic) {
      throw new Error('Invalid MQTT subscription topic');
    }

    const qos = Number.isInteger(entry.qos) ? entry.qos : 0;

    if (qos < 0 || qos > 2) {
      throw new Error(`Invalid MQTT subscription QoS: ${qos}`);
    }

    return Buffer.concat([
      encodeMqttString(entry.topic),
      Buffer.from([qos]),
    ]);
  });

  const body = Buffer.concat([id, ...topicBuffers]);

  return Buffer.concat([
    Buffer.from([SUBSCRIBE_PACKET_TYPE]),
    encodeRemainingLength(body.length),
    body,
  ]);
}

/**
 * Builds a MQTT PINGREQ packet.
 *
 * @returns {Buffer}
 */
function buildPingPacket() {
  return Buffer.from([PINGREQ_PACKET_TYPE, 0x00]);
}

// ── Packet parsing helpers ────────────────────────────────────────────────────

/**
 * Extracts the MQTT packet type (high nibble of first byte).
 *
 * @param {Buffer} buffer
 * @returns {number}
 */
function packetType(buffer) {
  return (buffer[0] & 0xf0) >> 4;
}

/**
 * Extracts the MQTT packet flags (low nibble of first byte).
 *
 * @param {Buffer} buffer
 * @returns {number}
 */
function packetFlags(buffer) {
  return buffer[0] & 0x0f;
}

/**
 * Parses a CONNACK packet body.
 *
 * CONNACK returnCode meanings:
 *   0 = Connection accepted
 *   1 = Unacceptable protocol version
 *   2 = Identifier rejected
 *   3 = Server unavailable
 *   4 = Bad username or password
 *   5 = Not authorized
 *
 * @param {Buffer} buffer - Complete CONNACK packet buffer.
 * @returns {{ valid: boolean, flags?: number, returnCode?: number, reason?: string }}
 */
function parseConnack(buffer) {
  const remaining = decodeRemainingLength(buffer);

  if (!remaining) {
    return { valid: false, reason: 'Incomplete CONNACK packet' };
  }

  if (
    remaining.value < 2 ||
    remaining.offset + remaining.value > buffer.length
  ) {
    return { valid: false, reason: 'Invalid CONNACK length' };
  }

  const offset = remaining.offset;

  return {
    valid:      true,
    flags:      buffer[offset],
    returnCode: buffer[offset + 1],
  };
}

// ── MQTT manager ──────────────────────────────────────────────────────────────

/**
 * Creates an MQTT-over-WebSocket manager that connects to the Messenger
 * realtime broker, handles MQTT framing, dispatches incoming messages to
 * registered handlers, and manages reconnection.
 *
 * @param {object} session                       - Hydrated Kaisha session.
 * @param {import('./logger').Logger} logger
 * @param {object}  [opts={}]
 * @param {number}  [opts.maxReconnectAttempts=10]
 * @param {number}  [opts.reconnectBaseDelay=2000]
 * @returns {{ connect: Function, disconnect: Function, isConnected: Function, on: Function }}
 */
function createMqttManager(
  session,
  logger,
  {
    maxReconnectAttempts = 10,
    reconnectBaseDelay   = 2_000,
  } = {}
) {
  /*
   * Active WebSocket instance.  Setting ws to null signals that no socket is
   * owned; comparing ws === socket inside event handlers prevents stale
   * closures from triggering reconnect or double-processing on replaced sockets.
   */
  let ws = null;

  let pingInterval   = null;
  let connectTimeout = null;

  let reconnectAttempts = 0;
  let intentionallyClosed = false;
  let authFailure         = false;  // set on CONNACK returnCode 1-5; suppresses reconnect
  let sessionReady        = false;

  let packetIDCounter = 1;

  /*
   * MQTT packets can arrive split across WebSocket frames or multiple packets
   * can arrive in a single frame.  Accumulate raw bytes here and slice out
   * complete packets in the parser loop.
   */
  let receiveBuffer = Buffer.alloc(0);

  const handlers = new Map();

  let onConnectCallback    = null;
  let onDisconnectCallback = null;
  let onErrorCallback      = null;

  // ── Topic dispatch ──────────────────────────────────────────────────────────

  /**
   * Registers a handler for an MQTT topic or the wildcard `'*'`.
   *
   * @param {string}   topic
   * @param {Function} fn
   */
  function on(topic, fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('MQTT handler must be a function');
    }

    if (!handlers.has(topic)) handlers.set(topic, []);

    handlers.get(topic).push(fn);
  }

  /**
   * Dispatches a received payload to all handlers registered for `topic` and
   * to wildcard handlers registered under `'*'`.
   *
   * @param {string} topic
   * @param {Buffer} payload
   */
  function dispatch(topic, payload) {
    const exact    = handlers.get(topic) || [];
    const wildcard = handlers.get('*')   || [];

    for (const fn of [...exact, ...wildcard]) {
      try {
        fn(payload, topic);
      } catch (err) {
        logger.error(`MQTT topic handler failed for ${topic}:`, err);
      }
    }
  }

  // ── Timer management ────────────────────────────────────────────────────────

  function clearConnectTimeout() {
    if (connectTimeout) {
      clearTimeout(connectTimeout);
      connectTimeout = null;
    }
  }

  function stopPing() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  }

  function startPing() {
    stopPing();

    pingInterval = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN || !sessionReady) return;

      try {
        ws.send(buildPingPacket());
        logger.debug('MQTT PINGREQ sent');
      } catch (err) {
        logger.warn('Failed to send MQTT PINGREQ:', err);
      }
    }, (MQTT_KEEPALIVE / 2) * 1000);

    if (typeof pingInterval.unref === 'function') pingInterval.unref();
  }

  // ── Subscribe ───────────────────────────────────────────────────────────────

  function subscribeToTopics() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionReady) {
      logger.warn('Cannot subscribe: MQTT session is not ready');
      return;
    }

    const subscriptions = DEFAULT_TOPICS.map((topic) => ({
      topic,
      qos: 0,
    }));

    const packet = buildSubscribePacket(subscriptions, packetIDCounter++);

    ws.send(packet);

    logger.info(`MQTT SUBSCRIBE sent (${subscriptions.length} topics)`);
  }

  // ── Packet handlers ─────────────────────────────────────────────────────────

  /**
   * Handles a received CONNACK packet.
   *
   * ReturnCode 0: session established — start keepalive, subscribe, fire callback.
   * ReturnCode 1-5: authentication or protocol rejection — mark authFailure,
   *   fire error callback, close socket.  Does NOT initiate reconnect.
   *
   * @param {Buffer} buffer
   */
  function handleConnack(buffer) {
    const result = parseConnack(buffer);

    if (!result.valid) {
      logger.error(`Invalid MQTT CONNACK: ${result.reason}`);
      return;
    }

    logger.info(
      `MQTT CONNACK: flags=0x${result.flags.toString(16)}, returnCode=${result.returnCode}`
    );

    clearConnectTimeout();

    if (result.returnCode !== 0) {
      /*
       * Codes 1-5 are broker-level rejections (protocol, identifier, auth).
       * None of them will be resolved by reconnecting with the same credentials.
       * Mark authFailure so the close handler suppresses reconnect.
       */
      sessionReady = false;
      authFailure  = true;

      const descriptions = {
        1: 'Unacceptable protocol version',
        2: 'Identifier rejected',
        3: 'Server unavailable',
        4: 'Bad username or password',
        5: 'Not authorized',
      };

      const description =
        descriptions[result.returnCode] ||
        `Unknown error (code ${result.returnCode})`;

      const error = new Error(
        `MQTT CONNECT rejected by broker: ${description} (return code ${result.returnCode})`
      );

      logger.error(error.message);

      if (onErrorCallback) {
        onErrorCallback(error);
      }

      /*
       * Close the WebSocket cleanly.  The close handler will see authFailure=true
       * and will not attempt to reconnect.
       */
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.close(
            MQTT_HANDSHAKE_CLOSE_CODE,
            `MQTT return code ${result.returnCode}`
          );
        } catch {
          /* ignore close errors */
        }
      }

      return;
    }

    sessionReady      = true;
    reconnectAttempts = 0;
    authFailure       = false;

    logger.info('MQTT session established successfully');

    startPing();
    subscribeToTopics();

    if (onConnectCallback) {
      try {
        onConnectCallback();
      } catch (err) {
        logger.error('MQTT onConnect callback failed:', err);
      }
    }
  }

  /**
   * Handles a received PUBLISH packet.
   *
   * Extracts the topic and payload, then dispatches to registered handlers.
   *
   * @param {Buffer} buffer
   * @param {{ value: number, offset: number }} remaining
   */
  function handlePublish(buffer, remaining) {
    let offset = remaining.offset;

    if (offset + 2 > buffer.length) {
      logger.warn('Invalid MQTT PUBLISH: missing topic length');
      return;
    }

    const topicLength = buffer.readUInt16BE(offset);
    offset += 2;

    if (offset + topicLength > buffer.length) {
      logger.warn('Invalid MQTT PUBLISH: incomplete topic');
      return;
    }

    const topic = buffer
      .subarray(offset, offset + topicLength)
      .toString('utf8');

    offset += topicLength;

    const qos = (buffer[0] & 0x06) >> 1;

    if (qos === 1 || qos === 2) {
      if (offset + 2 > buffer.length) {
        logger.warn('Invalid MQTT PUBLISH: missing packet identifier');
        return;
      }
      offset += 2;
    }

    const payload = buffer.subarray(offset);

    logger.debug(`MQTT PUBLISH topic=${topic}, payload=${payload.length} bytes`);

    dispatch(topic, payload);
  }

  /**
   * Dispatches a single complete MQTT packet to the appropriate handler.
   *
   * @param {Buffer} buffer - One complete MQTT packet.
   */
  function handlePacket(buffer) {
    if (!buffer || buffer.length < 2) return;

    const type  = packetType(buffer);
    const flags = packetFlags(buffer);

    let remaining;

    try {
      remaining = decodeRemainingLength(buffer);
    } catch (err) {
      logger.error('Failed to decode MQTT packet:', err);
      return;
    }

    if (!remaining) return;

    const packetEnd = remaining.offset + remaining.value;

    if (packetEnd > buffer.length) {
      logger.warn('MQTT packet body is incomplete');
      return;
    }

    logger.debug(
      `MQTT RX: type=${type}, flags=0x${flags.toString(16)}, ` +
      `remaining=${remaining.value}, bytes=${buffer.length}`
    );

    switch (type) {
      case 2:  // CONNACK
        handleConnack(buffer);
        break;

      case 3:  // PUBLISH
        handlePublish(buffer, remaining);
        break;

      case 9:  // SUBACK
        logger.debug('MQTT SUBACK received');
        break;

      case 13: // PINGRESP
        logger.debug('MQTT PINGRESP received');
        break;

      default:
        logger.debug(`Unhandled MQTT packet type=${type}`);
        break;
    }
  }

  /**
   * Processes incoming WebSocket data.
   *
   * Data is appended to the receive buffer.  Complete MQTT packets are sliced
   * out and dispatched; any remainder is retained for the next call.
   *
   * This handles:
   *   - one WebSocket frame = one MQTT packet (common case)
   *   - one WebSocket frame containing multiple MQTT packets
   *   - an MQTT packet split across multiple WebSocket frames
   *
   * @param {Buffer | ArrayBuffer | string} data
   */
  function processIncomingData(data) {
    const incoming = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data);

    if (incoming.length === 0) return;

    receiveBuffer =
      receiveBuffer.length === 0
        ? incoming
        : Buffer.concat([receiveBuffer, incoming]);

    while (receiveBuffer.length >= 2) {
      let remaining;

      try {
        remaining = decodeRemainingLength(receiveBuffer);
      } catch (err) {
        logger.error('MQTT RX parser error:', err);
        receiveBuffer = Buffer.alloc(0);
        return;
      }

      if (!remaining) {
        // Not enough bytes yet to decode the remaining-length field.
        return;
      }

      const packetLength = remaining.offset + remaining.value;

      if (receiveBuffer.length < packetLength) {
        // Full packet body has not arrived yet; wait for more data.
        return;
      }

      const packet = receiveBuffer.subarray(0, packetLength);
      receiveBuffer = receiveBuffer.subarray(packetLength);

      handlePacket(packet);
    }
  }

  // ── WebSocket factory ───────────────────────────────────────────────────────

  /**
   * Creates the WebSocket connection to the Messenger MQTT broker.
   *
   * Cookies are serialised from the session and sent as the Cookie header.
   * The WebSocket origin and referer headers are set to messenger.com.
   *
   * @param {string} mqttSessionID
   * @returns {WebSocket}
   */
  function createWebSocket(mqttSessionID) {
    const cookies =
      session &&
      session.data &&
      session.data.cookies
        ? session.data.cookies
        : {};

    const cookieString = Object.entries(cookies)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('; ');

    const clientID = getSessionValue(session, 'clientID');

    if (!clientID) {
      throw new Error(
        'Cannot create MQTT WebSocket without session clientID'
      );
    }

    /*
     * Both sid and cid query parameters must match the values used in the
     * MQTT CONNECT packet username JSON (mqtt_sid and d fields respectively).
     */
    const mqttUrl =
      `${MQTT_HOST}?sid=${encodeURIComponent(mqttSessionID)}` +
      `&cid=${encodeURIComponent(clientID)}`;

    logger.info('Connecting to Messenger MQTT broker…');
    logger.debug(`MQTT endpoint: ${MQTT_HOST}?sid=...&cid=...`);

    const socket = new WebSocket(mqttUrl, {
      headers: {
        Cookie:          cookieString,
        Origin:          'https://www.messenger.com',
        Referer:         'https://www.messenger.com/',
        Pragma:          'no-cache',
        'Cache-Control': 'no-cache',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/138.0.0.0 Safari/537.36',
      },
      handshakeTimeout:    30_000,
      perMessageDeflate:   false,
    });

    return socket;
  }

  // ── Public connect / disconnect ─────────────────────────────────────────────

  /**
   * Opens an MQTT-over-WebSocket connection to the Messenger broker.
   *
   * Registers exactly one `message` handler on the WebSocket; all MQTT packet
   * parsing goes through `processIncomingData`.
   *
   * @param {Function} [onConnect]    - Called when CONNACK returnCode=0 is received.
   * @param {Function} [onDisconnect] - Called when the connection closes.
   * @param {Function} [onError]      - Called on authentication failures or fatal errors.
   */
  function connect(onConnect, onDisconnect, onError) {
    onConnectCallback    = onConnect;
    onDisconnectCallback = onDisconnect;
    onErrorCallback      = onError;

    intentionallyClosed = false;
    authFailure         = false;

    clearConnectTimeout();
    stopPing();

    receiveBuffer = Buffer.alloc(0);

    /*
     * One MQTT session identifier per connection attempt.
     * Used in the WebSocket URL ?sid= and in the CONNECT username mqtt_sid.
     */
    const mqttSessionID = createSessionIdentifier();

    let socket;

    try {
      socket = createWebSocket(mqttSessionID);
    } catch (err) {
      logger.error('Failed to create MQTT WebSocket:', err);
      if (onErrorCallback) onErrorCallback(err);
      return;
    }

    ws = socket;
    sessionReady = false;

    // ── WebSocket: open ───────────────────────────────────────────────────────

    socket.on('open', () => {
      if (ws !== socket) return;  // stale socket guard

      logger.info('WebSocket open, sending MQTT CONNECT…');

      let packet;

      try {
        packet = buildConnectPacket(session, mqttSessionID);
      } catch (err) {
        logger.error('Failed to create MQTT CONNECT:', err);
        if (onErrorCallback) onErrorCallback(err);
        try { socket.close(MQTT_HANDSHAKE_CLOSE_CODE, 'CONNECT build failed'); } catch { /**/ }
        return;
      }

      logger.info(`MQTT CONNECT packet created (${packet.length} bytes)`);

      try {
        socket.send(packet);
      } catch (err) {
        logger.error('Failed to send MQTT CONNECT:', err);
        if (onErrorCallback) onErrorCallback(err);
        return;
      }

      /*
       * Start a timeout.  If CONNACK is not received within
       * MQTT_CONNECT_TIMEOUT milliseconds we close the socket, which will
       * trigger the close handler and a reconnect.
       */
      clearConnectTimeout();

      connectTimeout = setTimeout(() => {
        if (
          !sessionReady &&
          ws === socket &&
          socket.readyState === WebSocket.OPEN
        ) {
          logger.warn(
            'MQTT CONNACK timeout; broker did not acknowledge CONNECT'
          );
          try {
            socket.close(MQTT_HANDSHAKE_CLOSE_CODE, 'CONNACK timeout');
          } catch { /**/ }
        }
      }, MQTT_CONNECT_TIMEOUT);

      if (typeof connectTimeout.unref === 'function') {
        connectTimeout.unref();
      }
    });

    // ── WebSocket: message (single authoritative parser) ──────────────────────

    socket.on('message', (data) => {
      if (ws !== socket) return;  // stale socket guard
      processIncomingData(data);
    });

    // ── WebSocket: close ──────────────────────────────────────────────────────

    socket.on('close', async (code, reason) => {
      if (ws === socket) ws = null;

      clearConnectTimeout();
      stopPing();

      sessionReady  = false;
      receiveBuffer = Buffer.alloc(0);

      const closeReason =
        Buffer.isBuffer(reason)
          ? reason.toString('utf8')
          : String(reason || '');

      logger.warn(
        `MQTT connection closed: code=${code}, reason=${closeReason || 'none'}`
      );

      if (onDisconnectCallback) {
        try {
          onDisconnectCallback(code);
        } catch (err) {
          logger.error('MQTT onDisconnect callback failed:', err);
        }
      }

      /*
       * Suppress reconnect in three cases:
       *
       *   intentionallyClosed — caller called disconnect()
       *   authFailure         — broker rejected CONNECT with code 1-5;
       *                          reconnecting with the same credentials is useless
       *   maxReconnectAttempts exhausted — give up and report error
       */
      if (intentionallyClosed) {
        return;
      }

      if (authFailure) {
        /*
         * onError was already fired in handleConnack for auth failures;
         * do not fire it again here.
         */
        logger.error(
          'MQTT authentication rejected by broker — not reconnecting'
        );
        return;
      }

      if (reconnectAttempts >= maxReconnectAttempts) {
        if (onErrorCallback) {
          onErrorCallback(
            new Error('Maximum MQTT reconnect attempts reached')
          );
        }
        return;
      }

      reconnectAttempts++;

      const exponentialDelay =
        reconnectBaseDelay * Math.pow(2, reconnectAttempts - 1);

      const delay = Math.min(
        exponentialDelay + randomInt(0, 500),
        30_000
      );

      logger.info(
        `Reconnecting in ${delay}ms ` +
        `(attempt ${reconnectAttempts}/${maxReconnectAttempts})…`
      );

      await sleep(delay);

      if (intentionallyClosed || authFailure) return;

      connect(onConnectCallback, onDisconnectCallback, onErrorCallback);
    });

    // ── WebSocket: error ──────────────────────────────────────────────────────

    socket.on('error', (err) => {
      logger.error(`MQTT WebSocket error: ${err?.message || err}`);

      if (err?.stack) logger.debug(err.stack);

      /*
       * ws emits close after most connection errors.  Reconnection is handled
       * exclusively in the close handler to prevent duplicate reconnects.
       * Only surface the error to the caller when the session was previously
       * established (unexpected mid-session error).
       */
      if (onErrorCallback && sessionReady) {
        onErrorCallback(err);
      }
    });
  }

  /**
   * Closes the current MQTT connection without reconnecting.
   */
  function disconnect() {
    intentionallyClosed = true;
    sessionReady        = false;
    authFailure         = false;

    clearConnectTimeout();
    stopPing();

    receiveBuffer     = Buffer.alloc(0);
    reconnectAttempts = 0;

    const socket = ws;
    ws = null;

    if (socket) {
      try {
        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.close(1000, 'Client disconnect');
        }
      } catch { /**/ }
    }

    logger.info('MQTT connection closed by client');
  }

  /**
   * Returns true when there is an open WebSocket and the MQTT session has
   * been established (CONNACK returnCode=0 received).
   *
   * @returns {boolean}
   */
  function isConnected() {
    return (
      ws !== null &&
      ws.readyState === WebSocket.OPEN &&
      sessionReady
    );
  }

  return { connect, disconnect, isConnected, on };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  createMqttManager,

  /*
   * Internal exports for unit testing.
   * These are not part of the public API; the underscore prefix signals that.
   */
  _encodeRemainingLength: encodeRemainingLength,
  _decodeRemainingLength: decodeRemainingLength,
  _encodeMqttString:      encodeMqttString,
  _buildConnectPacket:    buildConnectPacket,
  _buildSubscribePacket:  buildSubscribePacket,
  _buildPingPacket:       buildPingPacket,
  _parseConnack:          parseConnack,
  _decodeCookieValue:     decodeCookieValue,
  _MQTT_CONNECT_FLAGS:    MQTT_CONNECT_FLAGS,
};