'use strict';

const WebSocket = require('ws');
const { sleep, randomInt } = require('./utils');

const DEFAULT_MQTT_HOST =
'wss://edge-chat.facebook.com/chat';

const MQTT_KEEPALIVE = 10;
const MQTT_CONNECT_TIMEOUT = 20000;
const MQTT_HANDSHAKE_CLOSE_CODE = 1002;

const CONNECT_PACKET_TYPE = 0x10;
const SUBSCRIBE_PACKET_TYPE = 0x82;
const PINGREQ_PACKET_TYPE = 0xc0;

const MQTT_CONNECT_FLAGS = 0x82;

const DEFAULT_USER_AGENT =
'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
'AppleWebKit/537.36 (KHTML, like Gecko) ' +
'Chrome/138.0.0.0 Safari/537.36';

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

/* -------------------------------------------------------------------------- /
/ MQTT encoding                                                              /
/ -------------------------------------------------------------------------- */

function encodeMqttString(value) {
const buffer = Buffer.from(
String(value ?? ''),
'utf8'
);

if (buffer.length > 0xffff) {
throw new Error(
'MQTT string exceeds 65535 bytes'
);
}

const length = Buffer.allocUnsafe(2);

length.writeUInt16BE(
buffer.length,
0
);

return Buffer.concat([
length,
buffer,
]);
}

function encodeRemainingLength(length) {
if (
!Number.isInteger(length) ||
length < 0 ||
length > 268435455
) {
throw new Error(
"Invalid MQTT remaining length: ${length}"
);
}

const bytes = [];

do {
let encoded =
length % 128;

length =
  Math.floor(
    length / 128
  );

if (length > 0) {
  encoded |= 0x80;
}

bytes.push(encoded);

} while (length > 0);

return Buffer.from(bytes);
}

function decodeRemainingLength(
buffer,
start = 1
) {
let multiplier = 1;
let value = 0;
let offset = start;

for (let i = 0; i < 4; i++) {
if (
offset >=
buffer.length
) {
return null;
}

const byte =
  buffer[offset++];

value +=
  (byte & 0x7f) *
  multiplier;

if (
  (byte & 0x80) === 0
) {
  return {
    value,
    offset,
  };
}

multiplier *= 128;

}

throw new Error(
'Malformed MQTT remaining-length field'
);
}

/* -------------------------------------------------------------------------- /
/ Session helpers                                                            /
/ -------------------------------------------------------------------------- */

function createSessionIdentifier() {
return String(
Math.floor(
Math.random() *
Number.MAX_SAFE_INTEGER
) + 1
);
}

function getSessionValue(
session,
name,
fallback = ''
) {
if (
!session ||
!session.data
) {
return fallback;
}

const value =
session.data[name];

if (
value === undefined ||
value === null
) {
return fallback;
}

return String(value);
}

function getCookie(
session,
name
) {
const cookies =
session &&
session.data &&
session.data.cookies;

if (
!cookies ||
typeof cookies !== 'object'
) {
return '';
}

if (
cookies[name] === undefined ||
cookies[name] === null
) {
return '';
}

return String(
cookies[name]
);
}

/* -------------------------------------------------------------------------- /
/ MQTT endpoint                                                              /
/ -------------------------------------------------------------------------- */

function getMqttEndpoint(
session
) {
let endpoint =
getSessionValue(
session,
'mqttEndpoint'
);

endpoint =
endpoint.replace(
/\//g,
'/'
);

if (!endpoint) {
endpoint =
DEFAULT_MQTT_HOST;
}

if (
!/^wss?:///i.test(
endpoint
)
) {
endpoint =
"wss://${endpoint}";
}

return endpoint;
}

function getMqttAppID(
session
) {
return (
getSessionValue(
session,
'mqttAppID'
) ||
'219994525426954'
);
}

function getMqttDeviceID(
session
) {
return (
getSessionValue(
session,
'mqttClientID'
) ||
getSessionValue(
session,
'clientID'
)
);
}

/* -------------------------------------------------------------------------- /
/ MQTT CONNECT                                                               /
/ -------------------------------------------------------------------------- */

