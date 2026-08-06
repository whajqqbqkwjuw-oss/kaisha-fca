/**
 * Kaisha — Facebook Messenger Library
 * Complete TypeScript declarations.
 *
 * @author Aldwin Padronia
 * @version 1.1.0
 * @license MIT
 */

import type { Readable } from 'stream';

// ─── Errors ───────────────────────────────────────────────────────────────────

export class KaishaError          extends Error { name: 'KaishaError'; }
export class AuthenticationError  extends KaishaError { name: 'AuthenticationError'; }
export class NetworkError         extends KaishaError { name: 'NetworkError'; statusCode?: number; }
export class ConnectionError      extends KaishaError { name: 'ConnectionError'; }
export class SessionError         extends KaishaError { name: 'SessionError'; }
export class PluginError          extends KaishaError { name: 'PluginError'; pluginName?: string; }
export class ConfigurationError   extends KaishaError { name: 'ConfigurationError'; }
export class AttachmentError      extends KaishaError { name: 'AttachmentError'; }

// ─── Configuration ────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface HealthConfig {
  enabled?:             boolean;
  intervalMs?:          number;
  timeoutMs?:           number;
  degradedThreshold?:   number;
  unhealthyThreshold?:  number;
  autoRecover?:         boolean;
  recoverAfterFails?:   number;
}

export interface KaishaConfig {
  logLevel?:             LogLevel;
  timeout?:              number;
  maxRetries?:           number;
  retryDelay?:           number;
  maxReconnectAttempts?: number;
  reconnectBaseDelay?:   number;
  userAgent?:            string;
  autoRead?:             boolean;
  autoSeen?:             boolean;
  health?:               HealthConfig;
}

// ─── Credentials ─────────────────────────────────────────────────────────────

export interface AppStateCookie {
  name:     string;
  value:    string;
  domain?:  string;
  path?:    string;
  secure?:  boolean;
  [key: string]: unknown;
}

export type KaishaCredentials =
  | { type: 'email';    email: string; password: string }
  | { type: 'appstate'; appstate: AppStateCookie[] };

// ─── Session ──────────────────────────────────────────────────────────────────

export interface SessionData {
  cookies:   Record<string, string>;
  userID:    string;
  clientID:  string;
  dtsg:      string;
  fbDtsgAg:  string;
  siteData:  string;
  createdAt: number;
}

export interface Session {
  readonly data: SessionData;
  getCookie(name: string): string | undefined;
  mergeCookies(cookies: Record<string, string>): void;
  toJSON(): SessionData;
  isValid(): boolean;
  save(filePath: string): void;
}

export function createSession(initial?: Partial<SessionData>): Session;
export function loadFromAppState(appstate: AppStateCookie[]): Session;

// ─── Logger ───────────────────────────────────────────────────────────────────

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(namespace: string): Logger;
}

export function createLogger(options?: { namespace?: string; level?: LogLevel }): Logger;

// ─── Events ───────────────────────────────────────────────────────────────────

export type KaishaEvent =
  | 'message'          | 'message:unsend'    | 'message:react' | 'message:reply'
  | 'connected'        | 'disconnected'      | 'reconnecting'  | 'error'          | 'ready'
  | 'typing'           | 'message:seen'
  | 'participant:join' | 'participant:leave'
  | 'admin:promote'    | 'admin:demote'
  | 'group:name'       | 'group:photo'       | 'group:emoji'
  | 'poll'             | 'presence'
  | 'reply'            | 'unsend'            | 'seen'
  | 'thread:update'    | 'nickname:change'   | 'emoji:change'  | 'theme:change'
  | 'user:added'       | 'user:removed'
  | 'approval:mode'    | 'approval:request'
  | 'call';

