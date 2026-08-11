'use strict';

/**
 * @module login
 * @description Handles email/password and appstate-based authentication
 * against Facebook, producing a fully hydrated Session.
 *
 * Root-cause fix (CONNACK 5):
 *   The MQTT broker at edge-chat.messenger.com authenticates against
 *   messenger.com session cookies, not just facebook.com cookies.
 *   After obtaining facebook.com tokens, we now also GET messenger.com
 *   so that the HTTP client cookie jar is populated with the
 *   messenger-specific cookies the broker requires.
 *   Without this step the WebSocket Cookie header is missing those cookies
 *   and the broker returns CONNACK returnCode=5 (Not Authorized).
 */

const { between, randomString } = require('./utils');
const { createSession, loadFromAppState } = require('./session');

const FB_BASE_URL       = 'https://www.facebook.com';
const FB_LOGIN_URL      = `${FB_BASE_URL}/login/device-based/regular/login/`;
const FB_HOME_URL       = `${FB_BASE_URL}/`;

/**
 * Messenger home page.
 *
 * Fetching this URL while carrying valid facebook.com session cookies causes
 * Facebook's auth layer to set messenger-domain session cookies.  The MQTT
 * broker at edge-chat.messenger.com validates those cookies; they must be
 * present in the WebSocket Cookie header or the broker returns CONNACK 5.
 */
const MESSENGER_HOME_URL = 'https://www.messenger.com/';

/**
 * Extracts key metadata from a Facebook HTML page source needed to
 * construct authenticated API requests.
 *
 * @param {string} html - Raw HTML of a logged-in Facebook page.
 * @returns {{ dtsg: string, fbDtsgAg: string, userID: string, siteData: string }}
 * @throws {Error} if any required token cannot be located in the page.
 */
function extractPageTokens(html) {
  const dtsg =
    between(html, '"DTSGInitialData",[],{"token":"', '"') ||
    between(html, '"token":"', '"') ||
    between(html, 'dtsg":{"token":"', '"');

  if (!dtsg) throw new Error('Unable to extract DTSG token from page HTML');

  const fbDtsgAg =
    between(html, '"dtsgag":"', '"') ||
    between(html, '"fb_dtsg_ag":"', '"') ||
    dtsg;

  const userID =
    between(html, '"USER_ID":"', '"') ||
    between(html, '"viewerID":"', '"') ||
    between(html, '"user_id":"', '"');

  if (!userID) throw new Error('Unable to extract user ID from page HTML');

  const siteData =
    between(html, '"LSD",[],{"token":"', '"') ||
    between(html, '"lsd":{"token":"', '"') ||
    '';

  return { dtsg, fbDtsgAg, userID, siteData };
}

/**
 * Extracts the initial form tokens from the Facebook login page HTML.
 *
 * @param {string} html
 * @returns {{ lsd: string, jazoest: string, mTs: string }}
 */
function extractLoginFormTokens(html) {
  const lsd     = between(html, 'name="lsd" value="', '"')     || '';
  const jazoest = between(html, 'name="jazoest" value="', '"') || '';
  const mTs     = between(html, 'name="m_ts" value="', '"')    || '';
  return { lsd, jazoest, mTs };
}

/**
 * Fetches the Messenger home page so that messenger.com session cookies are
 * added to the HTTP client cookie jar.
 *
 * The MQTT broker at edge-chat.messenger.com validates these cookies when it
 * receives the MQTT CONNECT packet.  Without them the broker returns
 * CONNACK returnCode=5 (Not Authorized) even when facebook.com auth succeeds.
 *
 * Errors are caught and logged as warnings so the rest of the login flow
 * can continue.
 *
 * @param {import('./http').HttpClient} httpClient
 * @param {import('./logger').Logger} logger
 */
async function hydrateMessengerCookies(httpClient, logger) {
  logger.debug('Fetching messenger.com to hydrate MQTT session cookies…');
  try {
    const res = await httpClient.get(MESSENGER_HOME_URL, {
      headers: {
        referer:          FB_HOME_URL,
        'sec-fetch-site': 'cross-site',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
      },
    });

    if (res.status >= 400) {
      logger.warn(
        `messenger.com returned HTTP ${res.status} — ` +
        'MQTT broker may still reject CONNECT if session cookies are absent'
      );
    } else {
      logger.debug('messenger.com session cookies obtained');
    }
  } catch (err) {
    logger.warn(
      `messenger.com prefetch failed (non-fatal): ${err.message}. ` +
      'MQTT broker may reject CONNECT if messenger-domain cookies are absent.'
    );
  }
}

/**
 * Authenticates with Facebook using an email address and password.
 *
 * @param {object} credentials
 * @param {string} credentials.email
 * @param {string} credentials.password
 * @param {import('./http').HttpClient} httpClient
 * @param {import('./logger').Logger} logger
 * @returns {Promise<import('./session').Session>}
 */
