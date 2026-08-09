'use strict';

/**
 * @module api
 * @description High-level Messenger API: messaging, group management,
 * attachments, message history, search, forward, quote-reply, voice messages,
 * documents, attachment downloads, shared media, nicknames, admin controls,
 * group leaving, reaction removal, and conversation management.
 */

const { toQueryString } = require('./utils');
const { uploadAttachments } = require('./upload');
const { downloadFile, downloadFiles } = require('./download');

const GRAPH_API_BASE  = 'https://www.facebook.com/api/graphql/';
const MESSENGER_SEND  = 'https://www.facebook.com/messaging/send/';
const UNSEND_URL      = 'https://www.facebook.com/messaging/unsend/';
const MARK_READ_URL   = 'https://www.facebook.com/ajax/mercury/change_read_status.php';
const TYPING_URL      = 'https://www.facebook.com/ajax/messaging/typ.php';
const FRIEND_LIST_URL = 'https://www.facebook.com/chat/user_info_all/';
const SEARCH_URL      = 'https://www.facebook.com/ajax/typeahead/search.php';
const MSG_SEARCH_URL  = 'https://www.facebook.com/ajax/mercury/search_messages.php';
const MSG_HISTORY_URL = 'https://www.facebook.com/ajax/mercury/thread_info.php';
const SHARED_MEDIA_URL       = 'https://www.facebook.com/ajax/mercury/attachments_for_thread.php';
const GROUP_CREATE_URL        = 'https://www.facebook.com/messaging/new_thread/';
const GROUP_ADD_MEMBER_URL    = 'https://www.facebook.com/messaging/add_members/';
const GROUP_REMOVE_MEMBER_URL = 'https://www.facebook.com/messaging/remove_members/';
const GROUP_NAME_URL          = 'https://www.facebook.com/messaging/set_thread_name/';
const GROUP_EMOJI_URL         = 'https://www.facebook.com/messaging/set_thread_emoji/';
const GROUP_IMAGE_URL         = 'https://www.facebook.com/messaging/set_thread_image/';
const GROUP_NICKNAME_URL      = 'https://www.facebook.com/messaging/set_nickname/';
const GROUP_ADMIN_URL         = 'https://www.facebook.com/messaging/set_admin/';
const GROUP_LEAVE_URL         = 'https://www.facebook.com/messaging/remove_members/';
const ARCHIVE_URL             = 'https://www.facebook.com/ajax/mercury/change_archived_status.php';
const MUTE_URL                = 'https://www.facebook.com/ajax/mercury/change_mute_settings.php';
const THREAD_SEARCH_URL       = 'https://www.facebook.com/ajax/mercury/search_threads.php';

/**
 * Builds the shared form-post body that every Messenger API call requires.
 *
 * @param {import('./session').Session} session
 * @param {Record<string,string|number>} extra
 * @returns {string} URL-encoded body string.
 */
function buildFormBody(session, extra = {}) {
  const base = {
    fb_dtsg:    session.data.dtsg,
    fb_dtsg_ag: session.data.fbDtsgAg,
    jazoest:    computeJazoest(session.data.dtsg),
    __user:     session.data.userID,
    __a:        '1',
    __dyn:      '',
    __csr:      '',
    __req:      'a',
    __hs:       '',
    dpr:        '1',
    __ccg:      'GOOD',
    lsd:        session.data.siteData,
    ...extra,
  };
  return toQueryString(base);
}

/**
 * Computes the `jazoest` value Facebook requires alongside the DTSG token.
 *
 * @param {string} dtsg
 * @returns {string}
 */
function computeJazoest(dtsg) {
  let sum = 0;
  for (let i = 0; i < dtsg.length; i++) {
    sum += dtsg.charCodeAt(i);
  }
  return `2${sum}`;
}

/**
 * Generates a Facebook-compatible offline threading ID.
 *
 * @returns {string}
 */
function generateOfflineThreadingID() {
  const now  = BigInt(Date.now());
  const rand = BigInt(Math.floor(Math.random() * 4294967295));
  return String((now << 22n) | (rand & 0x3FFFFFn));
}

/**
 * Strips Facebook's for(;;); JSON hijacking prefix and parses the result.
 *
 * @param {string|object} raw
 * @returns {object}
 */
function parseFBResponse(raw) {
  const text    = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const cleaned = text.replace(/^for\s*\(;;\);/, '');
  return JSON.parse(cleaned);
}

/**
 * Normalises an attachment object from a raw Messenger API response into a
 * consistent shape used across fetchMessageHistory, fetchSharedMedia, etc.
 *
 * @param {object} raw
 * @returns {NormalisedAttachment}
 *
 * @typedef {object} NormalisedAttachment
 * @property {string} id
 * @property {string} type      - 'image'|'video'|'audio'|'file'|'sticker'|'unknown'
 * @property {string} url
 * @property {string} filename
 * @property {number} filesize
 * @property {number} width
 * @property {number} height
 * @property {number} duration  - milliseconds
 * @property {string} mimeType
 */
function normaliseAttachment(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      id: '', type: 'unknown', url: '', filename: '',
      filesize: 0, width: 0, height: 0, duration: 0, mimeType: '',
    };
  }

  const type =
    raw.attach_type === 1           ? 'image'   :
    raw.attach_type === 2           ? 'sticker' :
    raw.attach_type === 3           ? 'file'    :
    raw.attach_type === 4           ? 'video'   :
    raw.attach_type === 5           ? 'audio'   :
    raw.__typename === 'MessageImage'         ? 'image'   :
    raw.__typename === 'MessageVideo'         ? 'video'   :
    raw.__typename === 'MessageAudio'         ? 'audio'   :
    raw.__typename === 'MessageFile'          ? 'file'    :
    raw.__typename === 'MessageAnimatedImage' ? 'image'   :
    raw.__typename === 'MessageSticker'       ? 'sticker' :
    'unknown';

  const url =
    raw.url              ??
    raw.large_preview?.uri ??
    raw.preview?.uri     ??
    raw.playable_url     ??
    raw.audio_url        ??
    raw.url_shimhash     ??
    '';

  return {
    id:       String(raw.id ?? raw.fbid ?? raw.metadata?.fbid ?? ''),
    type,
    url,
    filename: raw.filename ?? raw.name ?? raw.title ?? '',
    filesize: Number(raw.filesize ?? raw.file_size ?? 0),
    width:    Number(raw.original_dimensions?.width  ?? raw.width  ?? 0),
    height:   Number(raw.original_dimensions?.height ?? raw.height ?? 0),
    duration: Number(raw.playable_duration_in_ms ?? raw.duration ?? 0),
    mimeType: raw.mimeType ?? raw.mime_type ?? '',
  };
}

/**
 * Converts a raw thread node from a GraphQL or AJAX response into the
 * standard ThreadListItem shape shared by fetchThreadList, fetchGroupList,
 * fetchUnreadConversations, fetchRecentConversations, and searchThreads.
 *
 * @param {object} node
 * @returns {ThreadListItem}
 *
 * @typedef {object} ThreadListItem
 * @property {string}   threadID
 * @property {string}   name
 * @property {boolean}  isGroup
 * @property {string}   lastMessage
 * @property {number}   lastTimestamp
 * @property {string[]} participantIDs
 * @property {number}   unreadCount
 * @property {string}   imageSrc
 * @property {boolean}  isArchived
 * @property {boolean}  isMuted
 */
function normaliseThreadNode(node) {
  const participants   = node.all_participants?.nodes ?? [];
  const participantIDs = participants
    .map((p) => p.messaging_actor?.id ?? '')
    .filter(Boolean);

  const lastMsg = node.last_message?.nodes?.[0];

  return {
    threadID:      node.thread_key?.thread_fbid ?? node.thread_key?.other_user_id ?? '',
    name:          node.name ?? node.thread_name ?? '',
    isGroup:       node.thread_type === 'GROUP',
    lastMessage:   lastMsg?.snippet ?? lastMsg?.message?.text ?? '',
    lastTimestamp: Number(lastMsg?.timestamp_precise ?? 0),
    participantIDs,
    unreadCount:   node.unread_count ?? 0,
    imageSrc:      node.image?.uri ?? '',
    isArchived:    Boolean(node.is_archived ?? false),
    isMuted:       Boolean(node.mute_until ?? node.is_muted ?? false),
  };
}