export interface MessageEvent {
  type:             'message';
  messageID:        string;
  threadID:         string;
  senderID:         string;
  body:             string;
  timestamp:        number;
  isGroup:          boolean;
  attachments:      unknown[];
  replyToMessageID: string | null;
}
export interface ReactionEvent {
  type: 'message:react';
  messageID: string; threadID: string; senderID: string;
  reaction: string; action: 'ADD_REACTION' | 'REMOVE_REACTION';
}
export interface UnsendEvent   { type: 'message:unsend'; messageID: string; threadID: string; senderID: string; timestamp: number; }
export interface TypingEvent   { type: 'typing';         threadID: string; senderID: string; isTyping: boolean; isGroup: boolean; }
export interface SeenEvent     { type: 'message:seen';   threadID: string; readerID: string; messageID: string; timestamp: number; }
export interface PresenceEvent { type: 'presence';       userID: string; isActive: boolean; lastActive: number; }
export interface ParticipantJoinEvent  { type: 'participant:join';  threadID: string; actorID: string; addedIDs:   string[]; timestamp: number; }
export interface ParticipantLeaveEvent { type: 'participant:leave'; threadID: string; actorID: string; removedIDs: string[]; timestamp: number; }
export interface AdminPromoteEvent  { type: 'admin:promote'; threadID: string; actorID: string; targetID: string; timestamp: number; }
export interface AdminDemoteEvent   { type: 'admin:demote';  threadID: string; actorID: string; targetID: string; timestamp: number; }
export interface GroupNameEvent     { type: 'group:name';    threadID: string; actorID: string; name: string;     timestamp: number; }
export interface GroupPhotoEvent    { type: 'group:photo';   threadID: string; actorID: string; photoURL: string; timestamp: number; }
export interface GroupEmojiEvent    { type: 'group:emoji';   threadID: string; actorID: string; emoji: string;    timestamp: number; }
export interface PollOption { optionID: string; text: string; voterIDs: string[]; }
export interface PollEvent {
  type: 'poll'; threadID: string; actorID: string;
  action: 'create' | 'vote' | 'update'; pollID: string; question: string;
  options: PollOption[]; timestamp: number;
}
export interface NicknameChangeEvent  { type: 'nickname:change';   threadID: string; actorID: string; targetID: string; nickname: string; timestamp: number; }
export interface ThemeChangeEvent     { type: 'theme:change';      threadID: string; actorID: string; theme: string; themeName: string; timestamp: number; }
export interface ApprovalModeEvent    { type: 'approval:mode';     threadID: string; actorID: string; enabled: boolean; timestamp: number; }
export interface ApprovalRequestEvent { type: 'approval:request';  threadID: string; actorID: string; requesterID: string; timestamp: number; }
export interface CallEvent {
  type: 'call'; threadID: string; callID: string; callerID: string;
  callType: 'video' | 'audio'; status: 'started' | 'ended' | 'missed';
  duration: number; timestamp: number;
}
export interface ThreadUpdateEvent {
  type: 'thread:update'; updateType: string;
  threadID: string; actorID: string; timestamp: number; data: unknown;
}

export type KaishaEventPayloadMap = {
  'message':           MessageEvent;
  'message:reply':     MessageEvent;
  'reply':             MessageEvent;
  'message:react':     ReactionEvent;
  'message:unsend':    UnsendEvent;
  'unsend':            UnsendEvent;
  'message:seen':      SeenEvent;
  'seen':              SeenEvent;
  'typing':            TypingEvent;
  'presence':          PresenceEvent;
  'participant:join':  ParticipantJoinEvent;
  'user:added':        ParticipantJoinEvent;
  'participant:leave': ParticipantLeaveEvent;
  'user:removed':      ParticipantLeaveEvent;
  'admin:promote':     AdminPromoteEvent;
  'admin:demote':      AdminDemoteEvent;
  'group:name':        GroupNameEvent;
  'group:photo':       GroupPhotoEvent;
  'group:emoji':       GroupEmojiEvent;
  'emoji:change':      GroupEmojiEvent;
  'poll':              PollEvent;
  'thread:update':     ThreadUpdateEvent;
  'nickname:change':   NicknameChangeEvent;
  'theme:change':      ThemeChangeEvent;
  'approval:mode':     ApprovalModeEvent;
  'approval:request':  ApprovalRequestEvent;
  'call':              CallEvent;
  'connected':         void;
  'disconnected':      number;
  'reconnecting':      void;
  'error':             Error;
  'ready':             void;
};

export class KaishaEventEmitter {
  on<E extends KaishaEvent>(event: E, listener: (payload: KaishaEventPayloadMap[E]) => void): this;
  once<E extends KaishaEvent>(event: E, listener: (payload: KaishaEventPayloadMap[E]) => void): this;
  off<E extends KaishaEvent>(event: E, listener: (payload: KaishaEventPayloadMap[E]) => void): this;
  emit<E extends KaishaEvent>(event: E, ...args: unknown[]): boolean;
  removeAllListeners(event?: KaishaEvent): this;
  eventNames(): KaishaEvent[];
  listenerCount(event: KaishaEvent): number;
}

// ─── Plugin system ────────────────────────────────────────────────────────────

export interface KaishaPlugin {
  name:      string;
  version?:  string;
  install(client: KaishaClient, options?: Record<string, unknown>): void | Promise<void>;
}

