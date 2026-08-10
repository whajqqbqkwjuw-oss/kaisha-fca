'use strict';

/**
 * @module listener
 * @description Parses raw MQTT payloads from Facebook Messenger's real-time
 * topics and converts them into structured event objects emitted on the
 * KaishaEventEmitter.
 *
 * Topics handled:
 *   /t_ms                      — messages, reactions, unsends, group actions,
 *                                admin changes, polls, call events
 *   /thread_typing             — typing indicators (1:1 threads)
 *   /orca_typing_notifications — typing indicators (group threads)
 *   /orca_presence             — read receipts / seen events / presence
 *
 *   reply            — alias for message:reply (reply-to-message messages)
 *   unsend           — alias for message:unsend
 *   seen             — alias for message:seen
 *   thread:update    — any thread-level metadata change
 *   nickname:change  — participant nickname changed
 *   emoji:change     — thread emoji changed
 *   theme:change     — thread theme/colour changed
 *   user:added       — alias for participant:join
 *   user:removed     — alias for participant:leave
 *   approval:mode    — group approval-mode toggled (when supported)
 *   approval:request — join request raised in approval-mode group (when supported)
 *   call             — call started, ended, or missed (when supported)
 */

const { tryParseJSON } = require('./utils');

// ─── Payload decoder ─────────────────────────────────────────────────────────

/**
 * Decodes a raw MQTT Buffer into a plain object.
 *
 * @param {Buffer} payload
 * @returns {object|null}
 */