/**
 * Creates the Messenger API client.
 *
 * @param {import('./session').Session}   session
 * @param {import('./http').HttpClient}   httpClient
 * @param {import('./logger').Logger}     logger
 * @returns {MessengerAPI}
 */
function createAPI(session, httpClient, logger) {
  const JSON_HEADERS = {
    'content-type':       'application/x-www-form-urlencoded',
    'x-fb-friendly-name': 'MessengerRequest',
    'x-requested-with':   'XMLHttpRequest',
    'referer':            'https://www.facebook.com/',
    'origin':             'https://www.facebook.com',
  };

  /**
   * Low-level GraphQL call.
   *
   * @param {string} docID
   * @param {object} variables
   * @returns {Promise<object>}
   */
  async function graphql(docID, variables) {
    const body = buildFormBody(session, {
      doc_id:    docID,
      variables: JSON.stringify(variables),
    });

    const res = await httpClient.post(GRAPH_API_BASE, body, {
      headers: JSON_HEADERS,
    });

    const raw       = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const firstLine = raw.split('\n').find((l) => l.trim().startsWith('{'));
    if (!firstLine) throw new Error('GraphQL response contained no JSON object');

    const parsed = JSON.parse(firstLine);
    if (parsed.errors?.length) {
      throw new Error(`GraphQL error: ${parsed.errors[0].message}`);
    }
    return parsed.data ?? parsed;
  }

  /**
   * Internal helper that fetches a page of inbox threads from the GraphQL
   * thread-list endpoint and returns raw normalised items together with the
   * raw response so callers can apply additional filters.
   *
   * @param {object} variables  - GraphQL variables forwarded verbatim.
   * @returns {Promise<ThreadListItem[]>}
   */
  async function fetchThreadPage(variables) {
    const body = buildFormBody(session, {
      doc_id:    '1349387578499440',
      variables: JSON.stringify(variables),
    });

    const res = await httpClient.post(GRAPH_API_BASE, body, {
      headers: JSON_HEADERS,
    });

    const raw     = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const lines   = raw.split('\n').filter((l) => l.trim().startsWith('{'));
    const objects = lines
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);

    const edges =
      objects[0]?.data?.viewer?.message_threads?.nodes ??
      objects[0]?.data?.viewer?.message_threads?.edges?.map((e) => e.node) ??
      [];

    return edges.map(normaliseThreadNode);
  }


  /**
   * Sends a text message to a thread (user or group).
   *
   * @param {string} threadID
   * @param {string} message
   * @returns {Promise<{ messageID: string }>}
   */
  async function sendMessage(threadID, message) {
    logger.debug(`Sending message to thread ${threadID}`);

    const body = buildFormBody(session, {
      action_type:                     'ma-type:user-generated-message',
      thread_fbid:                     threadID,
      body:                            message,
      has_attachment:                  'false',
      message_id:                      generateOfflineThreadingID(),
      client:                          'mercury',
      timestamp:                       String(Date.now()),
      timestamp_absolute:              'Today',
      timestamp_relative:              new Date().toLocaleTimeString(),
      timestamp_time_passed:           '0',
      is_unread:                       'false',
      is_forward:                      'false',
      is_filtered_content:             'false',
      is_filtered_content_bh:          'false',
      is_filtered_content_account:     'false',
      is_filtered_content_quasar:      'false',
      is_filtered_content_invalid_app: 'false',
      is_spoof_warning:                'false',
      source:                          'source:chat:web',
      'source_tags[0]':                'source:chat',
    });

    const res = await httpClient.post(MESSENGER_SEND, body, {
      headers: JSON_HEADERS,
    });

    const text       = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const msgIDMatch = text.match(/"message_id"\s*:\s*"([^"]+)"/);
    const messageID  = msgIDMatch ? msgIDMatch[1] : null;

    if (!messageID && res.status >= 400) {
      throw new Error(`Failed to send message (HTTP ${res.status})`);
    }

    logger.debug(`Message sent, ID: ${messageID}`);
    return { messageID };
  }

  /**
   * Replies to a specific message within a thread.
   *
   * @param {string} threadID
   * @param {string} message
   * @param {string} replyToMessageID
   * @returns {Promise<{ messageID: string }>}
   */
  async function replyMessage(threadID, message, replyToMessageID) {
    logger.debug(`Replying to message ${replyToMessageID} in thread ${threadID}`);

    const body = buildFormBody(session, {
      action_type:           'ma-type:user-generated-message',
      thread_fbid:           threadID,
      body:                  message,
      has_attachment:        'false',
      message_id:            generateOfflineThreadingID(),
      replied_to_message_id: replyToMessageID,
      client:                'mercury',
      timestamp:             String(Date.now()),
    });

    const res = await httpClient.post(MESSENGER_SEND, body, {
      headers: JSON_HEADERS,
    });

    const text       = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const msgIDMatch = text.match(/"message_id"\s*:\s*"([^"]+)"/);
    const messageID  = msgIDMatch ? msgIDMatch[1] : null;

    if (!messageID && res.status >= 400) {
      throw new Error(`Failed to send reply (HTTP ${res.status})`);
    }

    logger.debug(`Reply sent, ID: ${messageID}`);
    return { messageID };
  }

  /**
   * Adds an emoji reaction to a message.
   *
   * @param {string} messageID
   * @param {string} threadID
   * @param {string} reaction - Unicode emoji; pass '' to remove.
   * @returns {Promise<void>}
   */
  async function reactToMessage(messageID, threadID, reaction) {
    logger.debug(`Reacting to message ${messageID} with "${reaction}"`);

    const body = buildFormBody(session, {
      action:      reaction ? 'ADD_REACTION' : 'REMOVE_REACTION',
      message_id:  messageID,
      thread_fbid: threadID,
      reaction,
    });

    const res = await httpClient.post(
      'https://www.facebook.com/webgraphql/mutation/?doc_id=1491398900900362',
      body,
      { headers: JSON_HEADERS }
    );

    if (res.status >= 400) {
      throw new Error(`Failed to react to message (HTTP ${res.status})`);
    }
  }

  /**
   * Unsends a message the authenticated user sent.
   *
   * @param {string} messageID
   * @returns {Promise<void>}
   */
  async function unsendMessage(messageID) {
    logger.debug(`Unsending message ${messageID}`);

    const body = buildFormBody(session, { message_id: messageID });

    const res = await httpClient.post(UNSEND_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to unsend message (HTTP ${res.status})`);
    }

    logger.debug(`Message ${messageID} unsent`);
  }

  /**
   * Fetches basic profile information for a Facebook user.
   *
   * @param {string} userID
   * @returns {Promise<UserInfo>}
   *
   * @typedef {object} UserInfo
   * @property {string} id
   * @property {string} name
   * @property {string} profilePictureURL
   * @property {string} gender
   * @property {string} vanity
   */
  async function fetchUserInfo(userID) {
    logger.debug(`Fetching user info for ${userID}`);

    const body = buildFormBody(session, {
      ids:    `[${userID}]`,
      fields: 'name,picture,gender,vanity',
    });

    const res = await httpClient.post(
      'https://www.facebook.com/chat/user_info/',
      body,
      { headers: JSON_HEADERS }
    );

    const parsed  = parseFBResponse(res.data);
    const payload = parsed?.payload?.profiles ?? parsed?.payload ?? {};
    const profile = payload[userID] ?? {};

    return {
      id:                userID,
      name:              profile.name ?? '',
      profilePictureURL: profile.thumbSrc ?? profile.picture?.uri ?? '',
      gender:            profile.gender ?? 'unknown',
      vanity:            profile.vanity ?? '',
    };
  }

  /**
   * Fetches information about a Messenger thread.
   *
   * @param {string} threadID
   * @returns {Promise<ThreadInfo>}
   *
   * @typedef {object} ThreadInfo
   * @property {string}   id
   * @property {string}   name
   * @property {boolean}  isGroup
   * @property {string[]} participantIDs
   * @property {string}   imageSrc
   * @property {number}   messageCount
   */
  async function fetchThreadInfo(threadID) {
    logger.debug(`Fetching thread info for ${threadID}`);

    const body = buildFormBody(session, {
      id:     threadID,
      manual: '0',
      fields: 'participants,name,image,message_count,thread_type',
    });

    const res = await httpClient.post(
      'https://www.facebook.com/chat/thread_info/',
      body,
      { headers: JSON_HEADERS }
    );

    const parsed = parseFBResponse(res.data);
    const thread = parsed?.payload ?? {};

    const participantIDs = (thread.participants ?? []).map((p) =>
      typeof p === 'object' ? p.fbid ?? p.id ?? '' : String(p)
    );

    return {
      id:           threadID,
      name:         thread.name ?? '',
      isGroup:      thread.thread_type === 'GROUP',
      participantIDs,
      imageSrc:     thread.image?.src ?? '',
      messageCount: thread.message_count ?? 0,
    };
  }


  /**
   * Marks a conversation thread as read.
   *
   * @param {string} threadID
   * @returns {Promise<void>}
   */
  async function markAsRead(threadID) {
    logger.debug(`Marking thread ${threadID} as read`);

    const body = buildFormBody(session, {
      [`ids[${threadID}]`]:  'true',
      watermarkTimestamp:    String(Date.now()),
      shouldSendReadReceipt: '1',
      state:                 'true',
    });

    const res = await httpClient.post(MARK_READ_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to mark thread as read (HTTP ${res.status})`);
    }

    logger.debug(`Thread ${threadID} marked as read`);
  }

  /**
   * Marks a conversation thread as unread.
   *
   * @param {string} threadID
   * @returns {Promise<void>}
   */
  async function markAsUnread(threadID) {
    logger.debug(`Marking thread ${threadID} as unread`);

    const body = buildFormBody(session, {
      [`ids[${threadID}]`]:  'false',
      watermarkTimestamp:    String(Date.now()),
      shouldSendReadReceipt: '0',
      state:                 'false',
    });

    const res = await httpClient.post(MARK_READ_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to mark thread as unread (HTTP ${res.status})`);
    }

    logger.debug(`Thread ${threadID} marked as unread`);
  }

  /**
   * Sends a typing indicator to a thread.
   *
   * @param {string}  threadID
   * @param {boolean} [isGroup=false]
   * @returns {Promise<void>}
   */
  async function startTyping(threadID, isGroup = false) {
    logger.debug(`Sending typing indicator to thread ${threadID}`);

    const body = buildFormBody(session, {
      typ:    '1',
      thread: threadID,
      to:     isGroup ? '' : threadID,
      source: 'mercury-chat',
    });

    const res = await httpClient.post(TYPING_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to send typing indicator (HTTP ${res.status})`);
    }
  }

  /**
   * Stops the typing indicator for a thread.
   *
   * @param {string}  threadID
   * @param {boolean} [isGroup=false]
   * @returns {Promise<void>}
   */
  async function stopTyping(threadID, isGroup = false) {
    logger.debug(`Stopping typing indicator on thread ${threadID}`);

    const body = buildFormBody(session, {
      typ:    '0',
      thread: threadID,
      to:     isGroup ? '' : threadID,
      source: 'mercury-chat',
    });

    const res = await httpClient.post(TYPING_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to stop typing indicator (HTTP ${res.status})`);
    }
  }

  /**
   * Fetches the authenticated user's inbox thread list.
   *
   * @param {object} [options={}]
   * @param {number} [options.limit=20]
   * @returns {Promise<ThreadListItem[]>}
   *
   * @note The underlying GraphQL endpoint uses cursor-based pagination (`before`
   * timestamp), not integer offsets.  Offset-based paging is not supported by
   * this endpoint; use `fetchMessageHistory`'s `before` option for paged reads.
   */
  async function fetchThreadList({ limit = 20 } = {}) {
    logger.debug(`Fetching thread list (limit ${limit})`);

    return fetchThreadPage({
      limit,
      before:                  null,
      tags:                    ['INBOX'],
      includeDeliveryReceipts: true,
      includeSeqID:            false,
    });
  }

  /**
   * Fetches the full Facebook profile for a user.
   *
   * @param {string} userID
   * @returns {Promise<UserProfile>}
   *
   * @typedef {object} UserProfile
   * @property {string}   id
   * @property {string}   name
   * @property {string}   vanity
   * @property {string}   profilePictureURL
   * @property {string}   coverPhotoURL
   * @property {string}   bio
   * @property {string}   gender
   * @property {string}   location
   * @property {string}   hometown
   * @property {string}   relationship
   * @property {string[]} work
   * @property {string[]} education
   * @property {string}   website
   */
  async function fetchUserProfile(userID) {
    logger.debug(`Fetching full profile for user ${userID}`);

    const data = await graphql('4221144941262266', {
      userID,
      scale:            1,
      profile_tab_type: 'ABOUT',
    }).catch(() => null);

    const basicInfo = await fetchUserInfo(userID);
    const actor     = data?.user ?? data?.node ?? {};

    return {
      id:                userID,
      name:              basicInfo.name,
      vanity:            basicInfo.vanity,
      profilePictureURL: basicInfo.profilePictureURL,
      coverPhotoURL:     actor.cover_photo?.photo?.image?.uri ?? '',
      bio:               actor.biography?.text ?? actor.about_me?.text ?? '',
      gender:            basicInfo.gender,
      location:          actor.current_city?.name ?? actor.location?.city ?? '',
      hometown:          actor.hometown?.name ?? '',
      relationship:      actor.relationship_status ?? '',
      work:              (actor.work?.nodes ?? []).map((w) => w.employer?.name ?? '').filter(Boolean),
      education:         (actor.education?.nodes ?? []).map((e) => e.school?.name ?? '').filter(Boolean),
      website:           actor.websites?.nodes?.[0]?.uri ?? '',
    };
  }

  /**
   * Searches for Facebook users by name or username.
   *
   * @param {string} query
   * @param {object} [options={}]
   * @param {number} [options.limit=10]
   * @returns {Promise<SearchResult[]>}
   *
   * @typedef {object} SearchResult
   * @property {string} id
   * @property {string} name
   * @property {string} profilePictureURL
   * @property {string} vanity
   * @property {string} type
   */
  async function searchUsers(query, { limit = 10 } = {}) {
    logger.debug(`Searching users with query: "${query}"`);

    const res = await httpClient.get(SEARCH_URL, {
      params: {
        value:        query,
        existing_ids: '[]',
        hash:         '',
        chat_type:    'user',
        __user:       session.data.userID,
        __a:          '1',
        fb_dtsg_ag:   session.data.fbDtsgAg,
        lsd:          session.data.siteData,
      },
      headers: {
        ...JSON_HEADERS,
        referer: 'https://www.facebook.com/messages/',
      },
    });

    const parsed  = parseFBResponse(res.data);
    const entries = parsed?.payload?.entries ?? parsed?.entries ?? [];

    return entries
      .slice(0, limit)
      .map((entry) => ({
        id:                entry.uid ?? entry.id ?? '',
        name:              entry.text ?? entry.name ?? '',
        profilePictureURL: entry.photo ?? entry.picture_url ?? '',
        vanity:            entry.path?.replace('/', '') ?? '',
        type:              entry.type ?? 'user',
      }))
      .filter((r) => r.id !== '');
  }

  /**
   * Fetches the authenticated user's friend list.
   *
   * @param {object} [options={}]
   * @param {number} [options.limit=500]
   * @returns {Promise<FriendEntry[]>}
   *
   * @typedef {object} FriendEntry
   * @property {string} id
   * @property {string} name
   * @property {string} vanity
   * @property {string} profilePictureURL
   * @property {string} gender
   */
  async function fetchFriendList({ limit = 500 } = {}) {
    logger.debug('Fetching friend list');

    const body = buildFormBody(session, { viewer: session.data.userID });

    const res = await httpClient.post(FRIEND_LIST_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status === 404 || res.status === 403) {
      logger.warn('fetchFriendList: endpoint not available for this account type');
      return [];
    }

    if (res.status >= 400) {
      throw new Error(`Failed to fetch friend list (HTTP ${res.status})`);
    }

    const parsed   = parseFBResponse(res.data);
    const profiles = parsed?.payload?.profiles ?? {};

    return Object.entries(profiles)
      .slice(0, limit)
      .map(([id, p]) => ({
        id,
        name:              p.name ?? '',
        vanity:            p.vanity ?? '',
        profilePictureURL: p.thumbSrc ?? p.picture?.uri ?? '',
        gender:            p.gender ?? 'unknown',
      }));
  }


  /**
   * Creates a new Messenger group conversation.
   *
   * @param {string[]} participantIDs - At least 2 user IDs.
   * @param {string}   [name='']
   * @returns {Promise<CreateGroupResult>}
   *
   * @typedef {object} CreateGroupResult
   * @property {string}   threadID
   * @property {string}   name
   * @property {string[]} participantIDs
   */
  async function createGroup(participantIDs, name = '') {
    if (!Array.isArray(participantIDs) || participantIDs.length < 2) {
      throw new TypeError('createGroup requires at least 2 participant IDs');
    }

    logger.debug(`Creating group with ${participantIDs.length} participants`);

    const extra = {};
    participantIDs.forEach((id, idx) => { extra[`ids[${idx}]`] = String(id); });
    if (name) extra.thread_name = name;

    const body = buildFormBody(session, {
      client:      'mercury',
      action_type: 'ma-type:user-generated-message',
      ...extra,
    });

    const res = await httpClient.post(GROUP_CREATE_URL, body, {
      headers: JSON_HEADERS,
    });

    const text    = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const cleaned = text.replace(/^for\s*\(;;\);/, '');

    let parsed;
    try { parsed = JSON.parse(cleaned); } catch { parsed = {}; }

    const payload  = parsed?.payload ?? {};
    const threadID =
      payload.thread_fbid ??
      payload.threadID    ??
      (text.match(/"thread_fbid"\s*:\s*"?(\d+)"?/)?.[1]) ??
      null;

    if (!threadID && res.status >= 400) {
      throw new Error(`Failed to create group (HTTP ${res.status})`);
    }

    logger.info(`Group created. Thread ID: ${threadID}`);
    return {
      threadID:       String(threadID ?? ''),
      name:           payload.name ?? name,
      participantIDs: [...participantIDs],
    };
  }

  /**
   * Adds one or more members to an existing group thread.
   *
   * @param {string}   threadID
   * @param {string[]} userIDs
   * @returns {Promise<void>}
   */
  async function addMembers(threadID, userIDs) {
    if (!Array.isArray(userIDs) || userIDs.length === 0) {
      throw new TypeError('addMembers requires a non-empty array of user IDs');
    }

    logger.debug(`Adding ${userIDs.length} member(s) to thread ${threadID}`);

    const extra = { thread_fbid: threadID };
    userIDs.forEach((id, idx) => { extra[`ids[${idx}]`] = String(id); });

    const body = buildFormBody(session, extra);
    const res  = await httpClient.post(GROUP_ADD_MEMBER_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to add members (HTTP ${res.status})`);
    }

    logger.debug(`Members added to thread ${threadID}`);
  }

  /**
   * Removes a single member from a group thread.
   *
   * @param {string} threadID
   * @param {string} userID
   * @returns {Promise<void>}
   */
  async function removeMember(threadID, userID) {
    logger.debug(`Removing user ${userID} from thread ${threadID}`);

    const body = buildFormBody(session, {
      thread_fbid: threadID,
      uid:         String(userID),
    });

    const res = await httpClient.post(GROUP_REMOVE_MEMBER_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to remove member (HTTP ${res.status})`);
    }

    logger.debug(`User ${userID} removed from thread ${threadID}`);
  }

  /**
   * Renames a group conversation thread.
   *
   * @param {string} threadID
   * @param {string} name
   * @returns {Promise<void>}
   */
  async function renameGroup(threadID, name) {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new TypeError('renameGroup: name must be a non-empty string');
    }

    logger.debug(`Renaming thread ${threadID} to "${name}"`);

    const body = buildFormBody(session, {
      thread_fbid: threadID,
      thread_name: name.trim(),
    });

    const res = await httpClient.post(GROUP_NAME_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to rename group (HTTP ${res.status})`);
    }

    logger.debug(`Thread ${threadID} renamed to "${name}"`);
  }

  /**
   * Changes the emoji icon of a group or 1:1 conversation.
   *
   * @param {string} threadID
   * @param {string} emoji
   * @returns {Promise<void>}
   */
  async function changeGroupEmoji(threadID, emoji) {
    if (typeof emoji !== 'string' || emoji.trim() === '') {
      throw new TypeError('changeGroupEmoji: emoji must be a non-empty string');
    }

    logger.debug(`Setting emoji for thread ${threadID} to "${emoji}"`);

    const body = buildFormBody(session, {
      thread_fbid: threadID,
      emoji:       emoji.trim(),
    });

    const res = await httpClient.post(GROUP_EMOJI_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to change group emoji (HTTP ${res.status})`);
    }

    logger.debug(`Thread ${threadID} emoji set to "${emoji}"`);
  }

  /**
   * Changes the group photo for a group thread.
   *
   * @param {string}                              threadID
   * @param {import('./upload').AttachmentSource} imageSource
   * @returns {Promise<void>}
   */
  async function changeGroupPhoto(threadID, imageSource) {
    logger.debug(`Changing photo for thread ${threadID}`);

    const [uploaded] = await uploadAttachments(
      [imageSource],
      session,
      httpClient,
      logger.child('Upload')
    );

    // ✅ Validation: tiyaking may attachment ID
    if (!uploaded || !uploaded.attachmentID) {
      throw new Error('Failed to upload group image');
    }

    // ✅ Validation: tiyaking image ang na-upload
    if (uploaded.attachmentType !== 'image') {
      throw new Error(
        `Expected image attachment but received "${uploaded.attachmentType || 'unknown'}"`
      );
    }

    const body = buildFormBody(session, {
      thread_fbid: threadID,
      image_id: uploaded.attachmentID,
    });

    const res = await httpClient.post(GROUP_IMAGE_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to change group photo (HTTP ${res.status})`);
    }

    logger.debug(`Thread ${threadID} photo updated`);
  }

  /**
   * Fetches detailed participant information for a thread.
   *
   * @param {string} threadID
   * @returns {Promise<ThreadParticipant[]>}
   *
   * @typedef {object} ThreadParticipant
   * @property {string}  id
   * @property {string}  name
   * @property {string}  profilePictureURL
   * @property {string}  gender
   * @property {string}  vanity
   * @property {boolean} isAdmin
   * @property {string}  nickname
   */
  async function fetchThreadParticipants(threadID) {
    logger.debug(`Fetching participants for thread ${threadID}`);

    const threadInfo = await fetchThreadInfo(threadID);
    if (threadInfo.participantIDs.length === 0) return [];

    const body = buildFormBody(session, {
      ids:    JSON.stringify(threadInfo.participantIDs),
      fields: 'name,picture,gender,vanity',
    });

    const res = await httpClient.post(
      'https://www.facebook.com/chat/user_info/',
      body,
      { headers: JSON_HEADERS }
    );

    const parsed   = parseFBResponse(res.data);
    const profiles = parsed?.payload?.profiles ?? parsed?.payload ?? {};

    const threadMeta = await graphql('1508526735892416', {
      threadID,
      withAdminInfo: true,
    }).catch(() => null);

    const adminIDs    = new Set((threadMeta?.thread?.admin_ids ?? []).map(String));
    const nicknames   = threadMeta?.thread?.customization_info?.participant_customizations ?? [];
    const nicknameMap = {};
    for (const nc of nicknames) {
      nicknameMap[nc.participant_id] = nc.nickname ?? '';
    }

    return threadInfo.participantIDs.map((id) => {
      const p = profiles[id] ?? {};
      return {
        id,
        name:              p.name ?? '',
        profilePictureURL: p.thumbSrc ?? p.picture?.uri ?? '',
        gender:            p.gender ?? 'unknown',
        vanity:            p.vanity ?? '',
        isAdmin:           adminIDs.has(id),
        nickname:          nicknameMap[id] ?? '',
      };
    });
  }

  /**
   * Sends a single image to a thread.
   *
   * @param {string}                              threadID
   * @param {import('./upload').AttachmentSource} imageSource
   * @param {string}                              [caption='']
   * @returns {Promise<{ messageID: string }>}
   */
  async function sendImage(threadID, imageSource, caption = '') {
    logger.debug(`Sending image to thread ${threadID}`);

    const [uploaded] = await uploadAttachments(
      [imageSource],
      session,
      httpClient,
      logger.child('Upload')
    );

    // ✅ Validation: tiyaking may attachment ID
    if (!uploaded || !uploaded.attachmentID) {
      throw new Error('Failed to upload image');
    }

    // ✅ Validation: tiyaking image ang na-upload
    if (uploaded.attachmentType !== 'image') {
      throw new Error(
        `Expected image attachment but received "${uploaded.attachmentType || 'unknown'}"`
      );
    }

    const body = buildFormBody(session, {
      action_type: 'ma-type:user-generated-message',
      thread_fbid: threadID,
      body: caption,
      has_attachment: 'true',
      message_id: generateOfflineThreadingID(),
      client: 'mercury',
      timestamp: String(Date.now()),
      image_ids: uploaded.attachmentID,
    });

    const res = await httpClient.post(MESSENGER_SEND, body, {
      headers: JSON_HEADERS,
    });

    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const msgIDMatch = text.match(/"message_id"\s*:\s*"([^"]+)"/);
    const messageID = msgIDMatch ? msgIDMatch[1] : null;

    if (!messageID && res.status >= 400) {
      throw new Error(`Failed to send image (HTTP ${res.status})`);
    }

    logger.debug(`Image sent. Message ID: ${messageID}`);
    return { messageID };
  }

  /**
   * Uploads one or more files and sends them as attachments to a thread.
   *
   * @param {string}                                threadID
   * @param {import('./upload').AttachmentSource[]} sources - 1–25 items.
   * @param {string}                                [caption='']
   * @returns {Promise<{ messageID: string }>}
   */
  async function sendAttachments(threadID, sources, caption = '') {
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new TypeError('sendAttachments requires a non-empty array of AttachmentSource objects');
    }
    if (sources.length > 25) {
      throw new TypeError('sendAttachments: Facebook allows a maximum of 25 attachments per message');
    }

    logger.debug(`Uploading ${sources.length} attachment(s) for thread ${threadID}`);

    const uploaded = await uploadAttachments(
      sources,
      session,
      httpClient,
      logger.child('Upload')
    );

    const extra = {
      action_type:    'ma-type:user-generated-message',
      thread_fbid:    threadID,
      body:           caption,
      has_attachment: 'true',
      message_id:     generateOfflineThreadingID(),
      client:         'mercury',
      timestamp:      String(Date.now()),
    };

    uploaded.forEach(({ attachmentID, attachmentType }, idx) => {
      switch (attachmentType) {
        case 'image':
          extra[`image_ids[${idx}]`] = attachmentID;
          break;

        case 'video':
          extra[`video_ids[${idx}]`] = attachmentID;
          break;

        case 'audio':
          extra[`audio_ids[${idx}]`] = attachmentID;
          break;

        default:
          extra[`file_ids[${idx}]`] = attachmentID;
          break;
      }
    });

    const body = buildFormBody(session, extra);
    const res  = await httpClient.post(MESSENGER_SEND, body, {
      headers: JSON_HEADERS,
    });

    const text       = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const msgIDMatch = text.match(/"message_id"\s*:\s*"([^"]+)"/);
    const messageID  = msgIDMatch ? msgIDMatch[1] : null;

    if (!messageID && res.status >= 400) {
      throw new Error(`Failed to send attachments (HTTP ${res.status})`);
    }

    logger.debug(`Attachments sent. Message ID: ${messageID}`);
    return { messageID };
  }


  /**
   * Searches for messages within a thread matching a keyword query.
   *
   * @param {string} threadID
   * @param {string} query
   * @param {object} [options={}]
   * @param {number} [options.limit=20]
   * @returns {Promise<MessageSearchResult[]>}
   *
   * @typedef {object} MessageSearchResult
   * @property {string}   messageID
   * @property {string}   threadID
   * @property {string}   senderID
   * @property {string}   senderName
   * @property {string}   body
   * @property {number}   timestamp
   * @property {NormalisedAttachment[]} attachments
   */
  async function searchMessages(threadID, query, { limit = 20 } = {}) {
    if (!query || typeof query !== 'string' || query.trim() === '') {
      throw new TypeError('searchMessages: query must be a non-empty string');
    }

    logger.debug(`Searching messages in thread ${threadID} for: "${query}"`);

    const body = buildFormBody(session, {
      query:       query.trim(),
      thread_fbid: threadID,
      offset:      '0',
      limit:       String(limit),
    });

    const res = await httpClient.post(MSG_SEARCH_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Message search failed (HTTP ${res.status})`);
    }

    const parsed   = parseFBResponse(res.data);
    const messages = parsed?.payload?.messages ?? parsed?.payload ?? [];

    return (Array.isArray(messages) ? messages : Object.values(messages))
      .slice(0, limit)
      .map((msg) => ({
        messageID:   msg.message_id ?? msg.messageID ?? '',
        threadID:    String(msg.thread_fbid ?? threadID),
        senderID:    String(msg.author?.replace('fbid:', '') ?? msg.senderID ?? ''),
        senderName:  msg.author_name ?? msg.senderName ?? '',
        body:        msg.body ?? msg.text ?? '',
        timestamp:   Number(msg.timestamp ?? msg.time ?? 0),
        attachments: (msg.attachments ?? []).map(normaliseAttachment),
      }))
      .filter((m) => m.messageID !== '');
  }

  /**
   * Fetches a page of message history for a thread, ordered newest-first.
   *
   * @param {string} threadID
   * @param {object} [options={}]
   * @param {number} [options.limit=20]
   * @param {number} [options.before]
   * @returns {Promise<MessageHistoryPage>}
   *
   * @typedef {object} MessageHistoryPage
   * @property {HistoryMessage[]} messages
   * @property {boolean}          hasMore
   * @property {number|null}      nextBefore
   *
   * @typedef {object} HistoryMessage
   * @property {string}   messageID
   * @property {string}   threadID
   * @property {string}   senderID
   * @property {string}   body
   * @property {number}   timestamp
   * @property {boolean}  isUnsent
   * @property {NormalisedAttachment[]} attachments
   * @property {object[]} reactions
   * @property {string|null} replyToMessageID
   */
  async function fetchMessageHistory(threadID, { limit = 20, before } = {}) {
    logger.debug(
      `Fetching message history for thread ${threadID} ` +
      `(limit ${limit}${before ? `, before ${before}` : ''})`
    );

    const extra = {
      id:             threadID,
      messages_limit: String(limit),
      manual:         '0',
    };

    if (before !== undefined) extra.timestamp = String(before);

    const body = buildFormBody(session, extra);
    const res  = await httpClient.post(MSG_HISTORY_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to fetch message history (HTTP ${res.status})`);
    }

    const parsed  = parseFBResponse(res.data);
    const payload = parsed?.payload ?? {};
    const rawMsgs = payload.actions ?? payload.messages ?? [];

    const messages = (Array.isArray(rawMsgs) ? rawMsgs : Object.values(rawMsgs))
      .map((msg) => ({
        messageID:        msg.message_id ?? msg.messageID ?? '',
        threadID:         String(msg.thread_fbid ?? threadID),
        senderID:         String(msg.author?.replace('fbid:', '') ?? msg.senderID ?? ''),
        body:             msg.body ?? msg.text ?? '',
        timestamp:        Number(msg.timestamp ?? 0),
        isUnsent:         Boolean(msg.is_unsent ?? false),
        attachments:      (msg.attachments ?? []).map(normaliseAttachment),
        reactions:        msg.message_reactions ?? msg.reactions ?? [],
        replyToMessageID: msg.replied_to_message?.message_id ?? null,
      }))
      .filter((m) => m.messageID !== '');

    const oldestTimestamp = messages.length > 0
      ? Math.min(...messages.map((m) => m.timestamp))
      : null;

    return {
      messages,
      hasMore:    payload.has_more_before ?? messages.length === limit,
      nextBefore: oldestTimestamp,
    };
  }

  /**
   * Forwards an existing message to one or more destination threads.
   *
   * @param {string}   messageID
   * @param {string}   sourceThreadID
   * @param {string[]} destThreadIDs
   * @returns {Promise<ForwardResult[]>}
   *
   * @typedef {object} ForwardResult
   * @property {string} threadID
   * @property {string} messageID
   */
  async function forwardMessage(messageID, sourceThreadID, destThreadIDs) {
    if (!Array.isArray(destThreadIDs) || destThreadIDs.length === 0) {
      throw new TypeError('forwardMessage: destThreadIDs must be a non-empty array');
    }

    logger.debug(`Forwarding message ${messageID} to ${destThreadIDs.length} thread(s)`);

    const history  = await fetchMessageHistory(sourceThreadID, { limit: 50 });
    const original = history.messages.find((m) => m.messageID === messageID);

    if (!original) {
      throw new Error(
        `Message ${messageID} not found in the last 50 messages of thread ${sourceThreadID}`
      );
    }

    const results = [];

    for (const destThreadID of destThreadIDs) {
      const forwardedSources = [];

      for (const att of original.attachments) {
        if (att.url) {
          try {
            const dl = await downloadFile(att.url, httpClient, logger.child('Download'));
            forwardedSources.push({
              data:     dl.buffer,
              filename: att.filename || 'attachment',
              mimeType: att.mimeType || dl.mimeType,
            });
          } catch (err) {
            logger.warn(`Could not re-download attachment ${att.id}: ${err.message}`);
          }
        }
      }

      let result;
      if (forwardedSources.length > 0) {
        result = await sendAttachments(destThreadID, forwardedSources, original.body);
      } else {
        result = await sendMessage(destThreadID, original.body || '[Forwarded message]');
      }

      results.push({ threadID: destThreadID, messageID: result.messageID });
    }

    return results;
  }

  /**
   * Sends a quote-reply embedding a preview of the original message text.
   *
   * @param {string} threadID
   * @param {string} replyToMessageID
   * @param {string} quoteText
   * @param {string} replyBody
   * @returns {Promise<{ messageID: string }>}
   */
  async function quoteReply(threadID, replyToMessageID, quoteText, replyBody) {
    if (typeof replyBody !== 'string' || replyBody.trim() === '') {
      throw new TypeError('quoteReply: replyBody must be a non-empty string');
    }

    logger.debug(`Sending quote-reply to message ${replyToMessageID} in thread ${threadID}`);

    const quotedBody = quoteText
      ? `> ${quoteText.split('\n').join('\n> ')}\n${replyBody.trim()}`
      : replyBody.trim();

    const body = buildFormBody(session, {
      action_type:           'ma-type:user-generated-message',
      thread_fbid:           threadID,
      body:                  quotedBody,
      has_attachment:        'false',
      message_id:            generateOfflineThreadingID(),
      replied_to_message_id: replyToMessageID,
      client:                'mercury',
      timestamp:             String(Date.now()),
    });

    const res = await httpClient.post(MESSENGER_SEND, body, {
      headers: JSON_HEADERS,
    });

    const text       = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const msgIDMatch = text.match(/"message_id"\s*:\s*"([^"]+)"/);
    const messageID  = msgIDMatch ? msgIDMatch[1] : null;

    if (!messageID && res.status >= 400) {
      throw new Error(`Failed to send quote-reply (HTTP ${res.status})`);
    }

    logger.debug(`Quote-reply sent. ID: ${messageID}`);
    return { messageID };
  }

  /**
   * Uploads an audio file and sends it as a voice message.
   *
   * @param {string}                              threadID
   * @param {import('./upload').AttachmentSource} audioSource
   * @returns {Promise<{ messageID: string }>}
   */
  async function sendVoiceMessage(threadID, audioSource) {
    logger.debug(`Sending voice message to thread ${threadID}`);

    const [uploaded] = await uploadAttachments(
      [audioSource],
      session,
      httpClient,
      logger.child('Upload')
    );

    if (!uploaded || !uploaded.attachmentID) {
      throw new Error('Failed to upload voice attachment');
    }

    if (uploaded.attachmentType !== 'audio') {
      throw new Error(
        `Expected audio attachment but received "${uploaded.attachmentType || 'unknown'}"`
      );
    }

    const body = buildFormBody(session, {
      action_type: 'ma-type:user-generated-message',
      thread_fbid: threadID,
      body: '',
      has_attachment: 'true',
      message_id: generateOfflineThreadingID(),
      client: 'mercury',
      timestamp: String(Date.now()),
      audio_ids: uploaded.attachmentID,
    });

    const res = await httpClient.post(MESSENGER_SEND, body, {
      headers: JSON_HEADERS,
    });

    const text       = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const msgIDMatch = text.match(/"message_id"\s*:\s*"([^"]+)"/);
    const messageID  = msgIDMatch ? msgIDMatch[1] : null;

    if (!messageID && res.status >= 400) {
      throw new Error(`Failed to send voice message (HTTP ${res.status})`);
    }

    logger.debug(`Voice message sent. ID: ${messageID}`);
    return { messageID };
  }

  /**
   * Uploads a document and sends it to a thread.
   *
   * @param {string}                              threadID
   * @param {import('./upload').AttachmentSource} documentSource
   * @param {string}                              [caption='']
   * @returns {Promise<{ messageID: string }>}
   */
  async function sendDocument(threadID, documentSource, caption = '') {
    logger.debug(`Sending document to thread ${threadID}`);

    const [uploaded] = await uploadAttachments(
      [documentSource],
      session,
      httpClient,
      logger.child('Upload')
    );

    if (!uploaded || !uploaded.attachmentID) {
      throw new Error('Failed to upload document attachment');
    }

    if (uploaded.attachmentType !== 'file') {
      throw new Error(
        `Expected file attachment but received "${uploaded.attachmentType || 'unknown'}"`
      );
    }

    const body = buildFormBody(session, {
      action_type: 'ma-type:user-generated-message',
      thread_fbid: threadID,
      body: caption,
      has_attachment: 'true',
      message_id: generateOfflineThreadingID(),
      client: 'mercury',
      timestamp: String(Date.now()),
      file_ids: uploaded.attachmentID,
    });

    const res = await httpClient.post(MESSENGER_SEND, body, {
      headers: JSON_HEADERS,
    });

    const text       = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const msgIDMatch = text.match(/"message_id"\s*:\s*"([^"]+)"/);
    const messageID  = msgIDMatch ? msgIDMatch[1] : null;

    if (!messageID && res.status >= 400) {
      throw new Error(`Failed to send document (HTTP ${res.status})`);
    }

    logger.debug(`Document sent. ID: ${messageID}`);
    return { messageID };
  }

  /**
   * Downloads one or more attachment URLs to disk or into memory.
   *
   * @param {Array<{url:string, filename?:string}>} items
   * @param {object} [options={}]
   * @param {string} [options.destDir]
   * @returns {Promise<import('./download').DownloadResult[]>}
   */
  async function downloadAttachments(items, { destDir } = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new TypeError('downloadAttachments: items must be a non-empty array');
    }

    logger.debug(
      `Downloading ${items.length} attachment(s)` +
      `${destDir ? ` to ${destDir}` : ' into memory'}`
    );

    return downloadFiles(items, httpClient, logger.child('Download'), { destDir });
  }

  /**
   * Fetches shared media for a thread, paginated by attachment type.
   *
   * @param {string} threadID
   * @param {object} [options={}]
   * @param {'images'|'videos'|'files'|'audio'|'all'} [options.type='all']
   * @param {number} [options.limit=20]
   * @param {number} [options.offset=0]
   * @returns {Promise<SharedMediaPage>}
   *
   * @typedef {object} SharedMediaPage
   * @property {NormalisedAttachment[]} items
   * @property {boolean}                hasMore
   * @property {number}                 total
   */
  async function fetchSharedMedia(threadID, { type = 'all', limit = 20, offset = 0 } = {}) {
    logger.debug(`Fetching shared media (${type}) for thread ${threadID}`);

    const typeMap = { images: '1', videos: '4', files: '3', audio: '5', all: '' };

    if (!Object.keys(typeMap).includes(type)) {
      throw new TypeError(
        `fetchSharedMedia: type must be one of: ${Object.keys(typeMap).join(', ')}`
      );
    }

    const extra = {
      thread_fbid: threadID,
      offset:      String(offset),
      limit:       String(limit),
    };

    if (typeMap[type]) extra.attach_type = typeMap[type];

    const body = buildFormBody(session, extra);
    const res  = await httpClient.post(SHARED_MEDIA_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to fetch shared media (HTTP ${res.status})`);
    }

    const parsed   = parseFBResponse(res.data);
    const payload  = parsed?.payload ?? {};
    const rawItems = payload.attachments ?? payload.items ?? [];
    const total    = Number(payload.total_count ?? payload.total ?? rawItems.length);
    const hasMore  = offset + limit < total;

    const items = (Array.isArray(rawItems) ? rawItems : Object.values(rawItems))
      .map(normaliseAttachment)
      .filter((a) => a.id !== '');

    return { items, hasMore, total };
  }


  /**
   * Changes the in-thread nickname for a participant.
   *
   * @param {string} threadID
   * @param {string} userID
   * @param {string} nickname - '' to clear.
   * @returns {Promise<void>}
   */
  async function changeNickname(threadID, userID, nickname) {
    if (typeof nickname !== 'string') {
      throw new TypeError('changeNickname: nickname must be a string (use "" to clear)');
    }

    logger.debug(
      `Setting nickname for user ${userID} in thread ${threadID}` +
      ` to "${nickname || '(cleared)'}"`
    );

    const body = buildFormBody(session, {
      thread_fbid:    threadID,
      participant_id: String(userID),
      nickname,
    });

    const res = await httpClient.post(GROUP_NICKNAME_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to change nickname (HTTP ${res.status})`);
    }

    logger.debug(`Nickname updated for user ${userID} in thread ${threadID}`);
  }

  /**
   * Promotes a group participant to admin.
   *
   * @param {string} threadID
   * @param {string} userID
   * @returns {Promise<void>}
   */
  async function promoteAdmin(threadID, userID) {
    logger.debug(`Promoting user ${userID} to admin in thread ${threadID}`);

    const body = buildFormBody(session, {
      thread_fbid: threadID,
      admin_id:    String(userID),
      add:         '1',
    });

    const res = await httpClient.post(GROUP_ADMIN_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to promote admin (HTTP ${res.status})`);
    }

    logger.debug(`User ${userID} promoted to admin in thread ${threadID}`);
  }

  /**
   * Demotes a group admin back to a regular participant.
   *
   * @param {string} threadID
   * @param {string} userID
   * @returns {Promise<void>}
   */
  async function demoteAdmin(threadID, userID) {
    logger.debug(`Demoting admin ${userID} in thread ${threadID}`);

    const body = buildFormBody(session, {
      thread_fbid: threadID,
      admin_id:    String(userID),
      add:         '0',
    });

    const res = await httpClient.post(GROUP_ADMIN_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to demote admin (HTTP ${res.status})`);
    }

    logger.debug(`Admin ${userID} demoted in thread ${threadID}`);
  }

  /**
   * Removes the authenticated user from a group thread.
   *
   * @param {string} threadID
   * @returns {Promise<void>}
   */
  async function leaveGroup(threadID) {
    logger.debug(`Leaving group thread ${threadID}`);

    const body = buildFormBody(session, {
      thread_fbid: threadID,
      uid:         session.data.userID,
    });

    const res = await httpClient.post(GROUP_LEAVE_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to leave group (HTTP ${res.status})`);
    }

    logger.info(`Left group thread ${threadID}`);
  }

  /**
   * Removes the authenticated user's own reaction from a message.
   *
   * @param {string} messageID
   * @param {string} threadID
   * @returns {Promise<void>}
   */
  async function removeReaction(messageID, threadID) {
    logger.debug(`Removing reaction from message ${messageID} in thread ${threadID}`);
    return reactToMessage(messageID, threadID, '');
  }


  /**
   * Fetches the authenticated user's group conversations only.
   *
   * Group threads are identified by `thread_type === 'GROUP'` in the inbox.
   * The full inbox is fetched (up to `limit` threads) and then filtered
   * client-side so the result set contains exclusively group threads.
   *
   * @param {object} [options={}]
   * @param {number} [options.limit=20]  - Maximum number of group threads to return.
   * @param {number} [options.fetchSize=100] - How many raw inbox threads to scan
   *   per request when looking for groups.  Increase if your inbox has many 1:1
   *   threads before reaching group threads.
   * @returns {Promise<ThreadListItem[]>}
   */
  async function fetchGroupList({ limit = 20, fetchSize = 100 } = {}) {
    logger.debug(`Fetching group list (limit ${limit})`);

    const all = await fetchThreadPage({
      limit:                   fetchSize,
      before:                  null,
      tags:                    ['INBOX'],
      includeDeliveryReceipts: true,
      includeSeqID:            false,
    });

    return all.filter((t) => t.isGroup).slice(0, limit);
  }

  /**
   * Archives a conversation thread, removing it from the main inbox view.
   *
   * @param {string} threadID
   * @returns {Promise<void>}
   */
  async function archiveConversation(threadID) {
    logger.debug(`Archiving thread ${threadID}`);

    const body = buildFormBody(session, {
      [`ids[${threadID}]`]: 'true',
    });

    const res = await httpClient.post(ARCHIVE_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to archive conversation (HTTP ${res.status})`);
    }

    logger.debug(`Thread ${threadID} archived`);
  }

  /**
   * Unarchives a previously archived conversation thread, restoring it to
   * the main inbox.
   *
   * @param {string} threadID
   * @returns {Promise<void>}
   */
  async function unarchiveConversation(threadID) {
    logger.debug(`Unarchiving thread ${threadID}`);

    const body = buildFormBody(session, {
      [`ids[${threadID}]`]: 'false',
    });

    const res = await httpClient.post(ARCHIVE_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to unarchive conversation (HTTP ${res.status})`);
    }

    logger.debug(`Thread ${threadID} unarchived`);
  }

  /**
   * Mutes a conversation thread for a given duration.
   *
   * @param {string} threadID
   * @param {number} [muteSeconds=-1]
   *   Duration in seconds.  Pass `-1` to mute indefinitely.
   *   Pass `0` to unmute (equivalent to calling `unmuteConversation`).
   * @returns {Promise<void>}
   */
  async function muteConversation(threadID, muteSeconds = -1) {
    if (typeof muteSeconds !== 'number') {
      throw new TypeError('muteConversation: muteSeconds must be a number');
    }

    logger.debug(
      `Muting thread ${threadID} for ` +
      `${muteSeconds === -1 ? 'indefinitely' : `${muteSeconds}s`}`
    );

    const body = buildFormBody(session, {
      thread_fbid:  threadID,
      mute_settings: String(muteSeconds),
    });

    const res = await httpClient.post(MUTE_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Failed to mute conversation (HTTP ${res.status})`);
    }

    logger.debug(`Thread ${threadID} muted`);
  }

  /**
   * Unmutes a previously muted conversation thread.
   *
   * This is a convenience wrapper around `muteConversation(threadID, 0)`.
   *
   * @param {string} threadID
   * @returns {Promise<void>}
   */
  async function unmuteConversation(threadID) {
    logger.debug(`Unmuting thread ${threadID}`);
    return muteConversation(threadID, 0);
  }

  /**
   * Fetches conversations that currently have unread messages.
   *
   * Scans the inbox (up to `fetchSize` threads) and returns only those where
   * `unreadCount > 0`, up to `limit` results.
   *
   * @param {object} [options={}]
   * @param {number} [options.limit=20]      - Maximum unread threads to return.
   * @param {number} [options.fetchSize=100] - Raw inbox page size to scan.
   * @returns {Promise<ThreadListItem[]>}
   */
  async function fetchUnreadConversations({ limit = 20, fetchSize = 100 } = {}) {
    logger.debug(`Fetching unread conversations (limit ${limit})`);

    const all = await fetchThreadPage({
      limit:                   fetchSize,
      before:                  null,
      tags:                    ['INBOX'],
      includeDeliveryReceipts: true,
      includeSeqID:            false,
    });

    return all.filter((t) => t.unreadCount > 0).slice(0, limit);
  }

  /**
   * Fetches the most recently active conversations, sorted by last message
   * timestamp descending (newest activity first).
   *
   * @param {object} [options={}]
   * @param {number} [options.limit=20] - Maximum threads to return.
   * @returns {Promise<ThreadListItem[]>}
   */
  async function fetchRecentConversations({ limit = 20 } = {}) {
    logger.debug(`Fetching recent conversations (limit ${limit})`);

    const threads = await fetchThreadPage({
      limit,
      before:                  null,
      tags:                    ['INBOX'],
      includeDeliveryReceipts: true,
      includeSeqID:            false,
    });

    return threads
      .slice()
      .sort((a, b) => b.lastTimestamp - a.lastTimestamp)
      .slice(0, limit);
  }

  /**
   * Searches Messenger threads (conversations) by name or participant name.
   *
   * Uses Facebook's thread search endpoint which matches group names and
   * participant names, returning a list of matching threads.
   *
   * @param {string} query            - Search term.
   * @param {object} [options={}]
   * @param {number} [options.limit=20] - Maximum results.
   * @returns {Promise<ThreadSearchResult[]>}
   *
   * @typedef {object} ThreadSearchResult
   * @property {string}   threadID
   * @property {string}   name
   * @property {boolean}  isGroup
   * @property {string[]} participantIDs
   * @property {string}   imageSrc
   * @property {string}   lastMessage
   * @property {number}   lastTimestamp
   * @property {number}   unreadCount
   */
  async function searchThreads(query, { limit = 20 } = {}) {
    if (!query || typeof query !== 'string' || query.trim() === '') {
      throw new TypeError('searchThreads: query must be a non-empty string');
    }

    logger.debug(`Searching threads with query: "${query}"`);

    const body = buildFormBody(session, {
      query:  query.trim(),
      limit:  String(limit),
      offset: '0',
    });

    const res = await httpClient.post(THREAD_SEARCH_URL, body, {
      headers: JSON_HEADERS,
    });

    if (res.status >= 400) {
      throw new Error(`Thread search failed (HTTP ${res.status})`);
    }

    const parsed  = parseFBResponse(res.data);
    const payload = parsed?.payload ?? {};

    // The endpoint may return results under several key names
    const rawThreads =
      payload.threads    ??
      payload.results    ??
      payload.items      ??
      [];

    return (Array.isArray(rawThreads) ? rawThreads : Object.values(rawThreads))
      .slice(0, limit)
      .map((t) => {
        // Normalise participants
        const participantIDs = (
          t.participants         ??
          t.all_participants     ??
          []
        ).map((p) =>
          typeof p === 'object'
            ? p.fbid ?? p.id ?? p.messaging_actor?.id ?? ''
            : String(p)
        ).filter(Boolean);

        return {
          threadID:      String(t.thread_fbid ?? t.threadID ?? t.id ?? ''),
          name:          t.name ?? t.thread_name ?? '',
          isGroup:       t.thread_type === 'GROUP' || Boolean(t.is_group),
          participantIDs,
          imageSrc:      t.image?.src ?? t.image?.uri ?? '',
          lastMessage:   t.snippet ?? t.last_message?.text ?? '',
          lastTimestamp: Number(t.timestamp ?? t.last_action_timestamp ?? 0),
          unreadCount:   Number(t.unread_count ?? 0),
        };
      })
      .filter((t) => t.threadID !== '');
  }

  /**
   * @typedef {object} MessengerAPI
   * @property {function} sendMessage
   * @property {function} replyMessage
   * @property {function} reactToMessage
   * @property {function} removeReaction
   * @property {function} unsendMessage
   * @property {function} fetchUserInfo
   * @property {function} fetchThreadInfo
   * @property {function} markAsRead
   * @property {function} markAsUnread
   * @property {function} startTyping
   * @property {function} stopTyping
   * @property {function} fetchThreadList
   * @property {function} fetchUserProfile
   * @property {function} searchUsers
   * @property {function} fetchFriendList
   * @property {function} createGroup
   * @property {function} addMembers
   * @property {function} removeMember
   * @property {function} renameGroup
   * @property {function} changeGroupEmoji
   * @property {function} changeGroupPhoto
   * @property {function} fetchThreadParticipants
   * @property {function} sendImage
   * @property {function} sendAttachments
   * @property {function} searchMessages
   * @property {function} fetchMessageHistory
   * @property {function} forwardMessage
   * @property {function} quoteReply
   * @property {function} sendVoiceMessage
   * @property {function} sendDocument
   * @property {function} downloadAttachments
   * @property {function} fetchSharedMedia
   * @property {function} changeNickname
   * @property {function} promoteAdmin
   * @property {function} demoteAdmin
   * @property {function} leaveGroup
   * @property {function} fetchGroupList
   * @property {function} archiveConversation
   * @property {function} unarchiveConversation
   * @property {function} muteConversation
   * @property {function} unmuteConversation
   * @property {function} fetchUnreadConversations
   * @property {function} fetchRecentConversations
   * @property {function} searchThreads
   */
  return {
    sendMessage,
    replyMessage,
    reactToMessage,
    removeReaction,
    unsendMessage,
    fetchUserInfo,
    fetchThreadInfo,
    markAsRead,
    markAsUnread,
    startTyping,
    stopTyping,
    fetchThreadList,
    fetchUserProfile,
    searchUsers,
    fetchFriendList,
    createGroup,
    addMembers,
    removeMember,
    renameGroup,
    changeGroupEmoji,
    changeGroupPhoto,
    fetchThreadParticipants,
    sendImage,
    sendAttachments,
    searchMessages,
    fetchMessageHistory,
    forwardMessage,
    quoteReply,
    sendVoiceMessage,
    sendDocument,
    downloadAttachments,
    fetchSharedMedia,
    changeNickname,
    promoteAdmin,
    demoteAdmin,
    leaveGroup,
    fetchGroupList,
    archiveConversation,
    unarchiveConversation,
    muteConversation,
    unmuteConversation,
    fetchUnreadConversations,
    fetchRecentConversations,
    searchThreads,
  };
}

module.exports = { createAPI };