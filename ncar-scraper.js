/* ============================================================
   NCAR Document Scraper — ncar.gov.sa
   Pure Node.js port (no extra deps for scraping).
   Supports per-trial GCS uploads via ./gcs-uploader.js
   ============================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gcs = require('./gcs-uploader');

const BASE = 'https://ncar.gov.sa';
const API = `${BASE}/api/index.php/api`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CURL_TIMEOUT_MS = 30000;

// ---------- Job state (singleton — one job at a time) ----------

/** @typedef {'idle'|'running'|'completed'|'failed'|'stopped'} JobStatus */

const state = {
  /** @type {JobStatus} */
  status: 'idle',
  trialId: null,
  startedAt: null,
  finishedAt: null,
  totalDocs: 0,
  totalPages: 0,
  currentPage: 0,
  processedDocs: 0,
  downloadedPdfs: 0,
  uploadedFiles: 0,
  failedPages: 0,
  failedDocs: 0,
  failedUploads: 0,
  lastError: null,
  config: null,
  gcsPrefix: null, // e.g. "trial_2026-04-20_14-03-22_ab12cd"
  gcsEnabled: false,
  /** @type {string[]} */
  log: [],
  /** @type {AbortController|null} */
  abort: null,
};

const LOG_MAX = 500;

// Registry of past trials (in-memory; persisted via onTrialUpdate hook).
/** @type {Map<string, object>} */
const trials = new Map();
let onTrialUpdate = null; // set by server.js for SQLite persistence

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  state.log.push(line);
  if (state.log.length > LOG_MAX) state.log.shift();
  console.log('[Scrapper]', msg);
}

function setTrialStore(cb) { onTrialUpdate = cb; }

function loadTrialsFromStore(rows) {
  for (const r of rows) trials.set(r.id, r);
}

function saveTrialSnapshot() {
  if (!state.trialId) return;
  const snap = {
    id: state.trialId,
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    totalDocs: state.totalDocs,
    totalPages: state.totalPages,
    processedDocs: state.processedDocs,
    downloadedPdfs: state.downloadedPdfs,
    uploadedFiles: state.uploadedFiles,
    failedPages: state.failedPages,
    failedDocs: state.failedDocs,
    failedUploads: state.failedUploads,
    lastError: state.lastError,
    config: state.config,
    gcsPrefix: state.gcsPrefix,
    gcsBucket: state.gcsEnabled ? process.env.GCP_BUCKET : null,
    gcsEnabled: state.gcsEnabled,
  };
  trials.set(state.trialId, snap);
  if (onTrialUpdate) {
    try { onTrialUpdate(snap); } catch (e) { console.error('[Scrapper] onTrialUpdate error:', e.message); }
  }
}

function listTrials() {
  return Array.from(trials.values())
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}
function getTrial(id) { return trials.get(id) || null; }

function resetRunningState() {
  state.status = 'idle';
  state.trialId = null;
  state.startedAt = null;
  state.finishedAt = null;
  state.totalDocs = 0;
  state.totalPages = 0;
  state.currentPage = 0;
  state.processedDocs = 0;
  state.downloadedPdfs = 0;
  state.uploadedFiles = 0;
  state.failedPages = 0;
  state.failedDocs = 0;
  state.failedUploads = 0;
  state.lastError = null;
  state.config = null;
  state.gcsPrefix = null;
  state.gcsEnabled = false;
  state.log = [];
  state.abort = null;
}

function getStatus() {
  return {
    status: state.status,
    trialId: state.trialId,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    totalDocs: state.totalDocs,
    totalPages: state.totalPages,
    currentPage: state.currentPage,
    processedDocs: state.processedDocs,
    downloadedPdfs: state.downloadedPdfs,
    uploadedFiles: state.uploadedFiles,
    failedPages: state.failedPages,
    failedDocs: state.failedDocs,
    failedUploads: state.failedUploads,
    lastError: state.lastError,
    config: state.config,
    gcsPrefix: state.gcsPrefix,
    gcsEnabled: state.gcsEnabled,
    gcsBucket: state.gcsEnabled ? process.env.GCP_BUCKET : null,
    gcsConfigured: gcs.isConfigured(),
    progressPct: state.totalDocs > 0
      ? Math.min(100, Math.round((state.processedDocs / state.totalDocs) * 100))
      : 0,
    log: state.log.slice(-200),
  };
}

