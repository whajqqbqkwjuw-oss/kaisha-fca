'use strict';

/**
 * @module upload
 * @description Handles multipart file uploads to Facebook's Messenger upload
 * endpoint, returning the attachment IDs required by the send API.
 *
 * Supports uploading from a local file path, a raw Buffer, or a readable
 * stream.  MIME type detection falls back to 'application/octet-stream' when
 * the type cannot be inferred from the file extension.
 */

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const UPLOAD_URL = 'https://upload.facebook.com/ajax/mercury/upload.php';

/**
 * Map of file extensions to MIME types for the attachment types that
 * Facebook Messenger accepts.
 *
 * @type {Record<string, string>}
 */
const EXTENSION_MIME_MAP = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  pdf: 'application/pdf',
  zip: 'application/zip',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});

/**
 * Derives the Messenger attachment category from a MIME type.
 *
 * @param {string} mimeType
 * @returns {'image'|'video'|'audio'|'file'}
 */
function resolveAttachmentType(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

/**
 * Resolves the MIME type for a given filename.
 *
 * @param {string} filename
 * @returns {string}
 */
function resolveMimeType(filename) {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  return EXTENSION_MIME_MAP[ext] ?? 'application/octet-stream';
}

/**
 * @typedef {object} AttachmentSource
 * @property {string|Buffer|import('stream').Readable} data
 *   - A local file path string, a raw Buffer, or a Readable stream.
 * @property {string} filename
 *   - The filename sent to Facebook (used to determine MIME type).
 * @property {string} [mimeType]
 *   - Override the inferred MIME type.
 */

/**
 * @typedef {object} UploadedAttachment
 * @property {string} attachmentID   - The Facebook attachment ID.
 * @property {string} filename       - The filename provided in the source.
 * @property {string} mimeType       - The resolved MIME type.
 * @property {'image'|'video'|'audio'|'file'} attachmentType - Category derived from mimeType.
 */

/**
 * Reads an AttachmentSource into a Buffer.
 *
 * @param {AttachmentSource} source
 * @returns {Promise<Buffer>}
 */
async function readSource(source) {
  const { data } = source;

  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (typeof data === 'string') {
    const resolved = path.resolve(data);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${resolved}`);
    }
    return fs.promises.readFile(resolved);
  }

  if (data instanceof Readable) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      data.on('data', (chunk) => chunks.push(chunk));
      data.on('end', () => resolve(Buffer.concat(chunks)));
      data.on('error', reject);
    });
  }

  throw new TypeError(
    'AttachmentSource.data must be a file path string, a Buffer, or a Readable stream'
  );
}

/**
 * Builds a multipart/form-data body from a set of fields and a single file
 * part, without depending on the `form-data` package so we avoid adding a
 * dependency for something achievable with Node.js built-ins.
 *
 * @param {Record<string,string>} fields  - Text fields to include.
 * @param {string}   fileField            - Form field name for the file.
 * @param {string}   filename             - Filename to send.
 * @param {string}   mimeType             - MIME type of the file.
 * @param {Buffer}   fileBuffer           - Raw file content.
 * @param {string}   boundary             - Unique boundary string.
 * @returns {Buffer}
 */
function buildMultipartBody(fields, fileField, filename, mimeType, fileBuffer, boundary) {
  const CRLF = '\r\n';
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${name}"${CRLF}` +
      `${CRLF}` +
      `${value}${CRLF}`
    );
  }

  const fileHeader =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="${fileField}"; filename="${filename}"${CRLF}` +
    `Content-Type: ${mimeType}${CRLF}` +
    `${CRLF}`;

  const closing = `${CRLF}--${boundary}--${CRLF}`;

  return Buffer.concat([
    Buffer.from(parts.join(''), 'utf8'),
    Buffer.from(fileHeader, 'utf8'),
    fileBuffer,
    Buffer.from(closing, 'utf8'),
  ]);
}

/**
 * Generates a random multipart boundary string.
 *
 * @returns {string}
 */
function generateBoundary() {
  return `----KaishaFormBoundary${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Uploads a single attachment to Facebook's Messenger upload endpoint.
 *
 * @param {AttachmentSource}              source
 * @param {import('./session').Session}   session
 * @param {import('./http').HttpClient}   httpClient
 * @param {import('./logger').Logger}     logger
 * @returns {Promise<UploadedAttachment>}
 * @throws {Error} If the upload fails or Facebook returns no attachment ID.
 */
async function uploadAttachment(source, session, httpClient, logger) {
  const mimeType = source.mimeType ?? resolveMimeType(source.filename);
  logger.debug(`Uploading attachment "${source.filename}" (${mimeType})`);

  const fileBuffer = await readSource(source);
  const boundary = generateBoundary();

  const fields = {
    fb_dtsg: session.data.dtsg,
    fb_dtsg_ag: session.data.fbDtsgAg,
    __user: session.data.userID,
    __a: '1',
    lsd: session.data.siteData,
  };

  const body = buildMultipartBody(
    fields,
    'upload_1024',
    source.filename,
    mimeType,
    fileBuffer,
    boundary
  );

  const res = await httpClient.request({
    method: 'POST',
    url: UPLOAD_URL,
    data: body,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'origin': 'https://www.facebook.com',
      'referer': 'https://www.facebook.com/',
      'x-requested-with': 'XMLHttpRequest',
    },
  });

  const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  const cleaned = text.replace(/^for\s*\(;;\);/, '');

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Upload response is not valid JSON: ${cleaned.slice(0, 200)}`);
  }

  if (res.status >= 400) {
    const msg = parsed?.error?.message ?? parsed?.errorDescription ?? `HTTP ${res.status}`;
    throw new Error(`Attachment upload failed: ${msg}`);
  }

  const metadata = parsed?.payload?.metadata?.[0] ?? {};
  const attachmentID =
    metadata.image_id ??
    metadata.video_id ??
    metadata.audio_id ??
    metadata.file_id ??
    metadata.attachment_id ??
    null;

  if (!attachmentID) {
    throw new Error(
      'Upload succeeded but Facebook returned no attachment ID. ' +
      `Raw response: ${cleaned.slice(0, 300)}`
    );
  }

  logger.debug(`Attachment uploaded. ID: ${attachmentID}`);

  return {
    attachmentID:   String(attachmentID),
    filename:       source.filename,
    mimeType,
    attachmentType: resolveAttachmentType(mimeType),
  };
}

/**
 * Uploads multiple attachments in sequence and returns an array of results.
 * Sequential uploading avoids race conditions on Facebook's upload service.
 *
 * @param {AttachmentSource[]}            sources
 * @param {import('./session').Session}   session
 * @param {import('./http').HttpClient}   httpClient
 * @param {import('./logger').Logger}     logger
 * @returns {Promise<UploadedAttachment[]>}
 */
async function uploadAttachments(sources, session, httpClient, logger) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new TypeError('sources must be a non-empty array of AttachmentSource objects');
  }

  const results = [];
  for (const source of sources) {
    const result = await uploadAttachment(source, session, httpClient, logger);
    results.push(result);
  }
  return results;
}

module.exports = { uploadAttachment, uploadAttachments, resolveMimeType, resolveAttachmentType };
