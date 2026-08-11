'use strict';

const { between, randomString } = require('./utils');
const { createSession, loadFromAppState } = require('./session');

const FB_BASE_URL = 'https://www.facebook.com';
const FB_HOME_URL = `${FB_BASE_URL}/`;

const MESSENGER_HOME_URL =
  'https://www.messenger.com/';

/* -------------------------------------------------------------------------- */
/* Generic HTML extraction                                                    */
/* -------------------------------------------------------------------------- */

function extractFirstMatch(html, patterns) {
  if (
    typeof html !== 'string' ||
    html.length === 0
  ) {
    return '';
  }

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match && match[1]) {
      return match[1];
    }
  }

  return '';
}

/* -------------------------------------------------------------------------- */
/* Facebook page/session data                                                 */
/* -------------------------------------------------------------------------- */

function extractPageTokens(html) {
  if (
    typeof html !== 'string' ||
    html.length === 0
  ) {
    throw new Error(
      'Facebook returned an empty page'
    );
  }

  const dtsg =
    between(
      html,
      '"DTSGInitialData",[],{"token":"',
      '"'
    ) ||
    between(
      html,
      'dtsg":{"token":"',
      '"'
    ) ||
    between(
      html,
      '"token":"',
      '"'
    );

  if (!dtsg) {
    throw new Error(
      'Unable to extract DTSG token from Facebook page'
    );
  }

  const fbDtsgAg =
    between(
      html,
      '"dtsgag":"',
      '"'
    ) ||
    between(
      html,
      '"fb_dtsg_ag":"',
      '"'
    ) ||
    dtsg;

  const userID =
    between(
      html,
      '"USER_ID":"',
      '"'
    ) ||
    between(
      html,
      '"viewerID":"',
      '"'
    ) ||
    between(
      html,
      '"user_id":"',
      '"'
    );

  if (!userID) {
    throw new Error(
      'Unable to extract Facebook user ID'
    );
  }

  const siteData =
    between(
      html,
      '"LSD",[],{"token":"',
      '"'
    ) ||
    between(
      html,
      '"lsd":{"token":"',
      '"'
    ) ||
    '';

  /*
   * Extract the values Messenger's web client exposes in its bootstrap
   * configuration.
   *
   * These are intentionally saved into the session so mqtt.js can use the
   * current values instead of relying on an old hardcoded app ID.
   */

  const mqttAppID =
    extractFirstMatch(
      html,
      [
        /"MqttWebConfig"[\s\S]{0,1000}?"appID"\s*:\s*"([^"]+)"/i,
        /"MqttWebConfig"[\s\S]{0,1000}?"appID"\s*:\s*([0-9]+)/i,
        /MqttWebConfig[\s\S]{0,1000}?appID\s*:\s*"([^"]+)"/i,
        /MqttWebConfig[\s\S]{0,1000}?appID\s*:\s*([0-9]+)/i,
      ]
    );

  const mqttClientID =
    extractFirstMatch(
      html,
      [
        /"MqttWebDeviceID"[\s\S]{0,1000}?"clientID"\s*:\s*"([^"]+)"/i,
        /"MqttWebDeviceID"[\s\S]{0,1000}?"clientID"\s*:\s*([0-9]+)/i,
        /MqttWebDeviceID[\s\S]{0,1000}?clientID\s*:\s*"([^"]+)"/i,
        /MqttWebDeviceID[\s\S]{0,1000}?clientID\s*:\s*([0-9]+)/i,
      ]
    );

  /*
   * Messenger can expose an MQTT endpoint in the page configuration.
   */
  const mqttEndpoint =
    extractFirstMatch(
      html,
      [
        /"MqttWebConfig"[\s\S]{0,1500}?"endpoint"\s*:\s*"([^"]+)"/i,
        /MqttWebConfig[\s\S]{0,1500}?endpoint\s*:\s*"([^"]+)"/i,
      ]
    );

  /*
   * Some responses expose a region separately.
   */
  const mqttRegion =
    extractFirstMatch(
      html,
      [
        /"MqttWebConfig"[\s\S]{0,1500}?"region"\s*:\s*"([^"]+)"/i,
        /MqttWebConfig[\s\S]{0,1500}?region\s*:\s*"([^"]+)"/i,
      ]
    );

  return {
    dtsg,
    fbDtsgAg,
    userID,
    siteData,
    mqttAppID,
    mqttClientID,
    mqttEndpoint,
    mqttRegion,
  };
}