function stopJob() {
  if (state.status !== 'running') return false;
  if (state.abort) state.abort.abort();
  state.status = 'stopped';
  state.finishedAt = new Date().toISOString();
  saveTrialSnapshot();
  log('⏹ Job stopped by user');
  return true;
}

// ---------- Helpers ----------

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      }, { once: true });
    }
  });
}

function describeFetchError(err, url) {
  if (!err) return 'unknown error';
  if (err.name === 'AbortError') return `timeout after ${CURL_TIMEOUT_MS}ms on ${url}`;
  const cause = err.cause || {};
  const parts = [];
  if (cause.code) parts.push(cause.code);
  if (cause.errno) parts.push(`errno=${cause.errno}`);
  if (cause.syscall) parts.push(cause.syscall);
  if (cause.hostname) parts.push(`host=${cause.hostname}`);
  if (cause.address) parts.push(`addr=${cause.address}`);
  if (cause.port) parts.push(`port=${cause.port}`);
  const detail = parts.length ? ` (${parts.join(' ')})` : '';
  return `${err.message}${detail} — ${url}`;
}

async function fetchJson(url, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CURL_TIMEOUT_MS);
  const onParentAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onParentAbort, { once: true });
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Accept-Language': 'ar,en;q=0.9',
        'Referer': `${BASE}/rules-regulations`,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    const e = new Error(describeFetchError(err, url));
    e.cause = err;
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onParentAbort);
  }
}

async function fetchPdf(url, outFile, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CURL_TIMEOUT_MS);
  const onParentAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onParentAbort, { once: true });
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Referer': `${BASE}/` },
    });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return false;
    if (buf.slice(0, 4).toString() !== '%PDF') return false;
    fs.writeFileSync(outFile, buf);
    return true;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onParentAbort);
  }
}