function decodePayload(payload) {
  if (!Buffer.isBuffer(payload)) payload = Buffer.from(payload ?? '');

  const raw = payload.toString('utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) return null;

  const candidates = [
    raw,
    raw.replace(/^\d+/, '').trim(),
    raw.replace(/^for\s*\(;;\);?/, '').trim(),
  ];

  for (const candidate of candidates) {
    const parsed = tryParseJSON(candidate);
    if (parsed !== null) return parsed;
  }

  for (const candidate of candidates) {
    const outer = tryParseJSON(candidate);
    if (typeof outer === 'string') {
      const inner = tryParseJSON(outer);
      if (inner !== null) return inner;
    }
  }

  return null;
}

// ─── /t_ms delta routing ─────────────────────────────────────────────────────

/**
 * Parses a raw /t_ms MQTT payload and returns the first recognisable event.
 *
 * @param {Buffer} payload
 * @param {string} selfUserID
 * @returns {object|null}
 */
function parseMqttPayload(payload, selfUserID) {
  const data = decodePayload(payload);
  if (!data) return null;

  let deltas;
  if (Array.isArray(data)) {
    deltas = data;
  } else if (Array.isArray(data.deltas)) {
    deltas = data.deltas;
  } else if (data.delta) {
    deltas = Array.isArray(data.delta) ? data.delta : [data.delta];
  } else if (Array.isArray(data.data?.deltas)) {
    deltas = data.data.deltas;
  } else if (data.data?.delta) {
    deltas = Array.isArray(data.data.delta) ? data.data.delta : [data.data.delta];
  } else {
    deltas = [data];
  }

  for (const delta of deltas) {
    const parsed = parseDelta(delta, selfUserID);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Routes a single delta object to the appropriate typed parser.
 *
 * @param {object} delta
 * @param {string} selfUserID
 * @returns {object|null}
 */
function parseDelta(delta, selfUserID) {
  if (!delta || typeof delta !== 'object') return null;

  const deltaClass = delta.class ?? delta.type ?? '';
  const logData    = delta.log_message_data ?? delta.logMessageData ?? null;
  const logType    = (delta.log_message_type ?? delta.logMessageType ?? '').toLowerCase();

  // ── Standard message ──────────────────────────────────────────────────
  if (deltaClass === 'NewMessage' || (delta.body !== undefined && delta.messageMetadata)) {
    return parseNewMessage(delta);
  }

  // ── Reaction ──────────────────────────────────────────────────────────
  if (
    deltaClass === 'ReactionNotif' ||
    delta.action === 'ADD_REACTION' ||
    delta.action === 'REMOVE_REACTION'
  ) {
    return parseReaction(delta);
  }

  // ── Unsend ────────────────────────────────────────────────────────────
  if (deltaClass === 'UnsendMessage' || (delta.irisSeqId !== undefined && delta.unsendTimestamp)) {
    return parseUnsend(delta);
  }

  // ── Call ──────────────────────────────────────────────────────────────
  if (
    deltaClass === 'VideoCall'          ||
    deltaClass === 'VoiceCall'          ||
    deltaClass === 'Call'               ||
    logType.includes('call')            ||
    delta.call_id !== undefined         ||
    delta.video_call_id !== undefined
  ) {
    return parseCallDelta(delta);
  }

  // ── Group log messages ────────────────────────────────────────────────
  if (deltaClass === 'ThreadAction' || logData !== null || logType !== '') {
    return parseLogMessage(delta);
  }

  // ── Poll ──────────────────────────────────────────────────────────────
  if (
    deltaClass === 'PollEvent'          ||
    deltaClass === 'PollUpdate'         ||
    delta.poll_id !== undefined         ||
    delta.extensible_attachment?.story_attachment?.target?.poll_question !== undefined
  ) {
    return parsePollDelta(delta);
  }

  return null;
}

// ─── Individual delta parsers ─────────────────────────────────────────────────

/**
 * @param {object} delta
 * @returns {import('./events').MessageEvent|null}
 */
function parseNewMessage(delta) {
  const meta = delta.messageMetadata ?? delta.metadata ?? {};

  const messageID = meta.messageId ?? delta.messageId ?? delta.message_id ?? null;
  const threadID  =
    meta.threadKey?.threadFbId    ??
    meta.threadKey?.otherUserFbId ??
    delta.threadKey?.threadFbId   ??
    delta.threadKey?.otherUserFbId ??
    null;

  const senderID    = meta.actorFbId ?? delta.senderFbId ?? null;
  const body        = delta.body ?? '';
  const timestamp   = Number(meta.timestamp ?? delta.timestamp ?? Date.now());
  const isGroup     = !!(meta.threadKey?.threadFbId ?? delta.threadKey?.threadFbId);
  const attachments = delta.attachments ?? [];
  const replyToMessageID =
    delta.replied_to_message?.message_id ??
    delta.replyToMessageId               ??
    null;

  if (!messageID || !threadID || !senderID) return null;

  return {
    type: 'message',
    messageID,
    threadID:          String(threadID),
    senderID:          String(senderID),
    body,
    timestamp,
    isGroup,
    attachments,
    replyToMessageID,
  };
}

/**
 * @param {object} delta
 * @returns {object|null}
 */
function parseReaction(delta) {
  const messageID = delta.messageId ?? delta.message_id ?? null;
  const threadID  =
    delta.threadKey?.threadFbId    ??
    delta.threadKey?.otherUserFbId ??
    null;
  const senderID  = delta.userId ?? delta.actorFbId ?? null;
  const reaction  = delta.reaction ?? '';
  const action    = delta.action ?? (reaction ? 'ADD_REACTION' : 'REMOVE_REACTION');

  if (!messageID || !threadID || !senderID) return null;

  return {
    type:      'message:react',
    messageID: String(messageID),
    threadID:  String(threadID),
    senderID:  String(senderID),
    reaction,
    action,
  };
}

/**
 * @param {object} delta
 * @returns {object|null}
 */
function parseUnsend(delta) {
  const messageID = delta.messageId ?? delta.message_id ?? null;
  const threadID  =
    delta.threadKey?.threadFbId    ??
    delta.threadKey?.otherUserFbId ??
    null;
  const senderID  = delta.actorFbId ?? delta.userId ?? null;
  const timestamp = Number(delta.unsendTimestamp ?? delta.timestamp ?? Date.now());

  if (!messageID || !threadID || !senderID) return null;

  return {
    type:      'message:unsend',
    messageID: String(messageID),
    threadID:  String(threadID),
    senderID:  String(senderID),
    timestamp,
  };
}

/**
 * Parses a group log-message delta into a typed group or thread event.
 *
 * Covers: participant join/leave, admin promote/demote, group name, photo,
 * emoji, theme/colour, nickname change, approval-mode toggle, and approval
 * join requests.
 *
 * @param {object} delta
 * @returns {object|null}
 */
function parseLogMessage(delta) {
  const logType = (
    delta.log_message_type ??
    delta.logMessageType   ??
    delta.type             ??
    ''
  ).toLowerCase();

  const logData  = delta.log_message_data ?? delta.logMessageData ?? {};
  const meta     = delta.messageMetadata  ?? delta.metadata        ?? {};
  const actorID  = String(
    meta.actorFbId    ??
    delta.actorFbId   ??
    logData.actor_id  ??
    logData.adminId   ??
    ''
  );
  const threadID = String(
    meta.threadKey?.threadFbId    ??
    meta.threadKey?.otherUserFbId ??
    delta.threadKey?.threadFbId   ??
    delta.threadKey?.otherUserFbId ??
    ''
  );
  const timestamp = Number(meta.timestamp ?? delta.timestamp ?? Date.now());

  if (!threadID) return null;

  // ── Participant joined ────────────────────────────────────────────────
  if (
    logType === 'log:subscribe'       ||
    logType === 'subscribe'           ||
    logType.includes('add_members')   ||
    logType.includes('joined')
  ) {
    const rawAdded =
      logData.added_participants    ??
      logData.addedParticipants     ??
      delta.addedParticipants       ??
      [];

    const addedIDs = (Array.isArray(rawAdded) ? rawAdded : [rawAdded])
      .map((p) => String(
        typeof p === 'object'
          ? p.user_fbid ?? p.userFbId ?? p.fbid ?? p.id ?? ''
          : p
      ))
      .filter(Boolean);

    if (addedIDs.length === 0 && actorID) addedIDs.push(actorID);

    return {
      type:      'participant:join',
      threadID,
      actorID,
      addedIDs,
      timestamp,
    };
  }

  // ── Participant left / removed ────────────────────────────────────────
  if (
    logType === 'log:unsubscribe'     ||
    logType === 'unsubscribe'         ||
    logType.includes('remove_members')||
    logType.includes('left')
  ) {
    const rawRemoved =
      logData.removed_participants ??
      logData.removedParticipants  ??
      delta.removedParticipants    ??
      [];

    const removedIDs = (Array.isArray(rawRemoved) ? rawRemoved : [rawRemoved])
      .map((p) => String(
        typeof p === 'object'
          ? p.user_fbid ?? p.userFbId ?? p.fbid ?? p.id ?? ''
          : p
      ))
      .filter(Boolean);

    if (removedIDs.length === 0 && actorID) removedIDs.push(actorID);

    return {
      type:       'participant:leave',
      threadID,
      actorID,
      removedIDs,
      timestamp,
    };
  }

  // ── Admin promoted ────────────────────────────────────────────────────
  if (
    logType === 'log:thread-admin-added' ||
    logType === 'thread_admin_added'     ||
    logType.includes('admin_added')      ||
    logType.includes('promote')
  ) {
    const targetID = String(
      logData.targetId  ??
      logData.target_id ??
      logData.userId    ??
      logData.user_id   ??
      delta.targetId    ??
      ''
    );
    if (!targetID) return null;

    return { type: 'admin:promote', threadID, actorID, targetID, timestamp };
  }

  // ── Admin demoted ─────────────────────────────────────────────────────
  if (
    logType === 'log:thread-admin-removed' ||
    logType === 'thread_admin_removed'     ||
    logType.includes('admin_removed')      ||
    logType.includes('demote')
  ) {
    const targetID = String(
      logData.targetId  ??
      logData.target_id ??
      logData.userId    ??
      logData.user_id   ??
      delta.targetId    ??
      ''
    );
    if (!targetID) return null;

    return { type: 'admin:demote', threadID, actorID, targetID, timestamp };
  }

  // ── Group name changed ───────────────────────────────────────────────
  if (
    logType === 'log:thread-name'     ||
    logType === 'thread_name'         ||
    logType.includes('name_change')   ||
    logType.includes('thread_name')
  ) {
    const name = String(
      logData.name        ??
      logData.thread_name ??
      delta.name          ??
      ''
    );

    return { type: 'group:name', threadID, actorID, name, timestamp };
  }

  // ── Group photo changed ──────────────────────────────────────────────
  if (
    logType === 'log:thread-image'    ||
    logType === 'thread_image'        ||
    logType.includes('photo_change')  ||
    logType.includes('thread_image')  ||
    logType.includes('image_change')
  ) {
    const photoURL = String(
      logData.image_uri  ??
      logData.imageUri   ??
      logData.url        ??
      logData.photo_url  ??
      delta.imageUri     ??
      ''
    );

    return { type: 'group:photo', threadID, actorID, photoURL, timestamp };
  }

  // ── Group emoji changed ──────────────────────────────────────────────
  if (
    logType === 'log:thread-icon'     ||
    logType === 'thread_icon'         ||
    logType.includes('emoji_change')  ||
    logType.includes('thread_icon')   ||
    logType.includes('thread_emoji')
  ) {
    const emoji = String(
      logData.thread_icon ??
      logData.threadIcon  ??
      logData.emoji       ??
      delta.emoji         ??
      ''
    );

    return { type: 'group:emoji', threadID, actorID, emoji, timestamp };
  }

  // ── Thread theme / colour changed ────────────────────────────────────
  if (
    logType === 'log:thread-color'    ||
    logType === 'thread_color'        ||
    logType.includes('theme_change')  ||
    logType.includes('thread_color')  ||
    logType.includes('thread_theme')
  ) {
    const theme = String(
      logData.thread_color       ??
      logData.threadColor        ??
      logData.theme_color        ??
      logData.background_color   ??
      logData.backgroundKey      ??
      delta.themeColor           ??
      ''
    );

    const themeName = String(
      logData.theme_name  ??
      logData.themeName   ??
      ''
    );

    return {
      type: 'theme:change',
      threadID,
      actorID,
      theme,
      themeName,
      timestamp,
    };
  }

  // ── Participant nickname changed ──────────────────────────────────────
  if (
    logType === 'log:thread-nickname'    ||
    logType === 'thread_nickname'        ||
    logType.includes('nickname_change')  ||
    logType.includes('thread_nickname')
  ) {
    const targetID = String(
      logData.participant_id  ??
      logData.participantId   ??
      logData.userId          ??
      logData.user_id         ??
      delta.participantId     ??
      ''
    );

    const nickname = String(
      logData.nickname ??
      delta.nickname   ??
      ''
    );

    return {
      type: 'nickname:change',
      threadID,
      actorID,
      targetID,
      nickname,
      timestamp,
    };
  }

  // ── Approval mode toggled ────────────────────────────────────────────
  if (
    logType === 'log:thread-approval-mode' ||
    logType === 'thread_approval_mode'     ||
    logType.includes('approval_mode')
  ) {
    const enabled = Boolean(
      logData.approval_mode    ??
      logData.approvalMode     ??
      delta.approvalMode       ??
      false
    );

    return {
      type: 'approval:mode',
      threadID,
      actorID,
      enabled,
      timestamp,
    };
  }

  // ── Approval join request ────────────────────────────────────────────
  if (
    logType === 'log:thread-approval-request' ||
    logType === 'thread_approval_request'     ||
    logType.includes('approval_request')      ||
    logType.includes('join_request')
  ) {
    const requesterID = String(
      logData.requester_id ??
      logData.requesterId  ??
      logData.userId       ??
      delta.requesterId    ??
      ''
    );

    return {
      type: 'approval:request',
      threadID,
      actorID,
      requesterID,
      timestamp,
    };
  }

  return null;
}

/**
 * Parses a poll-related delta into a PollEvent.
 *
 * @param {object} delta
 * @returns {object|null}
 */
function parsePollDelta(delta) {
  const meta      = delta.messageMetadata ?? delta.metadata ?? {};
  const actorID   = String(meta.actorFbId ?? delta.actorFbId ?? delta.actor_id ?? '');
  const threadID  = String(
    meta.threadKey?.threadFbId    ??
    meta.threadKey?.otherUserFbId ??
    delta.threadKey?.threadFbId   ??
    delta.threadKey?.otherUserFbId ??
    ''
  );
  const timestamp = Number(meta.timestamp ?? delta.timestamp ?? Date.now());

  const pollData =
    delta.poll                                                        ??
    delta.extensible_attachment?.story_attachment?.target             ??
    delta.story_attachment?.target                                    ??
    {};

  const pollID   = String(delta.poll_id   ?? pollData.id          ?? pollData.poll_id ?? '');
  const question = String(
    delta.poll_question   ??
    pollData.poll_question ??
    pollData.question      ??
    pollData.text          ??
    ''
  );

  const rawOptions = delta.poll_options ?? pollData.poll_options ?? pollData.options ?? [];

  const options = (Array.isArray(rawOptions) ? rawOptions : []).map((o) => ({
    optionID: String(o.id ?? o.option_id ?? o.key ?? ''),
    text:     String(o.text ?? o.option_text ?? o.description ?? ''),
    voterIDs: (o.voters ?? o.voter_ids ?? []).map(String),
  }));

  const deltaClass = (delta.class ?? delta.type ?? '').toLowerCase();
  const action =
    deltaClass.includes('vote')   ? 'vote'   :
    deltaClass.includes('update') ? 'update' :
    'create';

  if (!threadID) return null;

  return { type: 'poll', threadID, actorID, action, pollID, question, options, timestamp };
}

/**
 * Parses a call-related delta.
 *
 * Facebook delivers call events via the /t_ms stream.  The delta class and
 * log type vary by client version; this parser covers all known variants.
 *
 * @param {object} delta
 * @returns {CallEvent|null}
 *
 * @typedef {object} CallEvent
 * @property {'call'}            type
 * @property {string}            threadID
 * @property {string}            callID
 * @property {string}            callerID
 * @property {'video'|'audio'}   callType
 * @property {'started'|'ended'|'missed'} status
 * @property {number}            duration  - call length in seconds; 0 while ongoing
 * @property {number}            timestamp
 */
function parseCallDelta(delta) {
  const meta      = delta.messageMetadata ?? delta.metadata ?? {};
  const logData   = delta.log_message_data ?? delta.logMessageData ?? {};
  const logType   = (delta.log_message_type ?? delta.logMessageType ?? '').toLowerCase();

  const callID    = String(
    delta.call_id        ??
    delta.video_call_id  ??
    logData.call_id      ??
    ''
  );

  const threadID  = String(
    meta.threadKey?.threadFbId    ??
    meta.threadKey?.otherUserFbId ??
    delta.threadKey?.threadFbId   ??
    delta.threadKey?.otherUserFbId ??
    ''
  );

  const callerID  = String(
    meta.actorFbId    ??
    delta.actorFbId   ??
    logData.caller_id ??
    logData.initiator ??
    ''
  );

  const timestamp = Number(meta.timestamp ?? delta.timestamp ?? Date.now());

  const callType =
    logType.includes('video')      ||
    delta.class === 'VideoCall'    ||
    delta.video_call_id !== undefined
      ? 'video'
      : 'audio';

  const statusRaw = (
    delta.call_status         ??
    logData.call_status       ??
    logData.status            ??
    delta.class               ??
    ''
  ).toLowerCase();

  const status =
    statusRaw.includes('end')    ? 'ended'   :
    statusRaw.includes('miss')   ? 'missed'  :
    'started';

  const duration = Number(logData.duration ?? delta.call_duration ?? 0);

  if (!threadID) return null;

  return {
    type:      'call',
    threadID,
    callID,
    callerID,
    callType,
    status,
    duration,
    timestamp,
  };
}

// ─── Typing payload parser ────────────────────────────────────────────────────

/**
 * @param {Buffer} payload
 * @returns {object|null}
 */
function parseTypingPayload(payload) {
  const data = decodePayload(payload);
  if (!data) return null;

  const senderID = String(
    data.sender_fbid ??
    data.senderFbId  ??
    data.user_id     ??
    ''
  );

  const threadID = String(
    data.thread_fbid                  ??
    data.threadFbId                   ??
    data.other_user_fbid              ??
    data.thread_key?.thread_fbid      ??
    data.thread_key?.other_user_fbid  ??
    ''
  );

  const isTyping = Boolean(data.state ?? data.typing_state ?? false);
  const isGroup  = !!(data.thread_fbid ?? data.threadFbId ?? data.thread_key?.thread_fbid);

  if (!senderID || !threadID) return null;

  return { type: 'typing', threadID, senderID, isTyping, isGroup };
}

// ─── Presence payload parser ──────────────────────────────────────────────────

/**
 * Parses /orca_presence into SeenEvent[] and PresenceEvent[].
 *
 * @param {Buffer} payload
 * @returns {Array<object>}
 */
function parsePresencePayload(payload) {
  const data = decodePayload(payload);
  if (!data) return [];

  const events  = [];
  const entries = Array.isArray(data.list) ? data.list : [data];

  for (const entry of entries) {
    const receipt = entry.read_receipt ?? entry.readReceipt ?? null;

    if (receipt) {
      const readerID  = String(entry.u ?? entry.user_id ?? entry.userId ?? '');
      const threadID  = String(
        receipt.thread_fbid     ??
        receipt.threadFbId      ??
        receipt.other_user_fbid ??
        ''
      );
      const messageID = String(receipt.message_id ?? receipt.messageId ?? '');
      const timestamp = Number(receipt.timestamp ?? entry.lat ?? Date.now());

      if (readerID && threadID) {
        events.push({ type: 'message:seen', threadID, readerID, messageID, timestamp });
      }
      continue;
    }

    const flatReader  = String(entry.u ?? entry.user_id ?? '');
    const flatThread  = String(entry.thread_fbid ?? entry.threadFbId ?? '');
    const flatMsgID   = String(entry.message_id ?? entry.last_read_message_id ?? '');
    const flatTs      = Number(entry.timestamp ?? entry.lat ?? 0);

    if (flatReader && flatThread && flatTs > 0 && entry.p === undefined) {
      events.push({ type: 'message:seen', threadID: flatThread, readerID: flatReader, messageID: flatMsgID, timestamp: flatTs });
      continue;
    }

    const userID     = String(entry.u ?? entry.user_id ?? '');
    const pFlag      = entry.p;
    const latSeconds = entry.lat ?? 0;

    if (userID && pFlag !== undefined) {
      events.push({
        type:       'presence',
        userID,
        isActive:   Number(pFlag) > 0,
        lastActive: latSeconds > 0 ? latSeconds * 1000 : 0,
      });
    }
  }

  return events;
}

// ─── Thread-update synthetic event builder ────────────────────────────────────

/**
 * Wraps any group-metadata event object (group:name, group:photo, group:emoji,
 * theme:change, nickname:change, admin:promote, admin:demote, participant:join,
 * participant:leave, approval:mode, approval:request) into a normalised
 * `thread:update` envelope so consumers can subscribe to a single event for
 * all thread-level changes.
 *
 * @param {object} event - An already-parsed typed event object.
 * @returns {ThreadUpdateEvent}
 *
 * @typedef {object} ThreadUpdateEvent
 * @property {'thread:update'} type
 * @property {string}          updateType  - The original event type.
 * @property {string}          threadID
 * @property {string}          actorID
 * @property {number}          timestamp
 * @property {object}          data        - The full original event object.
 */
function buildThreadUpdateEvent(event) {
  return {
    type:       'thread:update',
    updateType: event.type,
    threadID:   event.threadID,
    actorID:    event.actorID ?? '',
    timestamp:  event.timestamp,
    data:       event,
  };
}

// ─── Listener attachment ──────────────────────────────────────────────────────

/**
 * The set of event types that should also be forwarded as `thread:update`.
 *
 * @type {Set<string>}
 */
const THREAD_UPDATE_TYPES = new Set([
  'group:name',
  'group:photo',
  'group:emoji',
  'theme:change',
  'nickname:change',
  'admin:promote',
  'admin:demote',
  'participant:join',
  'participant:leave',
  'approval:mode',
  'approval:request',
]);

/**
 * Attaches all MQTT topic listeners and emits structured events on the
 * provided KaishaEventEmitter.
 *
 *
 * @param {import('./mqtt').MqttManager}          mqttManager
 * @param {import('./events').KaishaEventEmitter} emitter
 * @param {string}                                selfUserID
 * @param {import('./logger').Logger}             logger
 */
function attachListener(mqttManager, emitter, selfUserID, logger) {
  // ── /t_ms ─────────────────────────────────────────────────────────────
  mqttManager.on('/t_ms', (payload) => {
    try {
      const data = decodePayload(payload);
      if (!data) {
        logger.debug(`/t_ms payload was not valid JSON (${payload.length} bytes)`);
        return;
      }

      let deltas;
      if (Array.isArray(data)) {
        deltas = data;
      } else if (Array.isArray(data.deltas)) {
        deltas = data.deltas;
      } else if (data.delta) {
        deltas = Array.isArray(data.delta) ? data.delta : [data.delta];
      } else if (Array.isArray(data.data?.deltas)) {
        deltas = data.data.deltas;
      } else if (data.data?.delta) {
        deltas = Array.isArray(data.data.delta) ? data.data.delta : [data.data.delta];
      } else {
        deltas = [data];
      }

      logger.debug(`/t_ms decoded ${deltas.length} delta(s)`);

      for (const delta of deltas) {
        const event = parseDelta(delta, selfUserID);
        if (!event) {
          const cls = delta && typeof delta === 'object'
            ? String(delta.class ?? delta.type ?? 'unknown')
            : typeof delta;
          logger.debug(`/t_ms delta ignored: class=${cls}`);
          continue;
        }

        logger.debug(`Parsed MQTT event: ${event.type}`);

        switch (event.type) {

          // ── Core message events ──────────────────────────────────────
          case 'message': {
            emitter.emit('message', event);

            // reply / message:reply — both fired when the message is a reply
            if (event.replyToMessageID) {
              emitter.emit('message:reply', event);
              emitter.emit('reply', event);
            }
            break;
          }

          case 'message:react':
            emitter.emit('message:react', event);
            break;

          // ── Unsend ───────────────────────────────────────────────────
          case 'message:unsend':
            emitter.emit('message:unsend', event);
            emitter.emit('unsend', event);         // named alias
            break;

          // ── Group membership ─────────────────────────────────────────
          case 'participant:join':
            emitter.emit('participant:join', event);
            emitter.emit('user:added', event);     // named alias
            emitter.emit('thread:update', buildThreadUpdateEvent(event));
            break;

          case 'participant:leave':
            emitter.emit('participant:leave', event);
            emitter.emit('user:removed', event);   // named alias
            emitter.emit('thread:update', buildThreadUpdateEvent(event));
            break;

          // ── Admin changes ────────────────────────────────────────────
          case 'admin:promote':
            emitter.emit('admin:promote', event);
            emitter.emit('thread:update', buildThreadUpdateEvent(event));
            break;

          case 'admin:demote':
            emitter.emit('admin:demote', event);
            emitter.emit('thread:update', buildThreadUpdateEvent(event));
            break;

          // ── Group metadata ───────────────────────────────────────────
          case 'group:name':
            emitter.emit('group:name', event);
            emitter.emit('thread:update', buildThreadUpdateEvent(event));
            break;

          case 'group:photo':
            emitter.emit('group:photo', event);
            emitter.emit('thread:update', buildThreadUpdateEvent(event));
            break;

          case 'group:emoji':
            emitter.emit('group:emoji', event);
            emitter.emit('emoji:change', event);   // named alias
            emitter.emit('thread:update', buildThreadUpdateEvent(event));
            break;

          case 'theme:change':
            emitter.emit('theme:change', event);
            emitter.emit('thread:update', buildThreadUpdateEvent(event));
            break;

          case 'nickname:change':
            emitter.emit('nickname:change', event);
            emitter.emit('thread:update', buildThreadUpdateEvent(event));
            break;

          case 'approval:mode':
            emitter.emit('approval:mode', event);
            emitter.emit('thread:update', buildThreadUpdateEvent(event));
            break;

          case 'approval:request':
            emitter.emit('approval:request', event);
            emitter.emit('thread:update', buildThreadUpdateEvent(event));
            break;

          // ── Polls ────────────────────────────────────────────────────
          case 'poll':
            emitter.emit('poll', event);
            break;

          // ── Calls ────────────────────────────────────────────────────
          case 'call':
            emitter.emit('call', event);
            break;
        }
      }
    } catch (err) {
      logger.error('Error parsing /t_ms payload:', err.message);
    }
  });

  // ── /thread_typing ────────────────────────────────────────────────────
  mqttManager.on('/thread_typing', (payload) => {
    try {
      const event = parseTypingPayload(payload);
      if (!event) return;
      logger.debug(`Typing event: senderID=${event.senderID} isTyping=${event.isTyping}`);
      emitter.emit('typing', event);
    } catch (err) {
      logger.error('Error parsing /thread_typing payload:', err.message);
    }
  });

  // ── /orca_typing_notifications ────────────────────────────────────────
  mqttManager.on('/orca_typing_notifications', (payload) => {
    try {
      const event = parseTypingPayload(payload);
      if (!event) return;
      logger.debug(`Group typing event: senderID=${event.senderID} isTyping=${event.isTyping}`);
      emitter.emit('typing', event);
    } catch (err) {
      logger.error('Error parsing /orca_typing_notifications payload:', err.message);
    }
  });

  // ── /orca_presence ────────────────────────────────────────────────────
  mqttManager.on('/orca_presence', (payload) => {
    try {
      const parsedEvents = parsePresencePayload(payload);

      for (const event of parsedEvents) {
        if (event.type === 'message:seen') {
          logger.debug(`Seen event: readerID=${event.readerID} threadID=${event.threadID}`);
          emitter.emit('message:seen', event);
          emitter.emit('seen', event);             // named alias
        } else if (event.type === 'presence') {
          logger.debug(`Presence event: userID=${event.userID} isActive=${event.isActive}`);
          emitter.emit('presence', event);
        }
      }
    } catch (err) {
      logger.error('Error parsing /orca_presence payload:', err.message);
    }
  });
}

module.exports = {
  attachListener,
  parseMqttPayload,
  parseTypingPayload,
  parsePresencePayload,
};