'use strict';

/**
 * @module login
 * @description
 * Facebook authentication and appstate session hydration.
 *
 * The login flow is intentionally strict:
 *
 * 1. Load the supplied Facebook appstate.
 * 2. Verify the Facebook session with facebook.com.
 * 3. Refresh the authenticated Facebook cookie jar.
 * 4. Visit messenger.com using the same authenticated HTTP client.
 * 5. Preserve the complete cookie jar for the MQTT layer.
 * 6. Refuse to create an MQTT session when the Facebook session is invalid.
 */

const { between, randomString } = require('./utils');
const { createSession, loadFromAppState } = require('./session');

const FB_BASE_URL = 'https://www.facebook.com';
const FB_HOME_URL = `${FB_BASE_URL}/`;
const FB_LOGIN_URL =
  `${FB_BASE_URL}/login/device-based/regular/login/`;

const MESSENGER_HOME_URL =
  'https://www.messenger.com/';

/* -------------------------------------------------------------------------- */
/* Page token extraction                                                      */
/* -------------------------------------------------------------------------- */

function extractPageTokens(html) {
  if (
    typeof html !== 'string' ||
    html.length === 0
  ) {
    throw new Error(
      'Facebook returned an empty page while extracting authentication tokens'
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
      '"token":"',
      '"'
    ) ||
    between(
      html,
      'dtsg":{"token":"',
      '"'
    );

  if (!dtsg) {
    throw new Error(
      'Unable to extract DTSG token from Facebook page. ' +
      'The appstate may be expired, invalid, or Facebook may have returned a checkpoint page.'
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
      'Unable to extract Facebook user ID from authenticated page'
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

  return {
    dtsg,
    fbDtsgAg,
    userID,
    siteData,
  };
}

/* -------------------------------------------------------------------------- */
/* Login form tokens                                                          */
/* -------------------------------------------------------------------------- */

function extractLoginFormTokens(html) {
  const lsd =
    between(
      html,
      'name="lsd" value="',
      '"'
    ) || '';

  const jazoest =
    between(
      html,
      'name="jazoest" value="',
      '"'
    ) || '';

  const mTs =
    between(
      html,
      'name="m_ts" value="',
      '"'
    ) || '';

  return {
    lsd,
    jazoest,
    mTs,
  };
}

/* -------------------------------------------------------------------------- */
/* Cookie helpers                                                             */
/* -------------------------------------------------------------------------- */

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

function countCookies(cookies) {
  if (
    !cookies ||
    typeof cookies !== 'object'
  ) {
    return 0;
  }

  return Object.keys(cookies).length;
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
/* Messenger hydration                                                       */
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

            'sec-fetch-site':
              'cross-site',

            'sec-fetch-dest':
              'document',

            'sec-fetch-mode':
              'navigate',

            accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

  const newCookies =
    Object.keys(after).filter(
      (name) =>
        !Object.prototype.hasOwnProperty.call(
          before,
          name
        )
    );

  logger.debug(
    `Messenger session request completed (HTTP ${response.status})`
  );

  logger.debug(
    `Cookie jar: ${beforeCount} → ${afterCount} cookies`
  );

  if (
    newCookies.length > 0
  ) {
    logger.debug(
      `New session cookies received: ${newCookies.length}`
    );
  } else {
    logger.debug(
      'Messenger did not add new cookie names; continuing with the refreshed authenticated cookie jar'
    );
  }

  return after;
}

/* -------------------------------------------------------------------------- */
/* Email/password login                                                       */
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
      FB_BASE_URL,
      {
        headers: {
          'sec-fetch-dest':
            'document',
        },
      }
    );

  if (
    loginPageRes.status !==
    200
  ) {
    throw new Error(
      `Failed to fetch login page (HTTP ${loginPageRes.status})`
    );
  }

  const {
    lsd,
    jazoest,
  } =
    extractLoginFormTokens(
      loginPageRes.data
    );

  if (!lsd) {
    throw new Error(
      'Facebook login page did not provide an LSD token'
    );
  }

  logger.debug(
    'Submitting login credentials…'
  );

  const formData =
    new URLSearchParams({
      lsd,
      jazoest,

      email,

      pass:
        password,

      login:
        '1',

      default_persistent:
        '0',

      timezone:
        '420',

      lgndim:
        Buffer.from(
          JSON.stringify({
            w: 1920,
            h: 1080,
            aw: 1920,
            ah: 1040,
            c: 24,
          })
        ).toString(
          'base64'
        ),

      lgnrnd:
        randomString(
          16
        ).toUpperCase(),

      lgnjs:
        String(
          Math.floor(
            Date.now() / 1000
          )
        ),

      locale:
        'en_US',
    });

  const loginResponse =
    await httpClient.post(
      FB_LOGIN_URL,
      formData.toString(),
      {
        headers: {
          'content-type':
            'application/x-www-form-urlencoded',

          origin:
            FB_BASE_URL,

          referer:
            `${FB_BASE_URL}/`,

          'sec-fetch-dest':
            'document',

          'sec-fetch-mode':
            'navigate',
        },
      }
    );

  if (
    !loginResponse
  ) {
    throw new Error(
      'Facebook login returned no response'
    );
  }

  const cookiesAfterLogin =
    httpClient.getCookies();

  assertFacebookSession(
    cookiesAfterLogin
  );

  logger.info(
    'Facebook credentials accepted'
  );

  logger.debug(
    `Authenticated cookie jar contains ${countCookies(cookiesAfterLogin)} cookies`
  );

  logger.info(
    'Fetching Facebook home page for session tokens…'
  );

  const homeRes =
    await httpClient.get(
      FB_HOME_URL,
      {
        headers: {
          referer:
            `${FB_BASE_URL}/`,
        },
      }
    );

  if (
    homeRes.status !==
    200
  ) {
    throw new Error(
      `Failed to fetch authenticated Facebook home page (HTTP ${homeRes.status})`
    );
  }

  const {
    dtsg,
    fbDtsgAg,
    userID,
    siteData,
  } =
    extractPageTokens(
      homeRes.data
    );

  const refreshedCookies =
    httpClient.getCookies();

  assertFacebookSession(
    refreshedCookies
  );

  await hydrateMessengerCookies(
    httpClient,
    logger
  );

  const currentCookies =
    httpClient.getCookies();

  assertFacebookSession(
    currentCookies
  );

  const session =
    createSession({
      cookies:
        currentCookies,

      userID,

      clientID:
        randomString(
          20
        ),

      dtsg,

      fbDtsgAg,

      siteData,

      createdAt:
        Date.now(),
    });

  logger.info(
    `Logged in as user ${userID}`
  );

  logger.debug(
    `Final authenticated cookie jar contains ${countCookies(currentCookies)} cookies`
  );

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

  /*
   * Convert the supplied appstate into the internal session representation.
   */
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
      'Unable to construct a session from the supplied appstate'
    );
  }

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
   * First request: Facebook.
   *
   * This validates that the supplied appstate still represents an
   * authenticated Facebook session and refreshes any Set-Cookie values.
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
            `${FB_BASE_URL}/`,
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

  /*
   * Extract Facebook authentication metadata while the authenticated
   * facebook.com response is still available.
   */
  const {
    dtsg,
    fbDtsgAg,
    userID,
    siteData,
  } =
    extractPageTokens(
      homeRes.data
    );

  logger.debug(
    `Facebook session validated for user ${userID}`
  );

  /*
   * Second request: Messenger.
   *
   * IMPORTANT:
   * Do this using the SAME HTTP client and cookie jar.
   * Do not create a new HTTP client here.
   */
  await hydrateMessengerCookies(
    httpClient,
    logger
  );

  /*
   * The MQTT layer must receive the final cookie jar, not the original
   * appstate and not the pre-Messenger cookie snapshot.
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
   * Keep the exact authenticated user ID obtained from Facebook.
   */
  const session =
    createSession({
      cookies:
        currentCookies,

      userID,

      clientID:
        randomString(
          20
        ),

      dtsg,

      fbDtsgAg,

      siteData,

      createdAt:
        Date.now(),
    });

  logger.info(
    `Logged in as user ${userID} via appstate`
  );

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