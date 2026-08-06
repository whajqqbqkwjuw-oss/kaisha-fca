'use strict';

/**
 * @module login
 * @description Handles email/password and appstate-based authentication
 * against Facebook, producing a fully hydrated Session.
 */

const { between, randomString } = require('./utils');
const { createSession, loadFromAppState } = require('./session');

const FB_BASE_URL = 'https://www.facebook.com';
const FB_LOGIN_URL = `${FB_BASE_URL}/login/device-based/regular/login/`;
const FB_HOME_URL = `${FB_BASE_URL}/`;

/**
 * Extracts key metadata from a Facebook HTML page source needed to
 * construct authenticated API requests.
 *
 * @param {string} html - Raw HTML of a logged-in Facebook page.
 * @returns {{ dtsg: string, fbDtsgAg: string, userID: string, siteData: string }}
 * @throws {Error} if any required token cannot be located in the page.
 */
function extractPageTokens(html) {
  // DTSG token
  const dtsg =
    between(html, '"DTSGInitialData",[],{"token":"', '"') ||
    between(html, '"token":"', '"') ||
    between(html, 'dtsg":{"token":"', '"');

  if (!dtsg) throw new Error('Unable to extract DTSG token from page HTML');

  // Async DTSG
  const fbDtsgAg =
    between(html, '"dtsgag":"', '"') ||
    between(html, '"fb_dtsg_ag":"', '"') ||
    dtsg;

  // Viewer / User ID
  const userID =
    between(html, '"USER_ID":"', '"') ||
    between(html, '"viewerID":"', '"') ||
    between(html, '"user_id":"', '"');

  if (!userID) throw new Error('Unable to extract user ID from page HTML');

  // Site data (LSD token used in form posts)
  const siteData =
    between(html, '"LSD",[],{"token":"', '"') ||
    between(html, '"lsd":{"token":"', '"') ||
    '';

  return { dtsg, fbDtsgAg, userID, siteData };
}

/**
 * Extracts the initial form tokens from the Facebook login page HTML
 * that must be submitted alongside credentials.
 *
 * @param {string} html - Raw HTML of the Facebook login page.
 * @returns {{ lsd: string, jazoest: string, mTs: string }}
 */
function extractLoginFormTokens(html) {
  const lsd = between(html, 'name="lsd" value="', '"') || '';
  const jazoest = between(html, 'name="jazoest" value="', '"') || '';
  const mTs = between(html, 'name="m_ts" value="', '"') || '';
  return { lsd, jazoest, mTs };
}

/**
 * Authenticates with Facebook using an email address and password.
 *
 * @param {object} credentials
 * @param {string} credentials.email    - Facebook account email address.
 * @param {string} credentials.password - Facebook account password.
 * @param {import('./http').HttpClient} httpClient
 * @param {import('./logger').Logger} logger
 * @returns {Promise<import('./session').Session>}
 * @throws {Error} If authentication fails or required tokens cannot be extracted.
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
    pass: password,
    login: '1',
    default_persistent: '0',
    timezone: '420',
    lgndim: Buffer.from('{"w":1920,"h":1080,"aw":1920,"ah":1040,"c":24}').toString('base64'),
    lgnrnd: randomString(16).toUpperCase(),
    lgnjs: String(Math.floor(Date.now() / 1000)),
    locale: 'en_US',
  });

  const loginRes = await httpClient.post(FB_LOGIN_URL, formData.toString(), {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'origin': FB_BASE_URL,
      'referer': FB_BASE_URL + '/',
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

  const session = createSession({
    cookies: httpClient.getCookies(),
    userID,
    clientID: randomString(20),
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
 * the Facebook home page to hydrate the session with DTSG tokens.
 *
 * @param {Array<{name:string, value:string}>} appstate
 * @param {import('./http').HttpClient} httpClient
 * @param {import('./logger').Logger} logger
 * @returns {Promise<import('./session').Session>}
 * @throws {Error} If the appstate is invalid or token extraction fails.
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

  const currentCookies = httpClient.getCookies();
  if (!currentCookies['c_user']) {
    throw new Error(
      'AppState login failed: "c_user" cookie missing. The appstate may be expired or invalid.'
    );
  }

  const { dtsg, fbDtsgAg, userID, siteData } = extractPageTokens(homeRes.data);

  const session = createSession({
    cookies: currentCookies,
    userID,
    clientID: randomString(20),
    dtsg,
    fbDtsgAg,
    siteData,
    createdAt: Date.now(),
  });

  logger.info(`Logged in as user ${userID} via appstate`);
  return session;
}

module.exports = { loginWithCredentials, loginWithAppState };