export interface MiddlewareContext {
  method: string;
  args:   unknown[];
  result: unknown;
}

export type MiddlewareFn = (ctx: MiddlewareContext, next: () => Promise<void>) => Promise<void>;

export interface PluginSystem {
  use(plugin: KaishaPlugin, options: Record<string, unknown>, client: KaishaClient): Promise<void>;
  addMiddleware(fn: MiddlewareFn): void;
  wrapAPI<T extends Record<string, unknown>>(api: T): T;
  installedPlugins(): readonly string[];
}

// ─── Health ───────────────────────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'recovering';

export interface HealthReport {
  readonly status:           HealthStatus;
  readonly isConnected:      boolean;
  readonly consecutiveFails: number;
  readonly totalChecks:      number;
  readonly totalFailures:    number;
  readonly uptimeMs:         number;
  readonly lastCheckAt:      number;
  readonly lastSuccessAt:    number;
}

export interface HealthMonitorInstance {
  start():  void;
  stop():   void;
  report(): HealthReport;
  check():  Promise<HealthReport>;
}

// ─── API data types ───────────────────────────────────────────────────────────

export interface AttachmentSource {
  data:      string | Buffer | Readable;
  filename:  string;
  mimeType?: string;
}

export interface SendResult    { messageID: string | null; }
export interface ForwardResult { threadID: string; messageID: string | null; }
export interface CreateGroupResult { threadID: string; name: string; participantIDs: string[]; }

export interface ThreadListItem {
  threadID:       string;
  name:           string;
  isGroup:        boolean;
  lastMessage:    string;
  lastTimestamp:  number;
  participantIDs: string[];
  unreadCount:    number;
  imageSrc:       string;
  isArchived:     boolean;
  isMuted:        boolean;
}

export interface ThreadSearchResult {
  threadID:       string;
  name:           string;
  isGroup:        boolean;
  participantIDs: string[];
  imageSrc:       string;
  lastMessage:    string;
  lastTimestamp:  number;
  unreadCount:    number;
}

export interface ThreadInfo {
  id:             string;
  name:           string;
  isGroup:        boolean;
  participantIDs: string[];
  imageSrc:       string;
  messageCount:   number;
}

export interface ThreadParticipant {
  id:                string;
  name:              string;
  profilePictureURL: string;
  gender:            string;
  vanity:            string;
  isAdmin:           boolean;
  nickname:          string;
}

export interface UserInfo {
  id:                string;
  name:              string;
  profilePictureURL: string;
  gender:            string;
  vanity:            string;
}

export interface UserProfile extends UserInfo {
  coverPhotoURL: string;
  bio:           string;
  location:      string;
  hometown:      string;
  relationship:  string;
  work:          string[];
  education:     string[];
  website:       string;
}

export interface SearchResult  { id: string; name: string; profilePictureURL: string; vanity: string; type: string; }
export interface FriendEntry   { id: string; name: string; vanity: string; profilePictureURL: string; gender: string; }

export interface NormalisedAttachment {
  id:       string;
  type:     'image' | 'video' | 'audio' | 'file' | 'sticker' | 'unknown';
  url:      string;
  filename: string;
  filesize: number;
  width:    number;
  height:   number;
  duration: number;
  mimeType: string;
}

export interface HistoryMessage {
  messageID:        string;
  threadID:         string;
  senderID:         string;
  body:             string;
  timestamp:        number;
  isUnsent:         boolean;
  attachments:      NormalisedAttachment[];
  reactions:        unknown[];
  replyToMessageID: string | null;
}

export interface MessageSearchResult {
  messageID:   string;
  threadID:    string;
  senderID:    string;
  senderName:  string;
  body:        string;
  timestamp:   number;
  attachments: NormalisedAttachment[];
}

export interface MessageHistoryPage { messages: HistoryMessage[];      hasMore: boolean; nextBefore: number | null; }
export interface SharedMediaPage    { items:    NormalisedAttachment[]; hasMore: boolean; total:      number; }
export interface DownloadResult     { filename: string; mimeType: string; size: number; savedTo?: string; buffer?: Buffer; }
export interface DownloadItem       { url: string; filename?: string; }

// ─── MessengerAPI ─────────────────────────────────────────────────────────────