async function loginWithCredentials({ email, password }, httpClient, logger) {
  logger.info('Fetching Facebook login page…');

  const loginPageRes = await httpClient.get(FB_BASE_URL, {
    headers: { 'sec-fetch-dest': 'document' },
  });

  if (loginPageRes.status !== 200) {
    throw new Error(`Failed to fetch login page (HTTP ${loginPageRes.status})`);
  }

  const { lsd, jazoest } = extractLoginFormTokens(loginPageRes.data);

  logger.debug('Submitting login credentials…');

  const formData = new URLSearchParams({
    lsd,
    jazoest,
    email,
    pass:               password,
    login:              '1',
    default_persistent: '0',
    timezone:           '420',
    lgndim:             Buffer.from('{"w":1920,"h":1080,"aw":1920,"ah":1040,"c":24}').toString('base64'),
    lgnrnd:             randomString(16).toUpperCase(),
    lgnjs:              String(Math.floor(Date.now() / 1000)),
    locale:             'en_US',
  });

  await httpClient.post(FB_LOGIN_URL, formData.toString(), {
    headers: {
      'content-type':  'application/x-www-form-urlencoded',
      origin:          FB_BASE_URL,
      referer:         FB_BASE_URL + '/',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
    },
  });

  const currentCookies = httpClient.getCookies();
  if (!currentCookies['c_user']) {
    throw new Error(
      'Login failed: "c_user" cookie not set after login attempt. ' +
      'Verify your credentials or check for checkpoint / 2FA challenges.'
    );
  }

  logger.info('Credentials accepted. Fetching home page for tokens…');

  const homeRes = await httpClient.get(FB_HOME_URL, {
    headers: { referer: FB_BASE_URL + '/' },
  });

  const { dtsg, fbDtsgAg, userID, siteData } = extractPageTokens(homeRes.data);

  // Fetch messenger.com to get the messenger-domain cookies that the MQTT broker
  // validates when it receives the CONNECT packet.
  await hydrateMessengerCookies(httpClient, logger);

  const session = createSession({
    cookies:   httpClient.getCookies(),   // full jar: facebook.com + messenger.com
    userID,
    clientID:  randomString(20),
    dtsg,
    fbDtsgAg,
    siteData,
    createdAt: Date.now(),
  });

  logger.info(`Logged in as user ${userID}`);
  return session;
}

/**
 * Authenticates using a pre-exported appstate cookie array, then fetches
 * the Facebook home page to hydrate the session with DTSG tokens, and
 * fetches the Messenger home page to obtain messenger-domain session cookies
 * required by the MQTT broker.
 *
 * @param {Array<{name:string, value:string}>} appstate
 * @param {import('./http').HttpClient} httpClient
 * @param {import('./logger').Logger} logger
 * @returns {Promise<import('./session').Session>}
 */
async function loginWithAppState(appstate, httpClient, logger) {
  logger.info('Logging in via appstate…');

  const partialSession = loadFromAppState(appstate);
  httpClient.setCookies(partialSession.data.cookies);

  const homeRes = await httpClient.get(FB_HOME_URL, {
    headers: { referer: FB_BASE_URL + '/' },
  });

  if (homeRes.status !== 200) {
    throw new Error(`Failed to fetch home page (HTTP ${homeRes.status})`);
  }

  const fbCookies = httpClient.getCookies();
  if (!fbCookies['c_user']) {
    throw new Error(
      'AppState login failed: "c_user" cookie missing. The appstate may be expired or invalid.'
    );
  }

  const { dtsg, fbDtsgAg, userID, siteData } = extractPageTokens(homeRes.data);

  // ── Critical fix: fetch messenger.com for MQTT broker auth ───────────────
  //
  // The MQTT broker at edge-chat.messenger.com validates the WebSocket
  // Cookie header against messenger.com session data.  These cookies are
  // only set when the client visits messenger.com while holding valid
  // facebook.com session cookies.
  //
  // Without this step the broker receives a Cookie header that contains
  // only facebook.com cookies, which is insufficient, and it responds
  // with CONNACK returnCode=5 (Not Authorized).
  await hydrateMessengerCookies(httpClient, logger);

  // Full cookie jar: original appstate + facebook.com refreshes + messenger.com cookies
  const currentCookies = httpClient.getCookies();

  const session = createSession({
    cookies:   currentCookies,
    userID,
    clientID:  randomString(20),
    dtsg,
    fbDtsgAg,
    siteData,
    createdAt: Date.now(),
  });

  logger.info(`Logged in as user ${userID} via appstate`);
  return session;
}

module.exports = { loginWithCredentials, loginWithAppState };