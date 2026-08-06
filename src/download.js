'use strict';

/**
 * @module download
 * @description Downloads Facebook Messenger attachments (images, videos,
 * audio, documents) to disk or into memory as a Buffer.
 *
 * All requests are made through the shared HttpClient so the session cookies
 * are automatically included, which is required for authenticated CDN URLs.
 */

const fs   = require('fs');
const path = require('path');

/**
 * @typedef {object} DownloadResult
 * @property {string}  filename    - The filename used when saving to disk, or
 *   derived from the URL when saving to memory.
 * @property {string}  mimeType    - Content-Type returned by the server.
 * @property {number}  size        - Size in bytes of the downloaded content.
 * @property {string}  [savedTo]   - Absolute path where the file was written
 *   (only present when a destination directory was provided).
 * @property {Buffer}  [buffer]    - Raw file content (only present when no
 *   destination directory was provided).
 */

/**
 * Derives a safe filename from a URL, stripping query strings and fragments.
 *
 * @param {string} url
 * @param {string} [fallback='attachment']
 * @returns {string}
 */
function filenameFromURL(url, fallback = 'attachment') {
  try {
    const pathname = new URL(url).pathname;
    const base     = path.basename(pathname);
    return base.length > 0 ? decodeURIComponent(base) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Downloads a single attachment from a URL.
 *
 * When `destDir` is provided the file is written to that directory and
 * `result.savedTo` is set.  When omitted the raw bytes are returned in
 * `result.buffer` without touching the filesystem.
 *
 * @param {string}                        url       - Direct download URL.
 * @param {import('./http').HttpClient}   httpClient
 * @param {import('./logger').Logger}     logger
 * @param {object}                        [options={}]
 * @param {string}                        [options.destDir]  - Directory to save the file in.
 * @param {string}                        [options.filename] - Override the derived filename.
 * @returns {Promise<DownloadResult>}
 * @throws {Error} If the server responds with a non-2xx status or the
 *   destination directory cannot be created.
 */
async function downloadFile(url, httpClient, logger, { destDir, filename } = {}) {
  logger.debug(`Downloading: ${url}`);

  const res = await httpClient.request({
    method:       'GET',
    url,
    responseType: 'arraybuffer',
    headers: {
      referer: 'https://www.facebook.com/',
    },
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Download failed for ${url} (HTTP ${res.status})`);
  }

  const buffer   = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data);
  const mimeType = (res.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim();
  const name     = filename ?? filenameFromURL(url);

  if (destDir) {
    const resolvedDir = path.resolve(destDir);
    fs.mkdirSync(resolvedDir, { recursive: true });

    const filePath = path.join(resolvedDir, name);
    fs.writeFileSync(filePath, buffer);

    logger.debug(`Saved ${buffer.length} bytes → ${filePath}`);

    return {
      filename: name,
      mimeType,
      size:     buffer.length,
      savedTo:  filePath,
    };
  }

  logger.debug(`Downloaded ${buffer.length} bytes into memory (${name})`);

  return {
    filename: name,
    mimeType,
    size:     buffer.length,
    buffer,
  };
}

/**
 * Downloads multiple attachments in sequence.
 *
 * @param {Array<{url:string, filename?:string}>} items
 * @param {import('./http').HttpClient}            httpClient
 * @param {import('./logger').Logger}              logger
 * @param {object}                                 [options={}]
 * @param {string}                                 [options.destDir]
 * @returns {Promise<DownloadResult[]>}
 */
async function downloadFiles(items, httpClient, logger, { destDir } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError('downloadFiles: items must be a non-empty array');
  }

  const results = [];
  for (const item of items) {
    const result = await downloadFile(
      item.url,
      httpClient,
      logger,
      { destDir, filename: item.filename }
    );
    results.push(result);
  }
  return results;
}

module.exports = { downloadFile, downloadFiles, filenameFromURL };