export interface MessengerAPI {
  sendMessage(threadID: string, message: string): Promise<SendResult>;
  replyMessage(threadID: string, message: string, replyToMessageID: string): Promise<SendResult>;
  quoteReply(threadID: string, replyToMessageID: string, quoteText: string, replyBody: string): Promise<SendResult>;
  reactToMessage(messageID: string, threadID: string, reaction: string): Promise<void>;
  removeReaction(messageID: string, threadID: string): Promise<void>;
  unsendMessage(messageID: string): Promise<void>;
  forwardMessage(messageID: string, sourceThreadID: string, destThreadIDs: string[]): Promise<ForwardResult[]>;
  sendImage(threadID: string, source: AttachmentSource, caption?: string): Promise<SendResult>;
  sendAttachments(threadID: string, sources: AttachmentSource[], caption?: string): Promise<SendResult>;
  sendVoiceMessage(threadID: string, source: AttachmentSource): Promise<SendResult>;
  sendDocument(threadID: string, source: AttachmentSource, caption?: string): Promise<SendResult>;
  markAsRead(threadID: string): Promise<void>;
  markAsUnread(threadID: string): Promise<void>;
  startTyping(threadID: string, isGroup?: boolean): Promise<void>;
  stopTyping(threadID: string, isGroup?: boolean): Promise<void>;
  fetchMessageHistory(threadID: string, options?: { limit?: number; before?: number }): Promise<MessageHistoryPage>;
  searchMessages(threadID: string, query: string, options?: { limit?: number }): Promise<MessageSearchResult[]>;
  downloadAttachments(items: DownloadItem[], options?: { destDir?: string }): Promise<DownloadResult[]>;
  fetchSharedMedia(threadID: string, options?: { type?: 'images'|'videos'|'files'|'audio'|'all'; limit?: number; offset?: number }): Promise<SharedMediaPage>;
  createGroup(participantIDs: string[], name?: string): Promise<CreateGroupResult>;
  addMembers(threadID: string, userIDs: string[]): Promise<void>;
  removeMember(threadID: string, userID: string): Promise<void>;
  renameGroup(threadID: string, name: string): Promise<void>;
  changeGroupEmoji(threadID: string, emoji: string): Promise<void>;
  changeGroupPhoto(threadID: string, source: AttachmentSource): Promise<void>;
  changeNickname(threadID: string, userID: string, nickname: string): Promise<void>;
  promoteAdmin(threadID: string, userID: string): Promise<void>;
  demoteAdmin(threadID: string, userID: string): Promise<void>;
  leaveGroup(threadID: string): Promise<void>;
  fetchThreadList(options?: { limit?: number; offset?: number }): Promise<ThreadListItem[]>;
  fetchGroupList(options?: { limit?: number; fetchSize?: number }): Promise<ThreadListItem[]>;
  fetchRecentConversations(options?: { limit?: number }): Promise<ThreadListItem[]>;
  fetchUnreadConversations(options?: { limit?: number; fetchSize?: number }): Promise<ThreadListItem[]>;
  archiveConversation(threadID: string): Promise<void>;
  unarchiveConversation(threadID: string): Promise<void>;
  muteConversation(threadID: string, muteSeconds?: number): Promise<void>;
  unmuteConversation(threadID: string): Promise<void>;
  searchThreads(query: string, options?: { limit?: number }): Promise<ThreadSearchResult[]>;
  fetchThreadInfo(threadID: string): Promise<ThreadInfo>;
  fetchThreadParticipants(threadID: string): Promise<ThreadParticipant[]>;
  fetchUserInfo(userID: string): Promise<UserInfo>;
  fetchUserProfile(userID: string): Promise<UserProfile>;
  searchUsers(query: string, options?: { limit?: number }): Promise<SearchResult[]>;
  fetchFriendList(options?: { limit?: number }): Promise<FriendEntry[]>;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export interface KaishaClient {
  readonly events:   KaishaEventEmitter;
  readonly api:      MessengerAPI;
  readonly session:  Session;
  readonly plugins:  PluginSystem;
  readonly health:   HealthMonitorInstance;
  listen():          Promise<void>;
  disconnect():      void;
  isConnected():     boolean;
  use(plugin: KaishaPlugin, options?: Record<string, unknown>): Promise<void>;
  addMiddleware(fn: MiddlewareFn): void;
}

// ─── Security ─────────────────────────────────────────────────────────────────

export interface SecureStorage {
  save(value: unknown): void;
  load(): unknown;
  exists(): boolean;
  delete(): void;
}

export interface CredentialVault {
  set(key: string, value: string): void;
  get(key: string): string | undefined;
  remove(key: string): void;
  clear(): void;
  save(): void;
  load(): void;
  exists(): boolean;
}

export interface EncryptedCache {
  set(key: string, value: unknown, ttlSeconds?: number): void;
  get(key: string): unknown;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
  save(): void;
  load(): void;
}

export interface TokenManager {
  setToken(name: string, value: string, ttlSeconds?: number): void;
  getToken(name: string): string | null;
  isExpired(name: string): boolean;
  removeToken(name: string): void;
  save(): void;
  load(): void;
}

export function createSecureStorage(filePath: string, passphrase: string): SecureStorage;
export function createCredentialVault(filePath: string, passphrase: string): CredentialVault;
export function createEncryptedCache(filePath: string, passphrase: string): EncryptedCache;
export function createTokenManager(filePath: string, passphrase: string): TokenManager;
export function backupSession(session: Session, filePath: string, passphrase: string): void;
export function restoreSession(filePath: string, passphrase: string): SessionData & { _backedUpAt: number };

// ─── Primary export ───────────────────────────────────────────────────────────

export function login(
  credentials: KaishaCredentials,
  config?: KaishaConfig
): Promise<KaishaClient>;

// ─── Cache Manager ────────────────────────────────────────────────────────────

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
}

