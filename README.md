# Kaisha

[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.2.0-orange)](CHANGELOG.md)

**Kaisha** is a production-ready Facebook Messenger library for Node.js 22+.

Built for developers who need a reliable, fully typed, and extensible foundation
for Messenger bots and automation tools, Kaisha provides real-time event
streaming over MQTT/WebSocket, a composable plugin and middleware system,
AES-256-GCM encrypted session storage, connection health monitoring with
automatic recovery, and a suite of dedicated managers for caching, retrying,
and dispatching HTTP requests — all with zero unnecessary dependencies.

---

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Features](#features)
- [Authentication](#authentication)
- [Messaging](#messaging)
- [Real-Time Events](#real-time-events)
- [Conversation Management](#conversation-management)
- [Group Management](#group-management)
- [Message History & Search](#message-history--search)
- [Media](#media)
- [Cache Manager](#cache-manager)
- [Retry Manager](#retry-manager)
- [Request Manager](#request-manager)
- [Security](#security)
- [Connection Health](#connection-health)
- [Error Handling](#error-handling)
- [Plugin System](#plugin-system)
- [Middleware](#middleware)
- [Logger](#logger)
- [Configuration](#configuration)
- [TypeScript](#typescript)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Repository Structure](#repository-structure)
- [Contributing](#contributing)
- [Author](#author)
- [Credits](#credits)
- [License](#license)

---

## Requirements

- **Node.js ≥ 22.0.0**
- npm ≥ 10

---

## Installation

```bash
git clone https://github.com/whajqqbqkwjuw-oss/kaisha-fca.git
cd kaisha
npm install
```

Verify the installation:

```bash
npm run verify
# Exports OK: AttachmentError, AuthenticationError, ConfigurationError, …
```

---

## Quick Start

```js
const { login } = require('./src');
const appstate  = require('./appstate.json');

const client = await login({ type: 'appstate', appstate });

await client.listen();

client.events.on('message', async (event) => {
  if (event.body === '!ping') {
    await client.api.sendMessage(event.threadID, 'Pong! 🏓');
  }
});

process.on('SIGINT', () => { client.disconnect(); process.exit(0); });
```

---

## Features

### Authentication
- Email and password login
- Appstate (cookie array) login — no re-login required
- Session management with disk serialisation
- Encrypted session backup and restore (AES-256-GCM)

### Messaging
- Send message
- Reply to a message
- Quote reply (blockquote-style preview)
- React to a message / remove reaction
- Unsend a message
- Forward a message to one or more threads
- Send image
- Send multiple attachments (up to 25 per message)
- Send voice message
- Send document

### Thread State
- Mark conversation as read
- Mark conversation as unread
- Auto-read / auto-seen incoming messages
- Typing indicator (start / stop)

### Real-Time Events (MQTT/WebSocket)
- `message` — new incoming message
- `message:reply` / `reply` — reply to a message
- `message:react` — reaction added or removed
- `message:unsend` / `unsend` — message deleted by sender
- `message:seen` / `seen` — thread read by a participant
- `typing` — user started or stopped typing
- `presence` — contact online / offline status
- `participant:join` / `user:added` — member(s) joined a group
- `participant:leave` / `user:removed` — member(s) left or were removed
- `admin:promote` — participant promoted to admin
- `admin:demote` — admin demoted to participant
- `group:name` — group renamed
- `group:photo` — group photo changed
- `group:emoji` / `emoji:change` — group emoji changed
- `nickname:change` — participant nickname changed
- `theme:change` — thread theme / colour changed
- `thread:update` — any thread-level metadata change
- `poll` — poll created, voted on, or updated
- `approval:mode` — group approval mode toggled
- `approval:request` — join request in an approval-mode group
- `call` — call started, ended, or missed

### Conversation Management
- Fetch inbox thread list
- Fetch group conversations only
- Fetch recent conversations (sorted by last activity)
- Fetch unread conversations
- Archive / unarchive conversation
- Mute / unmute conversation
- Search threads by name or participant

### Group Management
- Create group
- Add members
- Remove member
- Rename group
- Change group emoji
- Change group photo
- Change participant nickname
- Promote group admin
- Demote group admin
- Leave group

### Message History & Search
- Fetch message history (paginated, newest-first)
- Search messages within a thread

### Media
- Download attachments to disk or into memory (Buffer)
- Fetch shared media (images, videos, files, audio)

### Managers
- **Cache Manager** — in-process, TTL-aware, LRU-bounded cache
- **Retry Manager** — exponential-backoff retry with predicate and timeout
- **Request Manager** — signed Facebook API façade with integrated cache and retry

### Security
- AES-256-GCM encrypted file storage
- Encrypted credential vault
- Encrypted local cache with TTL
- Encrypted token manager
- Session backup and restore

### Infrastructure
- MQTT/WebSocket connection with automatic exponential-backoff reconnection
- Connection health monitor with configurable thresholds and auto-recovery
- Composable plugin system
- Composable middleware pipeline
- Structured, namespaced, ANSI-coloured logger with `child()` and `withFields()`
- Centralised configuration loader with full validation
- Typed error hierarchy (`toJSON()` for structured logging)
- Complete TypeScript declarations
- Zero unnecessary runtime dependencies

### Data
- Fetch thread information
- Fetch thread participants (with admin status and nickname)
- Fetch user information
- Fetch extended user profile
- Search users
- Fetch friend list

---

## Authentication

### Email and password

```js
const client = await login({
  type:     'email',
  email:    'you@example.com',
  password: 'yourpassword',
});
```

### Appstate (cookie array)

```js
const appstate = require('./appstate.json');
const client   = await login({ type: 'appstate', appstate });
```

### Save and restore sessions

```js
const { backupSession, restoreSession } = require('./src');

// Encrypt and save the live session
backupSession(client.session, './backup.enc', 'my-passphrase');

// Restore for a later run (no re-login required)
const data     = restoreSession('./backup.enc', 'my-passphrase');
const appstate = Object.entries(data.cookies).map(([name, value]) => ({
  name, value, domain: '.facebook.com', path: '/', secure: true,
}));
const client2  = await login({ type: 'appstate', appstate });
```

---

## Messaging

```js
// Send
await client.api.sendMessage('<threadID>', 'Hello!');

// Reply
await client.api.replyMessage('<threadID>', 'Got it!', '<messageID>');

// Quote reply
await client.api.quoteReply('<threadID>', '<messageID>', 'Original text', 'My reply');

// Forward to multiple threads
const results = await client.api.forwardMessage('<msgID>', '<srcThread>', ['<destA>', '<destB>']);

// Reactions
await client.api.reactToMessage('<msgID>', '<threadID>', '😍');
await client.api.removeReaction('<msgID>', '<threadID>');

// Unsend
await client.api.unsendMessage('<msgID>');

// Image  (data: file path string | Buffer | Readable stream)
await client.api.sendImage(
  '<threadID>',
  { data: '/path/photo.jpg', filename: 'photo.jpg' },
  'Optional caption'
);

// Multiple attachments (max 25)
await client.api.sendAttachments('<threadID>', [
  { data: '/path/a.png', filename: 'a.png' },
  { data: '/path/b.pdf', filename: 'b.pdf' },
], 'Files attached');

// Voice message
await client.api.sendVoiceMessage('<threadID>', {
  data: '/path/voice.ogg', filename: 'voice.ogg'
});

// Document
await client.api.sendDocument(
  '<threadID>',
  { data: '/path/report.pdf', filename: 'report.pdf' },
  'Please review this.'
);

// Thread state
await client.api.markAsRead('<threadID>');
await client.api.markAsUnread('<threadID>');
await client.api.startTyping('<threadID>');          // DM
await client.api.startTyping('<threadID>', true);    // group
await client.api.stopTyping('<threadID>');
```

---

## Real-Time Events

Call `await client.listen()` before registering listeners.

### Core events

```js
client.events.on('message',        (e) => { /* MessageEvent  */ });
client.events.on('message:reply',  (e) => { /* MessageEvent  */ });
client.events.on('message:react',  (e) => { /* ReactionEvent */ });
client.events.on('message:unsend', (e) => { /* UnsendEvent   */ });
client.events.on('message:seen',   (e) => { /* SeenEvent     */ });
client.events.on('typing',         (e) => { /* TypingEvent   */ });
client.events.on('presence',       (e) => { /* PresenceEvent */ });
```

### Group events

```js
client.events.on('participant:join',  (e) => { /* { threadID, actorID, addedIDs, timestamp }   */ });
client.events.on('participant:leave', (e) => { /* { threadID, actorID, removedIDs, timestamp } */ });
client.events.on('admin:promote',     (e) => { /* { threadID, actorID, targetID, timestamp }   */ });
client.events.on('admin:demote',      (e) => { /* { threadID, actorID, targetID, timestamp }   */ });
client.events.on('group:name',        (e) => { /* { threadID, actorID, name, timestamp }       */ });
client.events.on('group:photo',       (e) => { /* { threadID, actorID, photoURL, timestamp }   */ });
client.events.on('group:emoji',       (e) => { /* { threadID, actorID, emoji, timestamp }      */ });
client.events.on('poll',              (e) => { /* PollEvent                                     */ });
```

### Named aliases (fired alongside their canonical counterparts)

```js
client.events.on('reply',             (e) => { /* alias for message:reply    */ });
client.events.on('unsend',            (e) => { /* alias for message:unsend   */ });
client.events.on('seen',              (e) => { /* alias for message:seen     */ });
client.events.on('user:added',        (e) => { /* alias for participant:join */ });
client.events.on('user:removed',      (e) => { /* alias for participant:leave*/ });
client.events.on('emoji:change',      (e) => { /* alias for group:emoji      */ });
client.events.on('nickname:change',   (e) => { /* NicknameChangeEvent        */ });
client.events.on('theme:change',      (e) => { /* ThemeChangeEvent           */ });
client.events.on('thread:update',     (e) => { /* ThreadUpdateEvent          */ });
client.events.on('approval:mode',     (e) => { /* platform-dependent         */ });
client.events.on('approval:request',  (e) => { /* platform-dependent         */ });
client.events.on('call',              (e) => { /* platform-dependent         */ });
```

### Lifecycle events

```js
client.events.on('ready',        ()     => { /* MQTT ready to receive  */ });
client.events.on('connected',    ()     => { /* WebSocket established  */ });
client.events.on('disconnected', (code) => { /* connection closed      */ });
client.events.on('reconnecting', ()     => { /* reconnect in progress  */ });
client.events.on('error',        (err)  => { /* fatal Error            */ });
```

### Event payload shapes

```ts
MessageEvent         { type, messageID, threadID, senderID, body, timestamp, isGroup, attachments, replyToMessageID }
ReactionEvent        { type, messageID, threadID, senderID, reaction, action }
UnsendEvent          { type, messageID, threadID, senderID, timestamp }
TypingEvent          { type, threadID, senderID, isTyping, isGroup }
SeenEvent            { type, threadID, readerID, messageID, timestamp }
PresenceEvent        { type, userID, isActive, lastActive }
ParticipantJoinEvent { type, threadID, actorID, addedIDs[], timestamp }
ParticipantLeaveEvent{ type, threadID, actorID, removedIDs[], timestamp }
AdminPromoteEvent    { type, threadID, actorID, targetID, timestamp }
AdminDemoteEvent     { type, threadID, actorID, targetID, timestamp }
GroupNameEvent       { type, threadID, actorID, name, timestamp }
GroupPhotoEvent      { type, threadID, actorID, photoURL, timestamp }
GroupEmojiEvent      { type, threadID, actorID, emoji, timestamp }
PollEvent            { type, threadID, actorID, action, pollID, question, options[], timestamp }
NicknameChangeEvent  { type, threadID, actorID, targetID, nickname, timestamp }
ThemeChangeEvent     { type, threadID, actorID, theme, themeName, timestamp }
ApprovalModeEvent    { type, threadID, actorID, enabled, timestamp }
ApprovalRequestEvent { type, threadID, actorID, requesterID, timestamp }
CallEvent            { type, threadID, callID, callerID, callType, status, duration, timestamp }
ThreadUpdateEvent    { type, updateType, threadID, actorID, timestamp, data }
```

---

## Conversation Management

```js
const threads = await client.api.fetchThreadList({ limit: 20 });
const groups  = await client.api.fetchGroupList({ limit: 20 });
const recent  = await client.api.fetchRecentConversations({ limit: 10 });
const unread  = await client.api.fetchUnreadConversations({ limit: 20 });
const results = await client.api.searchThreads('family', { limit: 10 });

await client.api.archiveConversation('<threadID>');
await client.api.unarchiveConversation('<threadID>');
await client.api.muteConversation('<threadID>', 3600);   // 1 hour in seconds
await client.api.muteConversation('<threadID>', -1);     // indefinitely
await client.api.unmuteConversation('<threadID>');
```

`ThreadListItem` shape:

```ts
{
  threadID, name, isGroup, lastMessage, lastTimestamp,
  participantIDs, unreadCount, imageSrc, isArchived, isMuted
}
```

---

## Group Management

```js
const g = await client.api.createGroup(['uid1', 'uid2'], 'Group Name');
await client.api.addMembers('<threadID>', ['uid3', 'uid4']);
await client.api.removeMember('<threadID>', 'uid3');
await client.api.renameGroup('<threadID>', 'New Name');
await client.api.changeGroupEmoji('<threadID>', '🔥');
await client.api.changeGroupPhoto('<threadID>', { data: '/photo.jpg', filename: 'photo.jpg' });
await client.api.changeNickname('<threadID>', '<uid>', 'Nickname'); // '' to clear
await client.api.promoteAdmin('<threadID>', '<uid>');
await client.api.demoteAdmin('<threadID>', '<uid>');
await client.api.leaveGroup('<threadID>');
```

---

## Message History & Search

```js
// Most recent page
const page  = await client.api.fetchMessageHistory('<threadID>', { limit: 20 });
// { messages: HistoryMessage[], hasMore: boolean, nextBefore: number|null }

// Next (older) page
const page2 = await client.api.fetchMessageHistory('<threadID>', {
  limit:  20,
  before: page.nextBefore,
});

// Search within a thread
const msgs = await client.api.searchMessages('<threadID>', 'hello', { limit: 20 });
```

---

## Media

```js
// Download to disk
const [r] = await client.api.downloadAttachments(
  [{ url: 'https://cdn.fbsbx.com/…', filename: 'photo.jpg' }],
  { destDir: './downloads' }
);
// r.savedTo, r.size, r.mimeType

// Download into memory (omit destDir)
const [m] = await client.api.downloadAttachments([{ url: '…' }]);
// m.buffer, m.mimeType, m.filename, m.size

// Shared media
const media = await client.api.fetchSharedMedia('<threadID>', {
  type:   'images',   // 'images' | 'videos' | 'files' | 'audio' | 'all'
  limit:  20,
  offset: 0,
});
// { items: NormalisedAttachment[], total: number, hasMore: boolean }
```

---

## Cache Manager

A standalone, TTL-aware, LRU-bounded in-memory cache.

```js
const { createCacheManager } = require('./src');
// or: require('kaisha/cache')

const cache = createCacheManager({
  defaultTtlMs:    60_000,   // 1-minute default TTL
  maxSize:         500,      // evict oldest entry when full
  sweepIntervalMs: 120_000,  // background expiry sweep interval
});

// Store and retrieve
cache.set('user:123', { name: 'Alice' });
const user = cache.get('user:123');                    // { name: 'Alice' }
cache.has('user:123');                                 // true

// Per-entry TTL override
cache.set('token', 'abc', 5_000);                     // expires in 5 s

// Async cache-aside loader
const thread = await cache.getOrFetch(
  'thread:456',
  () => client.api.fetchThreadInfo('456'),
  30_000
);

// Statistics
console.log(cache.stats());
// { size: 2, hits: 1, misses: 1, evictions: 0 }

// Manual eviction
cache.delete('user:123');
cache.clear();

// Stop background sweep before process exit
cache.stop();
```

| Method                                     | Description                              |
|--------------------------------------------|------------------------------------------|
| `set(key, value, ttlMs?)`                  | Store a value with optional TTL override |
| `get(key)`                                 | Retrieve value (`undefined` if expired)  |
| `has(key)`                                 | Non-expired key check                    |
| `delete(key)`                              | Remove one entry                         |
| `clear()`                                  | Remove all entries                       |
| `getOrFetch(key, loader, ttlMs?)`          | Async cache-aside helper                 |
| `keys()`                                   | All non-expired keys                     |
| `stats()`                                  | `{ size, hits, misses, evictions }`      |
| `stop()`                                   | Stop background sweep timer              |

---

## Retry Manager

Configurable exponential-backoff retry wrapper, independent of any transport.

```js
const { createRetryManager } = require('./src');
// or: require('kaisha/retry')

const retry = createRetryManager({
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs:  15_000,
  jitterMs:    200,
  timeoutMs:   8_000,            // per-attempt timeout
  shouldRetry: (err) => !(err instanceof ValidationError),
  onRetry:     (err, n, delay) =>
    console.warn(`Retry ${n} in ${delay}ms: ${err.message}`),
});

// Execute with retry
const result = await retry.execute(() => fetch('https://api.example.com'));

// Wrap a function permanently
const safeFetch = retry.wrap(fetch);
const res       = await safeFetch('https://api.example.com');
```

| Method          | Description                                              |
|-----------------|----------------------------------------------------------|
| `execute(fn)`   | Runs `fn`, retrying on errors per the configured policy  |
| `wrap(fn)`      | Returns a permanently-wrapped async function             |

---

## Request Manager

High-level Facebook API façade with integrated retry and caching.
Available as `client.request` on every connected `KaishaClient`.

```js
// Signed POST — retried automatically on network errors
const data = await client.request.post(
  'https://www.facebook.com/chat/user_info/',
  { ids: '[123]', fields: 'name,picture' }
);

// Cached POST — second call with the same key returns from cache
const threadInfo = await client.request.cachedPost(
  `thread:${threadID}`,
  'https://www.facebook.com/chat/thread_info/',
  { id: threadID },
  60_000       // 60-second TTL
);

// GraphQL query
const gqlData = await client.request.graphql('4221144941262266', { userID });

// Cache management
console.log(client.request.cacheStats());
// { size: 1, hits: 1, misses: 1, evictions: 0 }

client.request.invalidate(`thread:${threadID}`);
client.request.clearCache();
```

Standalone (without a `KaishaClient`):

```js
const { createRequestManager } = require('./src');

const rm = createRequestManager(session, httpClient, logger, {
  maxRetries:   3,
  retryDelay:   1_000,
  cacheTtlMs:   30_000,
  maxCacheSize: 200,
});
```

| Method                                    | Description                          |
|-------------------------------------------|--------------------------------------|
| `post(url, extra?, headers?)`             | Signed POST with retry               |
| `cachedPost(key, url, extra?, ttlMs?)`    | POST with result cached              |
| `graphql(docID, variables)`               | Facebook GraphQL query               |
| `buildBody(extra?)`                       | Build signed form body string        |
| `parseFB(raw)`                            | Strip `for(;;);` and parse JSON      |
| `cacheStats()`                            | Cache statistics snapshot            |
| `invalidate(key)`                         | Remove one cached entry              |
| `clearCache()`                            | Empty the entire request cache       |

---

## Security

All encryption uses Node.js built-in `crypto`. **Zero additional dependencies.**

| Property       | Value                                   |
|----------------|-----------------------------------------|
| Algorithm      | AES-256-GCM                             |
| Key derivation | PBKDF2-SHA-512, 210 000 iterations      |
| Salt           | 32 random bytes per file                |
| IV             | 16 random bytes per encryption          |
| Auth tag       | 16 bytes (GCM authentication)           |
| Write strategy | Atomic — temp file + `fs.renameSync`    |

```js
const {
  createSecureStorage,
  createCredentialVault,
  createEncryptedCache,
  createTokenManager,
  backupSession,
  restoreSession,
} = require('./src');
// or: require('kaisha/secure')

// Encrypted file store — any JSON-serialisable value
const store = createSecureStorage('./data.enc', 'passphrase');
store.save({ cookies: { c_user: '123' } });
const obj = store.load();
store.exists();   // true
store.delete();

// Credential vault
const vault = createCredentialVault('./creds.enc', 'passphrase');
vault.set('email',    'user@example.com');
vault.set('password', 'secret');
vault.save();
vault.load();
const email = vault.get('email');
vault.remove('password');
vault.clear();

// Encrypted cache with TTL
const cache = createEncryptedCache('./cache.enc', 'passphrase');
cache.set('profile:123', { name: 'Alice' }, 3600); // 1-hour TTL (seconds)
const p = cache.get('profile:123');                // undefined when expired
cache.save();
cache.load();

// Token manager
const tm = createTokenManager('./tokens.enc', 'passphrase');
tm.setToken('dtsg', client.session.data.dtsg, 3600);
const dtsg = tm.getToken('dtsg');    // null when expired
tm.isExpired('dtsg');                // boolean
tm.removeToken('dtsg');
tm.save();
tm.load();

// Session backup / restore
backupSession(client.session, './backup.enc', 'passphrase');
const sessionData = restoreSession('./backup.enc', 'passphrase');
```

---

## Connection Health

```js
const client = await login(credentials, {
  health: {
    enabled:             true,
    intervalMs:          30_000,   // check every 30 s
    timeoutMs:           10_000,   // per-check timeout
    degradedThreshold:   2,        // consecutive fails → 'degraded'
    unhealthyThreshold:  5,        // consecutive fails → 'unhealthy'
    autoRecover:         true,     // reconnect automatically
    recoverAfterFails:   5,        // trigger recovery after N fails
  },
});

const r = client.health.report();
// {
//   status:           'healthy' | 'degraded' | 'unhealthy' | 'recovering'
//   isConnected:      boolean
//   consecutiveFails: number
//   totalChecks:      number
//   totalFailures:    number
//   uptimeMs:         number
//   lastCheckAt:      number   (ms timestamp)
//   lastSuccessAt:    number   (ms timestamp)
// }

await client.health.check();  // run one check immediately
client.health.start();        // start the periodic monitor
client.health.stop();         // stop the monitor
```

Health status thresholds:

| `consecutiveFails`    | `status`      |
|-----------------------|---------------|
| 0                     | `healthy`     |
| < `degradedThreshold` | `healthy`     |
| ≥ `degradedThreshold` | `degraded`    |
| ≥ `unhealthyThreshold`| `unhealthy`   |
| during auto-recovery  | `recovering`  |

---

## Error Handling

Kaisha throws typed errors so consumers can catch specific failure categories.

```js
const {
  KaishaError,
  AuthenticationError,
  NetworkError,
  RateLimitError,
  ConnectionError,
  SessionError,
  PluginError,
  ConfigurationError,
  AttachmentError,
  ValidationError,
} = require('./src');

try {
  const client = await login(credentials);
} catch (err) {
  if (err instanceof AuthenticationError) {
    console.error('Bad credentials:', err.message);
  } else if (err instanceof RateLimitError) {
    const wait = err.retryAfterMs ?? 60_000;
    await new Promise(r => setTimeout(r, wait));
  } else if (err instanceof NetworkError) {
    console.error(`HTTP ${err.statusCode}:`, err.message);
  } else if (err instanceof SessionError) {
    console.error('Session invalid:', err.message);
  } else if (err instanceof ValidationError) {
    console.error(`Invalid argument "${err.field}":`, err.message);
  } else {
    throw err;
  }
}

// Every typed error has toJSON() for structured logging
console.log(JSON.stringify(err.toJSON()));
// { "name": "NetworkError", "message": "…", "statusCode": 500 }
```

---

## Plugin System

Plugins are plain objects with a `name` string and an `install(client, options)`
function. Install them before calling `listen()`.

```js
const WelcomePlugin = {
  name:    'WelcomePlugin',
  version: '1.0.0',

  install(client, options) {
    const greeting = options.greeting ?? 'Welcome!';

    client.events.on('user:added', async (event) => {
      for (const uid of event.addedIDs) {
        await client.api.sendMessage(event.threadID, `${greeting} ${uid} 👋`);
      }
    });
  },
};

await client.use(WelcomePlugin, { greeting: 'Hello!' });

console.log(client.plugins.installedPlugins()); // ['WelcomePlugin']
```

Plugin `install()` may be async. If it throws, the plugin is removed from the
registry and a `PluginError` is propagated.

---

## Middleware

Middleware wraps every outgoing `api.*` call in a composable pipeline.
Functions are registered in FIFO order and each receives a `MiddlewareContext`
and a `next` function.

```js
// Logging middleware
client.addMiddleware(async (ctx, next) => {
  const start = Date.now();
  await next();
  console.log(`${ctx.method} → ${Date.now() - start}ms`);
});

// Rate-limiting middleware
let lastSendAt = 0;
client.addMiddleware(async (ctx, next) => {
  if (ctx.method === 'sendMessage') {
    const wait = 1_000 - (Date.now() - lastSendAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastSendAt = Date.now();
  }
  await next();
});

// Short-circuit middleware (do not call next)
client.addMiddleware(async (ctx, next) => {
  if (ctx.method === 'sendMessage' && ctx.args[1].includes('blocked')) {
    ctx.result = { messageID: null };
    return;
  }
  await next();
});
```

`MiddlewareContext`: `{ method: string; args: unknown[]; result: unknown }`

---

## Logger

```js
const { createLogger } = require('./src');
// or: require('kaisha/logger')

const logger = createLogger({ namespace: 'MyBot', level: 'debug' });

logger.info('Application started');
logger.debug('Connecting…');
logger.warn('Rate limit approaching');
logger.error('Connection lost');

// Child logger — inherits parent level, appends namespace
const apiLog = logger.child('API');
apiLog.info('Fetching thread info');
// → … [MyBot:API] INFO  Fetching thread info

// withFields — prepends structured key-value pairs to every line
const reqLog = apiLog.withFields({ threadID: '123', attempt: 1 });
reqLog.info('Sending message');
// → … [MyBot:API] INFO  threadID=123 attempt=1 Sending message

// Chain child() and withFields()
reqLog.child('Upload').debug('Uploading 2 files');
// → … [MyBot:API:Upload] DEBUG threadID=123 attempt=1 Uploading 2 files
```

Log levels: `debug` · `info` · `warn` · `error` · `silent`

---

## Configuration

All fields are optional; defaults are shown. Invalid values throw a
`ConfigurationError` at startup.

```js
const client = await login(credentials, {
  logLevel:              'info',      // 'debug'|'info'|'warn'|'error'|'silent'
  timeout:               30_000,      // HTTP request timeout (ms)
  maxRetries:            3,           // HTTP retry attempts
  retryDelay:            1_000,       // base retry delay (ms, exponential backoff)
  maxReconnectAttempts:  10,          // MQTT reconnection limit
  reconnectBaseDelay:    2_000,       // MQTT backoff base (ms)
  userAgent:             undefined,   // custom HTTP User-Agent string
  autoRead:              false,       // auto-mark incoming threads as read
  autoSeen:              false,       // alias for autoRead
  health: {
    enabled:              true,
    intervalMs:           30_000,
    timeoutMs:            10_000,
    degradedThreshold:    2,
    unhealthyThreshold:   5,
    autoRecover:          true,
    recoverAfterFails:    5,
  },
});
```

---

## TypeScript

Kaisha ships `types/index.d.ts` with complete declarations for every public
API.  The generic `KaishaEventPayloadMap` enables compile-time payload
inference on `events.on()`.

```ts
import { login, MessageEvent, ParticipantJoinEvent } from './src';

const client = await login({ type: 'appstate', appstate });

// Payload inferred as MessageEvent
client.events.on('message', (event) => {
  console.log(event.body, event.replyToMessageID);
});

// Payload inferred as ParticipantJoinEvent
client.events.on('participant:join', (event) => {
  console.log(event.addedIDs);
});
```

Sub-path imports resolve to the same declaration file:

```ts
import { createCacheManager }   from 'kaisha/cache';
import { createRetryManager }   from 'kaisha/retry';
import { createRequestManager } from 'kaisha/request';
import { createSecureStorage }  from 'kaisha/secure';
import { createLogger }         from 'kaisha/logger';
import { loadFromAppState }     from 'kaisha/session';
import { createHealthMonitor }  from 'kaisha/health';
```

---

## API Reference

### `login(credentials, config?) → Promise<KaishaClient>`

| Parameter               | Type                   | Required | Description             |
|-------------------------|------------------------|----------|-------------------------|
| `credentials.type`      | `'email'│'appstate'`   | ✓        | Authentication method   |
| `credentials.email`     | `string`               | email    | Facebook email address  |
| `credentials.password`  | `string`               | email    | Facebook password       |
| `credentials.appstate`  | `AppStateCookie[]`     | appstate | Browser cookie array    |

### `KaishaClient`

| Member              | Type                    | Description                          |
|---------------------|-------------------------|--------------------------------------|
| `events`            | `KaishaEventEmitter`    | Typed event bus                      |
| `api`               | `MessengerAPI`          | All Messenger action methods         |
| `session`           | `Session`               | Live session state                   |
| `plugins`           | `PluginSystem`          | Plugin registry + middleware         |
| `health`            | `HealthMonitorInstance` | Connection health monitor            |
| `request`           | `RequestManager`        | Signed HTTP façade with cache+retry  |
| `listen()`          | `→ Promise<void>`       | Connect MQTT, start receiving        |
| `disconnect()`      | `→ void`                | Graceful shutdown, cache cleared     |
| `isConnected()`     | `→ boolean`             | Current MQTT state                   |
| `use(plugin, opts)` | `→ Promise<void>`       | Install a plugin                     |
| `addMiddleware(fn)` | `→ void`                | Append a middleware function         |

### `MessengerAPI` — full method list

| Method                                               | Returns                         |
|------------------------------------------------------|---------------------------------|
| `sendMessage(threadID, message)`                     | `Promise<{messageID}>`          |
| `replyMessage(threadID, message, replyToMsgID)`      | `Promise<{messageID}>`          |
| `quoteReply(threadID, replyToMsgID, quote, body)`    | `Promise<{messageID}>`          |
| `reactToMessage(messageID, threadID, emoji)`         | `Promise<void>`                 |
| `removeReaction(messageID, threadID)`                | `Promise<void>`                 |
| `unsendMessage(messageID)`                           | `Promise<void>`                 |
| `forwardMessage(msgID, srcThread, destThreads[])`    | `Promise<ForwardResult[]>`      |
| `sendImage(threadID, source, caption?)`              | `Promise<{messageID}>`          |
| `sendAttachments(threadID, sources[], caption?)`     | `Promise<{messageID}>`          |
| `sendVoiceMessage(threadID, source)`                 | `Promise<{messageID}>`          |
| `sendDocument(threadID, source, caption?)`           | `Promise<{messageID}>`          |
| `markAsRead(threadID)`                               | `Promise<void>`                 |
| `markAsUnread(threadID)`                             | `Promise<void>`                 |
| `startTyping(threadID, isGroup?)`                    | `Promise<void>`                 |
| `stopTyping(threadID, isGroup?)`                     | `Promise<void>`                 |
| `fetchMessageHistory(threadID, opts?)`               | `Promise<MessageHistoryPage>`   |
| `searchMessages(threadID, query, opts?)`             | `Promise<MessageSearchResult[]>`|
| `downloadAttachments(items[], opts?)`                | `Promise<DownloadResult[]>`     |
| `fetchSharedMedia(threadID, opts?)`                  | `Promise<SharedMediaPage>`      |
| `createGroup(participantIDs[], name?)`               | `Promise<CreateGroupResult>`    |
| `addMembers(threadID, userIDs[])`                    | `Promise<void>`                 |
| `removeMember(threadID, userID)`                     | `Promise<void>`                 |
| `renameGroup(threadID, name)`                        | `Promise<void>`                 |
| `changeGroupEmoji(threadID, emoji)`                  | `Promise<void>`                 |
| `changeGroupPhoto(threadID, source)`                 | `Promise<void>`                 |
| `changeNickname(threadID, userID, nickname)`         | `Promise<void>`                 |
| `promoteAdmin(threadID, userID)`                     | `Promise<void>`                 |
| `demoteAdmin(threadID, userID)`                      | `Promise<void>`                 |
| `leaveGroup(threadID)`                               | `Promise<void>`                 |
| `fetchThreadList(opts?)`                             | `Promise<ThreadListItem[]>`     |
| `fetchGroupList(opts?)`                              | `Promise<ThreadListItem[]>`     |
| `fetchRecentConversations(opts?)`                    | `Promise<ThreadListItem[]>`     |
| `fetchUnreadConversations(opts?)`                    | `Promise<ThreadListItem[]>`     |
| `archiveConversation(threadID)`                      | `Promise<void>`                 |
| `unarchiveConversation(threadID)`                    | `Promise<void>`                 |
| `muteConversation(threadID, muteSeconds?)`           | `Promise<void>`                 |
| `unmuteConversation(threadID)`                       | `Promise<void>`                 |
| `searchThreads(query, opts?)`                        | `Promise<ThreadSearchResult[]>` |
| `fetchThreadInfo(threadID)`                          | `Promise<ThreadInfo>`           |
| `fetchThreadParticipants(threadID)`                  | `Promise<ThreadParticipant[]>`  |
| `fetchUserInfo(userID)`                              | `Promise<UserInfo>`             |
| `fetchUserProfile(userID)`                           | `Promise<UserProfile>`          |
| `searchUsers(query, opts?)`                          | `Promise<SearchResult[]>`       |
| `fetchFriendList(opts?)`                             | `Promise<FriendEntry[]>`        |

### Security API

| Export                                          | Description                          |
|-------------------------------------------------|--------------------------------------|
| `createSecureStorage(file, passphrase)`         | AES-256-GCM encrypted file store     |
| `createCredentialVault(file, passphrase)`       | Encrypted key-value credential map   |
| `createEncryptedCache(file, passphrase)`        | Encrypted cache with TTL             |
| `createTokenManager(file, passphrase)`          | Encrypted short-lived token store    |
| `backupSession(session, file, passphrase)`      | Encrypt and save session to disk     |
| `restoreSession(file, passphrase)`              | Decrypt and return session data      |

### Manager APIs

| Export                                                       | Description                    |
|--------------------------------------------------------------|--------------------------------|
| `createCacheManager(opts?)`                                  | In-memory TTL cache            |
| `createRetryManager(opts?)`                                  | Exponential-backoff retry      |
| `createRequestManager(session, http, logger, opts?)`         | Facebook API façade            |

### Health API (`client.health`)

| Method    | Returns                  | Description                   |
|-----------|--------------------------|-------------------------------|
| `start()` | `void`                   | Begin periodic health checks  |
| `stop()`  | `void`                   | Stop the monitor              |
| `report()`| `Readonly<HealthReport>` | Frozen status snapshot        |
| `check()` | `Promise<HealthReport>`  | Run one check immediately     |

---

## Events Reference

| Event               | Alias(es)               | Description                              |
|---------------------|-------------------------|------------------------------------------|
| `ready`             | —                       | MQTT ready to receive                    |
| `connected`         | —                       | WebSocket established                    |
| `disconnected`      | —                       | Connection closed                        |
| `reconnecting`      | —                       | Reconnect in progress                    |
| `error`             | —                       | Fatal error                              |
| `message`           | —                       | New incoming message                     |
| `message:reply`     | `reply`                 | Reply to a message                       |
| `message:react`     | —                       | Reaction added or removed                |
| `message:unsend`    | `unsend`                | Message deleted by sender                |
| `message:seen`      | `seen`                  | Thread read by a participant             |
| `typing`            | —                       | User started or stopped typing           |
| `presence`          | —                       | Contact online / offline status          |
| `participant:join`  | `user:added`            | Member(s) joined a group                 |
| `participant:leave` | `user:removed`          | Member(s) left or were removed           |
| `admin:promote`     | —                       | Participant promoted to admin            |
| `admin:demote`      | —                       | Admin demoted to participant             |
| `group:name`        | —                       | Group renamed                            |
| `group:photo`       | —                       | Group photo changed                      |
| `group:emoji`       | `emoji:change`          | Group emoji changed                      |
| `poll`              | —                       | Poll created, voted on, or updated       |
| `thread:update`     | —                       | Any thread-level metadata change         |
| `nickname:change`   | —                       | Participant nickname changed             |
| `theme:change`      | —                       | Thread theme / colour changed            |
| `approval:mode`     | —                       | Group approval mode toggled              |
| `approval:request`  | —                       | Join request in an approval-mode group   |
| `call`              | —                       | Call started, ended, or missed           |

---

## Examples

```bash
# Authentication
EMAIL=you@example.com PASSWORD=secret node examples/login.js
node examples/listen.js

# Messaging
THREAD_ID=123 MESSAGE="Hi!" node examples/send-message.js
THREAD_ID=123 IMAGE_PATH=/photo.jpg CAPTION="Look!" node examples/send-image.js
THREAD_ID=123 FILES="/a.jpg,/b.pdf" node examples/send-attachments.js
THREAD_ID=123 AUDIO_PATH=/voice.ogg node examples/send-voice.js
THREAD_ID=123 DOC_PATH=/report.pdf node examples/send-document.js
THREAD_ID=123 node examples/mark-read.js
THREAD_ID=123 node examples/typing.js
THREAD_ID=123 MESSAGE_ID=mid.xxx EMOJI="😍" node examples/message-reactions.js
THREAD_ID=123 MESSAGE_ID=mid.xxx QUOTE_TEXT="Original" REPLY="My reply" node examples/quote-reply.js
MESSAGE_ID=mid.xxx SOURCE_THREAD=123 DEST_THREADS="456,789" node examples/forward-message.js

# Real-time events
node examples/typing-events.js
node examples/read-events.js
node examples/group-events.js
node examples/poll-events.js
node examples/presence-events.js
node examples/named-events.js

# Conversation management
LIMIT=20 node examples/thread-list.js
LIMIT=20 node examples/group-list.js
LIMIT=10 node examples/recent-conversations.js
LIMIT=20 node examples/unread-conversations.js
THREAD_ID=123 node examples/archive-conversation.js
THREAD_ID=123 MUTE_SECONDS=3600 node examples/mute-conversation.js
QUERY="family" LIMIT=10 node examples/search-threads.js

# Message history & search
THREAD_ID=123 LIMIT=20 node examples/message-history.js
THREAD_ID=123 QUERY="hello" node examples/message-search.js

# Media
THREAD_ID=123 DEST_DIR=./downloads node examples/download-attachment.js
THREAD_ID=123 TYPE=images DOWNLOAD=1 DEST_DIR=./media node examples/shared-media.js

# Group management
PARTICIPANT_IDS="111,222,333" GROUP_NAME="My Group" node examples/create-group.js
THREAD_ID=123 ADD_IDS="444,555" REMOVE_ID="444" node examples/group-members.js
THREAD_ID=123 NAME="New Name" node examples/rename-group.js
THREAD_ID=123 EMOJI="🔥" node examples/group-emoji.js
THREAD_ID=123 IMAGE_PATH=/photo.jpg node examples/group-photo.js
THREAD_ID=123 USER_ID=456 NICKNAME="Cool Name" node examples/change-nickname.js
THREAD_ID=123 USER_ID=456 node examples/admin-controls.js
THREAD_ID=123 node examples/leave-group.js
THREAD_ID=123 node examples/thread-participants.js

# Data fetching
USER_ID=123 node examples/user-profile.js
QUERY="John Doe" node examples/search-users.js
node examples/friend-list.js

# Managers
node examples/cache-manager.js
node examples/retry-manager.js
node examples/request-manager.js
node examples/logger-fields.js

# Security
PASSPHRASE="secret" node examples/encrypted-session.js
PASSPHRASE="secret" EMAIL="you@example.com" PASSWORD="pass" node examples/secure-credentials.js
PASSPHRASE="secret" node examples/session-backup.js

# Health & reliability
node examples/health-monitor.js

# Plugin & middleware
node examples/plugin-system.js
THREAD_ID=123 node examples/middleware.js
```

---

## Repository Structure

```
kaisha/
├── src/
│   ├── index.js      # Entry point — login(), all exports
│   ├── config.js     # Configuration loader and validator
│   ├── errors.js     # Typed error hierarchy
│   ├── cache.js      # Cache Manager — TTL-aware in-memory cache
│   ├── retry.js      # Retry Manager — exponential-backoff retry
│   ├── request.js    # Request Manager — Facebook API façade
│   ├── login.js      # Authentication flows (email + appstate)
│   ├── api.js        # All MessengerAPI methods
│   ├── secure.js     # AES-256-GCM security utilities
│   ├── health.js     # Connection health monitor
│   ├── upload.js     # Multipart file upload pipeline
│   ├── download.js   # Authenticated file download pipeline
│   ├── listener.js   # MQTT payload parser and event dispatcher
│   ├── mqtt.js       # MQTT/WebSocket connection manager
│   ├── session.js    # Session state and disk serialisation
│   ├── http.js       # HTTP client with cookie management
│   ├── events.js     # Typed event emitter
│   ├── plugins.js    # Plugin system and middleware pipeline
│   ├── logger.js     # Structured, namespaced ANSI logger
│   └── utils.js      # Pure shared utility functions
├── types/
│   └── index.d.ts    # Complete TypeScript declarations
├── examples/         # 45+ runnable examples — one per feature
├── .editorconfig     # Editor formatting rules
├── .gitignore
├── .npmignore
├── jsconfig.json     # VS Code IntelliSense configuration
├── package.json
├── LICENSE
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
└── README.md
```

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md)
before opening a pull request.

To report a security vulnerability, follow the process described in
[SECURITY.md](SECURITY.md). Do not open a public GitHub issue for
security-related matters.

---

## Author

**Aldwin Padronia**

- GitHub: [https://github.com/whajqqbqkwjuw-oss](https://github.com/whajqqbqkwjuw-oss)
- Facebook: [https://www.facebook.com/Katagaki.n](https://www.facebook.com/Katagaki.n)
- Instagram: [https://www.instagram.com/kaiz3n_nnn](https://www.instagram.com/kaiz3n_nnn)

---

## Credits

Kaisha was created and is actively maintained by **Aldwin Padronia**.
All original design, architecture, implementation, and documentation are
the work of the author.

---

## License

MIT © Aldwin Padronia
