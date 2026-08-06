'use strict';

/**
 *
 * All events flow through the same MQTT pipeline and existing
 * KaishaEventEmitter — no additional setup is required.
 *
 * Named events and their canonical equivalents:
 *
 *   'reply'            → fires alongside 'message:reply'
 *   'unsend'           → fires alongside 'message:unsend'
 *   'seen'             → fires alongside 'message:seen'
 *   'thread:update'    → fires for every thread-level metadata change
 *   'nickname:change'  → participant nickname changed
 *   'emoji:change'     → fires alongside 'group:emoji'
 *   'theme:change'     → thread theme / colour changed
 *   'user:added'       → fires alongside 'participant:join'
 *   'user:removed'     → fires alongside 'participant:leave'
 *   'approval:mode'    → group approval-mode toggled (when supported)
 *   'approval:request' → join request in approval-mode group (when supported)
 *   'call'             → call started / ended / missed (when supported)
 *
 * Usage:
 *   node examples/named-events.js
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
  const client   = await kaisha.login(
    { type: 'appstate', appstate },
    { logLevel: 'info' }
  );

  console.log('Authenticated as user:', client.session.data.userID);

  client.events.on('ready', () => {
    console.log('Connected. Listening for named events…\n');
  });

  // ── reply ─────────────────────────────────────────────────────────────────
  /**
   * Fired when an incoming message is itself a reply to another message.
   * The payload is identical to a 'message' event with replyToMessageID set.
   *
   * {
   *   type:              'message'  (the base type is still 'message')
   *   messageID:         string
   *   threadID:          string
   *   senderID:          string
   *   body:              string
   *   timestamp:         number
   *   isGroup:           boolean
   *   attachments:       object[]
   *   replyToMessageID:  string    ← always set when 'reply' fires
   * }
   */
  client.events.on('reply', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();
    console.log(`[${ts}] [reply]`);
    console.log(`  Thread:  ${event.threadID}`);
    console.log(`  Sender:  ${event.senderID}`);
    console.log(`  Body:    ${event.body.slice(0, 60)}`);
    console.log(`  ReplyTo: ${event.replyToMessageID}`);
    console.log();
  });

  // ── unsend ────────────────────────────────────────────────────────────────
  /**
   * {
   *   type:      'message:unsend'
   *   messageID: string
   *   threadID:  string
   *   senderID:  string
   *   timestamp: number
   * }
   */
  client.events.on('unsend', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();
    console.log(`[${ts}] [unsend]`);
    console.log(`  Thread:  ${event.threadID}`);
    console.log(`  Sender:  ${event.senderID}`);
    console.log(`  MsgID:   ${event.messageID}`);
    console.log();
  });

  // ── seen ──────────────────────────────────────────────────────────────────
  /**
   * {
   *   type:      'message:seen'
   *   threadID:  string
   *   readerID:  string
   *   messageID: string
   *   timestamp: number
   * }
   */
  client.events.on('seen', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();
    console.log(`[${ts}] [seen]`);
    console.log(`  Thread:  ${event.threadID}`);
    console.log(`  Reader:  ${event.readerID}`);
    console.log(`  MsgID:   ${event.messageID || '(not provided)'}`);
    console.log();
  });

  // ── thread:update ─────────────────────────────────────────────────────────
  /**
   * Fires for every thread-level metadata change.  The `updateType` field
   * identifies the underlying change type.
   *
   * {
   *   type:       'thread:update'
   *   updateType: string         ← e.g. 'group:name', 'nickname:change', …
   *   threadID:   string
   *   actorID:    string
   *   timestamp:  number
   *   data:       object         ← the full original typed event
   * }
   */
  client.events.on('thread:update', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();
    console.log(`[${ts}] [thread:update] updateType=${event.updateType}`);
    console.log(`  Thread: ${event.threadID}`);
    console.log(`  Actor:  ${event.actorID || '(unknown)'}`);
    console.log();
  });

  // ── nickname:change ───────────────────────────────────────────────────────
  /**
   * {
   *   type:      'nickname:change'
   *   threadID:  string
   *   actorID:   string
   *   targetID:  string   — whose nickname changed
   *   nickname:  string   — new nickname ('' = cleared)
   *   timestamp: number
   * }
   */
  client.events.on('nickname:change', (event) => {
    const ts       = new Date(event.timestamp).toLocaleTimeString();
    const nickname = event.nickname || '(cleared)';
    console.log(`[${ts}] [nickname:change]`);
    console.log(`  Thread:   ${event.threadID}`);
    console.log(`  Actor:    ${event.actorID}`);
    console.log(`  Target:   ${event.targetID}`);
    console.log(`  Nickname: "${nickname}"`);
    console.log();
  });

  // ── emoji:change ──────────────────────────────────────────────────────────
  /**
   * Fires alongside 'group:emoji'.
   *
   * {
   *   type:      'group:emoji'
   *   threadID:  string
   *   actorID:   string
   *   emoji:     string
   *   timestamp: number
   * }
   */
  client.events.on('emoji:change', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();
    console.log(`[${ts}] [emoji:change]`);
    console.log(`  Thread: ${event.threadID}`);
    console.log(`  Actor:  ${event.actorID}`);
    console.log(`  Emoji:  "${event.emoji}"`);
    console.log();
  });

  // ── theme:change ──────────────────────────────────────────────────────────
  /**
   * {
   *   type:      'theme:change'
   *   threadID:  string
   *   actorID:   string
   *   theme:     string   — hex colour or theme key
   *   themeName: string   — human-readable theme name (may be '')
   *   timestamp: number
   * }
   */
  client.events.on('theme:change', (event) => {
    const ts    = new Date(event.timestamp).toLocaleTimeString();
    const label = event.themeName || event.theme || '(unknown)';
    console.log(`[${ts}] [theme:change]`);
    console.log(`  Thread: ${event.threadID}`);
    console.log(`  Actor:  ${event.actorID}`);
    console.log(`  Theme:  ${label}`);
    console.log();
  });

  // ── user:added ────────────────────────────────────────────────────────────
  /**
   * Fires alongside 'participant:join'.
   *
   * {
   *   type:      'participant:join'
   *   threadID:  string
   *   actorID:   string
   *   addedIDs:  string[]
   *   timestamp: number
   * }
   */
  client.events.on('user:added', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();
    console.log(`[${ts}] [user:added]`);
    console.log(`  Thread:   ${event.threadID}`);
    console.log(`  AddedBy:  ${event.actorID}`);
    console.log(`  AddedIDs: ${event.addedIDs.join(', ')}`);
    console.log();
  });

  // ── user:removed ──────────────────────────────────────────────────────────
  /**
   * Fires alongside 'participant:leave'.
   *
   * {
   *   type:       'participant:leave'
   *   threadID:   string
   *   actorID:    string
   *   removedIDs: string[]
   *   timestamp:  number
   * }
   */
  client.events.on('user:removed', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();
    console.log(`[${ts}] [user:removed]`);
    console.log(`  Thread:     ${event.threadID}`);
    console.log(`  Actor:      ${event.actorID}`);
    console.log(`  RemovedIDs: ${event.removedIDs.join(', ')}`);
    console.log();
  });

  // ── approval:mode ─────────────────────────────────────────────────────────
  /**
   * Emitted when a group admin toggles approval mode.
   * Only fired when the platform delivers this log message type.
   *
   * {
   *   type:      'approval:mode'
   *   threadID:  string
   *   actorID:   string
   *   enabled:   boolean
   *   timestamp: number
   * }
   */
  client.events.on('approval:mode', (event) => {
    const ts    = new Date(event.timestamp).toLocaleTimeString();
    const state = event.enabled ? 'ENABLED' : 'DISABLED';
    console.log(`[${ts}] [approval:mode] ${state}`);
    console.log(`  Thread: ${event.threadID}`);
    console.log(`  Actor:  ${event.actorID}`);
    console.log();
  });

  // ── approval:request ──────────────────────────────────────────────────────
  /**
   * Emitted when someone requests to join an approval-mode group.
   * Only fired when the platform delivers this log message type.
   *
   * {
   *   type:         'approval:request'
   *   threadID:     string
   *   actorID:      string
   *   requesterID:  string
   *   timestamp:    number
   * }
   */
  client.events.on('approval:request', (event) => {
    const ts = new Date(event.timestamp).toLocaleTimeString();
    console.log(`[${ts}] [approval:request]`);
    console.log(`  Thread:    ${event.threadID}`);
    console.log(`  Requester: ${event.requesterID}`);
    console.log();
  });

  // ── call ──────────────────────────────────────────────────────────────────
  /**
   * Emitted when a call is started, ended, or missed.
   * Only fired when the platform delivers call log messages.
   *
   * {
   *   type:      'call'
   *   threadID:  string
   *   callID:    string
   *   callerID:  string
   *   callType:  'video' | 'audio'
   *   status:    'started' | 'ended' | 'missed'
   *   duration:  number    — seconds; 0 while ongoing
   *   timestamp: number
   * }
   */
  client.events.on('call', (event) => {
    const ts  = new Date(event.timestamp).toLocaleTimeString();
    const dur = event.duration > 0 ? ` (${event.duration}s)` : '';
    console.log(`[${ts}] [call:${event.status}] ${event.callType}${dur}`);
    console.log(`  Thread: ${event.threadID}`);
    console.log(`  Caller: ${event.callerID}`);
    console.log(`  CallID: ${event.callID || '(unknown)'}`);
    console.log();
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  client.events.on('error', (err) => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down…');
    client.disconnect();
    process.exit(0);
  });

  await client.listen();
}

main().catch((err) => {
  console.error('Startup error:', err.message);
  process.exit(1);
});
