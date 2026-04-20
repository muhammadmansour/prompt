/* ============================================================
   Google Cloud Storage uploader — thin wrapper for NCAR scraper
   ============================================================ */

const fs = require('fs');
const path = require('path');

let _storage = null;
let _bucket = null;
let _initError = null;

function isConfigured() {
  return Boolean(process.env.GCP_BUCKET) &&
    (Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS) ||
     Boolean(process.env.GCP_SERVICE_ACCOUNT_JSON));
}

function init() {
  if (_bucket) return _bucket;
  if (_initError) throw _initError;

  try {
    const { Storage } = require('@google-cloud/storage');

    const opts = { projectId: process.env.GCP_PROJECT_ID };

    // Prefer inline JSON env var (container-friendly); fall back to key file.
    if (process.env.GCP_SERVICE_ACCOUNT_JSON) {
      try {
        opts.credentials = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
      } catch (e) {
        throw new Error('GCP_SERVICE_ACCOUNT_JSON is not valid JSON: ' + e.message);
      }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const keyPath = path.isAbsolute(process.env.GOOGLE_APPLICATION_CREDENTIALS)
        ? process.env.GOOGLE_APPLICATION_CREDENTIALS
        : path.join(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS);
      if (!fs.existsSync(keyPath)) {
        throw new Error(`GCP key file not found at ${keyPath}`);
      }
      opts.keyFilename = keyPath;
    }

    _storage = new Storage(opts);
    _bucket = _storage.bucket(process.env.GCP_BUCKET);
    return _bucket;
  } catch (err) {
    _initError = err;
    throw err;
  }
}

async function ping() {
  if (!isConfigured()) {
    return { ok: false, error: 'Not configured (set GCP_BUCKET and GOOGLE_APPLICATION_CREDENTIALS in .env)' };
  }
  try {
    const bucket = init();
    const [exists] = await bucket.exists();
    if (!exists) return { ok: false, error: `Bucket ${process.env.GCP_BUCKET} not found or no access` };
    return { ok: true, bucket: process.env.GCP_BUCKET, projectId: process.env.GCP_PROJECT_ID };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Upload a local file to gs://<bucket>/<destination>
 * Idempotent-ish: overwrites if destination exists.
 * @param {string} localPath
 * @param {string} destination gcs object path (no leading slash)
 * @param {object} [opts]
 * @param {string} [opts.contentType]
 * @param {object} [opts.metadata]
 */
async function uploadFile(localPath, destination, opts = {}) {
  const bucket = init();
  const options = {
    destination,
    resumable: false, // fast path for small files
    metadata: {
      contentType: opts.contentType,
      metadata: opts.metadata || {},
      cacheControl: 'private, max-age=0, no-transform',
    },
  };
  await bucket.upload(localPath, options);
  return `gs://${bucket.name}/${destination}`;
}

/**
 * Upload a Buffer / string to GCS directly.
 */
async function uploadBuffer(buffer, destination, opts = {}) {
  const bucket = init();
  const file = bucket.file(destination);
  await file.save(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'utf8'), {
    contentType: opts.contentType || 'application/octet-stream',
    resumable: false,
    metadata: { metadata: opts.metadata || {} },
  });
  return `gs://${bucket.name}/${destination}`;
}

/**
 * Write JSON object to GCS.
 */
async function uploadJson(obj, destination, opts = {}) {
  return uploadBuffer(
    Buffer.from(JSON.stringify(obj, null, 2), 'utf8'),
    destination,
    { ...opts, contentType: 'application/json' }
  );
}

/**
 * Generate a v4 signed URL (default 1 hour) for reading an object.
 */
async function signedUrl(destination, expiresInMs = 60 * 60 * 1000) {
  const bucket = init();
  const [url] = await bucket.file(destination).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInMs,
  });
  return url;
}

/**
 * Download an object's contents as a string.
 * @returns {Promise<string|null>} text or null if not found
 */
async function downloadText(destination) {
  const bucket = init();
  const file = bucket.file(destination);
  try {
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buf] = await file.download();
    return buf.toString('utf8');
  } catch (err) {
    if (err.code === 404) return null;
    throw err;
  }
}

/**
 * Check whether an object exists.
 */
async function fileExists(destination) {
  const bucket = init();
  const [exists] = await bucket.file(destination).exists();
  return exists;
}

/**
 * List objects under a prefix (e.g. a trial folder).
 */
async function listPrefix(prefix) {
  const bucket = init();
  const [files] = await bucket.getFiles({ prefix });
  return files.map(f => ({
    name: f.name,
    size: Number(f.metadata?.size || 0),
    updated: f.metadata?.updated,
    contentType: f.metadata?.contentType,
  }));
}

/**
 * Delete all objects under a prefix. Used when a trial is discarded.
 */
async function deletePrefix(prefix) {
  const bucket = init();
  const [files] = await bucket.getFiles({ prefix });
  await Promise.all(files.map(f => f.delete({ ignoreNotFound: true })));
  return files.length;
}

module.exports = {
  isConfigured,
  ping,
  uploadFile,
  uploadBuffer,
  uploadJson,
  downloadText,
  fileExists,
  signedUrl,
  listPrefix,
  deletePrefix,
};