/* -------------------------------------------------------------------------- */
/* Cookie helpers                                                             */
/* -------------------------------------------------------------------------- */

function countCookies(cookies) {
  if (
    !cookies ||
    typeof cookies !== 'object'
  ) {
    return 0;
  }

  return Object.keys(cookies).length;
}

function hasCookie(
  cookies,
  name
) {
  return Boolean(
    cookies &&
    typeof cookies === 'object' &&
    cookies[name]
  );
}

function assertFacebookSession(
  cookies
) {
  if (
    !hasCookie(
      cookies,
      'c_user'
    )
  ) {
    throw new Error(
      'Facebook session is not authenticated: c_user cookie is missing'
    );
  }

  if (
    !hasCookie(
      cookies,
      'xs'
    )
  ) {
    throw new Error(
      'Facebook session is incomplete: xs cookie is missing'
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Messenger cookie hydration                                                 */
/* -------------------------------------------------------------------------- */

async function hydrateMessengerCookies(
  httpClient,
  logger
) {
  logger.debug(
    'Hydrating Messenger session from messenger.com…'
  );

  const before =
    httpClient.getCookies();

  const beforeCount =
    countCookies(before);

  let response;

  try {
    response =
      await httpClient.get(
        MESSENGER_HOME_URL,
        {
          headers: {
            referer:
              FB_HOME_URL,

            origin:
              FB_BASE_URL,

            accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',

            'sec-fetch-site':
              'cross-site',

            'sec-fetch-mode':
              'navigate',

            'sec-fetch-dest':
              'document',
          },
        }
      );
  } catch (err) {
    throw new Error(
      `Unable to initialize Messenger session: ${err.message}`
    );
  }

  if (
    !response ||
    response.status >= 400
  ) {
    throw new Error(
      `Messenger session initialization failed: HTTP ${response?.status ?? 'unknown'}`
    );
  }

  const after =
    httpClient.getCookies();

  const afterCount =
    countCookies(after);

  logger.debug(
    `Messenger session request completed (HTTP ${response.status})`
  );

  logger.debug(
    `Cookie jar: ${beforeCount} → ${afterCount} cookies`
  );

  /*
   * Do not require messenger.com to add a new cookie.
   * The MQTT connection must be allowed to use the authenticated Facebook
   * cookie jar already established by appstate.
   */

  return {
    cookies: after,
    html:
      typeof response.data === 'string'
        ? response.data
        : '',
  };
}

/* -------------------------------------------------------------------------- */
/* Credential login                                                           */
/* -------------------------------------------------------------------------- */

async function loginWithCredentials(
  {
    email,
    password,
  },
  httpClient,
  logger
) {
  if (!email) {
    throw new Error(
      'Email is required'
    );
  }

  if (!password) {
    throw new Error(
      'Password is required'
    );
  }

  logger.info(
    'Fetching Facebook login page…'
  );

  const loginPageRes =
    await httpClient.get(
      FB_BASE_URL
    );

  if (
    loginPageRes.status !==
    200
  ) {
    throw new Error(
      `Failed to fetch login page (HTTP ${loginPageRes.status})`
    );
  }

  const loginHtml =
    loginPageRes.data;

  const lsd =
    extractFirstMatch(
      loginHtml,
      [
        /name="lsd"\s+value="([^"]+)"/i,
        /name="lsd"\s+value='([^']+)'/i,
      ]
    );

  const jazoest =
    extractFirstMatch(
      loginHtml,
      [
        /name="jazoest"\s+value="([^"]+)"/i,
        /name="jazoest"\s+value='([^']+)'/i,
      ]
    );

  if (!lsd) {
    throw new Error(
      'Facebook login page did not provide an LSD token'
    );
  }

  const formData =
    new URLSearchParams({
      lsd,
      jazoest,

      email,
      pass: password,

      login: '1',

      default_persistent:
        '0',

      timezone:
        '420',

      locale:
        'en_US',

      lgnrnd:
        randomString(16)
          .toUpperCase(),

      lgnjs:
        String(
          Math.floor(
            Date.now() / 1000
          )
        ),
    });

  logger.debug(
    'Submitting Facebook login credentials…'
  );

  const loginResponse =
    await httpClient.post(
      `${FB_BASE_URL}/login/device-based/regular/login/`,
      formData.toString(),
      {
        headers: {
          'content-type':
            'application/x-www-form-urlencoded',

          origin:
            FB_BASE_URL,

          referer:
            FB_HOME_URL,
        },
      }
    );

  if (!loginResponse) {
    throw new Error(
      'Facebook login returned no response'
    );
  }

  const cookies =
    httpClient.getCookies();

  assertFacebookSession(
    cookies
  );

  const homeRes =
    await httpClient.get(
      FB_HOME_URL
    );

  if (
    homeRes.status !==
    200
  ) {
    throw new Error(
      `Failed to fetch authenticated Facebook page (HTTP ${homeRes.status})`
    );
  }

  const page =
    extractPageTokens(
      homeRes.data
    );

  const messenger =
    await hydrateMessengerCookies(
      httpClient,
      logger
    );

  const finalCookies =
    httpClient.getCookies();

  assertFacebookSession(
    finalCookies
  );

  /*
   * Prefer the live MqttWebDeviceID exposed by Facebook.
   * Fall back to a generated ID only when Facebook does not expose one.
   */
  const clientID =
    page.mqttClientID ||
    randomString(20);

  const session =
    createSession({
      cookies:
        finalCookies,

      userID:
        page.userID,

      clientID,

      dtsg:
        page.dtsg,

      fbDtsgAg:
        page.fbDtsgAg,

      siteData:
        page.siteData,

      mqttAppID:
        page.mqttAppID,

      mqttClientID:
        page.mqttClientID,

      mqttEndpoint:
        page.mqttEndpoint,

      mqttRegion:
        page.mqttRegion,

      createdAt:
        Date.now(),
    });

  logger.info(
    `Logged in as user ${page.userID}`
  );

  if (page.mqttAppID) {
    logger.debug(
      `Detected Messenger MQTT app ID: ${page.mqttAppID}`
    );
  } else {
    logger.warn(
      'Messenger MQTT app ID was not found in Facebook bootstrap data'
    );
  }

  if (page.mqttClientID) {
    logger.debug(
      'Detected Messenger MQTT device ID from Facebook'
    );
  } else {
    logger.warn(
      'Messenger MQTT device ID was not found; using generated client ID'
    );
  }

  if (page.mqttEndpoint) {
    logger.debug(
      `Detected Messenger MQTT endpoint: ${page.mqttEndpoint}`
    );
  }

  if (page.mqttRegion) {
    logger.debug(
      `Detected Messenger MQTT region: ${page.mqttRegion}`
    );
  }

  void messenger;

  return session;
}

