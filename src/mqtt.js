'use strict';

/**
 * @module mqtt
 * @description Manages the MQTT-over-WebSocket connection to Facebook's
 * Messenger real-time infrastructure, including message parsing and
 * automatic reconnection.
 */

const WebSocket = require('ws');
const { sleep, randomInt } = require('./utils');

const MQTT_HOST      = 'wss://edge-chat.facebook.com/chat';
const MQTT_KEEPALIVE = 60;
const CONNECT_PACKET_TYPE = 0x10;
const SUBSCRIBE_PACKET_TYPE = 0x82;
const PINGREQ_PACKET_TYPE = 0xC0;

/**
 * Encodes a UTF-8 string as an MQTT-prefixed length string (2-byte big-endian
 * length prefix followed by the raw bytes).
 *
 * @param {string} str
 * @returns {Buffer}
 */
function encodeMqttString(str) {
  const strBuf = Buffer.from(str, 'utf8');
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(strBuf.length, 0);
  return Buffer.concat([lenBuf, strBuf]);
}

/**
 * Encodes the MQTT remaining-length field using the variable-length encoding
 * defined in the MQTT specification.
 *
 * @param {number} length
 * @returns {Buffer}
 */
function encodeRemainingLength(length) {
  const bytes = [];
  let remaining = length;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

/**
 * Builds a minimal MQTT CONNECT packet for Facebook's Messenger broker.
 *
 * @param {import('./session').Session} session
 * @returns {Buffer}
 */
function buildConnectPacket(session) {
  const { userID, clientID, cookies } = session.data;
  const cUser = cookies['c_user'] || userID;
  const xs    = cookies['xs'] || '';
  const locale = 'en_US';

  // Payload: clientID as MQTT client identifier
  const clientIDBuf = encodeMqttString(clientID);

  // CONNECT variable header: Protocol name, level, flags, keepalive
  const protocolName  = encodeMqttString('MQTToT');
  const protocolLevel = Buffer.from([3]); // MQTT 3.1
  const connectFlags  = Buffer.from([0xC2]); // clean session + username flag
  const keepalive     = Buffer.alloc(2);
  keepalive.writeUInt16BE(MQTT_KEEPALIVE, 0);

  // Username is a JSON payload Facebook uses for auth
  const username = JSON.stringify({
    u: cUser,
    s: xs,
    cp: 3,
    ecp: 10,
    chat_on: true,
    fg: false,
    d: clientID,
    ct: 'websocket',
    mqtt_sid: '',
    aid: 219994525426954,
    st: [],
    pm: [],
    dc: '',
    no_auto_fg: true,
    gas: null,
    pack: [],
    locale,
  });

  const usernameBuf = encodeMqttString(username);

  const variableHeader = Buffer.concat([
    protocolName,
    protocolLevel,
    connectFlags,
    keepalive,
  ]);

  const payload = Buffer.concat([clientIDBuf, usernameBuf]);
  const remaining = encodeRemainingLength(variableHeader.length + payload.length);

  return Buffer.concat([
    Buffer.from([CONNECT_PACKET_TYPE]),
    remaining,
    variableHeader,
    payload,
  ]);
}

/**
 * Builds an MQTT SUBSCRIBE packet for the given topics.
 *
 * @param {Array<{topic:string, qos:number}>} subscriptions
 * @param {number} packetID
 * @returns {Buffer}
 */
function buildSubscribePacket(subscriptions, packetID) {
  const packetIDBuf = Buffer.alloc(2);
  packetIDBuf.writeUInt16BE(packetID, 0);

  const topicBufs = subscriptions.map(({ topic, qos }) =>
    Buffer.concat([encodeMqttString(topic), Buffer.from([qos])])
  );

  const payload  = Buffer.concat(topicBufs);
  const body     = Buffer.concat([packetIDBuf, payload]);
  const remaining = encodeRemainingLength(body.length);

  return Buffer.concat([
    Buffer.from([SUBSCRIBE_PACKET_TYPE]),
    remaining,
    body,
  ]);
}

/**
 * Builds an MQTT PINGREQ packet.
 *
 * @returns {Buffer}
 */
function buildPingPacket() {
  return Buffer.from([PINGREQ_PACKET_TYPE, 0x00]);
}

/**
 * Creates an MQTT manager that maintains the WebSocket connection to Facebook
 * Messenger and exposes a message callback interface.
 *
 * @param {import('./session').Session} session
 * @param {import('./logger').Logger} logger
 * @param {object} options
 * @param {number} [options.maxReconnectAttempts=10]
 * @param {number} [options.reconnectBaseDelay=2000]
 * @returns {MqttManager}
 */
function createMqttManager(session, logger, {
  maxReconnectAttempts = 10,
  reconnectBaseDelay   = 2_000,
} = {}) {
  /** @type {WebSocket|null} */
  let ws                  = null;
  let pingInterval        = null;
  let connectTimeout      = null;
  let reconnectAttempts   = 0;
  let intentionallyClosed = false;
  let sessionReady        = false;
  let packetIDCounter     = 1;

  /** @type {Map<string, Function[]>} */
  const handlers = new Map();

  /**
   * Registers a callback for raw MQTT topic messages.
   *
   * @param {string} topic
   * @param {Function} fn - Called with (payload: Buffer)
   */
  function on(topic, fn) {
    if (!handlers.has(topic)) handlers.set(topic, []);
    handlers.get(topic).push(fn);
  }

  /**
   * Dispatches a received payload to the appropriate topic handlers.
   *
   * @param {string} topic
   * @param {Buffer} payload
   */
  function dispatch(topic, payload) {
    const fns = handlers.get(topic) ?? handlers.get('*') ?? [];
    for (const fn of fns) fn(payload);
  }

  /**
   * Parses a raw incoming MQTT packet buffer and dispatches PUBLISH messages.
   *
   * @param {Buffer} data
   */
  function handleIncoming(data) {
    if (!Buffer.isBuffer(data)) data = Buffer.from(data);

    const packetType = (data[0] & 0xF0) >> 4;

    // CONNACK = 2
    if (packetType === 2) {
      logger.debug('MQTT CONNACK received, subscribing to topics…');
      sessionReady = true;
      clearConnectTimeout();
      reconnectAttempts = 0;
      startPing();
      subscribeToTopics();
      onConnect();
      return;
    }

    // PUBLISH = 3
    if (packetType === 3) {
      let offset = 1;

      // Decode remaining length
      let multiplier = 1;
      let remainingLength = 0;
      let byte;
      do {
        byte = data[offset++];
        remainingLength += (byte & 0x7F) * multiplier;
        multiplier *= 128;
      } while (byte & 0x80);

      // Topic length
      const topicLength = data.readUInt16BE(offset);
      offset += 2;
      const topic = data.slice(offset, offset + topicLength).toString('utf8');
      offset += topicLength;

      // QoS level from fixed header
      const qos = (data[0] & 0x06) >> 1;
      if (qos > 0) {
        // Skip packet identifier
        offset += 2;
      }

      const payload = data.slice(offset);
      dispatch(topic, payload);
      return;
    }

    // PINGRESP = 13
    if (packetType === 13) {
      logger.debug('MQTT PINGRESP received');
    }
  }

  /**
   * Sends the MQTT SUBSCRIBE packet for all required Messenger topics.
   */
  function subscribeToTopics() {
    const topics = [
      { topic: '/t_ms',          qos: 0 },
      { topic: '/thread_typing', qos: 0 },
      { topic: '/orca_typing_notifications', qos: 0 },
      { topic: '/orca_presence',             qos: 0 },
      { topic: '/inbox',                     qos: 0 },
      { topic: '/mercury',                   qos: 0 },
      { topic: '/messaging_events',          qos: 0 },
      { topic: '/webrtc',                    qos: 0 },
      { topic: '/br_sr',                     qos: 0 },
      { topic: '/sr_res',                    qos: 0 },
    ];

    const packet = buildSubscribePacket(topics, packetIDCounter++);
    ws.send(packet);
    logger.info('Subscribed to Messenger MQTT topics');
  }

  /**
   * Starts the PING interval to keep the MQTT connection alive.
   */
  function startPing() {
    clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(buildPingPacket());
        logger.debug('MQTT PINGREQ sent');
      }
    }, (MQTT_KEEPALIVE / 2) * 1000);
  }

  /**
   * Stops the PING interval.
   */
  function stopPing() {
    clearInterval(pingInterval);
    pingInterval = null;
  }

  /**
   * Stops the CONNACK watchdog timer.
   */
  function clearConnectTimeout() {
    clearTimeout(connectTimeout);
    connectTimeout = null;
  }

  /**
   * Opens the WebSocket connection and sends the MQTT CONNECT packet.
   *
   * @param {Function} onConnect - Called when the MQTT session is established.
   * @param {Function} onDisconnect - Called when the connection closes.
   * @param {Function} onError - Called with an Error on fatal errors.
   */
  function connect(onConnect, onDisconnect, onError) {
    const { cookies } = session.data;
    const cookieString = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    logger.info('Connecting to Messenger MQTT broker…');

    ws = new WebSocket(MQTT_HOST, {
      headers: {
        Cookie: cookieString,
        Origin: 'https://www.facebook.com',
        Host: 'edge-chat.facebook.com',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
      },
    });

    sessionReady = false;
    clearConnectTimeout();

    ws.on('open', () => {
      logger.info('WebSocket open, sending MQTT CONNECT…');
      ws.send(buildConnectPacket(session));

      clearConnectTimeout();
      connectTimeout = setTimeout(() => {
        if (!sessionReady && ws && ws.readyState === WebSocket.OPEN) {
          logger.warn('MQTT CONNACK timeout; closing stale socket');
          try {
            ws.close(1002, 'CONNACK timeout');
          } catch {}
        }
      }, 15000);

      if (connectTimeout.unref) {
        connectTimeout.unref();
      }
    });

    ws.on('message', (data) => {
      handleIncoming(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });

    ws.on('close', async (code, reason) => {
      logger.warn(`Close code: ${code}`);
      logger.warn(`Close reason: ${Buffer.isBuffer(reason) ? reason.toString() : reason}`);
      clearConnectTimeout();
      stopPing();
      const msg = `MQTT connection closed (code ${code}, reason: ${reason || 'none'})`;
      logger.warn(msg);
      onDisconnect(code);

      if (!intentionallyClosed && reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = Math.min(
          reconnectBaseDelay * Math.pow(2, reconnectAttempts - 1) +
            randomInt(0, 500),
          30_000
        );
        logger.info(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})…`);
        await sleep(delay);
        connect(onConnect, onDisconnect, onError);
      } else if (!intentionallyClosed && reconnectAttempts >= maxReconnectAttempts) {
        onError(new Error('Max MQTT reconnect attempts reached'));
      }
    });

    ws.on('error', (err) => {
      logger.error('WebSocket error:', err);
      logger.error(err?.stack || '');
      onError(err);
    });
  }

  /**
   * Gracefully closes the MQTT connection without triggering reconnection.
   */
  function disconnect() {
    intentionallyClosed = true;
    sessionReady = false;
    clearConnectTimeout();
    stopPing();
    if (ws) {
      ws.close(1000, 'Client disconnect');
      ws = null;
    }
    logger.info('MQTT connection closed by client');
  }

  /**
   * Returns whether the WebSocket is currently open.
   *
   * @returns {boolean}
   */
  function isConnected() {
    return ws !== null && ws.readyState === WebSocket.OPEN;
  }

  /**
   * @typedef {object} MqttManager
   * @property {function} connect
   * @property {function} disconnect
   * @property {function} isConnected
   * @property {function} on
   */
  return { connect, disconnect, isConnected, on };
}

module.exports = { createMqttManager };