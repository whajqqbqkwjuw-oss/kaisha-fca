'use strict';

/**
 * @module mqtt
 * @description
 * Low-level MQTT-over-WebSocket transport for Messenger realtime events.
 *
 * This implementation intentionally builds MQTT packets directly instead
 * of depending on an MQTT client or an existing Messenger library.
 */

const WebSocket = require('ws');
const { sleep, randomInt } = require('./utils');

const MQTT_HOST = 'wss://edge-chat.messenger.com/chat';
const MQTT_KEEPALIVE = 10;

const CONNECT_PACKET_TYPE = 0x10;
const SUBSCRIBE_PACKET_TYPE = 0x82;
const PINGREQ_PACKET_TYPE = 0xC0;

function encodeMqttString(str) {
  const value = Buffer.from(String(str ?? ''), 'utf8');

  if (value.length > 0xffff) {
    throw new Error('MQTT string exceeds 65535 bytes');
  }

  const length = Buffer.allocUnsafe(2);
  length.writeUInt16BE(value.length, 0);

  return Buffer.concat([length, value]);
}

function encodeRemainingLength(length) {
  if (!Number.isInteger(length) || length < 0) {
    throw new Error('Invalid MQTT remaining length');
  }

  const bytes = [];
  let remaining = length;

  do {
    let encoded = remaining % 128;
    remaining = Math.floor(remaining / 128);

    if (remaining > 0) {
      encoded |= 0x80;
    }

    bytes.push(encoded);
  } while (remaining > 0);

  return Buffer.from(bytes);
}

function decodeRemainingLength(data, offset = 1) {
  let multiplier = 1;
  let value = 0;
  let position = offset;

  for (let i = 0; i < 4; i++) {
    if (position >= data.length) {
      throw new Error('Incomplete MQTT remaining-length field');
    }

    const byte = data[position++];

    value += (byte & 0x7f) * multiplier;

    if ((byte & 0x80) === 0) {
      return {
        value,
        offset: position,
      };
    }

    multiplier *= 128;
  }

  throw new Error('Malformed MQTT remaining-length field');
}

function buildConnectPacket(session) {
  const {
    userID,
    clientID,
    cookies = {},
  } = session.data;

  const cUser = cookies.c_user || userID;
  const xs = cookies.xs || '';

  if (!cUser) {
    throw new Error('Missing c_user/userID for MQTT authentication');
  }

  if (!xs) {
    throw new Error('Missing xs cookie for MQTT authentication');
  }

  const mqttClientID = String(clientID || '');

  const username = JSON.stringify({
    u: String(cUser),
    s: String(xs),

    cp: 3,
    ecp: 10,

    chat_on: true,
    fg: false,

    d: mqttClientID,
    ct: 'websocket',

    mqtt_sid: '',

    aid: '219994525426954',

    st: [
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
    ],

    pm: [],

    dc: '',
    no_auto_fg: true,

    gas: null,
    pack: [],

    locale: 'en_US',
  });

  /*
   * MQTT 3.1 / MQIsdp.
   *
   * Messenger-compatible implementations historically use:
   *
   * protocolId     = MQIsdp
   * protocolLevel  = 3
   * clean session   = true
   * username flag   = true
   */
  const variableHeader = Buffer.concat([
    encodeMqttString('MQIsdp'),
    Buffer.from([3]),
    Buffer.from([0xC2]),
    Buffer.from([
      (MQTT_KEEPALIVE >> 8) & 0xff,
      MQTT_KEEPALIVE & 0xff,
    ]),
  ]);

  /*
   * CONNECT payload:
   *
   * client identifier
   * username JSON
   */
  const payload = Buffer.concat([
    encodeMqttString(mqttClientID),
    encodeMqttString(username),
  ]);

  const remaining = encodeRemainingLength(
    variableHeader.length + payload.length
  );

  return Buffer.concat([
    Buffer.from([CONNECT_PACKET_TYPE]),
    remaining,
    variableHeader,
    payload,
  ]);
}