function safeDirname(s) {
  return String(s || '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`;
}

function appendCsv(csvPath, row) {
  fs.appendFileSync(csvPath, row.map(csvEscape).join(',') + '\n', 'utf8');
}

const RIYADH_TZ = 'Asia/Riyadh';

/** Get date/time parts formatted in a specific IANA time zone. */
function nowInZone(tz = RIYADH_TZ) {
  // `en-CA` gives ISO-like parts (YYYY-MM-DD / 24h) that are easy to read back.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date()).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  // Normalize 24h "hour: 24" → "00" (Intl quirk in some runtimes)
  if (parts.hour === '24') parts.hour = '00';
  return parts;
}

function makeTrialId() {
  const p = nowInZone(RIYADH_TZ);
  const ts = `${p.year}-${p.month}-${p.day}_${p.hour}-${p.minute}-${p.second}`;
  const rnd = crypto.randomBytes(3).toString('hex');
  // e.g. trial_2026-04-20_17-03-22_KSA_ab12cd
  return `trial_${ts}_KSA_${rnd}`;
}

// ---------- GCS helpers (fire-and-track; never crash the job) ----------

async function gcsUploadSafe(localPath, destRel, contentType) {
  if (!state.gcsEnabled) return null;
  const destination = `${state.gcsPrefix}/${destRel}`.replace(/\\/g, '/');
  try {
    const uri = await gcs.uploadFile(localPath, destination, { contentType });
    state.uploadedFiles++;
    return uri;
  } catch (err) {
    state.failedUploads++;
    log(`  ⚠ GCS upload failed for ${destRel}: ${err.message}`);
    return null;
  }
}

async function gcsUploadJsonSafe(obj, destRel) {
  if (!state.gcsEnabled) return null;
  const destination = `${state.gcsPrefix}/${destRel}`.replace(/\\/g, '/');
  try {
    const uri = await gcs.uploadJson(obj, destination);
    state.uploadedFiles++;
    return uri;
  } catch (err) {
    state.failedUploads++;
    log(`  ⚠ GCS upload failed for ${destRel}: ${err.message}`);
    return null;
  }
}

function formatInZone(isoString, tz = RIYADH_TZ) {
  if (!isoString) return null;
  try {
    return new Date(isoString).toLocaleString('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }) + ` (${tz})`;
  } catch { return isoString; }
}

async function writeManifest() {
  if (!state.gcsEnabled) return;
  const manifest = {
    id: state.trialId,
    status: state.status,
    startedAt: state.startedAt,
    startedAtKSA: formatInZone(state.startedAt),
    finishedAt: state.finishedAt,
    finishedAtKSA: formatInZone(state.finishedAt),
    timezone: RIYADH_TZ,
    config: state.config,
    progress: {
      totalDocs: state.totalDocs,
      totalPages: state.totalPages,
      currentPage: state.currentPage,
      processedDocs: state.processedDocs,
      downloadedPdfs: state.downloadedPdfs,
      uploadedFiles: state.uploadedFiles,
      failedPages: state.failedPages,
      failedDocs: state.failedDocs,
      failedUploads: state.failedUploads,
    },
    gcs: {
      bucket: process.env.GCP_BUCKET,
      prefix: state.gcsPrefix,
    },
  };
  try { await gcs.uploadJson(manifest, `${state.gcsPrefix}/manifest.json`); }
  catch (err) { log(`  ⚠ Manifest upload failed: ${err.message}`); }
}

// ---------- Scraping API calls ----------

function pageUrl(page, perPage, sort, order) {
  return `${API}/documents/list/${page}/${perPage}/${sort}/${order}`;
}

async function probeTotal(perPage, sort, order, signal) {
  const d = await fetchJson(pageUrl(1, perPage, sort, order), signal);
  return { total: Number(d?.dataLength || 0), first: d };
}

async function fetchPage(page, perPage, sort, order, signal) {
  return fetchJson(pageUrl(page, perPage, sort, order), signal);
}

// ---------- Per-document processing ----------

async function processDoc(doc, idx, trialDir, downloadPdf, signal) {
  const encId = doc?.id || '';
  if (!encId) return { ok: false, pdfs: 0 };

  const titleAr = doc?.title_ar || '';
  const titleEn = doc?.title_en || '';
  const number = doc?.number || '';
  const approveDate = doc?.approve_date || '';
  const isValid = doc?.is_valid ?? '';
  const markerEn = doc?.marker?.title_en || '';
  const approves = doc?.Approves || [];
  const approveType = approves.length ? (approves[0].name_en || '') : '';

  const label = /[a-zA-Z]{3}/.test(titleEn) ? titleEn : `doc_${number.replace(/\//g, '_')}`;
  const safeLabel = safeDirname(label);
  const relFolder = path.posix.join('pdfs', `${idx}_${safeLabel}`);
  const docDir = path.join(trialDir, 'pdfs', `${idx}_${safeLabel}`);

  // Save metadata locally + upload
  const metaDir = path.join(trialDir, 'metadata');
  const metaFile = path.join(metaDir, `${idx}.json`);
  fs.writeFileSync(metaFile, JSON.stringify(doc, null, 2), 'utf8');
  gcsUploadJsonSafe(doc, `metadata/${idx}.json`).catch(() => {});

  log(`  [${idx}] ${titleAr}`);
  if (titleEn) log(`        EN: ${titleEn}`);
  log(`        num=${number} | date=${approveDate} | ${approveType} | ${markerEn}`);

  let o = 0, t = 0, p = 0;
  const uploads = [];
  if (downloadPdf) {
    fs.mkdirSync(docDir, { recursive: true });
    const tryOne = async (doctype, outFile, destRel) => {
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) return 1;
      const url = `${API}/resource/${encId}/Documents/${doctype}`;
      const ok = await fetchPdf(url, outFile, signal);
      if (ok) uploads.push(gcsUploadSafe(outFile, destRel, 'application/pdf'));
      return ok ? 1 : 0;
    };
    o = await tryOne('OriginalAttachPath',   path.join(docDir, 'original.pdf'),   `${relFolder}/original.pdf`);
    if (signal?.aborted) throw new Error('aborted');
    t = await tryOne('TranslatedAttachPath', path.join(docDir, 'translated.pdf'), `${relFolder}/translated.pdf`);
    if (signal?.aborted) throw new Error('aborted');
    p = await tryOne('PrintedAttachPath',    path.join(docDir, 'printed.pdf'),    `${relFolder}/printed.pdf`);
    log(`        PDFs → orig=${o} trans=${t} print=${p}`);
  }

  // Don't block the job on uploads — but wait for them before marking doc done
  // so the manifest counts stay consistent. Failures are swallowed inside gcsUploadSafe.
  if (uploads.length) await Promise.allSettled(uploads);

  // CSV + index (local)
  const csv = path.join(trialDir, 'documents.csv');
  appendCsv(csv, [
    encId, number, titleAr, titleEn, approveType, approveDate, isValid, markerEn,
    o, t, p,
  ]);

  const idxPath = path.join(trialDir, 'index.jsonl');
  const record = {
    idx, id: encId, number, title_ar: titleAr, title_en: titleEn,
    approve_type: approveType, approve_date: approveDate, is_valid: isValid,
    marker_en: markerEn, has_original: o, has_translated: t, has_printed: p,
    folder: relFolder,
  };
  fs.appendFileSync(idxPath, JSON.stringify(record) + '\n', 'utf8');

  return { ok: true, pdfs: o + t + p };
}

// ---------- Main runner ----------

/**
 * Start a scraping trial. Returns immediately; progress tracked via getStatus().
 * @param {object} cfg
 * @param {number} [cfg.startPage=1]
 * @param {number} [cfg.perPage=10]
 * @param {string} [cfg.sort='approveDate']
 * @param {string} [cfg.order='ASC']
 * @param {boolean} [cfg.downloadPdf=true]
 * @param {boolean} [cfg.uploadToGcs] default: true if GCS configured
 * @param {string} [cfg.outDir]  absolute path; default <cwd>/ncar_documents
 * @param {number} [cfg.delayMs=400]
 * @param {number} [cfg.maxPages] optional cap (for testing)
 */
async function startJob(cfg = {}) {
  if (state.status === 'running') {
    throw new Error('A scraping job is already running');
  }
  resetRunningState();

  const gcsConfigured = gcs.isConfigured();
  const gcsEnabled = gcsConfigured && cfg.uploadToGcs !== false;

  const config = {
    startPage: Math.max(1, parseInt(cfg.startPage || 1, 10)),
    perPage: Math.max(1, Math.min(100, parseInt(cfg.perPage || 10, 10))),
    sort: cfg.sort || 'approveDate',
    order: (cfg.order || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
    downloadPdf: cfg.downloadPdf !== false,
    uploadToGcs: gcsEnabled,
    outDir: cfg.outDir || path.join(process.cwd(), 'ncar_documents'),
    delayMs: Math.max(0, parseInt(cfg.delayMs ?? 400, 10)),
    maxPages: cfg.maxPages ? parseInt(cfg.maxPages, 10) : null,
  };

  state.trialId = makeTrialId();
  state.gcsPrefix = state.trialId;
  state.gcsEnabled = gcsEnabled;
  state.config = config;
  state.status = 'running';
  state.startedAt = new Date().toISOString();
  state.abort = new AbortController();
  const signal = state.abort.signal;

  const trialDir = path.join(config.outDir, state.trialId);
  fs.mkdirSync(path.join(trialDir, 'pdfs'), { recursive: true });
  fs.mkdirSync(path.join(trialDir, 'metadata'), { recursive: true });

  const csv = path.join(trialDir, 'documents.csv');
  fs.writeFileSync(csv,
    'id,number,title_ar,title_en,approve_type,approve_date,is_valid,marker,has_original,has_translated,has_printed\n',
    'utf8');

  log('╔══════════════════════════════════════════════╗');
  log('║        NCAR Bulk Scraper — ncar.gov.sa       ║');
  log('╚══════════════════════════════════════════════╝');
  log(`Trial:  ${state.trialId}`);
  log(`Output: ${trialDir}`);
  log(`PDFs:   ${config.downloadPdf}`);
  log(`GCS:    ${gcsEnabled ? `✓ gs://${process.env.GCP_BUCKET}/${state.gcsPrefix}/` : (gcsConfigured ? 'disabled for this trial' : 'not configured')}`);
  log(`Started: ${formatInZone(state.startedAt)}`);

  saveTrialSnapshot();
  if (gcsEnabled) await writeManifest();

  runJob(config, trialDir, signal)
    .catch(err => {
      if (err?.message === 'aborted' || signal.aborted) {
        state.status = 'stopped';
      } else {
        state.status = 'failed';
        state.lastError = err?.message || String(err);
        log(`✗ Job failed: ${state.lastError}`);
      }
      state.finishedAt = new Date().toISOString();
    })
    .finally(async () => {
      saveTrialSnapshot();
      if (state.gcsEnabled) {
        // Final artifacts: CSV + index + manifest
        const localCsv = path.join(trialDir, 'documents.csv');
        const localIdx = path.join(trialDir, 'index.jsonl');
        if (fs.existsSync(localCsv)) await gcsUploadSafe(localCsv, 'documents.csv', 'text/csv');
        if (fs.existsSync(localIdx)) await gcsUploadSafe(localIdx, 'index.jsonl', 'application/x-ndjson');
        await writeManifest();
      }
    });

  return getStatus();
}

async function runJob(config, trialDir, signal) {
  log('▶ Probing API...');
  const { total } = await probeTotal(config.perPage, config.sort, config.order, signal);
  if (!total) throw new Error('API returned 0 documents. Check connection.');

  const totalPages = Math.ceil(total / config.perPage);
  state.totalDocs = total;
  state.totalPages = totalPages;
  log(`▶ Total documents : ${total}`);
  log(`▶ Total pages     : ${totalPages}`);
  log(`▶ Starting page   : ${config.startPage}`);
  if (config.maxPages) log(`▶ Max pages       : ${config.maxPages} (capped)`);

  let docCount = (config.startPage - 1) * config.perPage;
  let page = config.startPage;
  const lastPage = config.maxPages ? Math.min(totalPages, config.startPage + config.maxPages - 1) : totalPages;

  while (page <= lastPage) {
    if (signal.aborted) throw new Error('aborted');
    state.currentPage = page;
    log(`── Page ${page} / ${totalPages} (docs so far: ${docCount}) ──`);

    let response;
    try {
      response = await fetchPage(page, config.perPage, config.sort, config.order, signal);
    } catch (e) {
      log(`  ⚠ Bad response — retrying in 5s... (${e.message})`);
      try { await sleep(5000, signal); } catch { throw new Error('aborted'); }
      try {
        response = await fetchPage(page, config.perPage, config.sort, config.order, signal);
      } catch (e2) {
        log(`  ✗ Skipping page ${page}`);
        state.failedPages++;
        page++;
        continue;
      }
    }

    if (response?.status !== 1 && response?.status !== '1') {
      log(`  ✗ Skipping page ${page} (status=${response?.status})`);
      state.failedPages++;
      page++;
      continue;
    }

    const items = Array.isArray(response?.data) ? response.data : [];
    for (const item of items) {
      if (signal.aborted) throw new Error('aborted');
      docCount++;
      state.processedDocs = docCount;
      try {
        const { pdfs } = await processDoc(item, docCount, trialDir, config.downloadPdf, signal);
        state.downloadedPdfs += pdfs;
      } catch (e) {
        if (e?.message === 'aborted' || signal.aborted) throw e;
        state.failedDocs++;
        log(`  ✗ Doc ${docCount} failed: ${e.message}`);
      }
      if (config.delayMs) {
        try { await sleep(config.delayMs, signal); } catch { throw new Error('aborted'); }
      }
    }

    // Per-page manifest refresh + snapshot
    saveTrialSnapshot();
    if (state.gcsEnabled) writeManifest().catch(() => {});

    page++;
    if (config.delayMs) {
      try { await sleep(config.delayMs, signal); } catch { throw new Error('aborted'); }
    }
  }

  state.status = 'completed';
  state.finishedAt = new Date().toISOString();
  log(`✅ Done! Documents: ${docCount} | PDFs: ${state.downloadedPdfs} | Uploads: ${state.uploadedFiles} | Failed: pages=${state.failedPages} docs=${state.failedDocs} uploads=${state.failedUploads}`);
  log(`   Finished: ${formatInZone(state.finishedAt)}`);
}

// ---------- Listing scraped documents (per trial) ----------

function trialDirFor(outDir, trialId) {
  return path.join(outDir, trialId);
}

function listDocuments(outDir, { trialId, limit = 50, offset = 0, search = '' } = {}) {
  // If no trial id, use most recent trial with an index file
  let id = trialId;
  if (!id) {
    const t = listTrials().find(t => fs.existsSync(path.join(outDir, t.id, 'index.jsonl')));
    id = t?.id;
  }
  if (!id) return { total: 0, items: [], trialId: null };

  const idxFile = path.join(outDir, id, 'index.jsonl');
  if (!fs.existsSync(idxFile)) return { total: 0, items: [], trialId: id };

  const lines = fs.readFileSync(idxFile, 'utf8').split(/\r?\n/).filter(Boolean);
  let items = [];
  for (const line of lines) { try { items.push(JSON.parse(line)); } catch { /* skip */ } }
  items.reverse();

  if (search) {
    const q = search.toLowerCase();
    items = items.filter(d =>
      (d.title_ar || '').toLowerCase().includes(q) ||
      (d.title_en || '').toLowerCase().includes(q) ||
      (d.number || '').toLowerCase().includes(q));
  }
  const total = items.length;
  items = items.slice(offset, offset + limit);
  return { total, items, trialId: id };
}

function documentPdfPath(outDir, trialId, folder, type) {
  const filename = ({ original: 'original.pdf', translated: 'translated.pdf', printed: 'printed.pdf' })[type];
  if (!filename || !trialId) return null;
  const full = path.join(outDir, trialId, folder, filename);
  const resolved = path.resolve(full);
  const trialRoot = path.resolve(path.join(outDir, trialId));
  if (!resolved.startsWith(trialRoot)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}

async function getSignedUrlForTrialFile(trialId, relPath, expiresMs = 60 * 60 * 1000) {
  if (!gcs.isConfigured()) throw new Error('GCS not configured');
  const destination = `${trialId}/${relPath}`.replace(/\\/g, '/');
  return gcs.signedUrl(destination, expiresMs);
}

/**
 * Read the scraped index for a trial **from the GCS bucket** and return it
 * enriched with per-document GCS paths.
 *
 * Primary source:  gs://<bucket>/<trialId>/index.jsonl
 * Fallback:        list all objects under gs://<bucket>/<trialId>/pdfs/ and
 *                  reconstruct minimal records (for trials stopped mid-run
 *                  before index.jsonl was flushed).
 */
async function readTrialIndexFromGcs(trialId) {
  if (!gcs.isConfigured()) throw new Error('GCS not configured');
  const bucket = process.env.GCP_BUCKET;

  const indexPath = `${trialId}/index.jsonl`;
  const manifestPath = `${trialId}/manifest.json`;

  let manifest = null;
  try {
    const mText = await gcs.downloadText(manifestPath);
    if (mText) manifest = JSON.parse(mText);
  } catch (_) { /* ignore — manifest is optional */ }

  const indexText = await gcs.downloadText(indexPath);
  let items = [];

  if (indexText) {
    // Parse NDJSON
    for (const line of indexText.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { items.push(JSON.parse(line)); } catch { /* skip bad line */ }
    }
  } else {
    // Fallback: list the prefix and build skeleton records
    const files = await gcs.listPrefix(`${trialId}/pdfs/`);
    const byFolder = new Map();
    for (const f of files) {
      const rel = f.name.slice(`${trialId}/`.length); // "pdfs/1_Foo/original.pdf"
      const m = rel.match(/^(pdfs\/[^/]+)\/(original|translated|printed)\.pdf$/);
      if (!m) continue;
      const folder = m[1];
      const type = m[2];
      if (!byFolder.has(folder)) byFolder.set(folder, { folder, size: 0 });
      const rec = byFolder.get(folder);
      rec[`has_${type}`] = 1;
      rec.size += f.size || 0;
    }
    let idx = 0;
    for (const rec of byFolder.values()) {
      idx++;
      const nameMatch = rec.folder.match(/^pdfs\/(\d+)_(.+)$/);
      items.push({
        idx: nameMatch ? Number(nameMatch[1]) : idx,
        title_ar: '',
        title_en: nameMatch ? nameMatch[2].replace(/_/g, ' ') : rec.folder,
        folder: rec.folder,
        has_original: rec.has_original || 0,
        has_translated: rec.has_translated || 0,
        has_printed: rec.has_printed || 0,
      });
    }
    items.sort((a, b) => (a.idx || 0) - (b.idx || 0));
  }

  // Enrich with GCS paths
  items = items.map(d => ({
    ...d,
    gcs: {
      bucket,
      prefix: `${trialId}/${d.folder}`,
      original:   d.has_original   ? `${d.folder}/original.pdf`   : null,
      translated: d.has_translated ? `${d.folder}/translated.pdf` : null,
      printed:    d.has_printed    ? `${d.folder}/printed.pdf`    : null,
    },
  }));

  return {
    trialId,
    bucket,
    prefix: trialId,
    consoleUrl: `https://console.cloud.google.com/storage/browser/${bucket}/${trialId}`,
    source: indexText ? 'index.jsonl' : 'listed-prefix',
    manifest,
    total: items.length,
    items,
  };
}

async function gcsPing() { return gcs.ping(); }

module.exports = {
  startJob,
  stopJob,
  getStatus,
  resetRunningState,
  listDocuments,
  documentPdfPath,
  listTrials,
  getTrial,
  setTrialStore,
  loadTrialsFromStore,
  getSignedUrlForTrialFile,
  readTrialIndexFromGcs,
  gcsPing,
};