function buildConnectPacket(
session,
mqttSessionID
) {
const userID =
getSessionValue(
session,
'userID'
) ||
getCookie(
session,
'c_user'
);

const deviceID =
getMqttDeviceID(
session
);

if (!userID) {
throw new Error(
'Missing userID / c_user cookie'
);
}

if (!deviceID) {
throw new Error(
'Missing Messenger MQTT device ID'
);
}

if (!mqttSessionID) {
throw new Error(
'Missing MQTT session ID'
);
}

const userAgent =
getSessionValue(
session,
'userAgent'
) ||
DEFAULT_USER_AGENT;

const appID =
getMqttAppID(
session
);

const username =
JSON.stringify({
u: userID,

  s:
    mqttSessionID,

  chat_on:
    true,

  fg:
    false,

  d:
    deviceID,

  ct:
    'websocket',

  aid:
    appID,

  mqtt_sid:
    '',

  cp:
    3,

  ecp:
    10,

  st:
    [],

  pm:
    [],

  dc:
    '',

  no_auto_fg:
    true,

  gas:
    null,

  pack:
    [],

  a:
    userAgent,
});

const variableHeader =
Buffer.concat([
encodeMqttString(
'MQIsdp'
),

  Buffer.from([
    3,
  ]),

  Buffer.from([
    MQTT_CONNECT_FLAGS,
  ]),

  Buffer.from([
    (MQTT_KEEPALIVE >> 8) &
      0xff,

    MQTT_KEEPALIVE &
      0xff,
  ]),
]);

const payload =
Buffer.concat([
encodeMqttString(
'mqttwsclient'
),

  encodeMqttString(
    username
  ),
]);

const body =
Buffer.concat([
variableHeader,
payload,
]);

return Buffer.concat([
Buffer.from([
CONNECT_PACKET_TYPE,
]),

encodeRemainingLength(
  body.length
),

body,

]);
}

/* -------------------------------------------------------------------------- /
/ MQTT SUBSCRIBE                                                             /
/ -------------------------------------------------------------------------- */

function buildSubscribePacket(
subscriptions,
packetID
) {
if (
!Array.isArray(
subscriptions
) ||
subscriptions.length === 0
) {
throw new Error(
'Cannot subscribe without topics'
);
}

const id =
Buffer.allocUnsafe(2);

id.writeUInt16BE(
packetID & 0xffff,
0
);

const topicBuffers =
subscriptions.map(
(entry) => {
if (
!entry ||
!entry.topic
) {
throw new Error(
'Invalid MQTT topic'
);
}

    const qos =
      Number.isInteger(
        entry.qos
      )
        ? entry.qos
        : 0;

    if (
      qos < 0 ||
      qos > 2
    ) {
      throw new Error(
        `Invalid MQTT QoS: ${qos}`
      );
    }

    return Buffer.concat([
      encodeMqttString(
        entry.topic
      ),

      Buffer.from([
        qos,
      ]),
    ]);
  }
);

const body =
Buffer.concat([
id,
...topicBuffers,
]);

return Buffer.concat([
Buffer.from([
SUBSCRIBE_PACKET_TYPE,
]),

encodeRemainingLength(
  body.length
),

body,

]);
}

/* -------------------------------------------------------------------------- /
/ MQTT PING                                                                  /
/ -------------------------------------------------------------------------- */

function buildPingPacket() {
return Buffer.from([
PINGREQ_PACKET_TYPE,
0x00,
]);
}

/* -------------------------------------------------------------------------- /
/ Packet helpers                                                             /
/ -------------------------------------------------------------------------- */

function getPacketType(
buffer
) {
return (
(buffer[0] & 0xf0) >>
4
);
}

function getPacketFlags(
buffer
) {
return (
buffer[0] & 0x0f
);
}

function parseConnack(
buffer
) {
const remaining =
decodeRemainingLength(
buffer
);

if (!remaining) {
return {
valid: false,
reason:
'Incomplete CONNACK',
};
}

if (
remaining.value < 2 ||
remaining.offset +
remaining.value >
buffer.length
) {
return {
valid: false,
reason:
'Invalid CONNACK length',
};
}

const offset =
remaining.offset;

return {
valid: true,

flags:
  buffer[offset],

returnCode:
  buffer[offset + 1],

};
}