export interface CacheManagerOptions {
  defaultTtlMs ? : number;
  maxSize ? : number;
  sweepIntervalMs ? : number;
}

export interface CacheManager {
  set(key: string, value: unknown, ttlMs ? : number): void;
  get(key: string): unknown;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
  getOrFetch < T > (key: string, loader: () => T | Promise < T > , ttlMs ? : number): Promise < T > ;
  keys(): string[];
  stats(): CacheStats;
  stop(): void;
}

export function createCacheManager(options ? : CacheManagerOptions): CacheManager;

// ─── Retry Manager ────────────────────────────────────────────────────────────

export interface RetryOptions {
  maxAttempts ? : number;
  baseDelayMs ? : number;
  maxDelayMs ? : number;
  jitterMs ? : number;
  timeoutMs ? : number;
  shouldRetry ? : (err: Error, attempt: number) => boolean;
  onRetry ? : (err: Error, attempt: number, delayMs: number) => void;
}

export interface RetryManager {
  execute < T > (fn: () => T | Promise < T > ): Promise < T > ;
  wrap < F extends(...args: unknown[]) => unknown > (fn: F): (...args: Parameters < F > ) => Promise < Awaited < ReturnType < F >>> ;
}

export function createRetryManager(options ? : RetryOptions): RetryManager;

// ─── Request Manager ──────────────────────────────────────────────────────────

export interface RequestManagerOptions {
  maxRetries ? : number;
  retryDelay ? : number;
  cacheTtlMs ? : number;
  maxCacheSize ? : number;
}

export interface RequestManager {
  post(url: string, extra ? : Record < string, string | number | boolean > , headers ? : Record < string, string > ): Promise < unknown > ;
  cachedPost(cacheKey: string, url: string, extra ? : Record < string, string | number | boolean > , ttlMs ? : number): Promise < unknown > ;
  graphql(docID: string, variables: Record < string, unknown > ): Promise < unknown > ;
  buildBody(extra ? : Record < string, string | number | boolean > ): string;
  parseFB(raw: unknown): unknown;
  cacheStats(): CacheStats;
  invalidate(key: string): void;
  clearCache(): void;
}

export function createRequestManager(
  session: Session,
  httpClient: object,
  logger: Logger,
  options ? : RequestManagerOptions
): RequestManager;

// ─── Additional error types ───────────────────────────────────────────────────

export class RateLimitError extends NetworkError {
  retryAfterMs ? : number;
}

export class ValidationError extends KaishaError {
  field ? : string;
}

// ─── Logger extension ─────────────────────────────────────────────────────────

// Extend the Logger interface to include withFields
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(namespace: string): Logger;
  withFields(fields: Record < string, unknown > ): Logger;
}

// ─── Client extension ─────────────────────────────────────────────────────────

// KaishaClient now includes the request manager
export interface KaishaClient {
  readonly events: KaishaEventEmitter;
  readonly api: MessengerAPI;
  readonly session: Session;
  readonly plugins: PluginSystem;
  readonly health: HealthMonitorInstance;
  readonly request: RequestManager;
  listen(): Promise < void > ;
  disconnect(): void;
  isConnected(): boolean;
  use(plugin: KaishaPlugin, options ? : Record < string, unknown > ): Promise < void > ;
  addMiddleware(fn: MiddlewareFn): void;
}