function buildSubscribePacket(subscriptions, packetID) {
  const id = Buffer.allocUnsafe(2);
  id.writeUInt16BE(packetID & 0xffff, 0);

  const topics = subscriptions.map(({ topic, qos = 0 }) => {
    return Buffer.concat([
      encodeMqttString(topic),
      Buffer.from([qos & 0x03]),
    ]);
  });

  const body = Buffer.concat([
    id,
    ...topics,
  ]);

  return Buffer.concat([
    Buffer.from([SUBSCRIBE_PACKET_TYPE]),
    encodeRemainingLength(body.length),
    body,
  ]);
}

function buildPingPacket() {
  return Buffer.from([PINGREQ_PACKET_TYPE, 0x00]);
}

function createMqttManager(
  session,
  logger,
  {
    maxReconnectAttempts = 10,
    reconnectBaseDelay = 2000,
  } = {}
) {
  let ws = null;
  let pingInterval = null;
  let connectTimeout = null;

  let reconnectAttempts = 0;
  let intentionallyClosed = false;
  let sessionReady = false;
  let packetIDCounter = 1;

  const handlers = new Map();

  let onConnectCallback = null;
  let onDisconnectCallback = null;
  let onErrorCallback = null;

  function on(topic, fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('MQTT handler must be a function');
    }

    if (!handlers.has(topic)) {
      handlers.set(topic, []);
    }

    handlers.get(topic).push(fn);
  }

  function dispatch(topic, payload) {
    const exact = handlers.get(topic) || [];
    const wildcard = handlers.get('*') || [];

    for (const fn of [...exact, ...wildcard]) {
      try {
        fn(payload, topic);
      } catch (err) {
        logger.error(
          `MQTT topic handler failed for ${topic}:`,
          err
        );
      }
    }
  }

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
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        ws.send(buildPingPacket());
        logger.debug('MQTT PINGREQ sent');
      } catch (err) {
        logger.warn('Failed to send MQTT PINGREQ:', err);
      }
    }, (MQTT_KEEPALIVE / 2) * 1000);

    if (typeof pingInterval.unref === 'function') {
      pingInterval.unref();
    }
  }

  function subscribeToTopics() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot subscribe: MQTT WebSocket is not open');
      return;
    }

    const topics = [
      { topic: '/t_ms', qos: 0 },
      { topic: '/thread_typing', qos: 0 },
      { topic: '/orca_typing_notifications', qos: 0 },
      { topic: '/orca_presence', qos: 0 },
      { topic: '/inbox', qos: 0 },
      { topic: '/mercury', qos: 0 },
      { topic: '/messaging_events', qos: 0 },
      { topic: '/webrtc', qos: 0 },
      { topic: '/br_sr', qos: 0 },
      { topic: '/sr_res', qos: 0 },
      { topic: '/pp', qos: 0 },
      { topic: '/webrtc_response', qos: 0 },
    ];

    const packet = buildSubscribePacket(
      topics,
      packetIDCounter++
    );

    ws.send(packet);

    logger.info(
      `MQTT SUBSCRIBE sent (${topics.length} topics)`
    );
  }

  function handleIncoming(data) {
    if (!Buffer.isBuffer(data)) {
      data = Buffer.from(data);
    }

    if (data.length < 2) {
      logger.warn('MQTT received an incomplete packet');
      return;
    }

    const packetType = (data[0] & 0xf0) >> 4;
    const flags = data[0] & 0x0f;

    let remaining;

    try {
      remaining = decodeRemainingLength(data);
    } catch (err) {
      logger.error('Failed to decode MQTT packet:', err);
      return;
    }

    logger.info(
      `MQTT RX: type=${packetType}, flags=0x${flags.toString(16)}, remaining=${remaining.value}, bytes=${data.length}`
    );

    /*
     * CONNACK
     */
    if (packetType === 2) {
      if (data.length < remaining.offset + 2) {
        logger.error('Invalid MQTT CONNACK packet');
        return;
      }

      const ackFlags = data[remaining.offset];
      const returnCode = data[remaining.offset + 1];

      logger.info(
        `MQTT CONNACK: flags=0x${ackFlags.toString(16)}, returnCode=${returnCode}`
      );

      clearConnectTimeout();

      if (returnCode !== 0) {
        sessionReady = false;

        const error = new Error(
          `MQTT CONNECT rejected by broker (return code ${returnCode})`
        );

        logger.error(error.message);

        if (onErrorCallback) {
          onErrorCallback(error);
        }

        return;
      }

      sessionReady = true;
      reconnectAttempts = 0;

      logger.info('MQTT session established successfully');

      startPing();
      subscribeToTopics();

      if (onConnectCallback) {
        onConnectCallback();
      }

      return;
    }

    /*
     * PUBLISH
     */
    if (packetType === 3) {
      let offset = remaining.offset;

      if (offset + 2 > data.length) {
        logger.warn('Invalid MQTT PUBLISH: missing topic length');
        return;
      }

      const topicLength = data.readUInt16BE(offset);
      offset += 2;

      if (offset + topicLength > data.length) {
        logger.warn('Invalid MQTT PUBLISH: incomplete topic');
        return;
      }

      const topic = data
        .subarray(offset, offset + topicLength)
        .toString('utf8');

      offset += topicLength;

      const qos = (data[0] & 0x06) >> 1;

      if (qos > 0) {
        if (offset + 2 > data.length) {
          logger.warn(
            'Invalid MQTT PUBLISH: missing packet identifier'
          );
          return;
        }

        offset += 2;
      }

      const payload = data.subarray(offset);

      logger.debug(
        `MQTT PUBLISH topic=${topic}, payload=${payload.length} bytes`
      );

      dispatch(topic, payload);
      return;
    }

    /*
     * PINGRESP
     */
    if (packetType === 13) {
      logger.debug('MQTT PINGRESP received');
      return;
    }

    /*
     * SUBACK
     */
    if (packetType === 9) {
      logger.debug('MQTT SUBACK received');
      return;
    }

    logger.debug(
      `Unhandled MQTT packet type=${packetType}`
    );
  }

  function connect(onConnect, onDisconnect, onError) {
    onConnectCallback = onConnect;
    onDisconnectCallback = onDisconnect;
    onErrorCallback = onError;

    intentionallyClosed = false;

    const { cookies = {}, clientID } = session.data;

    const cookieString = Object.entries(cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');

    const sid =
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const cid = encodeURIComponent(
      String(clientID || '')
    );

    /*
     * Messenger's WebSocket endpoint expects session/client
     * identifiers in the connection URL.
     */
    const mqttUrl =
      `${MQTT_HOST}?sid=${encodeURIComponent(sid)}&cid=${cid}`;

    logger.info('Connecting to Messenger MQTT broker…');
    logger.debug(
      `MQTT endpoint: ${MQTT_HOST}?sid=...&cid=...`
    );

    ws = new WebSocket(mqttUrl, {
      headers: {
        Cookie: cookieString,
        Origin: 'https://www.messenger.com',
        Referer: 'https://www.messenger.com/',
        Host: 'edge-chat.messenger.com',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/138.0.0.0 Safari/537.36',
      },

      protocolVersion: 13,

      handshakeTimeout: 30_000,
    });

    sessionReady = false;
    clearConnectTimeout();
    stopPing();

    ws.on('open', () => {
      logger.info(
        'WebSocket open, sending MQTT CONNECT…'
      );

      try {
        const packet = buildConnectPacket(session);

        logger.info(
          `MQTT CONNECT packet created (${packet.length} bytes)`
        );

        /*
         * Do NOT log the packet hex because it contains
         * authentication material.
         */
        ws.send(packet);
      } catch (err) {
        logger.error(
          'Failed to create/send MQTT CONNECT:',
          err
        );

        if (onErrorCallback) {
          onErrorCallback(err);
        }

        return;
      }

      clearConnectTimeout();

      connectTimeout = setTimeout(() => {
        if (
          !sessionReady &&
          ws &&
          ws.readyState === WebSocket.OPEN
        ) {
          logger.warn(
            'MQTT CONNACK timeout; closing stale connection'
          );

          try {
            ws.close(1002, 'CONNACK timeout');
          } catch {}
        }
      }, 15_000);

      if (typeof connectTimeout.unref === 'function') {
        connectTimeout.unref();
      }
    });

    // ✅ Pinalitan ang ws.on('message') block
    ws.on('message', (data) => {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

      if (buffer.length === 0) {
        logger.warn('MQTT RX: empty packet');
        return;
      }

      const packetType = (buffer[0] & 0xF0) >> 4;
      const flags = buffer[0] & 0x0F;

      logger.info(
        `MQTT RX: ${buffer.length} bytes, type=${packetType}, flags=0x${flags.toString(16)}`
      );

      // Safe diagnostic: only show the first bytes, never cookies/auth data.
      logger.debug(
        `MQTT RX HEX: ${buffer.toString('hex').slice(0, 64)}`
      );

      if (packetType === 2) {
        if (buffer.length >= 4) {
          const returnCode = buffer[3];

          logger.info(
            `MQTT CONNACK received, returnCode=${returnCode}`
          );

          if (returnCode === 0) {
            logger.info('MQTT broker accepted CONNECT');
          } else {
            logger.error(
              `MQTT broker rejected CONNECT with return code ${returnCode}`
            );
          }
        } else {
          logger.warn('MQTT CONNACK packet is too short');
        }
      }

      handleIncoming(buffer);
    });

    ws.on('close', async (code, reason) => {
      clearConnectTimeout();
      stopPing();

      // ✅ In-update ang close message format
      const closeReason = Buffer.isBuffer(reason)
        ? reason.toString('utf8')
        : String(reason || '');

      const msg =
        `MQTT connection closed: code=${code}, reason=${closeReason || 'none'}`;

      logger.warn(msg);

      sessionReady = false;

      if (onDisconnectCallback) {
        onDisconnectCallback(code);
      }

      if (
        intentionallyClosed ||
        reconnectAttempts >= maxReconnectAttempts
      ) {
        if (
          !intentionallyClosed &&
          reconnectAttempts >= maxReconnectAttempts &&
          onErrorCallback
        ) {
          onErrorCallback(
            new Error(
              'Maximum MQTT reconnect attempts reached'
            )
          );
        }

        return;
      }

      reconnectAttempts++;

      const delay = Math.min(
        reconnectBaseDelay *
          Math.pow(2, reconnectAttempts - 1) +
          randomInt(0, 500),
        30_000
      );

      logger.info(
        `Reconnecting in ${delay}ms ` +
        `(attempt ${reconnectAttempts}/${maxReconnectAttempts})…`
      );

      await sleep(delay);

      if (!intentionallyClosed) {
        connect(
          onConnect,
          onDisconnect,
          onError
        );
      }
    });

    ws.on('error', (err) => {
      logger.error(
        `MQTT WebSocket error: ${err?.message || err}`
      );

      if (err?.stack) {
        logger.debug(err.stack);
      }

      /*
       * ws normally emits close after error. We do not
       * reconnect here directly to avoid duplicate reconnects.
       */
      if (onErrorCallback && sessionReady) {
        onErrorCallback(err);
      }
    });
  }

  function disconnect() {
    intentionallyClosed = true;
    sessionReady = false;

    clearConnectTimeout();
    stopPing();

    if (ws) {
      try {
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close(1000, 'Client disconnect');
        }
      } catch {}

      ws = null;
    }

    logger.info(
      'MQTT connection closed by client'
    );
  }

  function isConnected() {
    return (
      ws !== null &&
      ws.readyState === WebSocket.OPEN &&
      sessionReady
    );
  }

  return {
    connect,
    disconnect,
    isConnected,
    on,
  };
}

module.exports = {
  createMqttManager,
};