/* -------------------------------------------------------------------------- /
/ MQTT manager                                                               /
/ -------------------------------------------------------------------------- */

function createMqttManager(
session,
logger,
{
maxReconnectAttempts = 10,
reconnectBaseDelay = 2000,
} = {}
) {
let ws = null;

let pingInterval =
null;

let connectTimeout =
null;

let reconnectAttempts =
0;

let intentionallyClosed =
false;

let authFailure =
false;

let sessionReady =
false;

let packetIDCounter =
1;

let receiveBuffer =
Buffer.alloc(0);

const handlers =
new Map();

let onConnectCallback =
null;

let onDisconnectCallback =
null;

let onErrorCallback =
null;

function on(
topic,
fn
) {
if (
typeof fn !==
'function'
) {
throw new TypeError(
'MQTT handler must be a function'
);
}

if (
  !handlers.has(topic)
) {
  handlers.set(
    topic,
    []
  );
}

handlers
  .get(topic)
  .push(fn);

}

function dispatch(
topic,
payload
) {
const exact =
handlers.get(topic) ||
[];

const wildcard =
  handlers.get('*') ||
  [];

for (
  const fn of [
    ...exact,
    ...wildcard,
  ]
) {
  try {
    fn(
      payload,
      topic
    );
  } catch (err) {
    logger.error(
      `MQTT topic handler failed for ${topic}:`,
      err
    );
  }
}

}

function clearConnectTimeout() {
if (
connectTimeout
) {
clearTimeout(
connectTimeout
);

  connectTimeout =
    null;
}

}

function stopPing() {
if (
pingInterval
) {
clearInterval(
pingInterval
);

  pingInterval =
    null;
}

}

function startPing() {
stopPing();

pingInterval =
  setInterval(
    () => {
      if (
        !ws ||
        ws.readyState !==
          WebSocket.OPEN ||
        !sessionReady
      ) {
        return;
      }

      try {
        ws.send(
          buildPingPacket()
        );

        logger.debug(
          'MQTT PINGREQ sent'
        );
      } catch (err) {
        logger.warn(
          'Failed to send MQTT PINGREQ:',
          err
        );
      }
    },

    (MQTT_KEEPALIVE / 2) *
      1000
  );

if (
  typeof pingInterval.unref ===
  'function'
) {
  pingInterval.unref();
}

}

function subscribeToTopics() {
if (
!ws ||
ws.readyState !==
WebSocket.OPEN ||
!sessionReady
) {
logger.warn(
'Cannot subscribe: MQTT session is not ready'
);

  return;
}

const subscriptions =
  DEFAULT_TOPICS.map(
    (topic) => ({
      topic,
      qos: 0,
    })
  );

const packet =
  buildSubscribePacket(
    subscriptions,
    packetIDCounter++
  );

ws.send(
  packet
);

logger.info(
  `MQTT SUBSCRIBE sent (${subscriptions.length} topics)`
);

}

function handleConnack(
buffer
) {
const result =
parseConnack(
buffer
);

if (
  !result.valid
) {
  logger.error(
    `Invalid MQTT CONNACK: ${result.reason}`
  );

  return;
}

logger.info(
  `MQTT CONNACK: flags=0x${result.flags.toString(16)}, ` +
  `returnCode=${result.returnCode}`
);

clearConnectTimeout();

if (
  result.returnCode !==
  0
) {
  sessionReady =
    false;

  authFailure =
    true;

  const descriptions = {
    1:
      'Unacceptable protocol version',

    2:
      'Identifier rejected',

    3:
      'Server unavailable',

    4:
      'Bad username or password',

    5:
      'Not authorized',
  };

  const description =
    descriptions[
      result.returnCode
    ] ||
    `Messenger broker rejected CONNECT with code ${result.returnCode}`;

  const error =
    new Error(
      'MQTT CONNECT rejected by broker: ' +
      `${description} ` +
      `(return code ${result.returnCode})`
    );

  logger.error(
    error.message
  );

  if (
    onErrorCallback
  ) {
    onErrorCallback(
      error
    );
  }

  if (
    ws &&
    ws.readyState ===
      WebSocket.OPEN
  ) {
    try {
      ws.close(
        MQTT_HANDSHAKE_CLOSE_CODE,
        `MQTT return code ${result.returnCode}`
      );
    } catch {
      // Ignore.
    }
  }

  return;
}

sessionReady =
  true;

reconnectAttempts =
  0;

authFailure =
  false;

logger.info(
  'MQTT session established successfully'
);

startPing();

subscribeToTopics();

if (
  onConnectCallback
) {
  try {
    onConnectCallback();
  } catch (err) {
    logger.error(
      'MQTT onConnect callback failed:',
      err
    );
  }
}

}

function handlePublish(
buffer,
remaining
) {
let offset =
remaining.offset;

if (
  offset + 2 >
  buffer.length
) {
  logger.warn(
    'Invalid MQTT PUBLISH: missing topic length'
  );

  return;
}

const topicLength =
  buffer.readUInt16BE(
    offset
  );

offset += 2;

if (
  offset +
    topicLength >
  buffer.length
) {
  logger.warn(
    'Invalid MQTT PUBLISH: incomplete topic'
  );

  return;
}

const topic =
  buffer
    .subarray(
      offset,
      offset +
        topicLength
    )
    .toString(
      'utf8'
    );

offset +=
  topicLength;

const qos =
  (buffer[0] &
    0x06) >>
  1;

if (
  qos === 1 ||
  qos === 2
) {
  if (
    offset + 2 >
    buffer.length
  ) {
    logger.warn(
      'Invalid MQTT PUBLISH: missing packet id'
    );

    return;
  }

  offset += 2;
}

const payload =
  buffer.subarray(
    offset
  );

logger.debug(
  `MQTT PUBLISH topic=${topic}, ` +
  `payload=${payload.length} bytes`
);

dispatch(
  topic,
  payload
);

}

function handlePacket(
buffer
) {
if (
!buffer ||
buffer.length < 2
) {
return;
}

const type =
  getPacketType(
    buffer
  );

const flags =
  getPacketFlags(
    buffer
  );

let remaining;

try {
  remaining =
    decodeRemainingLength(
      buffer
    );
} catch (err) {
  logger.error(
    'Failed to decode MQTT packet:',
    err
  );

  return;
}

if (!remaining) {
  return;
}

const packetEnd =
  remaining.offset +
  remaining.value;

if (
  packetEnd >
  buffer.length
) {
  logger.warn(
    'MQTT packet body is incomplete'
  );

  return;
}

logger.debug(
  `MQTT RX: type=${type}, ` +
  `flags=0x${flags.toString(16)}, ` +
  `remaining=${remaining.value}, ` +
  `bytes=${buffer.length}`
);

switch (type) {
  case 2:
    handleConnack(
      buffer
    );
    break;

  case 3:
    handlePublish(
      buffer,
      remaining
    );
    break;

  case 9:
    logger.debug(
      'MQTT SUBACK received'
    );
    break;

  case 13:
    logger.debug(
      'MQTT PINGRESP received'
    );
    break;

  default:
    logger.debug(
      `Unhandled MQTT packet type=${type}`
    );
    break;
}

}

function processIncomingData(
data
) {
const incoming =
Buffer.isBuffer(data)
? data
: Buffer.from(data);

if (
  incoming.length === 0
) {
  return;
}

if (
  receiveBuffer.length ===
  0
) {
  receiveBuffer =
    incoming;
} else {
  receiveBuffer =
    Buffer.concat([
      receiveBuffer,
      incoming,
    ]);
}

while (
  receiveBuffer.length >= 2
) {
  let remaining;

  try {
    remaining =
      decodeRemainingLength(
        receiveBuffer
      );
  } catch (err) {
    logger.error(
      'MQTT RX parser error:',
      err
    );

    receiveBuffer =
      Buffer.alloc(0);

    return;
  }

  if (!remaining) {
    return;
  }

  const packetLength =
    remaining.offset +
    remaining.value;

  if (
    receiveBuffer.length <
    packetLength
  ) {
    return;
  }

  const packet =
    receiveBuffer.subarray(
      0,
      packetLength
    );

  receiveBuffer =
    receiveBuffer.subarray(
      packetLength
    );

  handlePacket(
    packet
  );
}

}

function createWebSocket(
mqttSessionID
) {
const cookies =
session &&
session.data &&
session.data.cookies
? session.data.cookies
: {};

const cookieString =
  Object.entries(
    cookies
  )
    .filter(
      ([, value]) =>
        value !== undefined &&
        value !== null
    )
    .map(
      ([key, value]) =>
        `${key}=${String(value)}`
    )
    .join('; ');

const clientID =
  getMqttDeviceID(
    session
  );

if (!clientID) {
  throw new Error(
    'Cannot create MQTT WebSocket without Messenger device ID'
  );
}

let mqttUrl =
  getMqttEndpoint(
    session
  );

const parsed =
  new URL(
    mqttUrl
  );

if (
  !parsed.searchParams.has(
    'sid'
  )
) {
  parsed.searchParams.set(
    'sid',
    mqttSessionID
  );
}

if (
  !parsed.searchParams.has(
    'cid'
  )
) {
  parsed.searchParams.set(
    'cid',
    clientID
  );
}

mqttUrl =
  parsed.toString();

const hostname =
  parsed.hostname;

logger.info(
  'Connecting to Messenger MQTT broker…'
);

logger.debug(
  `MQTT endpoint: ${mqttUrl.replace(
    /([?&]sid=)[^&]+/i,
    '$1...'
  ).replace(
    /([?&]cid=)[^&]+/i,
    '$1...'
  )}`
);

logger.debug(
  `MQTT app ID: ${getMqttAppID(session)}`
);

logger.debug(
  'MQTT device ID detected from Messenger session'
);

const userAgent =
  getSessionValue(
    session,
    'userAgent'
  ) ||
  DEFAULT_USER_AGENT;

return new WebSocket(
  mqttUrl,
  {
    headers: {
      Cookie:
        cookieString,

      Origin:
        'https://www.messenger.com',

      Referer:
        'https://www.messenger.com/',

      Host:
        hostname,

      'User-Agent':
        userAgent,

      Pragma:
        'no-cache',

      'Cache-Control':
        'no-cache',
    },

    handshakeTimeout:
      30000,

    perMessageDeflate:
      false,
  }
);

}

function connect(
onConnect,
onDisconnect,
onError
) {
onConnectCallback =
onConnect;

onDisconnectCallback =
  onDisconnect;

onErrorCallback =
  onError;

intentionallyClosed =
  false;

authFailure =
  false;

sessionReady =
  false;

clearConnectTimeout();

stopPing();

receiveBuffer =
  Buffer.alloc(0);

const mqttSessionID =
  createSessionIdentifier();

let socket;

try {
  socket =
    createWebSocket(
      mqttSessionID
    );
} catch (err) {
  logger.error(
    'Failed to create MQTT WebSocket:',
    err
  );

  if (
    onErrorCallback
  ) {
    onErrorCallback(
      err
    );
  }

  return;
}

ws =
  socket;

socket.on(
  'open',
  () => {
    if (
      ws !== socket
    ) {
      return;
    }

    logger.info(
      'WebSocket open, sending MQTT CONNECT…'
    );

    let packet;

    try {
      packet =
        buildConnectPacket(
          session,
          mqttSessionID
        );
    } catch (err) {
      logger.error(
        'Failed to create MQTT CONNECT:',
        err
      );

      if (
        onErrorCallback
      ) {
        onErrorCallback(
          err
        );
      }

      try {
        socket.close(
          MQTT_HANDSHAKE_CLOSE_CODE,
          'CONNECT build failed'
        );
      } catch {
        // Ignore.
      }

      return;
    }

    logger.info(
      `MQTT CONNECT packet created (${packet.length} bytes)`
    );

    try {
      socket.send(
        packet
      );
    } catch (err) {
      logger.error(
        'Failed to send MQTT CONNECT:',
        err
      );

      if (
        onErrorCallback
      ) {
        onErrorCallback(
          err
        );
      }

      return;
    }

    clearConnectTimeout();

    connectTimeout =
      setTimeout(
        () => {
          if (
            !sessionReady &&
            ws === socket &&
            socket.readyState ===
              WebSocket.OPEN
          ) {
            logger.warn(
              'MQTT CONNACK timeout'
            );

            try {
              socket.close(
                MQTT_HANDSHAKE_CLOSE_CODE,
                'CONNACK timeout'
              );
            } catch {
              // Ignore.
            }
          }
        },
        MQTT_CONNECT_TIMEOUT
      );

    if (
      typeof connectTimeout.unref ===
      'function'
    ) {
      connectTimeout.unref();
    }
  }
);

socket.on(
  'message',
  (data) => {
    if (
      ws !== socket
    ) {
      return;
    }

    processIncomingData(
      data
    );
  }
);

socket.on(
  'close',
  async (
    code,
    reason
  ) => {
    if (
      ws === socket
    ) {
      ws = null;
    }

    clearConnectTimeout();

    stopPing();

    sessionReady =
      false;

    receiveBuffer =
      Buffer.alloc(0);

    const closeReason =
      Buffer.isBuffer(
        reason
      )
        ? reason.toString(
            'utf8'
          )
        : String(
            reason || ''
          );

    logger.warn(
      `MQTT connection closed: ` +
      `code=${code}, ` +
      `reason=${closeReason || 'none'}`
    );

    if (
      onDisconnectCallback
    ) {
      try {
        onDisconnectCallback(
          code
        );
      } catch (err) {
        logger.error(
          'MQTT onDisconnect callback failed:',
          err
        );
      }
    }

    if (
      intentionallyClosed
    ) {
      return;
    }

    if (
      authFailure
    ) {
      logger.error(
        'MQTT authentication rejected by broker — not reconnecting'
      );

      return;
    }

    if (
      reconnectAttempts >=
      maxReconnectAttempts
    ) {
      const error =
        new Error(
          'Maximum MQTT reconnect attempts reached'
        );

      if (
        onErrorCallback
      ) {
        onErrorCallback(
          error
        );
      }

      return;
    }

    reconnectAttempts++;

    const exponentialDelay =
      reconnectBaseDelay *
      Math.pow(
        2,
        reconnectAttempts - 1
      );

    const jitter =
      randomInt(
        0,
        500
      );

    const delay =
      Math.min(
        exponentialDelay +
          jitter,
        30000
      );

    logger.info(
      `Reconnecting in ${delay}ms ` +
      `(attempt ${reconnectAttempts}/${maxReconnectAttempts})…`
    );

    await sleep(
      delay
    );

    if (
      intentionallyClosed ||
      authFailure
    ) {
      return;
    }

    connect(
      onConnectCallback,
      onDisconnectCallback,
      onErrorCallback
    );
  }
);

socket.on(
  'error',
  (err) => {
    logger.error(
      `MQTT WebSocket error: ` +
      `${err?.message || err}`
    );

    if (
      err?.stack
    ) {
      logger.debug(
        err.stack
      );
    }

    if (
      onErrorCallback &&
      sessionReady
    ) {
      onErrorCallback(
        err
      );
    }
  }
);

}

function disconnect() {
intentionallyClosed =
true;

sessionReady =
  false;

authFailure =
  false;

clearConnectTimeout();

stopPing();

receiveBuffer =
  Buffer.alloc(0);

reconnectAttempts =
  0;

const socket =
  ws;

ws =
  null;

if (socket) {
  try {
    if (
      socket.readyState ===
        WebSocket.OPEN ||
      socket.readyState ===
        WebSocket.CONNECTING
    ) {
      socket.close(
        1000,
        'Client disconnect'
      );
    }
  } catch {
    // Ignore.
  }
}

logger.info(
  'MQTT connection closed by client'
);

}

function isConnected() {
return (
ws !== null &&
ws.readyState ===
WebSocket.OPEN &&
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

/* -------------------------------------------------------------------------- /
/ Exports                                                                    /
/ -------------------------------------------------------------------------- */

module.exports = {
createMqttManager,

_encodeRemainingLength:
encodeRemainingLength,

_decodeRemainingLength:
decodeRemainingLength,

_encodeMqttString:
encodeMqttString,

_buildConnectPacket:
buildConnectPacket,

_buildSubscribePacket:
buildSubscribePacket,

_buildPingPacket:
buildPingPacket,

_parseConnack:
parseConnack,

_MQTT_CONNECT_FLAGS:
MQTT_CONNECT_FLAGS,
};