/* -------------------------------------------------------------------------- */
/* Appstate login                                                             */
/* -------------------------------------------------------------------------- */

async function loginWithAppState(
  appstate,
  httpClient,
  logger
) {
  logger.info(
    'Logging in via appstate…'
  );

  if (
    !Array.isArray(
      appstate
    ) ||
    appstate.length === 0
  ) {
    throw new Error(
      'Appstate must be a non-empty cookie array'
    );
  }

  const partialSession =
    loadFromAppState(
      appstate
    );

  if (
    !partialSession ||
    !partialSession.data ||
    !partialSession.data.cookies
  ) {
    throw new Error(
      'Unable to construct session from appstate'
    );
  }

  /*
   * Start with exactly the supplied browser cookies.
   */
  httpClient.setCookies(
    partialSession.data.cookies
  );

  const initialCookies =
    httpClient.getCookies();

  assertFacebookSession(
    initialCookies
  );

  logger.debug(
    `Loaded ${countCookies(initialCookies)} authentication cookies into HTTP client`
  );

  /*
   * Validate the appstate against Facebook.
   */
  logger.debug(
    'Validating appstate against facebook.com…'
  );

  const homeRes =
    await httpClient.get(
      FB_HOME_URL,
      {
        headers: {
          referer:
            FB_HOME_URL,
        },
      }
    );

  if (
    homeRes.status !==
    200
  ) {
    throw new Error(
      `Appstate Facebook session validation failed (HTTP ${homeRes.status})`
    );
  }

  const fbCookies =
    httpClient.getCookies();

  assertFacebookSession(
    fbCookies
  );

  const page =
    extractPageTokens(
      homeRes.data
    );

  if (
    page.userID !==
    partialSession.data.userID
  ) {
    logger.warn(
      `Appstate user ID (${partialSession.data.userID}) ` +
      `differs from Facebook page user ID (${page.userID}); using Facebook value`
    );
  }

  logger.debug(
    `Facebook session validated for user ${page.userID}`
  );

  /*
   * Hydrate Messenger using the SAME authenticated HTTP client.
   */
  await hydrateMessengerCookies(
    httpClient,
    logger
  );

  /*
   * Final cookie jar used by MQTT.
   */
  const currentCookies =
    httpClient.getCookies();

  assertFacebookSession(
    currentCookies
  );

  if (
    countCookies(
      currentCookies
    ) === 0
  ) {
    throw new Error(
      'Final authentication cookie jar is empty'
    );
  }

  /*
   * Use the real Messenger web device ID when Facebook exposes it.
   * This is different from the MQTT protocol clientId "mqttwsclient".
   */
  const clientID =
    page.mqttClientID ||
    partialSession.data.clientID ||
    randomString(20);

  const session =
    createSession({
      cookies:
        currentCookies,

      userID:
        page.userID,

      clientID,

      dtsg:
        page.dtsg,

      fbDtsgAg:
        page.fbDtsgAg,

      siteData:
        page.siteData,

      mqttAppID:
        page.mqttAppID,

      mqttClientID:
        page.mqttClientID,

      mqttEndpoint:
        page.mqttEndpoint,

      mqttRegion:
        page.mqttRegion,

      createdAt:
        Date.now(),
    });

  logger.info(
    `Logged in as user ${page.userID} via appstate`
  );

  if (page.mqttAppID) {
    logger.debug(
      `Detected Messenger MQTT app ID: ${page.mqttAppID}`
    );
  } else {
    logger.warn(
      'Messenger MQTT app ID was not detected; current mqtt.js may need a session fallback'
    );
  }

  if (page.mqttClientID) {
    logger.debug(
      'Detected Messenger MQTT device ID from Facebook'
    );
  } else {
    logger.warn(
      'Messenger MQTT device ID was not detected; generated client ID will be used'
    );
  }

  if (page.mqttEndpoint) {
    logger.debug(
      `Detected Messenger MQTT endpoint: ${page.mqttEndpoint}`
    );
  }

  if (page.mqttRegion) {
    logger.debug(
      `Detected Messenger MQTT region: ${page.mqttRegion}`
    );
  }

  logger.debug(
    `Final MQTT authentication cookie jar contains ${countCookies(currentCookies)} cookies`
  );

  return session;
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

module.exports = {
  loginWithCredentials,
  loginWithAppState,
};