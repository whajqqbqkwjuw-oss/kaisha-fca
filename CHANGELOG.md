# Changelog

All notable changes to Kaisha are documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning: [Semantic Versioning](https://semver.org/).

---

## [1.2.0] — 2026-08-07


#### Breaking changes
_None. All existing APIs remain fully compatible._

---

### New features

#### Cache Manager (`src/cache.js`)
- Standalone, dependency-free, TTL-aware in-memory cache.
- Per-entry TTL override and global `defaultTtlMs`.
- LRU-lite eviction: oldest entry is removed when `maxSize` is reached.
- Optional background sweep timer (`sweepIntervalMs`) to eagerly evict
  expired entries; timer is `unref()`-ed so it does not block process exit.
- `getOrFetch(key, loader, ttlMs?)` — async cache-aside helper; calls `loader`
  only on a cache miss and stores the result automatically.
- `stats()` — returns a `{ size, hits, misses, evictions }` snapshot.
- `keys()` — lists all non-expired keys currently held.
- `stop()` — stops the sweep timer for clean shutdown.
- Exported from `src/index.js` as `createCacheManager`.
- Accessible via the `kaisha/cache` sub-path export.

#### Retry Manager (`src/retry.js`)
- Configurable exponential-backoff retry wrapper; fully independent of any
  HTTP transport so it can wrap any async function.
- Options: `maxAttempts`, `baseDelayMs`, `maxDelayMs`, `jitterMs`,
  `timeoutMs` (per-attempt timeout races against a rejection timer).
- `shouldRetry(err, attempt)` predicate — retry only on specific error types.
- `onRetry(err, attempt, delayMs)` callback for logging and observability.
- `execute(fn)` — runs `fn`, retrying on failure per the configured policy.
- `wrap(fn)` — returns a permanently-wrapped async function.
- Throws `NetworkError` (with the original error as `cause`) when all
  attempts are exhausted.
- Exported from `src/index.js` as `createRetryManager`.
- Accessible via the `kaisha/retry` sub-path export.

#### Request Manager (`src/request.js`)
- High-level Facebook API façade that centralises:
  - Automatic `fb_dtsg`, `jazoest`, `lsd`, and session-token injection into
    every form body (previously duplicated in every `api.js` method).
  - Consistent stripping of Facebook's `for(;;);` JSON hijacking prefix.
  - Integration with `RetryManager` so all requests benefit from the same
    configurable retry policy.
  - Integration with `CacheManager` for idempotent GET-equivalent requests.
- `post(url, extra?, headers?)` — signed POST with automatic retry.
- `cachedPost(key, url, extra?, ttlMs?)` — like `post` but caches the result.
- `graphql(docID, variables)` — executes a Facebook GraphQL query.
- `buildBody(extra?)` — builds a signed `application/x-www-form-urlencoded`
  body string (exposed for advanced use).
- `parseFB(raw)` — strips `for(;;);` and parses JSON; throws `NetworkError`
  on malformed responses.
- `cacheStats()`, `invalidate(key)`, `clearCache()` — cache management.
- Exposed on `KaishaClient` as `client.request`.
- `disconnect()` now calls `requestManager.clearCache()` so no stale data
  lingers after a session ends.
- Exported from `src/index.js` as `createRequestManager`.
- Accessible via the `kaisha/request` sub-path export.

---

### Improvements

#### `src/logger.js`
- `withFields(fields)` — creates a sibling logger that prepends structured
  key-value pairs (`key=value`) to every output line, enabling per-request
  or per-thread tracing without a separate logging library.
- `child()` now passes the resolved `_minLevel` integer to child loggers
  directly, preventing level drift when the original level string is not
  present in the level map.
- `formatValue` handles `BigInt` (rendered as `123n`), `Symbol`, and
  `undefined` explicitly, eliminating `[object Object]` surprises.

#### `src/errors.js`
- `toJSON()` method added to every error class, returning
  `{ name, message, cause? }` suitable for structured logging or HTTP
  error responses.
- `RateLimitError` added — extends `NetworkError`; carries an optional
  `retryAfterMs` field indicating how long to wait before retrying.
- `ValidationError` added — carries an optional `field` property identifying
  the failing argument name.
- All classes use `new.target.name` for the `name` property so every
  subclass reports the correct name automatically without manual assignment.
- `Error.captureStackTrace` is called in the base constructor when available
  (V8 environments) to produce cleaner stack traces.

#### `src/config.js`
- `assertRange(field, value, min, max)` helper extracted to eliminate the
  duplicated integer-validation pattern across every field check.
- Validation ranges widened to reflect real-world usage (e.g. `timeout`
  now accepts up to 600 000 ms instead of 300 000 ms).
- `DEFAULTS` exported as a named constant so external tooling can reference
  default values without instantiating a configuration object.

#### `src/index.js`
- Version bumped to `1.2.0`.
- `createCacheManager`, `createRetryManager`, and `createRequestManager`
  added to the public exports.
- `client.request` (`RequestManager`) exposed on `KaishaClient`.
- `disconnect()` calls `requestManager.clearCache()` to release memory on
  session end.
- Version string in startup log message updated to `1.2.0`.

---

### Repository additions

#### `CONTRIBUTING.md`
- Code of conduct, project structure overview, coding style guide (indentation,
  quotes, line endings, variable declarations, error types).
- Pull request process: fork, branch, syntax check, JSDoc, examples,
  CHANGELOG, PR.
- Bug reporting guide: required information (Node.js version, Kaisha version,
  reproduction script, stack trace).

#### `SECURITY.md`
- Vulnerability disclosure policy: private reporting via GitHub Security
  Advisories; 72-hour acknowledgement SLA.
- Supported versions table.
- Cryptographic design summary table.
- In-scope / out-of-scope definitions.

#### `.editorconfig`
- Enforces 2-space indentation, LF line endings, UTF-8 charset, trailing
  whitespace removal, and a final newline across all editors and operating
  systems.
- Markdown files exempt from trailing-whitespace trimming.

#### `jsconfig.json`
- Enables VS Code `checkJs` and `strictNullChecks` for the CommonJS
  codebase.
- Declares path aliases for all sub-path exports so IDE go-to-definition
  resolves correctly: `kaisha`, `kaisha/cache`, `kaisha/retry`,
  `kaisha/request`, `kaisha/secure`, `kaisha/health`, `kaisha/logger`,
  `kaisha/session`.

#### `.npmignore`
- Prevents development files, editor config, test fixtures, and sensitive
  `.enc` session files from being included in an `npm publish` artifact.

---

### package.json changes
- Version `1.2.0`.
- Sub-path exports added: `kaisha/cache`, `kaisha/retry`, `kaisha/request`.
- `CONTRIBUTING.md` and `SECURITY.md` added to the `files` array so they
  are included in npm packages.
- Keywords expanded: `cache`, `retry` added.

---

### TypeScript declarations (`types/index.d.ts`)
- `CacheManager`, `CacheStats`, `CacheManagerOptions` — full interface set
  for the Cache Manager.
- `RetryManager`, `RetryOptions` — full interface set for the Retry Manager.
- `RequestManager`, `RequestManagerOptions` — full interface set for the
  Request Manager.
- `RateLimitError` class declaration with `retryAfterMs` property.
- `ValidationError` class declaration with `field` property.
- `Logger.withFields(fields)` method added to the `Logger` interface.
- `KaishaClient.request: RequestManager` added to `KaishaClient`.

---

### Examples added
- `examples/cache-manager.js` — demonstrates TTL, `getOrFetch`, stats,
  invalidation, and the background sweep.
- `examples/retry-manager.js` — demonstrates flaky function retry, custom
  `shouldRetry` predicate, per-attempt timeout, and `wrap()`.
- `examples/request-manager.js` — demonstrates `client.request.cachedPost`,
  cache statistics, and manual invalidation against a live session.
- `examples/logger-fields.js` — demonstrates `withFields()` and `child()`
  chaining for structured per-request tracing.

---

### Documentation
- `README.md` fully rewritten:
  - Updated project description and feature list to cover every implemented
  - Node.js ≥ 22.0.0 requirement prominently stated.
  - Dedicated sections for Cache Manager, Retry Manager, Request Manager,
    Logger (`withFields`), new error types, and sub-path imports.
  - Repository structure updated to include new source files and repository
    files.
  - Contributing and Security sections added.
  - Author and Credits sections updated.

---


#### Breaking changes
_None._

### Added
- `src/config.js` — centralised `loadConfig()` validator.
- `src/errors.js` — typed error hierarchy: `KaishaError`,
  `AuthenticationError`, `NetworkError`, `ConnectionError`, `SessionError`,
  `PluginError`, `ConfigurationError`, `AttachmentError`.
- `KaishaEventEmitter.listenerCount(event)`.
- `PluginSystem.installedPlugins()` returns a frozen, sorted list.
- `types/index.d.ts` — complete TypeScript declarations.

### Changed
- Node.js engine raised to `>=22.0.0`.
- `package.json` — `exports` map, `repository`, `homepage`, `bugs`,
  expanded `keywords`, `author` as object.
- `src/utils.js` — `randomString` O(n); `deepMerge` skips `undefined`
  source values.
- `src/logger.js` — child loggers inherit the parent's resolved level integer.
- `src/events.js` — listener errors routed through `'error'` event; one-time
  listeners snapshotted before iteration.
- `src/plugins.js` — `PluginError` used; `wrapAPI` null-prototype output.
- `src/http.js` — `NetworkError` on permanent failure; frozen `BASE_HEADERS`.
- `src/session.js` — `SessionError`; atomic `save()`.
- `src/health.js` — frozen `report()` snapshots; `ConnectionError`.
- `src/mqtt.js` — `exponentialBackoff` helper; ping interval `unref`.
- `src/secure.js` — `SessionError` / `ConfigurationError`; temp-file name
  includes `Date.now()`.
- `src/index.js` — delegates to `loadConfig()`; typed errors exported.

### Fixed
- Event listener set mutation during `once` dispatch.
- `wrapAPI` producing `undefined` slots for non-function API values.
- Concurrent writes to the same secure file leaving orphaned temp files.
- `health.report()` returning a mutable object that listeners could corrupt.

---


### Added
- First complete TypeScript declaration file (`types/index.d.ts`).
- `CHANGELOG.md`.
- `exponentialBackoff()` shared utility.
- `randomString` rewritten from O(n²) to O(n).

### Changed
- `src/http.js` and `src/mqtt.js` share the `exponentialBackoff` helper.
- MQTT ping interval `unref()`-ed.
- `package.json`: `types`, `engines ≥16`, `files` array.
- Removed unused `mqtt`, `axios-cookiejar-support`, `tough-cookie` packages.

---


### Added
- Named event aliases: `reply`, `unsend`, `seen`, `user:added`,
  `user:removed`, `emoji:change`, `thread:update`, `nickname:change`,
  `theme:change`, `approval:mode`, `approval:request`, `call`.

---


### Added
- `src/secure.js` — AES-256-GCM encrypted storage, credential vault,
  cache, token manager, session backup / restore.
- `src/health.js` — connection health monitor with configurable thresholds
  and automatic MQTT session recovery.
- `client.health` exposed on `KaishaClient`.

---


### Added
- MQTT events: `participant:join`, `participant:leave`, `admin:promote`,
  `admin:demote`, `group:name`, `group:photo`, `group:emoji`, `poll`,
  `presence`.

---


### Added
- `fetchGroupList`, `fetchRecentConversations`, `fetchUnreadConversations`.
- `archiveConversation`, `unarchiveConversation`.
- `muteConversation`, `unmuteConversation`.
- `searchThreads`.
- `isArchived`, `isMuted` fields on `ThreadListItem`.

---


### Added
- `changeNickname`, `promoteAdmin`, `demoteAdmin`, `leaveGroup`.
- `removeReaction`.
- `typing` event (started / stopped typing).
- `message:seen` event (read receipts).

---


### Added
- `fetchMessageHistory` (paginated), `searchMessages`.
- `forwardMessage`, `quoteReply`.
- `sendVoiceMessage`, `sendDocument`.
- `downloadAttachments`, `fetchSharedMedia`.
- `src/download.js` — authenticated file download pipeline.

---


### Added
- `createGroup`, `addMembers`, `removeMember`, `renameGroup`.
- `changeGroupEmoji`, `changeGroupPhoto`.
- `fetchThreadParticipants`.
- `sendImage`, `sendAttachments`.
- `src/upload.js` — multipart file upload pipeline.

---


### Added
- `markAsRead`, `markAsUnread`, `startTyping`, `stopTyping`.
- `fetchThreadList`, `fetchUserProfile`, `searchUsers`, `fetchFriendList`.
- `autoRead` / `autoSeen` configuration options.
- `src/plugins.js` — plugin system and middleware pipeline.
- `client.use()`, `client.addMiddleware()`.

---


### Added
- Email / password and appstate-based authentication.
- MQTT/WebSocket connection to Facebook Messenger.
- `sendMessage`, `replyMessage`, `reactToMessage`, `unsendMessage`.
- `fetchUserInfo`, `fetchThreadInfo`.
- `message`, `message:reply`, `message:react`, `message:unsend` events.
- Automatic exponential-backoff reconnection.
- `src/index.js`, `src/login.js`, `src/api.js`, `src/listener.js`,
  `src/mqtt.js`, `src/session.js`, `src/http.js`, `src/events.js`,
  `src/logger.js`, `src/utils.js`.
