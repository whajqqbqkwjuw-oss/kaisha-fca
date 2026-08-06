'use strict';

/**
 * @module http
 * @description HTTP client with cookie management, automatic retry, and
 * Facebook-compatible default headers.
 *
 * Improvements in this version:
 * - `NetworkError` is thrown on permanent failure instead of the raw Axios error.
 * - `axios.isCancel` check prevents retry on request cancellation.
 * - Cookie jar uses `Object.create(null)` to prevent prototype pollution.
 * - `BASE_HEADERS` is a frozen constant to avoid per-request allocations.
 * - Retry delays use the shared `exponentialBackoff` helper.
 */

const axios = require('axios');
const { serializeCookies, parseCookies, sleep, exponentialBackoff } = require('./utils');
const { NetworkError } = require('./errors');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/125.0.0.0 Safari/537.36';

/** @type {Readonly<Record<string,string>>} */
const BASE_HEADERS = Object.freeze({
  accept:                      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language':           'en-US,en;q=0.9',
  'accept-encoding':           'gzip, deflate, br',
  connection:                  'keep-alive',
  'sec-fetch-dest':            'document',
  'sec-fetch-mode':            'navigate',
  'sec-fetch-site':            'same-origin',
  'upgrade-insecure-requests': '1',
});

/**
 * @typedef {object} HttpClient
 * @property {function} get
 * @property {function} post
 * @property {function} request
 * @property {function} getCookies
 * @property {function} setCookies
 */

/**
 * Creates an HTTP client.
 *
 * @param {object}  [opts={}]
 * @param {Record<string,string>} [opts.cookies={}]
 * @param {string}  [opts.userAgent]
 * @param {number}  [opts.timeout=30000]
 * @param {number}  [opts.maxRetries=3]
 * @param {number}  [opts.retryDelay=1000]
 * @param {import('./logger').Logger} opts.logger
 * @returns {HttpClient}
 */
function createHttpClient({
  cookies    = {},
  userAgent  = DEFAULT_USER_AGENT,
  timeout    = 30_000,
  maxRetries = 3,
  retryDelay = 1_000,
  logger,
} = {}) {
  const jar = Object.assign(Object.create(null), cookies);

  const instance = axios.create({
    timeout,
    maxRedirects: 5,
    // Treat anything < 500 as a non-error so callers can inspect status themselves.
    validateStatus: (s) => s < 500,
  });

  /**
   * @param {import('axios').AxiosResponse} res
   */
  function absorbCookies(res) {
    const raw = res.headers['set-cookie'];
    if (!raw) return;
    const parsed = parseCookies(Array.isArray(raw) ? raw : [raw]);
    Object.assign(jar, parsed);
  }

  /**
   * Executes a request with exponential-backoff retry on network errors.
   *
   * @param {import('axios').AxiosRequestConfig} config
   * @returns {Promise<import('axios').AxiosResponse>}
   */
  async function request(config) {
    const cookieStr = serializeCookies(jar);
    const headers   = {
      ...BASE_HEADERS,
      'user-agent': userAgent,
      ...(cookieStr ? { cookie: cookieStr } : {}),
      ...config.headers,
    };

    let lastErr;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await instance.request({ ...config, headers });
        absorbCookies(res);
        return res;
      } catch (err) {
        if (axios.isCancel(err)) throw err;

        lastErr = err;

        if (attempt < maxRetries) {
          const delay = exponentialBackoff(attempt, retryDelay);
          logger.warn(
            `HTTP ${(config.method ?? 'REQ').toUpperCase()} ${config.url} ` +
            `failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms: ${err.message}`
          );
          await sleep(delay);
        }
      }
    }

    throw new NetworkError(
      `HTTP request to ${config.url} failed after ${maxRetries} attempts: ${lastErr?.message}`,
      undefined,
      { cause: lastErr }
    );
  }

  /**
   * GET request.
   *
   * @param {string} url
   * @param {import('axios').AxiosRequestConfig} [config={}]
   */
  const get  = (url, config = {}) => request({ ...config, method: 'GET',  url });

  /**
   * POST request.
   *
   * @param {string} url
   * @param {unknown} data
   * @param {import('axios').AxiosRequestConfig} [config={}]
   */
  const post = (url, data, config = {}) => request({ ...config, method: 'POST', url, data });

  /** @returns {Record<string,string>} */
  const getCookies = () => Object.assign(Object.create(null), jar);

  /** @param {Record<string,string>} c */
  const setCookies = (c) => Object.assign(jar, c);

  return { get, post, request, getCookies, setCookies };
}

module.exports = { createHttpClient, DEFAULT_USER_AGENT };
