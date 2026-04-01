const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GoogleGenAI } = require('@google/genai');
const Database = require('better-sqlite3');

const PORT = 5555; // Wathbah server port
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_UPLOAD_URL = 'https://generativelanguage.googleapis.com/upload/v1beta';

// Load environment variables from .env file
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    });
  } catch (error) {
    console.warn('No .env file found or error loading it:', error.message);
  }
}

loadEnv();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// GRC Platform configuration
const GRC_API_URL = process.env.GRC_API_URL || 'https://grc.wathbah.dev';

// ==========================================
// Authentication (via GRC IAM)
// ==========================================

// Maps local session token → GRC auth token
const authSessions = new Map(); // { localToken: { grcToken, username } }

function generateLocalToken() {
  return crypto.randomBytes(48).toString('hex');
}

function isValidToken(token) {
  return token && authSessions.has(token);
}

function getGrcToken(localToken) {
  const session = authSessions.get(localToken);
  return session ? session.grcToken : null;
}

// Helper: make authenticated GRC API fetch
function grcFetch(url, options = {}, localToken) {
  const grcToken = localToken ? getGrcToken(localToken) : null;
  const headers = { ...(options.headers || {}) };
  if (grcToken) {
    headers['Authorization'] = `Token ${grcToken}`;
  }
  return fetch(url, { ...options, headers });
}

// Public paths that don't need auth
const PUBLIC_PATHS = new Set([
  '/login.html', '/login.css', '/login.js',
  '/api/auth/login', '/api/auth/logout', '/api/auth/check',
]);

function isPublicPath(pathname) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Fonts / favicons
  if (pathname.endsWith('.woff2') || pathname.endsWith('.woff') || pathname === '/favicon.ico') return true;
  // Policy collections API is public for now
  if (pathname.startsWith('/api/policy-collections')) return true;
  return false;
}

function getTokenFromRequest(req) {
  // Check cookie
  const cookies = (req.headers.cookie || '').split(';').map(c => c.trim());
  for (const c of cookies) {
    if (c.startsWith('wathba_token=')) return c.substring('wathba_token='.length);
  }
  // Check Authorization header (for API clients)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.substring(7);
  return null;
}

// ==========================================
// SQLite Database
// ==========================================

const db = new Database(path.join(__dirname, 'sessions.db'));
db.pragma('journal_mode = WAL');  // Better performance for concurrent reads

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    context TEXT NOT NULL DEFAULT '{}',
    system_prompt TEXT NOT NULL DEFAULT '',
    cached_content_name TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);

  CREATE TABLE IF NOT EXISTS local_prompts (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS org_contexts (
    id TEXT PRIMARY KEY,
    name_en TEXT NOT NULL,
    name_ar TEXT DEFAULT '',
    sector TEXT DEFAULT '',
    sector_custom TEXT DEFAULT '',
    size TEXT DEFAULT '',
    compliance_maturity INTEGER DEFAULT 1,
    regulatory_mandates TEXT DEFAULT '[]',
    governance_structure TEXT DEFAULT '',
    data_classification TEXT DEFAULT '',
    geographic_scope TEXT DEFAULT '',
    it_infrastructure TEXT DEFAULT '',
    strategic_objectives TEXT DEFAULT '[]',
    obligatory_frameworks TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cs_sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    step INTEGER NOT NULL DEFAULT 0,
    requirements TEXT NOT NULL DEFAULT '[]',
    collections TEXT NOT NULL DEFAULT '[]',
    selected_files TEXT NOT NULL DEFAULT '[]',
    session_files TEXT NOT NULL DEFAULT '[]',
    org_context TEXT DEFAULT NULL,
    controls TEXT NOT NULL DEFAULT '[]',
    framework TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS policy_collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    store_id TEXT DEFAULT '',
    status TEXT DEFAULT 'empty',
    config TEXT DEFAULT '{}',
    extraction_result TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS policy_files (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mime_type TEXT DEFAULT 'application/octet-stream',
    size INTEGER DEFAULT 0,
    local_path TEXT DEFAULT '',
    store_doc_name TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (collection_id) REFERENCES policy_collections(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_policy_files_collection ON policy_files(collection_id);

  CREATE TABLE IF NOT EXISTS policy_generation_history (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL,
    generation_type TEXT DEFAULT 'both',
    status TEXT DEFAULT 'generated',
    config TEXT DEFAULT '{}',
    summary TEXT DEFAULT '{}',
    library_urn TEXT DEFAULT NULL,
    controls_count INTEGER DEFAULT 0,
    nodes_count INTEGER DEFAULT 0,
    confidence_score INTEGER DEFAULT 0,
    generation_time TEXT DEFAULT '',
    source_file_count INTEGER DEFAULT 0,
    error_message TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (collection_id) REFERENCES policy_collections(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_policy_gen_history_collection ON policy_generation_history(collection_id);
`);

// Migrate policy_generation_history: add extraction_data column if missing
try {
  const histCols = db.pragma('table_info(policy_generation_history)').map(c => c.name);
  if (!histCols.includes('extraction_data')) {
    db.exec(`ALTER TABLE policy_generation_history ADD COLUMN extraction_data TEXT DEFAULT NULL`);
    console.log('[Migration] Added extraction_data column to policy_generation_history');
  }
} catch (migErr) { console.warn('policy_generation_history migration:', migErr.message); }

// Migrate policy_files: add gemini_file_name and gemini_file_uri columns if missing
try {
  const pfCols = db.pragma('table_info(policy_files)').map(c => c.name);
  if (!pfCols.includes('gemini_file_name')) {
    db.exec(`ALTER TABLE policy_files ADD COLUMN gemini_file_name TEXT DEFAULT ''`);
    console.log('[Migration] Added gemini_file_name column to policy_files');
  }
  if (!pfCols.includes('gemini_file_uri')) {
    db.exec(`ALTER TABLE policy_files ADD COLUMN gemini_file_uri TEXT DEFAULT ''`);
    console.log('[Migration] Added gemini_file_uri column to policy_files');
  }
} catch (migErr) { console.warn('policy_files migration:', migErr.message); }

// Migrate cs_sessions: add exported_control_ids if missing
try {
  const csCols = db.pragma('table_info(cs_sessions)').map(c => c.name);
  if (!csCols.includes('exported_control_ids')) {
    db.exec(`ALTER TABLE cs_sessions ADD COLUMN exported_control_ids TEXT NOT NULL DEFAULT '[]'`);
  }
} catch (migErr) { console.warn('CS sessions migration:', migErr.message); }

// Migrate org_contexts: add new profile columns if missing
try {
  const cols = db.pragma('table_info(org_contexts)').map(c => c.name);
  const addCol = (name, def) => { if (!cols.includes(name)) db.exec(`ALTER TABLE org_contexts ADD COLUMN ${name} ${def}`); };
  addCol('sector_custom', "TEXT DEFAULT ''");
  addCol('compliance_maturity', 'INTEGER DEFAULT 1');
  addCol('regulatory_mandates', "TEXT DEFAULT '[]'");
  addCol('governance_structure', "TEXT DEFAULT ''");
  addCol('data_classification', "TEXT DEFAULT ''");
  addCol('geographic_scope', "TEXT DEFAULT ''");
  addCol('it_infrastructure', "TEXT DEFAULT ''");
  addCol('strategic_objectives', "TEXT DEFAULT '[]'");
  addCol('policies', "TEXT DEFAULT '[]'");
} catch (migErr) { console.warn('Org profile migration:', migErr.message); }

console.log('SQLite database initialized (sessions.db)');

// DB helper functions
const dbInsertSession = db.prepare(`
  INSERT INTO sessions (id, context, system_prompt, cached_content_name, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

const dbInsertMessage = db.prepare(`
  INSERT INTO messages (session_id, role, text, created_at)
  VALUES (?, ?, ?, ?)
`);

const dbGetSession = db.prepare(`SELECT * FROM sessions WHERE id = ?`);

const dbGetMessages = db.prepare(`
  SELECT role, text, created_at FROM messages WHERE session_id = ? ORDER BY id ASC
`);

const dbListSessions = db.prepare(`
  SELECT s.*, (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count
  FROM sessions s ORDER BY s.created_at DESC
`);

const dbDeleteSession = db.prepare(`DELETE FROM sessions WHERE id = ?`);
const dbDeleteSessionMessages = db.prepare(`DELETE FROM messages WHERE session_id = ?`);

// Local prompts DB helpers
const dbGetLocalPrompt = db.prepare(`SELECT * FROM local_prompts WHERE id = ?`);
const dbGetLocalPromptByKey = db.prepare(`SELECT * FROM local_prompts WHERE key = ?`);
const dbListLocalPrompts = db.prepare(`SELECT * FROM local_prompts ORDER BY name ASC`);
const dbInsertLocalPrompt = db.prepare(`
  INSERT OR IGNORE INTO local_prompts (id, key, name, content, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const dbUpdateLocalPrompt = db.prepare(`
  UPDATE local_prompts SET name = ?, content = ?, updated_at = ? WHERE id = ?
`);

// Org contexts DB helpers
const dbListOrgContexts = db.prepare(`SELECT * FROM org_contexts ORDER BY created_at DESC`);
const dbGetOrgContext = db.prepare(`SELECT * FROM org_contexts WHERE id = ?`);
const dbInsertOrgContext = db.prepare(`
  INSERT INTO org_contexts (id, name_en, name_ar, sector, sector_custom, size, compliance_maturity, regulatory_mandates, governance_structure, data_classification, geographic_scope, it_infrastructure, strategic_objectives, obligatory_frameworks, policies, notes, is_active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const dbUpdateOrgContext = db.prepare(`
  UPDATE org_contexts SET name_en = ?, name_ar = ?, sector = ?, sector_custom = ?, size = ?, compliance_maturity = ?, regulatory_mandates = ?, governance_structure = ?, data_classification = ?, geographic_scope = ?, it_infrastructure = ?, strategic_objectives = ?, obligatory_frameworks = ?, policies = ?, notes = ?, is_active = ?, updated_at = ? WHERE id = ?
`);
const dbDeleteOrgContext = db.prepare(`DELETE FROM org_contexts WHERE id = ?`);

function orgContextToJSON(r) {
  return {
    id: r.id,
    nameEn: r.name_en,
    nameAr: r.name_ar,
    sector: r.sector,
    sectorCustom: r.sector_custom || '',
    size: r.size,
    complianceMaturity: r.compliance_maturity || 1,
    regulatoryMandates: JSON.parse(r.regulatory_mandates || '[]'),
    governanceStructure: r.governance_structure || '',
    dataClassification: r.data_classification || '',
    geographicScope: r.geographic_scope || '',
    itInfrastructure: r.it_infrastructure || '',
    strategicObjectives: JSON.parse(r.strategic_objectives || '[]'),
    obligatoryFrameworks: JSON.parse(r.obligatory_frameworks || '[]'),
    policies: JSON.parse(r.policies || '[]'),
    notes: r.notes,
    isActive: !!r.is_active,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// Controls Studio sessions DB helpers
const dbListCsSessions = db.prepare(`SELECT * FROM cs_sessions ORDER BY updated_at DESC`);
const dbGetCsSession = db.prepare(`SELECT * FROM cs_sessions WHERE id = ?`);
const dbInsertCsSession = db.prepare(`
  INSERT INTO cs_sessions (id, name, status, step, requirements, collections, selected_files, session_files, org_context, controls, framework, exported_control_ids, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const dbUpdateCsSession = db.prepare(`
  UPDATE cs_sessions SET name = ?, status = ?, step = ?, requirements = ?, collections = ?, selected_files = ?, session_files = ?, org_context = ?, controls = ?, framework = ?, exported_control_ids = ?, updated_at = ? WHERE id = ?
`);
const dbDeleteCsSession = db.prepare(`DELETE FROM cs_sessions WHERE id = ?`);

function csSessionToJSON(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    step: row.step,
    requirements: JSON.parse(row.requirements || '[]'),
    collections: JSON.parse(row.collections || '[]'),
    selectedFiles: JSON.parse(row.selected_files || '[]'),
    sessionFiles: JSON.parse(row.session_files || '[]'),
    orgContext: row.org_context ? JSON.parse(row.org_context) : null,
    controls: JSON.parse(row.controls || '[]'),
    framework: row.framework || '',
    exportedControlIds: JSON.parse(row.exported_control_ids || '[]'),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Policy collections DB helpers
const dbListPolicyCollections = db.prepare(`SELECT * FROM policy_collections ORDER BY updated_at DESC`);
const dbGetPolicyCollection = db.prepare(`SELECT * FROM policy_collections WHERE id = ?`);
const dbInsertPolicyCollection = db.prepare(`
  INSERT INTO policy_collections (id, name, description, store_id, status, config, extraction_result, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const dbUpdatePolicyCollection = db.prepare(`
  UPDATE policy_collections SET name = ?, description = ?, status = ?, config = ?, extraction_result = ?, updated_at = ? WHERE id = ?
`);
const dbDeletePolicyCollection = db.prepare(`DELETE FROM policy_collections WHERE id = ?`);

// Policy files DB helpers
const dbListPolicyFiles = db.prepare(`SELECT * FROM policy_files WHERE collection_id = ? ORDER BY created_at ASC`);
const dbGetPolicyFile = db.prepare(`SELECT * FROM policy_files WHERE id = ?`);
const dbInsertPolicyFile = db.prepare(`
  INSERT INTO policy_files (id, collection_id, name, mime_type, size, local_path, store_doc_name, gemini_file_name, gemini_file_uri, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const dbUpdatePolicyFileGemini = db.prepare(`UPDATE policy_files SET gemini_file_name = ?, gemini_file_uri = ? WHERE id = ?`);
const dbUpdatePolicyFileStoreDoc = db.prepare(`UPDATE policy_files SET store_doc_name = ? WHERE id = ?`);
const dbUpdatePolicyCollectionStoreId = db.prepare(`UPDATE policy_collections SET store_id = ? WHERE id = ?`);
const dbDeletePolicyFile = db.prepare(`DELETE FROM policy_files WHERE id = ?`);
const dbDeletePolicyFilesForCollection = db.prepare(`DELETE FROM policy_files WHERE collection_id = ?`);

// Policy generation history DB helpers
const dbInsertGenHistory = db.prepare(`
  INSERT INTO policy_generation_history (id, collection_id, generation_type, status, config, summary, library_urn, controls_count, nodes_count, confidence_score, generation_time, source_file_count, error_message, extraction_data, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const dbUpdateGenHistoryStatus = db.prepare(`UPDATE policy_generation_history SET status = ?, library_urn = ?, error_message = ? WHERE id = ?`);
const dbListGenHistory = db.prepare(`SELECT * FROM policy_generation_history WHERE collection_id = ? ORDER BY created_at DESC`);
const dbGetLatestGenHistory = db.prepare(`SELECT * FROM policy_generation_history WHERE collection_id = ? ORDER BY created_at DESC LIMIT 1`);
const dbGetGenHistoryById = db.prepare(`SELECT * FROM policy_generation_history WHERE id = ?`);

async function policyCollectionToJSON(row, apiKey) {
  const storeId = row.store_id || '';

  // Fetch files directly from Gemini File Search Store
  let files = [];
  if (storeId && apiKey) {
    try {
      const storeName = storeId.startsWith('fileSearchStores/') ? storeId : `fileSearchStores/${storeId}`;
      const result = await listStoreDocuments(storeName, apiKey);
      files = (result.documents || []).map(doc => {
        const displayName = doc.displayName || doc.name || '';
        const ext = displayName.split('.').pop().toLowerCase();
        const sizeBytes = parseInt(doc.sizeBytes || '0', 10);
        return {
          documentName: doc.name || '',
          name: displayName,
          type: ext,
          sizeBytes,
          size: sizeBytes > 1024 * 1024 ? (sizeBytes / (1024 * 1024)).toFixed(1) + ' MB' : (sizeBytes / 1024).toFixed(0) + ' KB',
          createTime: doc.createTime || '',
          updateTime: doc.updateTime || '',
        };
      });
    } catch (err) {
      console.warn(`[Policy] Could not list docs for store ${storeId}:`, err.message);
    }
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    storeId,
    status: row.status || 'empty',
    config: JSON.parse(row.config || '{}'),
    extractionResult: row.extraction_result ? JSON.parse(row.extraction_result) : null,
    files,
    fileCount: files.length,
    lastUpdated: new Date(row.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Ensure policy-uploads directory exists
const POLICY_UPLOADS_DIR = path.join(__dirname, 'policy-uploads');
if (!fs.existsSync(POLICY_UPLOADS_DIR)) fs.mkdirSync(POLICY_UPLOADS_DIR, { recursive: true });

// Gemini SDK client + in-memory chat sessions (SDK ChatSession objects)
let genai = null;
const chatSessions = {};  // sessionId -> { chat: SDK ChatSession, systemPrompt: string }
const policyChats = {};   // sessionId -> { chat: SDK ChatSession, storeIds, history, createdAt }

// Load prompt templates from files (used as seed defaults)
const promptTemplatePath = path.join(__dirname, 'prompts', 'requirement-analyzer.txt');
let promptTemplate = '';

try {
  promptTemplate = fs.readFileSync(promptTemplatePath, 'utf-8');
} catch (error) {
  console.error('Error loading prompt template:', error.message);
  process.exit(1);
}

const chatPromptPath = path.join(__dirname, 'prompts', 'chat-auditor.txt');
let chatPromptFileContent = '';

try {
  chatPromptFileContent = fs.readFileSync(chatPromptPath, 'utf-8');
} catch (error) {
  console.warn('Chat prompt template not found.');
}

const controlsPromptPath = path.join(__dirname, 'prompts', 'controls-generator.txt');
let controlsPromptTemplate = '';

try {
  controlsPromptTemplate = fs.readFileSync(controlsPromptPath, 'utf-8');
} catch (error) {
  console.warn('Controls generator prompt template not found.');
}

const policyExtractorPath = path.join(__dirname, 'prompts', 'policy-extractor.txt');
let policyExtractorPrompt = '';

try {
  policyExtractorPrompt = fs.readFileSync(policyExtractorPath, 'utf-8');
} catch (error) {
  console.warn('Policy extractor prompt template not found.');
}

// Load the framework-extractor prompt (framework + requirement_nodes only)
const frameworkExtractorPath = path.join(__dirname, 'prompts', 'framework-extractor.txt');
let frameworkExtractorPrompt = '';
try {
  frameworkExtractorPrompt = fs.readFileSync(frameworkExtractorPath, 'utf-8');
} catch (error) {
  console.warn('Framework extractor prompt template not found.');
}

// Load the reference-controls-extractor prompt (controls only)
const refControlsExtractorPath = path.join(__dirname, 'prompts', 'reference-controls-extractor.txt');
let refControlsExtractorPrompt = '';
try {
  refControlsExtractorPrompt = fs.readFileSync(refControlsExtractorPath, 'utf-8');
} catch (error) {
  console.warn('Reference controls extractor prompt template not found.');
}

// Seed the chat-auditor prompt into the DB if not already present
const CHAT_AUDITOR_PROMPT_ID = 'local-chat-auditor';
const now = new Date().toISOString();
dbInsertLocalPrompt.run(
  CHAT_AUDITOR_PROMPT_ID,
  'chat_auditor',
  'Chat Auditor (Start Audit Session)',
  chatPromptFileContent || 'You are an expert compliance and governance auditor for the Wathbah Auditor platform.',
  now,
  now
);

// Seed the controls-generator prompt into the DB — always update to latest template
const CONTROLS_GENERATOR_PROMPT_ID = 'local-controls-generator';
dbInsertLocalPrompt.run(
  CONTROLS_GENERATOR_PROMPT_ID,
  'controls_generator',
  'Controls Generator (Applied Controls Studio)',
  controlsPromptTemplate || 'You are an expert GRC consultant who specializes in designing applied controls for regulatory frameworks.',
  now,
  now
);
// Force-update to latest prompt template (in case DB had older version)
if (controlsPromptTemplate) {
  dbUpdateLocalPrompt.run('Controls Generator (Applied Controls Studio)', controlsPromptTemplate, now, CONTROLS_GENERATOR_PROMPT_ID);
}

// Seed the policy-extractor prompt into the DB
const POLICY_EXTRACTOR_PROMPT_ID = 'local-policy-extractor';
dbInsertLocalPrompt.run(
  POLICY_EXTRACTOR_PROMPT_ID,
  'policy_extractor',
  'Policy Extractor (Policy Ingestion)',
  policyExtractorPrompt || 'You are a GRC policy extraction engine for the CISO Assistant platform.',
  now,
  now
);
if (policyExtractorPrompt) {
  dbUpdateLocalPrompt.run('Policy Extractor (Policy Ingestion)', policyExtractorPrompt, now, POLICY_EXTRACTOR_PROMPT_ID);
}

// Seed the framework-extractor prompt into the DB
const FRAMEWORK_EXTRACTOR_PROMPT_ID = 'local-framework-extractor';
dbInsertLocalPrompt.run(
  FRAMEWORK_EXTRACTOR_PROMPT_ID,
  'framework_extractor',
  'Framework Extractor (Policy Ingestion — Framework)',
  frameworkExtractorPrompt || 'You are a GRC framework extraction engine for the CISO Assistant platform.',
  now,
  now
);
if (frameworkExtractorPrompt) {
  dbUpdateLocalPrompt.run('Framework Extractor (Policy Ingestion — Framework)', frameworkExtractorPrompt, now, FRAMEWORK_EXTRACTOR_PROMPT_ID);
}

// Seed the reference-controls-extractor prompt into the DB
const REF_CONTROLS_EXTRACTOR_PROMPT_ID = 'local-ref-controls-extractor';
dbInsertLocalPrompt.run(
  REF_CONTROLS_EXTRACTOR_PROMPT_ID,
  'ref_controls_extractor',
  'Reference Controls Extractor (Policy Ingestion — Controls)',
  refControlsExtractorPrompt || 'You are a GRC reference controls extraction engine for the CISO Assistant platform.',
  now,
  now
);
if (refControlsExtractorPrompt) {
  dbUpdateLocalPrompt.run('Reference Controls Extractor (Policy Ingestion — Controls)', refControlsExtractorPrompt, now, REF_CONTROLS_EXTRACTOR_PROMPT_ID);
}

// Helper: get the current policy extractor prompt from DB
function getPolicyExtractorPrompt() {
  const row = dbGetLocalPromptByKey.get('policy_extractor');
  return row ? row.content : policyExtractorPrompt || 'You are a GRC policy extraction engine for the CISO Assistant platform.';
}

// Helper: get the framework extractor prompt from DB
function getFrameworkExtractorPrompt() {
  const row = dbGetLocalPromptByKey.get('framework_extractor');
  return row ? row.content : frameworkExtractorPrompt || 'You are a GRC framework extraction engine for the CISO Assistant platform.';
}

// Helper: get the reference controls extractor prompt from DB
function getRefControlsExtractorPrompt() {
  const row = dbGetLocalPromptByKey.get('ref_controls_extractor');
  return row ? row.content : refControlsExtractorPrompt || 'You are a GRC reference controls extraction engine for the CISO Assistant platform.';
}

// Helper: get the current chat auditor prompt from DB (always use DB as source of truth)
function getChatAuditorPrompt() {
  const row = dbGetLocalPromptByKey.get('chat_auditor');
  return row ? row.content : (chatPromptFileContent || 'You are an expert compliance and governance auditor for the Wathbah Auditor platform.');
}

// Helper: get the current controls generator prompt from DB (always use DB as source of truth)
function getControlsGeneratorPrompt() {
  const row = dbGetLocalPromptByKey.get('controls_generator');
  return row ? row.content : (controlsPromptTemplate || 'You are an expert GRC consultant who specializes in designing applied controls for regulatory frameworks.');
}

// MIME types for static files
const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Safe JSON response helper — handles Unicode (Arabic, etc.) without ByteString errors
function sendJSON(res, statusCode, data) {
  const jsonStr = JSON.stringify(data);
  const buf = Buffer.from(jsonStr, 'utf-8');
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
  });
  res.end(buf);
}

// Parse JSON body from request
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX_SIZE = 150 * 1024 * 1024; // 150MB limit for base64 file uploads

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        reject(new Error('Request body too large (max 150MB)'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ==========================================
// Gemini Analysis API
// ==========================================

// Call Gemini API for a single requirement
async function callGeminiAPIForSingle(requirement, userPrompt, apiKey, contextFiles) {
  // Format context files content for the prompt
  let contextFilesText = 'No context files provided.';
  if (contextFiles && contextFiles.length > 0) {
    contextFilesText = contextFiles.map((cf, i) => {
      // Truncate very large files to avoid token limits (keep first ~8000 chars)
      const content = cf.content && cf.content.length > 8000
        ? cf.content.substring(0, 8000) + '\n... [truncated — file too large to include fully]'
        : (cf.content || '(empty file)');
      return `### File ${i + 1}: ${cf.name}\n\`\`\`\n${content}\n\`\`\``;
    }).join('\n\n');
  }

  const fullPrompt = promptTemplate
    .replace('{{REQUIREMENT}}', JSON.stringify(requirement, null, 2))
    .replace('{{USER_PROMPT}}', userPrompt || 'No additional context provided.')
    .replace('{{CONTEXT_FILES}}', contextFilesText);

  const requestBody = {
    contents: [{
      parts: [{
        text: fullPrompt
      }]
    }],
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 4096,
    }
  };

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  
  const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!textResponse) {
    throw new Error('No response from Gemini API');
  }

  let jsonStr = textResponse.trim();
  
  console.log('Raw Gemini response length:', textResponse.length);
  
  const jsonMatch = textResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
    console.log('Extracted from markdown code block');
  }
  
  if (!jsonStr.startsWith('{')) {
    const jsonObjectMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      jsonStr = jsonObjectMatch[0];
      console.log('Extracted JSON object from text');
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    
    if (!parsed.typical_evidence || !Array.isArray(parsed.typical_evidence)) {
      parsed.typical_evidence = [];
    }
    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      parsed.questions = [];
    }
    if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
      parsed.suggestions = [];
    }
    
    console.log('Parsed successfully:', {
      evidence_count: parsed.typical_evidence.length,
      questions_count: parsed.questions.length,
      suggestions_count: parsed.suggestions.length
    });
    
    return parsed;
  } catch (e) {
    console.error('Failed to parse Gemini response as JSON');
    console.error('Parse error:', e.message);
    console.error('First 500 chars of response:', textResponse.substring(0, 500));
    
    try {
      const evidenceMatch = jsonStr.match(/"typical_evidence"\s*:\s*\[([\s\S]*?)\]/);
      const questionsMatch = jsonStr.match(/"questions"\s*:\s*\[([\s\S]*?)\]/);
      
      if (evidenceMatch || questionsMatch) {
        console.log('Attempting partial extraction...');
        return {
          typical_evidence: evidenceMatch ? JSON.parse('[' + evidenceMatch[1] + ']') : [],
          questions: questionsMatch ? JSON.parse('[' + questionsMatch[1] + ']') : [],
          suggestions: []
        };
      }
    } catch (e2) {
      console.error('Partial extraction also failed:', e2.message);
    }
    
    throw new Error('Failed to parse AI response. Please try again.');
  }
}

// Call Gemini API for multiple requirements (batch processing)
async function callGeminiAPIForMultiple(requirements, userPrompt, apiKey, contextFiles) {
  console.log(`Processing ${requirements.length} requirements...`);
  
  const CONCURRENCY_LIMIT = 3;
  const results = [];
  
  for (let i = 0; i < requirements.length; i += CONCURRENCY_LIMIT) {
    const batch = requirements.slice(i, i + CONCURRENCY_LIMIT);
    const batchPromises = batch.map(async (requirement, batchIndex) => {
      const index = i + batchIndex;
      console.log(`Analyzing requirement ${index + 1}/${requirements.length}: ${requirement.refId || 'No ref'}`);
      
      try {
        const analysis = await callGeminiAPIForSingle(requirement, userPrompt, apiKey, contextFiles);
        return {
          requirement,
          analysis,
          success: true
        };
      } catch (error) {
        console.error(`Failed to analyze requirement ${index + 1}:`, error.message);
        return {
          requirement,
          analysis: {
            typical_evidence: [],
            questions: [],
            suggestions: []
          },
          success: false,
          error: error.message
        };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }
  
  return { results };
}

// ==========================================
// Gemini Controls Generation API
// ==========================================

function buildOrgProfileText(orgContext) {
  if (!orgContext) return 'No organization profile provided. Generate industry-agnostic controls.';
  const p = [];
  if (orgContext.nameEn) p.push(`Organization: ${orgContext.nameEn}`);
  if (orgContext.nameAr) p.push(`Arabic Name: ${orgContext.nameAr}`);
  const sectorLabels = { banking: 'Banking & Financial Services', government: 'Government', healthcare: 'Healthcare', energy: 'Energy & Utilities', telecom: 'Telecommunications', education: 'Education', retail: 'Retail & E-Commerce', insurance: 'Insurance', technology: 'Technology', other: 'Other' };
  const sizeLabels = { small: 'Small (1–50)', medium: 'Medium (51–500)', large: 'Large (501–5000)', enterprise: 'Enterprise (5000+)' };
  const sector = orgContext.sectorCustom || sectorLabels[orgContext.sector] || orgContext.sector;
  if (sector) p.push(`Industry Vertical: ${sector}`);
  if (orgContext.size) p.push(`Entity Size: ${sizeLabels[orgContext.size] || orgContext.size}`);
  if (orgContext.complianceMaturity) p.push(`Compliance Maturity Level: ${orgContext.complianceMaturity} / 5`);
  if (orgContext.regulatoryMandates && orgContext.regulatoryMandates.length) p.push(`Active Regulatory Mandates: ${orgContext.regulatoryMandates.join(', ')}`);
  if (orgContext.governanceStructure) p.push(`Governance Structure: ${orgContext.governanceStructure}`);
  if (orgContext.dataClassification) p.push(`Data Classification Level: ${orgContext.dataClassification}`);
  if (orgContext.geographicScope) p.push(`Geographic Scope: ${orgContext.geographicScope}`);
  if (orgContext.itInfrastructure) p.push(`IT Infrastructure Type: ${orgContext.itInfrastructure}`);
  if (orgContext.strategicObjectives && orgContext.strategicObjectives.length) p.push(`Strategic Objectives:\n${orgContext.strategicObjectives.map(o => '  - ' + o).join('\n')}`);
  if (orgContext.obligatoryFrameworks && orgContext.obligatoryFrameworks.length) p.push(`Obligatory Frameworks: ${orgContext.obligatoryFrameworks.join(', ')}`);
  if (orgContext.policies && orgContext.policies.length) p.push(`Linked Policies:\n${orgContext.policies.map(pol => '  - ' + (pol.name || pol)).join('\n')}`);
  if (orgContext.notes) p.push(`Additional Notes: ${orgContext.notes}`);
  return p.join('\n');
}

async function generateControlsForRequirement(requirement, orgContext, contextFiles, apiKey, existingControls) {
  const orgContextText = buildOrgProfileText(orgContext);

  // Build reference files text
  let refFilesText = 'No reference files provided.';
  if (contextFiles && contextFiles.length > 0) {
    refFilesText = contextFiles.map((cf, i) => {
      const content = cf.content && cf.content.length > 8000
        ? cf.content.substring(0, 8000) + '\n... [truncated]'
        : (cf.content || '(empty)');
      return `### File ${i + 1}: ${cf.name}\n\`\`\`\n${content}\n\`\`\``;
    }).join('\n\n');
  }

  // Build requirement text
  const reqText = [
    `Framework: ${requirement.frameworkName || 'Unknown'}`,
    requirement.refId ? `Ref ID: ${requirement.refId}` : '',
    `Name: ${requirement.name || ''}`,
    `Description: ${requirement.description || ''}`,
    requirement.depth !== undefined ? `Depth: ${requirement.depth}` : '',
  ].filter(Boolean).join('\n');

  // Build existing controls context (for reuse detection)
  let existingCtrlsText = '';
  if (existingControls && existingControls.length > 0) {
    existingCtrlsText = '\n\n## Existing Applied Controls (already generated in this session)\n\nBefore creating new controls, check if any of the following existing controls already satisfy this requirement. If they do, include them with `"reuse": true` instead of generating duplicates.\n\n' +
      existingControls.map((c, i) => `${i + 1}. **${c.name}** (${c.requirementRefId || 'unknown ref'}) — ${c.description || ''}`).join('\n');
  }

  const fullPrompt = getControlsGeneratorPrompt()
    .replace('{{ORG_CONTEXT}}', orgContextText)
    .replace('{{REFERENCE_FILES}}', refFilesText)
    .replace('{{REQUIREMENT}}', reqText)
    + existingCtrlsText;

  const requestBody = {
    contents: [{ parts: [{ text: fullPrompt }] }],
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192,
    }
  };

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textResponse) throw new Error('No response from Gemini API');

  // Parse JSON from response
  let jsonStr = textResponse.trim();
  const jsonMatch = textResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();
  if (!jsonStr.startsWith('{')) {
    const obj = jsonStr.match(/\{[\s\S]*\}/);
    if (obj) jsonStr = obj[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.controls || !Array.isArray(parsed.controls)) parsed.controls = [];
    return parsed.controls;
  } catch (e) {
    console.error('Controls JSON parse failed:', e.message, 'First 500:', textResponse.substring(0, 500));
    return [];
  }
}

async function generateControlsBatch(requirements, orgContext, contextFiles, apiKey) {
  const CONCURRENCY = 3;
  const allControls = [];
  const progress = { total: requirements.length, completed: 0, failed: 0 };

  for (let i = 0; i < requirements.length; i += CONCURRENCY) {
    const batch = requirements.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (req, batchIdx) => {
      const idx = i + batchIdx;
      console.log(`[Controls] Generating for req ${idx + 1}/${requirements.length}: ${req.refId || req.name || 'Unknown'}`);
      try {
        // Pass existing controls so the AI can detect reuse opportunities
        const controls = await generateControlsForRequirement(req, orgContext, contextFiles, apiKey, allControls);
        progress.completed++;
        return controls.map(c => ({
          ...c,
          requirementRefId: req.refId,
          requirementName: req.name || req.description,
          framework: req.frameworkName,
          requirementUrn: req.nodeUrn,
          requirementNodeId: req.nodeId,
        }));
      } catch (err) {
        console.error(`[Controls] Failed req ${idx + 1}:`, err.message);
        progress.failed++;
        return [];
      }
    }));
    allControls.push(...results.flat());
  }

  return { controls: allControls, progress };
}

// ---- Question-to-Control Conversion ----
async function convertQuestionToControl(question, requirement, orgContext, apiKey) {
  const orgContextText = buildOrgProfileText(orgContext);

  const prompt = `You are a GRC expert. A compliance question was asked during an audit or assessment. Your job is to generate an Applied Control that, if implemented, would make the answer to this question "Yes / Compliant."

## Organization Profile

${orgContextText}

## Source Requirement

Framework: ${requirement?.frameworkName || 'Unknown'}
${requirement?.refId ? `Ref ID: ${requirement.refId}` : ''}
Name: ${requirement?.name || 'N/A'}
Description: ${requirement?.description || 'N/A'}

## Compliance Question

"${question}"

## Instructions

Generate exactly ONE applied control that directly addresses this question. The control should be specific enough that implementing it would definitively answer the question with "Yes / Compliant."

CRITICAL: Respond with ONLY valid JSON. No markdown. Start with { end with }.

{
  "control": {
    "name": "Control name in English (5-15 words)",
    "name_ar": "اسم الضابط بالعربية",
    "description": "Detailed description (30-80 words) of what the control entails, how to implement it, and what evidence demonstrates compliance",
    "description_ar": "وصف تفصيلي للضابط",
    "control_type": "preventive|detective|corrective|directive",
    "implementation_priority": "critical|high|medium|low",
    "effort_estimate": "Low|Medium|High",
    "relevance_score": 85,
    "evidence_examples": ["Evidence 1", "Evidence 2"],
    "source_question": "${question.replace(/"/g, '\\"')}"
  }
}`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.5, topK: 40, topP: 0.95, maxOutputTokens: 4096 }
  };

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textResponse) throw new Error('No response from Gemini API');

  let jsonStr = textResponse.trim();
  const jsonMatch = textResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();
  if (!jsonStr.startsWith('{')) {
    const obj = jsonStr.match(/\{[\s\S]*\}/);
    if (obj) jsonStr = obj[0];
  }

  const parsed = JSON.parse(jsonStr);
  return parsed.control || parsed;
}

// ==========================================
// Gemini File Search Store (Collections) API
// ==========================================

// Create a file search store
async function createFileSearchStore(displayName, apiKey) {
  const res = await fetch(`${GEMINI_BASE_URL}/fileSearchStores?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Create store failed (${res.status}): ${err}`);
  }
  return res.json();
}

// List all file search stores
async function listFileSearchStores(apiKey) {
  const res = await fetch(`${GEMINI_BASE_URL}/fileSearchStores?key=${apiKey}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`List stores failed (${res.status}): ${err}`);
  }
  return res.json();
}

// Delete a file search store
async function deleteFileSearchStore(storeName, apiKey) {
  const res = await fetch(`${GEMINI_BASE_URL}/${storeName}?key=${apiKey}`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Delete store failed (${res.status}): ${err}`);
  }
  // DELETE may return empty body
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// Upload file directly to a file search store using resumable upload protocol.
// This combines file upload + store import in a single operation.
async function uploadFileToStore(storeName, fileName, mimeType, fileBuffer, apiKey) {
  const sizeBytes = fileBuffer.length;

  // URL-encode the filename for HTTP headers (non-ASCII chars like Arabic are not allowed in headers)
  const encodedFileName = encodeURIComponent(fileName);

  // Step 1: Initiate resumable upload — get the upload URL
  const initRes = await fetch(`${GEMINI_UPLOAD_URL}/${storeName}:uploadToFileSearchStore?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(sizeBytes),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'X-Goog-Upload-File-Name': encodedFileName
    },
    body: JSON.stringify({
      displayName: fileName
    })
  });

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`Upload initiation failed (${initRes.status}): ${err}`);
  }

  const uploadUrl = initRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new Error('Server did not return an upload URL.');
  }

  // Step 2: Upload the actual file bytes to the upload URL
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(sizeBytes),
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-File-Name': encodedFileName
    },
    body: fileBuffer
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`File upload failed (${uploadRes.status}): ${err}`);
  }

  return uploadRes.json();
}

// List documents in a file search store
async function listStoreDocuments(storeName, apiKey) {
  const res = await fetch(`${GEMINI_BASE_URL}/${storeName}/documents?key=${apiKey}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`List documents failed (${res.status}): ${err}`);
  }
  return res.json();
}

// Delete a document from a file search store
async function deleteDocument(documentName, apiKey) {
  const res = await fetch(`${GEMINI_BASE_URL}/${documentName}?key=${apiKey}`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Delete document failed (${res.status}): ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// Poll a long-running operation until done
async function pollOperation(operationName, apiKey, maxWaitMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${GEMINI_BASE_URL}/${operationName}?key=${apiKey}`);
    if (!res.ok) {
      console.warn(`Poll operation warning: ${res.status}`);
      break;
    }
    const op = await res.json();
    if (op.done) return op;
    await new Promise(r => setTimeout(r, 3000));
  }
  return { done: false, note: 'Still processing in background' };
}

// ==========================================
// Static File Server
// ==========================================

function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

// ==========================================
// HTTP Server
// ==========================================

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ---- Auth: Login endpoint (via GRC IAM) ----
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const { username, password } = body;
      if (!username || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Username and password are required.' }));
        return;
      }

      // Authenticate via GRC IAM API
      console.log(`[Auth] Logging in via GRC IAM for user: ${username}`);
      const grcLoginRes = await fetch(`${GRC_API_URL}/api/iam/login/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!grcLoginRes.ok) {
        const errText = await grcLoginRes.text();
        console.log(`[Auth] GRC login failed for ${username}: ${grcLoginRes.status}`);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid username or password' }));
        return;
      }

      const grcData = await grcLoginRes.json();
      const grcToken = grcData.token || grcData.key || grcData.access;
      if (!grcToken) {
        console.error('[Auth] GRC login response missing token:', JSON.stringify(grcData));
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'GRC login succeeded but no token returned.' }));
        return;
      }

      // Create local session linked to GRC token
      const localToken = generateLocalToken();
      authSessions.set(localToken, { grcToken, username });
      console.log(`[Auth] Login successful for ${username} — GRC token stored`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, token: localToken }));
    } catch (error) {
      console.error('[Auth] Login error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Login failed: ' + error.message }));
    }
    return;
  }

  // ---- Auth: Logout endpoint ----
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    const token = getTokenFromRequest(req);
    if (token) authSessions.delete(token);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // ---- Auth: Check endpoint ----
  if (url.pathname === '/api/auth/check' && req.method === 'GET') {
    const token = getTokenFromRequest(req);
    const valid = isValidToken(token);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ authenticated: valid }));
    return;
  }

  // ---- Auth Guard ----
  if (!isPublicPath(url.pathname)) {
    const token = getTokenFromRequest(req);
    if (!isValidToken(token)) {
      // For API requests, return 401
      if (url.pathname.startsWith('/api/')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized. Please log in.' }));
        return;
      }
      // For page requests (HTML or SPA routes), redirect to login
      const SPA_PREFIXES = ['/', '/dashboard', '/audit-sessions', '/audit-studio', '/controls-studio', '/merge-optimizer', '/policy-ingestion', '/org-contexts', '/prompts', '/file-collections'];
      const isSpaRoute = SPA_PREFIXES.some(p => url.pathname === p || (p !== '/' && url.pathname.startsWith(p + '/')));
      if (isSpaRoute || url.pathname.endsWith('.html')) {
        res.writeHead(302, { 'Location': '/login.html' });
        res.end();
        return;
      }
      // Static assets (css, js) — allow through so login page renders correctly
      // But only known login assets are in PUBLIC_PATHS; others need auth
      // Actually, let CSS/JS through since they don't expose data
      const ext = path.extname(url.pathname);
      if (['.css', '.js', '.svg', '.png', '.jpg', '.ico', '.woff', '.woff2'].includes(ext)) {
        // Allow static assets through (no sensitive data)
      } else {
        res.writeHead(302, { 'Location': '/login.html' });
        res.end();
        return;
      }
    }
  }

  // Extract local token for GRC-authenticated fetch calls
  const reqToken = getTokenFromRequest(req);

  // ---- Analyze API ----
  if (url.pathname === '/api/analyze' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      console.log('Received analysis request');
      
      const { requirement, requirements, prompt, contextFiles } = body;
      
      const apiKey = GEMINI_API_KEY || req.headers['x-api-key'];

      if (!apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API key not configured. Add GEMINI_API_KEY to .env file.' }));
        return;
      }

      if (contextFiles && contextFiles.length > 0) {
        console.log(`Context files attached: ${contextFiles.length} (${contextFiles.map(f => f.name).join(', ')})`);
      }

      if (requirements && Array.isArray(requirements) && requirements.length > 0) {
        console.log(`Batch analysis for ${requirements.length} requirements`);
        const result = await callGeminiAPIForMultiple(requirements, prompt, apiKey, contextFiles);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: result }));
        return;
      }
      
      if (!requirement) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Requirement(s) required.' }));
        return;
      }

      const result = await callGeminiAPIForSingle(requirement, prompt, apiKey, contextFiles);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: result }));
    } catch (error) {
      console.error('Analyze API Error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
        return;
      }
      
  // ---- Controls Generation API ----
  if (url.pathname === '/api/controls/generate' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const { requirements, orgContext, contextFiles } = body;

      const apiKey = GEMINI_API_KEY || req.headers['x-api-key'];
      if (!apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API key not configured. Add GEMINI_API_KEY to .env file.' }));
        return;
      }

      // Block generation if no org profile
      if (!orgContext || !orgContext.nameEn) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Organization Profile is required. Please select or create an Organization Profile before generating controls.' }));
        return;
      }

      if (!requirements || !Array.isArray(requirements) || requirements.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'At least one requirement is needed.' }));
        return;
      }

      console.log(`[Controls] Generating controls for ${requirements.length} requirements` +
        ` (org: ${orgContext.nameEn}, sector: ${orgContext.sectorCustom || orgContext.sector || 'N/A'}, maturity: ${orgContext.complianceMaturity || 'N/A'})` +
        (contextFiles?.length ? `, ${contextFiles.length} context files` : ''));

      const result = await generateControlsBatch(requirements, orgContext, contextFiles, apiKey);

      console.log(`[Controls] Done: ${result.controls.length} controls generated, ${result.progress.failed} reqs failed`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (error) {
      console.error('[Controls] Generate API Error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- Question-to-Control Conversion API ----
  if (url.pathname === '/api/controls/from-question' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const { question, requirement, orgContext } = body;

      const apiKey = GEMINI_API_KEY || req.headers['x-api-key'];
      if (!apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API key not configured.' }));
        return;
      }

      if (!question) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Question is required.' }));
        return;
      }

      if (!orgContext || !orgContext.nameEn) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Organization Profile is required to convert questions to controls.' }));
        return;
      }

      console.log(`[Q2Control] Converting question for org "${orgContext.nameEn}": "${question.substring(0, 80)}..."`);
      const control = await convertQuestionToControl(question, requirement, orgContext, apiKey);
      console.log(`[Q2Control] Generated: "${control.name}"`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, control }));
    } catch (error) {
      console.error('[Q2Control] Error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- GRC Platform Proxy: List frameworks ----
  if (url.pathname === '/api/grc/frameworks' && req.method === 'GET') {
    try {
      const grcRes = await grcFetch(`${GRC_API_URL}/api/frameworks/`, {}, reqToken);
      if (!grcRes.ok) throw new Error(`GRC API ${grcRes.status}: ${await grcRes.text()}`);
      const data = await grcRes.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, results: data.results || data }));
    } catch (error) {
      console.error('[GRC] Frameworks error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- GRC Platform Proxy: Get framework requirement tree ----
  const fwTreeMatch = url.pathname.match(/^\/api\/grc\/frameworks\/([^/]+)\/tree$/);
  if (fwTreeMatch && req.method === 'GET') {
    try {
      const fwId = fwTreeMatch[1];
      const grcRes = await grcFetch(`${GRC_API_URL}/api/frameworks/${fwId}/tree/`, {}, reqToken);
      if (!grcRes.ok) throw new Error(`GRC API ${grcRes.status}: ${await grcRes.text()}`);
      const data = await grcRes.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, tree: data }));
    } catch (error) {
      console.error('[GRC] Framework tree error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- GRC Platform Proxy: Get compliance assessment tree (RA UUIDs as keys) ----
  const caTreeMatch = url.pathname.match(/^\/api\/grc\/compliance-assessments\/([^/]+)\/tree$/);
  if (caTreeMatch && req.method === 'GET') {
    try {
      const caId = caTreeMatch[1];
      console.log(`[GRC] Fetching tree for compliance assessment ${caId}`);
      const grcRes = await grcFetch(`${GRC_API_URL}/api/compliance-assessments/${caId}/tree/`, {}, reqToken);
      if (!grcRes.ok) throw new Error(`GRC API ${grcRes.status}: ${await grcRes.text()}`);
      const data = await grcRes.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, tree: data }));
    } catch (error) {
      console.error('[GRC] Compliance assessment tree error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- GRC Platform Proxy: Get requirement nodes count for a framework ----
  if (url.pathname === '/api/grc/requirement-nodes' && req.method === 'GET') {
    try {
      const qs = url.search || '';
      const grcRes = await grcFetch(`${GRC_API_URL}/api/requirement-nodes/${qs}`, {}, reqToken);
      if (!grcRes.ok) throw new Error(`GRC API ${grcRes.status}: ${await grcRes.text()}`);
      const data = await grcRes.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: data.count, results: data.results || data }));
    } catch (error) {
      console.error('[GRC] Requirement nodes error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- GRC Platform Proxy: Get compliance assessments ----
  if (url.pathname === '/api/grc/compliance-assessments' && req.method === 'GET') {
    try {
      const grcRes = await grcFetch(`${GRC_API_URL}/api/compliance-assessments/`, {}, reqToken);
      if (!grcRes.ok) throw new Error(`GRC API ${grcRes.status}: ${await grcRes.text()}`);
      const data = await grcRes.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, results: data.results || data }));
    } catch (error) {
      console.error('[GRC] Compliance assessments error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- GRC Platform Proxy: List policies (applied controls) ----
  if (url.pathname === '/api/grc/policies' && req.method === 'GET') {
    try {
      const qs = url.search || '';
      const grcRes = await grcFetch(`${GRC_API_URL}/api/applied-controls/${qs ? qs + '&page_size=500' : '?page_size=500'}`, {}, reqToken);
      if (!grcRes.ok) throw new Error(`GRC API ${grcRes.status}: ${await grcRes.text()}`);
      const data = await grcRes.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, results: data.results || data }));
    } catch (error) {
      console.error('[GRC] Policies error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- GRC Platform Proxy: Get organisation objectives ----
  if (url.pathname === '/api/grc/organisation-objectives' && req.method === 'GET') {
    try {
      const grcRes = await grcFetch(`${GRC_API_URL}/api/organisation-objectives/`, {}, reqToken);
      if (!grcRes.ok) throw new Error(`GRC API ${grcRes.status}: ${await grcRes.text()}`);
      const data = await grcRes.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, results: data.results || data }));
    } catch (error) {
      console.error('[GRC] Organisation objectives error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- GRC Platform Proxy: Create organisation objective ----
  if (url.pathname === '/api/grc/organisation-objectives' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      console.log(`[GRC] Creating organisation objective: "${body.name}"`);
      const grcRes = await grcFetch(`${GRC_API_URL}/api/organisation-objectives/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, reqToken);
      if (!grcRes.ok) {
        const errText = await grcRes.text();
        throw new Error(`GRC API ${grcRes.status}: ${errText}`);
      }
      const data = await grcRes.json();
      console.log(`[GRC] Organisation objective created: ${data.id}`);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result: data }));
    } catch (error) {
      console.error('[GRC] Create organisation objective error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- GRC Platform Proxy: Get folders (with query params) ----
  if (url.pathname === '/api/grc/folders' && req.method === 'GET') {
    try {
      const qs = url.search || '';
      const grcRes = await grcFetch(`${GRC_API_URL}/api/folders/${qs}`, {}, reqToken);
      if (!grcRes.ok) throw new Error(`GRC API ${grcRes.status}: ${await grcRes.text()}`);
      const data = await grcRes.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, folders: data.results || data }));
    } catch (error) {
      console.error('[GRC] Folders error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- GRC Platform Proxy: Get requirement assessments ----
  if (url.pathname === '/api/grc/requirement-assessments' && req.method === 'GET') {
    try {
      const qs = url.search || '';
      const grcRes = await grcFetch(`${GRC_API_URL}/api/requirement-assessments/${qs}`, {}, reqToken);
      if (!grcRes.ok) throw new Error(`GRC API ${grcRes.status}: ${await grcRes.text()}`);
      const data = await grcRes.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, results: data.results || data }));
    } catch (error) {
      console.error('[GRC] Requirement assessments error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- GRC Platform Proxy: PATCH requirement assessment (link applied controls) ----
  const raPatchMatch = url.pathname.match(/^\/api\/grc\/requirement-assessments\/([^/]+)$/);
  if (raPatchMatch && req.method === 'PATCH') {
    try {
      const raId = raPatchMatch[1];
      const body = await parseBody(req);
      console.log(`[GRC] PATCH requirement-assessment ${raId}:`, JSON.stringify(body));
      const grcRes = await grcFetch(`${GRC_API_URL}/api/requirement-assessments/${raId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, reqToken);
      if (!grcRes.ok) {
        const errText = await grcRes.text();
        throw new Error(`GRC API ${grcRes.status}: ${errText}`);
      }
      const data = await grcRes.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data }));
    } catch (error) {
      console.error('[GRC] PATCH requirement-assessment error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- GRC Platform Proxy: Export applied controls ----
  if (url.pathname === '/api/grc/applied-controls' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const { controls, folder } = body;
      if (!controls || !Array.isArray(controls) || controls.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No controls to export.' }));
        return;
      }
      console.log(`[GRC Export] Exporting ${controls.length} controls${folder ? ` to folder ${folder}` : ' (root folder)'}`);

      const prioMap = { critical: 1, high: 2, medium: 3, low: 4 };
      const effortMap = { low: 'S', small: 'S', s: 'S', medium: 'M', m: 'M', high: 'L', large: 'L', l: 'L', 'extra-large': 'XL', xl: 'XL' };

      const results = [];
      const errors = [];

      // ── Phase 1: POST all applied controls to GRC ──
      // Pre-fetch existing applied controls to handle duplicates
      let existingControls = [];
      try {
        const listRes = await grcFetch(`${GRC_API_URL}/api/applied-controls/?page_size=1000`, {}, reqToken);
        if (listRes.ok) {
          const listData = await listRes.json();
          existingControls = Array.isArray(listData.results) ? listData.results : [];
          console.log(`[GRC Export] Fetched ${existingControls.length} existing applied controls`);
        }
      } catch (_) {}

      for (let i = 0; i < controls.length; i++) {
        const c = controls[i];
        try {
          const grcBody = {
            name: c.name || c.name_ar || 'Untitled Control',
            description: c.description || c.description_ar || '',
            status: c.status || 'to_do',
            priority: typeof c.priority === 'number' ? c.priority : (prioMap[(c.priority || c.implementation_priority || 'medium').toLowerCase()] || 3),
            category: c.category || c.control_type || '',
            csf_function: c.csf_function || c.csfFunction || '',
            effort: effortMap[(c.effort || c.effort_estimate || 'M').toLowerCase()] || c.effort || 'M',
          };

          // Only include folder if provided (otherwise GRC uses root folder)
          if (folder) grcBody.folder = folder;

          console.log(`[GRC Export] ${i + 1}/${controls.length}: POST "${grcBody.name}" (priority: ${grcBody.priority}, category: ${grcBody.category})`);

          const grcRes = await grcFetch(`${GRC_API_URL}/api/applied-controls/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(grcBody)
          }, reqToken);

          if (grcRes.ok) {
            const created = await grcRes.json();
            results.push({
              controlId: c.id,
              grcId: created.id,
              name: grcBody.name,
              success: true,
              requirementUrn: c.requirementUrn || '',
              requirementRefId: c.requirementRefId || '',
              requirementNodeId: c.requirementNodeId || '',
              linkedRA: []
            });
          } else {
            // If duplicate name error, find existing control and reuse its UUID
            const errText = await grcRes.text();
            const isDuplicate = grcRes.status === 400 && errText.includes('already used');

            if (isDuplicate) {
              const existing = existingControls.find(ec => ec.name === grcBody.name);
              if (existing) {
                console.log(`[GRC Export] "${grcBody.name}" already exists (${existing.id}) — reusing`);
                results.push({
                  controlId: c.id,
                  grcId: existing.id,
                  name: grcBody.name,
                  success: true,
                  reused: true,
                  requirementUrn: c.requirementUrn || '',
                  requirementRefId: c.requirementRefId || '',
                  requirementNodeId: c.requirementNodeId || '',
                  linkedRA: []
                });
              } else {
                console.warn(`[GRC Export] "${grcBody.name}" is duplicate but not found in existing list`);
                errors.push({ controlId: c.id, name: c.name, error: errText });
              }
            } else {
              throw new Error(`${grcRes.status}: ${errText}`);
            }
          }
        } catch (err) {
          console.error(`[GRC Export] Failed "${c.name}":`, err.message);
          errors.push({ controlId: c.id, name: c.name, error: err.message });
        }
      }

      console.log(`[GRC Export] Phase 1 done: ${results.length} controls created, ${errors.length} failed`);

      // ── Phase 2: Link applied controls to requirement assessments ──
      // 1. GET /api/requirement-assessments/?compliance_assessment=<ca-uuid>&page_size=1000
      // 2. Filter: match RA.requirement to our requirementNodeIds + skip status=done
      // 3. PATCH /api/requirement-assessments/<ra-uuid>/ { applied_controls: [...existing, ...new] }
      let totalLinked = 0;

      // Collect ALL generated control GRC UUIDs (to link all of them to every matching RA)
      const allControlGrcIds = results.map(r => r.grcId).filter(Boolean);

      // Collect unique requirement node UUIDs from the generated controls
      const selectedReqNodeIds = [...new Set(results.map(r => r.requirementNodeId).filter(Boolean))];

      if (selectedReqNodeIds.length === 0 || allControlGrcIds.length === 0) {
        console.log(`[GRC Link] No requirement UUIDs on controls — skipping`);
      } else {
        console.log(`[GRC Link] Linking ${allControlGrcIds.length} controls to ${selectedReqNodeIds.length} requirement(s)`);

        try {
          // Step 1: Fetch ALL compliance assessments
          const caRes = await grcFetch(`${GRC_API_URL}/api/compliance-assessments/`, {}, reqToken);
          if (!caRes.ok) throw new Error(`Failed to fetch CAs: ${caRes.status}`);
          const caData = await caRes.json();
          const allCAs = Array.isArray(caData.results) ? caData.results : [];
          console.log(`[GRC Link] Found ${allCAs.length} compliance assessment(s)`);

          // Step 2: Loop over each CA, fetch its RAs, filter & PATCH
          for (const ca of allCAs) {
            const caId = ca.id || ca.uuid;
            if (!caId) continue;

            let allRAs = [];
            let raUrl = `${GRC_API_URL}/api/requirement-assessments/?compliance_assessment=${caId}&page_size=1000`;
            while (raUrl) {
              const raRes = await grcFetch(raUrl, {}, reqToken);
              if (!raRes.ok) { console.warn(`[GRC Link] Failed to fetch RAs for CA ${caId}: ${raRes.status}`); break; }
              const raData = await raRes.json();
              allRAs = allRAs.concat(Array.isArray(raData.results) ? raData.results : []);
              raUrl = raData.next || null;
            }

            // Step 3: Filter — match RA.requirement to selected requirement nodes, skip done
            const targetRAs = allRAs.filter(ra => {
              const reqId = typeof ra.requirement === 'string' ? ra.requirement : (ra.requirement?.id || '');
              return selectedReqNodeIds.includes(reqId) && ra.status !== 'done';
            });

            if (targetRAs.length === 0) continue;
            console.log(`[GRC Link] CA ${ca.name || caId}: ${targetRAs.length} matching RA(s) from ${allRAs.length} total`);

            // Step 4: PATCH each matching RA — link ALL generated controls to each RA
            for (const ra of targetRAs) {
              const raId = ra.id || ra.uuid;
              if (!raId) continue;

              try {
                // Preserve existing linked controls
                const existingRaw = Array.isArray(ra.applied_controls) ? ra.applied_controls : [];
                const existingIds = existingRaw.map(ac =>
                  typeof ac === 'object' && ac !== null ? (ac.id || ac.uuid || '') : String(ac)
                ).filter(Boolean);
                const merged = [...new Set([...existingIds, ...allControlGrcIds])];

                const newCount = merged.length - existingIds.length;
                console.log(`[GRC Link] PATCH RA ${raId} ← ${newCount} new, ${merged.length} total applied_controls`);

                const patchRes = await grcFetch(`${GRC_API_URL}/api/requirement-assessments/${raId}/`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ applied_controls: merged })
                }, reqToken);

                if (patchRes.ok) {
                  console.log(`[GRC Link] ✓ RA ${raId} linked`);
                  totalLinked++;
                } else {
                  const errText = await patchRes.text();
                  console.warn(`[GRC Link] Failed PATCH RA ${raId}: ${patchRes.status} ${errText}`);
                }
              } catch (patchErr) {
                console.warn(`[GRC Link] Error on RA ${raId}:`, patchErr.message);
              }
            }
          }
        } catch (fetchErr) {
          console.error(`[GRC Link] Error:`, fetchErr.message);
        }
      }

      console.log(`[GRC Export] Done: ${results.length} created, ${errors.length} failed, ${totalLinked} RAs linked`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: errors.length === 0,
        exported: results.length,
        failed: errors.length,
        linked: totalLinked,
        results,
        errors
      }));
    } catch (error) {
      console.error('[GRC Export] Error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- GRC Platform Config Check ----
  if (url.pathname === '/api/grc/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      configured: true,
      url: GRC_API_URL,
    }));
    return;
  }

  // ---- List all chat sessions ----
  if (url.pathname === '/api/chat/sessions' && req.method === 'GET') {
    try {
      const rows = dbListSessions.all();
      const sessions = rows.map(row => {
        const ctx = JSON.parse(row.context || '{}');
        const reqs = ctx.requirements || [];
        const files = ctx.fileResources || [];
        const query = ctx.query || '';

        return {
          sessionId: row.id,
          createdAt: row.created_at,
          query,
          messageCount: row.message_count,
          requirementsCount: reqs.length,
          filesCount: files.length,
          collectionsCount: (ctx.collections || []).length,
          requirements: reqs.map(r => ({
            refId: r.refId || '',
            description: r.description || r.name || '',
            frameworkName: r.frameworkName || ''
          })),
          collections: (ctx.collections || []).map(c => ({
            storeId: c.storeId,
            displayName: c.displayName || c.storeId
          })),
          fileResources: files.map(f => ({
            storeId: f.storeId,
            fileId: f.fileId,
            documentName: f.documentName || ''
          }))
        };
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, sessions }));
    } catch (error) {
      console.error('List sessions error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- Get chat session history ----
  const sessionMatch = url.pathname.match(/^\/api\/chat\/sessions\/([0-9a-f-]+)$/);
  if (sessionMatch && req.method === 'GET') {
    try {
      const sessionId = sessionMatch[1];
      const row = dbGetSession.get(sessionId);

      if (!row) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found.' }));
        return;
      }

      // Get history from DB
      const messages = dbGetMessages.all(sessionId);
      const history = messages.map(m => ({
        role: m.role,
        text: m.text
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        sessionId,
        createdAt: row.created_at,
        context: JSON.parse(row.context || '{}'),
        history
      }));
    } catch (error) {
      console.error('Get session error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- Delete chat session ----
  if (sessionMatch && req.method === 'DELETE') {
    try {
      const sessionId = sessionMatch[1];
      const row = dbGetSession.get(sessionId);

      if (!row) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found.' }));
        return;
      }

      // Delete messages first, then session
      dbDeleteSessionMessages.run(sessionId);
      dbDeleteSession.run(sessionId);

      // Remove from in-memory cache
      delete chatSessions[sessionId];

      console.log(`Session deleted: ${sessionId}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      console.error('Delete session error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- Create new chat session ----
  if (url.pathname === '/api/chat/sessions' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const { context } = body;
      const apiKey = GEMINI_API_KEY || req.headers['x-api-key'];

      if (!apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API key not configured.' }));
        return;
      }

      // Lazy-init the SDK client
      if (!genai) {
        genai = new GoogleGenAI({ apiKey });
      }

      // Generate proper UUID
      const sessionId = crypto.randomUUID();

      // Build the system instruction from context (read from DB)
      let systemPrompt = getChatAuditorPrompt();

      if (context) {
        // Inject selected requirements with full details
        if (context.requirements && context.requirements.length > 0) {
          systemPrompt += `\n\n---\n## SESSION CONTEXT: Selected Requirements (${context.requirements.length} total)\n`;
          const groupedByFramework = {};
          context.requirements.forEach(r => {
            const fw = r.frameworkName || 'Unknown Framework';
            if (!groupedByFramework[fw]) groupedByFramework[fw] = [];
            groupedByFramework[fw].push(r);
          });
          Object.entries(groupedByFramework).forEach(([fw, reqs]) => {
            systemPrompt += `\n### Framework: ${fw}\n`;
            reqs.forEach((r, i) => {
              systemPrompt += `${i + 1}. **[${r.refId || 'N/A'}]** ${r.description || r.name || ''}`;
              if (r.nodeUrn) systemPrompt += ` (URN: ${r.nodeUrn})`;
              systemPrompt += `\n`;
            });
          });
        }

        // Inject reference files / collections info
        if (context.fileResources && context.fileResources.length > 0) {
          systemPrompt += `\n---\n## SESSION CONTEXT: Reference Files (${context.fileResources.length} files)\n`;
          systemPrompt += `The user has uploaded the following reference documents for cross-referencing:\n`;
          context.fileResources.forEach((f, i) => {
            systemPrompt += `${i + 1}. Store: ${f.storeName || f.storeId}, Document: ${f.documentName || f.fileId}\n`;
          });
          systemPrompt += `\nUse these documents to ground your analysis in the user's actual policies and evidence when possible.\n`;
        }

        // Inject uploaded context files content
        if (context.contextFiles && context.contextFiles.length > 0) {
          systemPrompt += `\n---\n## SESSION CONTEXT: Uploaded Context Files (${context.contextFiles.length} files)\n`;
          systemPrompt += `The user has uploaded the following documents as additional context. Use their content to ground your analysis:\n\n`;
          context.contextFiles.forEach((cf, i) => {
            // Truncate to ~8000 chars per file to avoid token overflow
            const content = cf.content && cf.content.length > 8000
              ? cf.content.substring(0, 8000) + '\n... [truncated]'
              : (cf.content || '(empty file)');
            systemPrompt += `### File ${i + 1}: ${cf.name}\n\`\`\`\n${content}\n\`\`\`\n\n`;
          });
        }

        // Inject user query context
        if (context.query) {
          systemPrompt += `\n---\n## SESSION CONTEXT: User's Initial Query\n"${context.query}"\n`;
          systemPrompt += `\nAddress this query directly in your first response. Tailor all analysis to this specific focus area.\n`;
        }
      }

      // Create Gemini cached content to store the session context on Gemini's servers
      let cachedContentName = null;
      try {
        const cache = await genai.caches.create({
          model: 'gemini-2.5-pro',
          config: {
            contents: [{
              role: 'user',
              parts: [{ text: `Session ${sessionId} initialized. Awaiting first query.` }]
            }, {
              role: 'model',
              parts: [{ text: 'Session ready. I have loaded all the audit context and I am ready to analyze your requirements.' }]
            }],
            displayName: `wathbah-audit-${sessionId}`,
            systemInstruction: systemPrompt,
            ttl: '3600s' // 1 hour TTL
          }
        });
        cachedContentName = cache.name;
        console.log(`Gemini cache created: ${cachedContentName}`);
      } catch (cacheErr) {
        console.warn(`Cache creation failed (will use direct system instruction): ${cacheErr.message}`);
      }

      // Create SDK chat session — with cached content if available, otherwise system instruction
      const chatConfig = {
        temperature: 0.7,
        maxOutputTokens: 8192
      };

      if (cachedContentName) {
        chatConfig.cachedContent = cachedContentName;
      } else {
        chatConfig.systemInstruction = systemPrompt;
      }

      const createdAt = new Date().toISOString();

      // Save session to DB
      dbInsertSession.run(
        sessionId,
        JSON.stringify(context || {}),
        systemPrompt,
        cachedContentName,
        createdAt
      );

      // Keep in-memory chat session for active conversations
      chatSessions[sessionId] = {
        id: sessionId,
        cachedContentName,
        systemPrompt,
        context: context || {},
        createdAt,
        chat: genai.chats.create({
          model: 'gemini-2.5-pro',
          config: chatConfig
        })
      };

      console.log(`Chat session created & persisted: ${sessionId} (cache: ${cachedContentName || 'none'}, prompt: ${systemPrompt.length} chars)`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        sessionId,
        cachedContent: cachedContentName || null
      }));
    } catch (error) {
      console.error('Create session error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- Send message to chat session ----
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const { sessionId, message } = body;
      const apiKey = GEMINI_API_KEY || req.headers['x-api-key'];

      if (!apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API key not configured.' }));
        return;
      }

      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'sessionId is required.' }));
        return;
      }

      if (!message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Message is required.' }));
        return;
      }

      // Lazy-init the SDK client
      if (!genai) {
        genai = new GoogleGenAI({ apiKey });
      }

      // Ensure in-memory session exists (restore from DB if needed)
      if (!chatSessions[sessionId]) {
        const row = dbGetSession.get(sessionId);
        if (row) {
          // Rebuild in-memory chat session from DB
          const savedMessages = dbGetMessages.all(sessionId);
          const history = savedMessages.map(m => ({
            role: m.role === 'ai' ? 'model' : 'user',
            parts: [{ text: m.text }]
          }));

          // Always use systemInstruction when restoring (cached content may have expired — TTL is 1h)
          const chatConfig = {
            systemInstruction: row.system_prompt || 'You are an expert compliance auditor.',
            temperature: 0.7,
            maxOutputTokens: 8192
          };

          // Provide history so the SDK ChatSession resumes from where it left off
          if (history.length > 0) {
            chatConfig.history = history;
          }

          chatSessions[sessionId] = {
            id: sessionId,
            cachedContentName: null, // Don't reuse expired cache
            systemPrompt: row.system_prompt,
            context: JSON.parse(row.context || '{}'),
            createdAt: row.created_at,
            chat: genai.chats.create({
              model: 'gemini-2.5-pro',
              config: chatConfig
            })
          };
          console.log(`Chat session restored from DB: ${sessionId} (${history.length} messages, using systemInstruction)`);
        } else {
          // No DB record — create a fresh session
          const createdAt = new Date().toISOString();
          const sysPrompt = getChatAuditorPrompt();
          dbInsertSession.run(sessionId, '{}', sysPrompt, null, createdAt);

          chatSessions[sessionId] = {
            id: sessionId,
            cachedContentName: null,
            systemPrompt: sysPrompt,
            context: {},
            createdAt,
            chat: genai.chats.create({
              model: 'gemini-2.5-pro',
              config: {
                systemInstruction: sysPrompt,
                temperature: 0.7,
                maxOutputTokens: 8192
              }
            })
          };
          console.log(`Chat session created on-the-fly & persisted: ${sessionId}`);
        }
      }

      const session = chatSessions[sessionId];

      // Send message — SDK ChatSession handles history automatically
      const historyLen = session.chat.getHistory ? session.chat.getHistory(false).length : 0;
      console.log(`Session ${sessionId}: sending message to Gemini (history: ${historyLen} msgs)`);
      const response = await session.chat.sendMessage({ message });
      const reply = response.text || 'No response generated.';

      // Persist both user message and AI reply to DB
      const now = new Date().toISOString();
      dbInsertMessage.run(sessionId, 'user', message, now);
      dbInsertMessage.run(sessionId, 'ai', reply, now);

      console.log(`Session ${sessionId}: got reply (${reply.length} chars) — messages persisted to DB`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, reply, sessionId }));
    } catch (error) {
      console.error('Chat API Error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- Local Prompts API ----
  if (url.pathname === '/api/local-prompts' && req.method === 'GET') {
    try {
      const rows = dbListLocalPrompts.all();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, prompts: rows }));
    } catch (error) {
      console.error('List local prompts error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  const localPromptMatch = url.pathname.match(/^\/api\/local-prompts\/([^\/]+)$/);
  if (localPromptMatch && req.method === 'GET') {
    try {
      const row = dbGetLocalPrompt.get(localPromptMatch[1]);
      if (!row) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Prompt not found.' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, prompt: row }));
    } catch (error) {
      console.error('Get local prompt error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (localPromptMatch && req.method === 'PUT') {
    try {
      const id = localPromptMatch[1];
      const row = dbGetLocalPrompt.get(id);
      if (!row) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Prompt not found.' }));
        return;
      }
      const body = await parseBody(req);
      const name = body.name || row.name;
      const content = body.content !== undefined ? body.content : row.content;
      const updatedAt = new Date().toISOString();
      dbUpdateLocalPrompt.run(name, content, updatedAt, id);
      console.log(`Local prompt updated: ${id} ("${name}", ${content.length} chars)`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, prompt: { ...row, name, content, updated_at: updatedAt } }));
    } catch (error) {
      console.error('Update local prompt error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- Org Contexts API ----
  // ---- Controls Studio Sessions API ----
  const csMatch = url.pathname.match(/^\/api\/cs-sessions(?:\/([^\/]+))?$/);

  if (url.pathname === '/api/cs-sessions' && req.method === 'GET') {
    try {
      const rows = dbListCsSessions.all();
      const sessions = rows.map(csSessionToJSON);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, sessions }));
    } catch (error) {
      console.error('List CS sessions error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (url.pathname === '/api/cs-sessions' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const id = body.id || crypto.randomUUID();
      const now = new Date().toISOString();
      dbInsertCsSession.run(
        id,
        body.name || '',
        body.status || 'draft',
        body.step || 0,
        JSON.stringify(body.requirements || []),
        JSON.stringify(body.collections || []),
        JSON.stringify(body.selectedFiles || []),
        JSON.stringify(body.sessionFiles || []),
        body.orgContext ? JSON.stringify(body.orgContext) : null,
        JSON.stringify(body.controls || []),
        body.framework || '',
        JSON.stringify(body.exportedControlIds || []),
        now,
        now
      );
      const row = dbGetCsSession.get(id);
      console.log(`CS session created: ${id} ("${body.name}")`);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, session: csSessionToJSON(row) }));
    } catch (error) {
      console.error('Create CS session error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (csMatch && csMatch[1] && req.method === 'GET') {
    try {
      const row = dbGetCsSession.get(csMatch[1]);
      if (!row) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found.' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, session: csSessionToJSON(row) }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (csMatch && csMatch[1] && req.method === 'PUT') {
    try {
      const id = csMatch[1];
      const existing = dbGetCsSession.get(id);
      if (!existing) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found.' })); return; }
      const body = await parseBody(req);
      const now = new Date().toISOString();
      dbUpdateCsSession.run(
        body.name !== undefined ? body.name : existing.name,
        body.status !== undefined ? body.status : existing.status,
        body.step !== undefined ? body.step : existing.step,
        body.requirements !== undefined ? JSON.stringify(body.requirements) : existing.requirements,
        body.collections !== undefined ? JSON.stringify(body.collections) : existing.collections,
        body.selectedFiles !== undefined ? JSON.stringify(body.selectedFiles) : existing.selected_files,
        body.sessionFiles !== undefined ? JSON.stringify(body.sessionFiles) : existing.session_files,
        body.orgContext !== undefined ? (body.orgContext ? JSON.stringify(body.orgContext) : null) : existing.org_context,
        body.controls !== undefined ? JSON.stringify(body.controls) : existing.controls,
        body.framework !== undefined ? body.framework : existing.framework,
        body.exportedControlIds !== undefined ? JSON.stringify(body.exportedControlIds) : existing.exported_control_ids,
        now,
        id
      );
      const updated = dbGetCsSession.get(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, session: csSessionToJSON(updated) }));
    } catch (error) {
      console.error('Update CS session error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (csMatch && csMatch[1] && req.method === 'DELETE') {
    try {
      const id = csMatch[1];
      const row = dbGetCsSession.get(id);
      if (!row) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found.' })); return; }
      dbDeleteCsSession.run(id);
      console.log(`CS session deleted: ${id}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      console.error('Delete CS session error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- Org Contexts API ----
  if (url.pathname === '/api/org-contexts' && req.method === 'GET') {
    try {
      const rows = dbListOrgContexts.all();
      const contexts = rows.map(orgContextToJSON);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, contexts }));
    } catch (error) {
      console.error('List org contexts error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (url.pathname === '/api/org-contexts' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const id = body.id || crypto.randomUUID();
      const now = new Date().toISOString();
      dbInsertOrgContext.run(
        id,
        body.nameEn || body.name || '',
        body.nameAr || '',
        body.sector || '',
        body.sectorCustom || '',
        body.size || '',
        body.complianceMaturity || 1,
        JSON.stringify(body.regulatoryMandates || []),
        body.governanceStructure || '',
        body.dataClassification || '',
        body.geographicScope || '',
        body.itInfrastructure || '',
        JSON.stringify(body.strategicObjectives || []),
        JSON.stringify(body.obligatoryFrameworks || []),
        JSON.stringify(body.policies || []),
        body.notes || '',
        body.isActive !== undefined ? (body.isActive ? 1 : 0) : 1,
        now,
        now
      );
      const row = dbGetOrgContext.get(id);
      console.log(`Org context created: ${id} ("${body.nameEn || body.name}")`);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, context: orgContextToJSON(row) }));
    } catch (error) {
      console.error('Create org context error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  const orgCtxMatch = url.pathname.match(/^\/api\/org-contexts\/([^\/]+)$/);
  if (orgCtxMatch && req.method === 'GET') {
    try {
      const row = dbGetOrgContext.get(orgCtxMatch[1]);
      if (!row) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found.' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, context: orgContextToJSON(row) }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (orgCtxMatch && req.method === 'PUT') {
    try {
      const id = orgCtxMatch[1];
      const row = dbGetOrgContext.get(id);
      if (!row) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found.' })); return; }
      const body = await parseBody(req);
      const now = new Date().toISOString();
      dbUpdateOrgContext.run(
        body.nameEn !== undefined ? body.nameEn : row.name_en,
        body.nameAr !== undefined ? body.nameAr : row.name_ar,
        body.sector !== undefined ? body.sector : row.sector,
        body.sectorCustom !== undefined ? body.sectorCustom : (row.sector_custom || ''),
        body.size !== undefined ? body.size : row.size,
        body.complianceMaturity !== undefined ? body.complianceMaturity : (row.compliance_maturity || 1),
        body.regulatoryMandates !== undefined ? JSON.stringify(body.regulatoryMandates) : (row.regulatory_mandates || '[]'),
        body.governanceStructure !== undefined ? body.governanceStructure : (row.governance_structure || ''),
        body.dataClassification !== undefined ? body.dataClassification : (row.data_classification || ''),
        body.geographicScope !== undefined ? body.geographicScope : (row.geographic_scope || ''),
        body.itInfrastructure !== undefined ? body.itInfrastructure : (row.it_infrastructure || ''),
        body.strategicObjectives !== undefined ? JSON.stringify(body.strategicObjectives) : (row.strategic_objectives || '[]'),
        body.obligatoryFrameworks !== undefined ? JSON.stringify(body.obligatoryFrameworks) : row.obligatory_frameworks,
        body.policies !== undefined ? JSON.stringify(body.policies) : (row.policies || '[]'),
        body.notes !== undefined ? body.notes : row.notes,
        body.isActive !== undefined ? (body.isActive ? 1 : 0) : row.is_active,
        now,
        id
      );
      const updated = dbGetOrgContext.get(id);
      console.log(`Org context updated: ${id}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, context: orgContextToJSON(updated) }));
    } catch (error) {
      console.error('Update org context error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (orgCtxMatch && req.method === 'DELETE') {
    try {
      const id = orgCtxMatch[1];
      const row = dbGetOrgContext.get(id);
      if (!row) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found.' })); return; }
      dbDeleteOrgContext.run(id);
      console.log(`Org context deleted: ${id}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      console.error('Delete org context error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- Policy Collections API ----
  const policyCollMatch = url.pathname.match(/^\/api\/policy-collections(?:\/([^\/]+))?(?:\/(files|extract|approve|history|sync|chat)(?:\/([^\/]+))?)?$/);
  if (policyCollMatch) {
    let collId = policyCollMatch[1];
    let subResource = policyCollMatch[2]; // 'files' | 'extract' | 'approve' | 'history' | 'sync' | 'chat'
    const fileId = policyCollMatch[3];
    const apiKey = GEMINI_API_KEY || req.headers['x-api-key'];

    try {
      // POST /api/policy-collections/chat — Chat without a specific collection (pass storeIds in body)
      if (collId === 'chat' && !subResource && req.method === 'POST') {
        collId = null;
        subResource = 'chat';
      }

      // GET /api/policy-collections/overview — Hierarchical view of all collections + files from Gemini
      if (collId === 'overview' && req.method === 'GET') {
        const rows = dbListPolicyCollections.all();
        const overview = await Promise.all(rows.map(async row => {
          const storeId = row.store_id || '';
          let files = [];
          if (storeId && apiKey) {
            try {
              const storeName = storeId.startsWith('fileSearchStores/') ? storeId : `fileSearchStores/${storeId}`;
              const result = await listStoreDocuments(storeName, apiKey);
              files = (result.documents || []).map(doc => ({
                documentName: doc.name || '',
                name: doc.displayName || doc.name || '',
                sizeBytes: parseInt(doc.sizeBytes || '0', 10),
                createTime: doc.createTime || '',
                updateTime: doc.updateTime || '',
              }));
            } catch (err) {
              console.warn(`[Overview] Could not list docs for store ${storeId}:`, err.message);
            }
          }
          return {
            id: row.id,
            name: row.name,
            description: row.description || '',
            storeId,
            status: row.status || 'empty',
            fileCount: files.length,
            created: row.created_at,
            files,
          };
        }));

        const totalFiles = overview.reduce((sum, c) => sum + c.fileCount, 0);

        sendJSON(res, 200, {
          success: true,
          totalCollections: overview.length,
          totalFiles,
          data: overview,
        });
        return;
      }

      // GET /api/policy-collections — List all
      if (!collId && req.method === 'GET') {
        const rows = dbListPolicyCollections.all();
        const collections = await Promise.all(rows.map(r => policyCollectionToJSON(r, apiKey)));
        sendJSON(res, 200, { success: true, data: collections });
        return;
      }

      // POST /api/policy-collections — Create new (+ File Search Store)
      if (!collId && !subResource && req.method === 'POST') {
        const body = await parseBody(req);
        const newId = 'pc-' + crypto.randomUUID();
        const collName = body.name || 'New Collection';
        const now2 = new Date().toISOString();

        // Create a Gemini File Search Store for this collection
        let storeId = '';
        if (apiKey) {
          try {
            const safeName = collName.replace(/[^\x20-\x7E]/g, '_');
            console.log(`[Policy] Creating File Search Store for new collection "${safeName}"...`);
            const storeResult = await createFileSearchStore(safeName, apiKey);

            let store = storeResult;
            if (storeResult.name && !storeResult.done && !storeResult.name.startsWith('fileSearchStores/')) {
              store = await pollOperation(storeResult.name, apiKey);
              store = store.response || store;
            }

            const fullStoreName = store.name || '';
            storeId = fullStoreName.replace('fileSearchStores/', '');
            console.log(`[Policy] File Search Store created: ${storeId}`);
          } catch (storeErr) {
            console.error(`[Policy] Failed to create File Search Store:`, storeErr.message);
          }
        }

        dbInsertPolicyCollection.run(
          newId,
          collName,
          body.description || '',
          storeId,
          'empty',
          '{}',
          null,
          now2,
          now2
        );
        const newRow = dbGetPolicyCollection.get(newId);
        sendJSON(res, 201, { success: true, data: await policyCollectionToJSON(newRow, apiKey) });
        return;
      }

      // DELETE /api/policy-collections/:id — Delete collection + files (Gemini + File Search + local)
      if (collId && !subResource && req.method === 'DELETE') {
        const collRow = dbGetPolicyCollection.get(collId);
        const collFiles = dbListPolicyFiles.all(collId);

        // Delete Gemini files + File Search documents for this collection
        for (const f of collFiles) {
          if (f.gemini_file_name) {
            try {
              if (!genai && apiKey) genai = new GoogleGenAI({ apiKey });
              if (genai) await genai.files.delete({ name: f.gemini_file_name });
              console.log(`[Policy] Deleted Gemini file: ${f.gemini_file_name}`);
            } catch (delErr) {
              console.warn(`[Policy] Could not delete Gemini file ${f.gemini_file_name}:`, delErr.message);
            }
          }
          if (f.store_doc_name) {
            try {
              await deleteDocument(f.store_doc_name, apiKey);
              console.log(`[Policy] Deleted File Search document: ${f.store_doc_name}`);
            } catch (delErr) {
              console.warn(`[Policy] Could not delete File Search doc ${f.store_doc_name}:`, delErr.message);
            }
          }
        }

        // Delete the File Search Store itself
        if (collRow && collRow.store_id) {
          try {
            const storeName = `fileSearchStores/${collRow.store_id}`;
            await deleteFileSearchStore(storeName, apiKey);
            console.log(`[Policy] Deleted File Search Store: ${storeName}`);
          } catch (delErr) {
            console.warn(`[Policy] Could not delete File Search Store:`, delErr.message);
          }
        }

        // Delete local files
        const collDir = path.join(POLICY_UPLOADS_DIR, collId);
        if (fs.existsSync(collDir)) fs.rmSync(collDir, { recursive: true, force: true });
        dbDeletePolicyFilesForCollection.run(collId);
        dbDeletePolicyCollection.run(collId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // PUT /api/policy-collections/:id — Update name/description
      if (collId && !subResource && req.method === 'PUT') {
        const body = await parseBody(req);
        const row = dbGetPolicyCollection.get(collId);
        if (!row) { sendJSON(res, 404, { error: 'Not found' }); return; }
        const now2 = new Date().toISOString();
        dbUpdatePolicyCollection.run(
          body.name !== undefined ? body.name : row.name,
          body.description !== undefined ? body.description : row.description,
          row.status,
          row.config,
          row.extraction_result,
          now2,
          collId
        );
        const updated = dbGetPolicyCollection.get(collId);
        sendJSON(res, 200, { success: true, data: await policyCollectionToJSON(updated, apiKey) });
        return;
      }

      // GET /api/policy-collections/:id — Get single collection
      if (collId && !subResource && req.method === 'GET') {
        const row = dbGetPolicyCollection.get(collId);
        if (!row) { sendJSON(res, 404, { error: 'Not found' }); return; }
        sendJSON(res, 200, { success: true, data: await policyCollectionToJSON(row, apiKey) });
        return;
      }

      // POST /api/policy-collections/:id/files — Upload file to Gemini + store metadata
      if (collId && subResource === 'files' && !fileId && req.method === 'POST') {
        const row = dbGetPolicyCollection.get(collId);
        if (!row) { sendJSON(res, 404, { error: 'Collection not found' }); return; }

        if (!apiKey) {
          sendJSON(res, 401, { error: 'Gemini API key not configured. Cannot upload files.' });
          return;
        }

        const body = await parseBody(req);
        const { fileName, mimeType, data } = body;
        if (!fileName || !data) {
          sendJSON(res, 400, { error: 'fileName and data (base64) are required.' });
          return;
        }

        const fileBuffer = Buffer.from(data, 'base64');
        const fId = 'pf-' + crypto.randomUUID();
        const mime = mimeType || 'application/octet-stream';
        const now2 = new Date().toISOString();

        // Save a local copy for preview/backup
        const collDir = path.join(POLICY_UPLOADS_DIR, collId);
        if (!fs.existsSync(collDir)) fs.mkdirSync(collDir, { recursive: true });
        const safeName = fileName.replace(/[^a-zA-Z0-9._\- ]/g, '_');
        const localPath = path.join(collDir, fId + '_' + safeName);
        fs.writeFileSync(localPath, fileBuffer);

        // Upload to Gemini Files API (for AI generation)
        let geminiFileName = '';
        let geminiFileUri = '';
        try {
          if (!genai) genai = new GoogleGenAI({ apiKey });
          const safeDisplayName = fileName.replace(/[^\x20-\x7E]/g, '_');
          console.log(`[Policy] Uploading "${safeDisplayName}" (${fileBuffer.length} bytes) to Gemini Files API...`);

          const uploaded = await genai.files.upload({
            file: localPath,
            config: { mimeType: mime, displayName: safeDisplayName },
          });
          geminiFileName = uploaded.name || '';
          geminiFileUri = uploaded.uri || '';
          console.log(`[Policy] Gemini file created: ${geminiFileName} → ${geminiFileUri}`);

          // Wait for file to be ACTIVE (max 60s)
          let fileState = uploaded;
          let attempts = 0;
          while (fileState.state === 'PROCESSING' && attempts < 30) {
            await new Promise(r => setTimeout(r, 2000));
            fileState = await genai.files.get({ name: fileState.name });
            attempts++;
          }
          if (fileState.state !== 'ACTIVE') {
            console.warn(`[Policy] Gemini file ${geminiFileName} state: ${fileState.state} (may not be ready yet)`);
          } else {
            console.log(`[Policy] Gemini file ${geminiFileName} is ACTIVE`);
          }
        } catch (geminiErr) {
          console.error(`[Policy] Gemini Files API upload failed for "${fileName}":`, geminiErr.message);
        }

        // Upload to Gemini File Search Store (for search/retrieval)
        let storeDocName = '';
        let storeId = row.store_id || '';
        try {
          // Fallback: create store if collection was created before this feature
          if (!storeId) {
            const safeName = (row.name || 'Policy Collection').replace(/[^\x20-\x7E]/g, '_');
            console.log(`[Policy] Creating File Search Store (retroactive) for "${safeName}"...`);
            const storeResult = await createFileSearchStore(safeName, apiKey);
            let store = storeResult;
            if (storeResult.name && !storeResult.done && !storeResult.name.startsWith('fileSearchStores/')) {
              store = await pollOperation(storeResult.name, apiKey);
              store = store.response || store;
            }
            storeId = (store.name || '').replace('fileSearchStores/', '');
            dbUpdatePolicyCollectionStoreId.run(storeId, collId);
            console.log(`[Policy] File Search Store created: ${storeId}`);
          }

          // Upload file to the File Search Store
          if (storeId) {
            const storeName = `fileSearchStores/${storeId}`;
            console.log(`[Policy] Uploading "${fileName}" to File Search Store ${storeName}...`);
            const storeUploadResult = await uploadFileToStore(storeName, fileName, mime, fileBuffer, apiKey);
            console.log(`[Policy] Store upload raw result:`, JSON.stringify(storeUploadResult).slice(0, 500));

            // Poll if long-running operation
            let finalResult = storeUploadResult;
            if (storeUploadResult.name && !storeUploadResult.done) {
              finalResult = await pollOperation(storeUploadResult.name, apiKey);
              console.log(`[Policy] Store upload polled result:`, JSON.stringify(finalResult).slice(0, 500));
            }

            // Extract the document name — handle multiple response shapes
            const docResponse = finalResult.response || finalResult.metadata || finalResult;
            storeDocName = docResponse.document?.name || docResponse.name || '';
            if (!storeDocName && finalResult.metadata?.document) {
              storeDocName = finalResult.metadata.document.name || finalResult.metadata.document || '';
            }
            console.log(`[Policy] File Search document: ${storeDocName}`);
          }
        } catch (storeErr) {
          console.error(`[Policy] File Search Store upload failed for "${fileName}":`, storeErr.message);
        }

        // Insert DB record with both Gemini file info + File Search doc name
        dbInsertPolicyFile.run(fId, collId, fileName, mime, fileBuffer.length, localPath, storeDocName, geminiFileName, geminiFileUri, now2);

        // Update collection status
        const fileCount = dbListPolicyFiles.all(collId).length;
        dbUpdatePolicyCollection.run(row.name, row.description, fileCount > 0 ? 'ready' : 'empty', row.config, row.extraction_result, now2, collId);

        console.log(`[Policy] File "${fileName}" stored: local + Gemini Files (${geminiFileName || 'n/a'}) + File Search (${storeDocName || 'n/a'})`);
        sendJSON(res, 200, { success: true, data: { id: fId, name: fileName, size: fileBuffer.length, geminiFileName, geminiFileUri, storeDocName } });
        return;
      }

      // GET /api/policy-collections/:id/files — List files directly from Gemini File Search Store
      if (collId && subResource === 'files' && !fileId && req.method === 'GET') {
        const collRow = dbGetPolicyCollection.get(collId);
        if (!collRow) {
          sendJSON(res, 404, { error: 'Collection not found' });
          return;
        }
        const storeId = collRow.store_id || '';

        // Fetch files from Gemini File Search Store directly
        let geminiDocs = [];
        if (storeId && apiKey) {
          try {
            const storeName = storeId.startsWith('fileSearchStores/') ? storeId : `fileSearchStores/${storeId}`;
            const result = await listStoreDocuments(storeName, apiKey);
            geminiDocs = (result.documents || []).map(doc => ({
              name: doc.displayName || doc.name || '',
              documentName: doc.name || '',
              createTime: doc.createTime || '',
              updateTime: doc.updateTime || '',
              sizeBytes: doc.sizeBytes || 0,
            }));
          } catch (listErr) {
            console.warn(`[Policy] Could not list File Search docs for store ${storeId}:`, listErr.message);
          }
        }

        sendJSON(res, 200, {
          success: true,
          storeId,
          data: geminiDocs,
        });
        return;
      }

      // GET /api/policy-collections/:id/files/:fileId — Serve/download file
      if (collId && subResource === 'files' && fileId && req.method === 'GET') {
        const file = dbGetPolicyFile.get(fileId);
        if (!file || !file.local_path || !fs.existsSync(file.local_path)) {
          sendJSON(res, 404, { error: 'File not found' });
          return;
        }
        const stat = fs.statSync(file.local_path);
        const mimeType = file.mime_type || 'application/octet-stream';
        // For PDFs and images, display inline; otherwise download
        const isInline = mimeType.startsWith('application/pdf') || mimeType.startsWith('image/');
        const disposition = isInline ? 'inline' : 'attachment';
        const safeFilename = file.name.replace(/[^\x20-\x7E]/g, '_');
        res.writeHead(200, {
          'Content-Type': mimeType,
          'Content-Length': stat.size,
          'Content-Disposition': `${disposition}; filename="${safeFilename}"`,
          'Cache-Control': 'private, max-age=3600',
        });
        fs.createReadStream(file.local_path).pipe(res);
        return;
      }

      // DELETE /api/policy-collections/:id/files/:fileId — Delete file from Gemini + File Search + local
      if (collId && subResource === 'files' && fileId && req.method === 'DELETE') {
        const file = dbGetPolicyFile.get(fileId);
        // Delete from Gemini Files API
        if (file && file.gemini_file_name) {
          try {
            if (!genai) genai = new GoogleGenAI({ apiKey });
            await genai.files.delete({ name: file.gemini_file_name });
            console.log(`[Policy] Deleted Gemini file: ${file.gemini_file_name}`);
          } catch (delErr) {
            console.warn(`[Policy] Could not delete Gemini file ${file.gemini_file_name}:`, delErr.message);
          }
        }
        // Delete from File Search Store
        if (file && file.store_doc_name) {
          try {
            await deleteDocument(file.store_doc_name, apiKey);
            console.log(`[Policy] Deleted File Search document: ${file.store_doc_name}`);
          } catch (delErr) {
            console.warn(`[Policy] Could not delete File Search doc ${file.store_doc_name}:`, delErr.message);
          }
        }
        // Delete local copy
        if (file && file.local_path && fs.existsSync(file.local_path)) fs.unlinkSync(file.local_path);
        dbDeletePolicyFile.run(fileId);
        // Update collection status
        const now2 = new Date().toISOString();
        const row = dbGetPolicyCollection.get(collId);
        if (row) {
          const fileCount = dbListPolicyFiles.all(collId).length;
          dbUpdatePolicyCollection.run(row.name, row.description, fileCount > 0 ? 'ready' : 'empty', row.config, row.extraction_result, now2, collId);
        }
        sendJSON(res, 200, { success: true });
        return;
      }

      // POST /api/policy-collections/:id/sync — Sync existing files to Gemini + File Search
      if (collId && subResource === 'sync' && req.method === 'POST') {
        if (!apiKey) {
          sendJSON(res, 401, { error: 'Gemini API key not configured.' });
          return;
        }
        const row = dbGetPolicyCollection.get(collId);
        if (!row) { sendJSON(res, 404, { error: 'Collection not found' }); return; }

        if (!genai) genai = new GoogleGenAI({ apiKey });

        // Ensure collection has a File Search Store
        let storeId = row.store_id || '';
        if (!storeId) {
          try {
            const safeName = (row.name || 'Policy Collection').replace(/[^\x20-\x7E]/g, '_');
            console.log(`[Sync] Creating File Search Store for "${safeName}"...`);
            const storeResult = await createFileSearchStore(safeName, apiKey);
            let store = storeResult;
            if (storeResult.name && !storeResult.done && !storeResult.name.startsWith('fileSearchStores/')) {
              store = await pollOperation(storeResult.name, apiKey);
              store = store.response || store;
            }
            storeId = (store.name || '').replace('fileSearchStores/', '');
            dbUpdatePolicyCollectionStoreId.run(storeId, collId);
            console.log(`[Sync] File Search Store created: ${storeId}`);
          } catch (err) {
            sendJSON(res, 500, { error: `Failed to create File Search Store: ${err.message}` });
            return;
          }
        }

        // Find files that need syncing
        const files = dbListPolicyFiles.all(collId);
        const results = { synced: 0, skipped: 0, failed: 0, errors: [] };

        for (const f of files) {
          const needsGemini = !f.gemini_file_name;
          const needsStore = !f.store_doc_name;

          if (!needsGemini && !needsStore) {
            results.skipped++;
            continue;
          }

          // Need local file for upload
          if (!f.local_path || !fs.existsSync(f.local_path)) {
            results.failed++;
            results.errors.push(`${f.name}: local file not found`);
            continue;
          }

          try {
            let geminiName = f.gemini_file_name || '';
            let geminiUri = f.gemini_file_uri || '';
            let storeDocName = f.store_doc_name || '';

            // Upload to Gemini Files API if missing
            if (needsGemini) {
              const safeDisplayName = f.name.replace(/[^\x20-\x7E]/g, '_');
              console.log(`[Sync] Uploading "${safeDisplayName}" to Gemini Files API...`);
              const uploaded = await genai.files.upload({
                file: f.local_path,
                config: { mimeType: f.mime_type, displayName: safeDisplayName },
              });
              geminiName = uploaded.name || '';
              geminiUri = uploaded.uri || '';

              // Wait for ACTIVE
              let fileState = uploaded;
              let attempts = 0;
              while (fileState.state === 'PROCESSING' && attempts < 30) {
                await new Promise(r => setTimeout(r, 2000));
                fileState = await genai.files.get({ name: fileState.name });
                attempts++;
              }
              console.log(`[Sync] Gemini file: ${geminiName} (${fileState.state})`);
              dbUpdatePolicyFileGemini.run(geminiName, geminiUri, f.id);
            }

            // Upload to File Search Store if missing
            if (needsStore && storeId) {
              const storeName = `fileSearchStores/${storeId}`;
              const fileBuffer = fs.readFileSync(f.local_path);
              console.log(`[Sync] Uploading "${f.name}" to File Search Store...`);
              const storeUploadResult = await uploadFileToStore(storeName, f.name, f.mime_type, fileBuffer, apiKey);

              let finalResult = storeUploadResult;
              if (storeUploadResult.name && !storeUploadResult.done) {
                finalResult = await pollOperation(storeUploadResult.name, apiKey);
              }
              const docResponse = finalResult.response || finalResult;
              storeDocName = docResponse.name || '';
              console.log(`[Sync] File Search document: ${storeDocName}`);
              dbUpdatePolicyFileStoreDoc.run(storeDocName, f.id);
            }

            results.synced++;
          } catch (err) {
            results.failed++;
            results.errors.push(`${f.name}: ${err.message}`);
            console.error(`[Sync] Failed for "${f.name}":`, err.message);
          }
        }

        console.log(`[Sync] Collection ${collId}: ${results.synced} synced, ${results.skipped} already synced, ${results.failed} failed`);
        sendJSON(res, 200, { success: true, storeId, ...results });
        return;
      }

      // POST /api/policy-collections/:id/extract — Run Gemini extraction
      if (collId && subResource === 'extract' && req.method === 'POST') {
        if (!apiKey) {
          sendJSON(res, 401, { error: 'Gemini API key not configured.' });
          return;
        }
        const row = dbGetPolicyCollection.get(collId);
        if (!row) { sendJSON(res, 404, { error: 'Collection not found' }); return; }

        const body = await parseBody(req);
        const config = {
          generationType: body.generationType || 'both',
          libraryName: body.libraryName || row.name,
          provider: body.provider || row.name || 'Organization',
          language: body.language || 'en',
          detailLevel: body.detailLevel || 'comprehensive',
          linkedFrameworkIds: body.linkedFrameworkIds || [],
        };

        // Save config
        const now2 = new Date().toISOString();
        dbUpdatePolicyCollection.run(row.name, row.description, 'generating', JSON.stringify(config), null, now2, collId);

        // Get files for this collection (optionally filter by selectedFileIds)
        let files = dbListPolicyFiles.all(collId);
        if (body.selectedFileIds && body.selectedFileIds.length > 0) {
          files = files.filter(f => body.selectedFileIds.includes(f.id));
        }

        if (files.length === 0) {
          sendJSON(res, 400, { error: 'No files to extract from.' });
          return;
        }

        console.log(`[Policy Extraction] Starting for collection "${row.name}" with ${files.length} file(s)...`);

        try {
          // Initialize Gemini SDK
          if (!genai) genai = new GoogleGenAI({ apiKey });

          // Resolve Gemini file references — use stored URIs or re-upload if expired/missing
          const uploadedFiles = [];
          for (const f of files) {
            let geminiName = f.gemini_file_name || '';
            let geminiUri = f.gemini_file_uri || '';
            let geminiMime = f.mime_type;

            // Check if stored Gemini file is still ACTIVE
            if (geminiName) {
              try {
                const fileState = await genai.files.get({ name: geminiName });
                if (fileState.state === 'ACTIVE') {
                  console.log(`[Policy Extraction] Using stored Gemini file: ${geminiName} (ACTIVE)`);
                  uploadedFiles.push({ name: geminiName, uri: geminiUri || fileState.uri, mimeType: geminiMime });
                  continue;
                } else {
                  console.warn(`[Policy Extraction] Stored Gemini file ${geminiName} state: ${fileState.state} — re-uploading`);
                  geminiName = '';
                  geminiUri = '';
                }
              } catch (getErr) {
                console.warn(`[Policy Extraction] Could not verify Gemini file ${geminiName}: ${getErr.message} — re-uploading`);
                geminiName = '';
                geminiUri = '';
              }
            }

            // No valid Gemini file — re-upload from local copy
            if (!f.local_path || !fs.existsSync(f.local_path)) {
              console.warn(`[Policy Extraction] File not on disk and no Gemini ref: ${f.name} — skipping`);
              continue;
            }
            const safeDisplayName = f.name.replace(/[^\x20-\x7E]/g, '_');
            console.log(`[Policy Extraction] Uploading "${safeDisplayName}" to Gemini Files API...`);
            const uploaded = await genai.files.upload({
              file: f.local_path,
              config: { mimeType: f.mime_type, displayName: safeDisplayName },
            });
            console.log(`[Policy Extraction] Uploaded: ${uploaded.name} (${uploaded.uri})`);

            // Wait for ACTIVE state
            let fileState = uploaded;
            let attempts = 0;
            while (fileState.state === 'PROCESSING' && attempts < 30) {
              await new Promise(r => setTimeout(r, 2000));
              fileState = await genai.files.get({ name: fileState.name });
              attempts++;
            }
            if (fileState.state !== 'ACTIVE') {
              console.warn(`[Policy Extraction] File ${uploaded.name} state: ${fileState.state}`);
            }

            // Update DB with new Gemini file info
            dbUpdatePolicyFileGemini.run(uploaded.name, uploaded.uri, f.id);
            uploadedFiles.push({ name: uploaded.name, uri: uploaded.uri, mimeType: f.mime_type });
          }

          if (uploadedFiles.length === 0) {
            throw new Error('No files could be uploaded to Wathbah AI');
          }

          // Determine generation type: 'framework', 'controls', or 'both' (legacy)
          const generationType = config.generationType || 'both';

          // Pick the right system prompt based on generation type
          let systemPrompt;
          if (generationType === 'framework') {
            systemPrompt = getFrameworkExtractorPrompt();
          } else if (generationType === 'controls') {
            systemPrompt = getRefControlsExtractorPrompt();
          } else {
            systemPrompt = getPolicyExtractorPrompt(); // Legacy: both framework + controls
          }

          // Compute slugs for URN generation
          const orgSlug = (config.provider || 'org').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const libSlug = (config.libraryName || row.name || 'policy').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

          // Build the task description based on generation type
          let taskDesc;
          if (generationType === 'framework') {
            taskDesc = 'Extract the document structure into a CISO Assistant framework library (framework + requirement_nodes ONLY, no reference_controls).';
          } else if (generationType === 'controls') {
            taskDesc = 'Extract reusable reference controls (procedures, technical controls, processes) into a CISO Assistant controls library (reference_controls ONLY, no framework).';
          } else {
            taskDesc = 'Extract all policies from the uploaded document(s) into a full CISO Assistant library (framework + requirement_nodes + reference_controls).';
          }

          let userPrompt = `${taskDesc}\n\n`;
          userPrompt += `Use these EXACT values in the output JSON:\n`;
          userPrompt += `- urn: "urn:${orgSlug}:risk:library:${libSlug}"\n`;
          userPrompt += `- locale: "${config.language || 'en'}"\n`;
          userPrompt += `- ref_id: "${libSlug}"\n`;
          userPrompt += `- name: "${config.libraryName}"\n`;
          userPrompt += `- provider: "${config.provider || ''}"\n`;
          userPrompt += `- copyright: "© ${config.provider || 'Organization'} ${new Date().getFullYear()}"\n`;
          userPrompt += `- <org-slug>: "${orgSlug}"\n`;
          userPrompt += `- <lib-slug>: "${libSlug}"\n\n`;
          userPrompt += `Configuration:\n`;
          userPrompt += `- Generation Type: ${generationType}\n`;
          userPrompt += `- Detail Level: ${config.detailLevel}\n`;
          if (config.linkedFrameworkIds && config.linkedFrameworkIds.length > 0) {
            userPrompt += `- Link to Framework IDs: ${config.linkedFrameworkIds.join(', ')}\n`;
          }
          userPrompt += `\nPlease analyze ALL the uploaded documents and extract into the JSON structure specified by your instructions.`;

          // Build parts: file references + text prompt
          const parts = [];
          for (const uf of uploadedFiles) {
            parts.push({ fileData: { fileUri: uf.uri, mimeType: uf.mimeType } });
          }
          parts.push({ text: userPrompt });

          console.log(`[Policy Extraction] Calling Gemini with ${uploadedFiles.length} files + prompt...`);
          const startTime = Date.now();

          const response = await genai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: [{ role: 'user', parts }],
            config: {
              systemInstruction: systemPrompt,
              temperature: 0.2,
              maxOutputTokens: 65536,
            },
          });

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[Policy Extraction] Gemini responded in ${elapsed}s`);

          const textResponse = response.text || '';
          if (!textResponse) throw new Error('No response from Gemini');

          // Parse JSON from response
          let jsonStr = textResponse.trim();
          const jsonMatch = textResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) jsonStr = jsonMatch[1].trim();
          if (!jsonStr.startsWith('{')) {
            const obj = jsonStr.match(/\{[\s\S]*\}/);
            if (obj) jsonStr = obj[0];
          }

          const extractedLibrary = JSON.parse(jsonStr);

          // The AI returns the full library structure (with top-level urn, name, objects, etc.)
          // Extract the objects part for metadata computation
          const libObjects = extractedLibrary.objects || extractedLibrary;
          const refControls = libObjects.reference_controls || [];
          const framework = libObjects.framework || {};
          const reqNodes = framework.requirement_nodes || [];
          const assessableNodes = reqNodes.filter(n => n.assessable);
          const csfFunctions = [...new Set(refControls.map(rc => rc.csf_function).filter(Boolean))];
          const categories = [...new Set(refControls.map(rc => rc.category).filter(Boolean))];

          // Compute confidence from annotations
          let totalConfidence = 0;
          let confCount = 0;
          // For framework mode: parse annotations from assessable nodes
          assessableNodes.forEach(n => {
            try {
              const ann = JSON.parse(n.annotation || '{}');
              if (ann.confidence) { totalConfidence += ann.confidence; confCount++; }
            } catch (e) { /* ignore */ }
          });
          // For controls mode: parse annotations from reference controls
          refControls.forEach(rc => {
            try {
              const ann = JSON.parse(rc.annotation || '{}');
              if (ann.confidence) { totalConfidence += ann.confidence; confCount++; }
            } catch (e) { /* ignore */ }
          });
          const avgConfidence = confCount > 0 ? Math.round((totalConfidence / confCount) * 100) : 85;

          // Build result based on generation type
          const result = {
            id: 'pg-' + crypto.randomUUID(),
            collectionId: collId,
            generationType, // 'framework', 'controls', or 'both'
            libraryName: config.libraryName,
            provider: config.provider,
            language: config.language,
            confidenceScore: avgConfidence,
            generationTime: elapsed + 's',
            sourceFileCount: files.length,
            extractedLibrary,
            linkedFrameworks: config.linkedFrameworkIds || [],
          };

          if (generationType === 'framework') {
            // Framework mode: expose requirement nodes for review
            result.requirementNodes = reqNodes.map((rn, i) => ({
              id: 'rn-' + (i + 1),
              urn: rn.urn || '',
              ref_id: rn.ref_id || '',
              name: rn.name || 'Unnamed Node',
              description: rn.description || '',
              assessable: !!rn.assessable,
              depth: rn.depth || 1,
              parent_urn: rn.parent_urn || null,
            }));
            result.totalNodes = reqNodes.length;
            result.assessableNodes = assessableNodes.length;
            result.policies = []; // No policies in framework mode
          } else if (generationType === 'controls') {
            // Controls mode: expose reference controls for review (displayed as "policies")
            result.policies = refControls.map((rc, i) => ({
              id: 'gp-' + (i + 1),
              code: rc.ref_id || `RC-${i + 1}`,
              name: rc.name || 'Unnamed Control',
              description: rc.description || '',
              category: rc.category || 'policy',
              csfFunction: rc.csf_function || 'govern',
              sourceFile: files.length === 1 ? files[0].name : 'Multiple files',
              sourcePages: '',
              linkedRequirements: [],
              linkedFrameworks: config.linkedFrameworkIds || [],
            }));
            result.csfDistribution = csfFunctions;
            result.categoryDistribution = categories;
          } else {
            // "Both" mode: full library with framework + controls
            result.requirementNodes = reqNodes.map((rn, i) => ({
              id: 'rn-' + (i + 1),
              urn: rn.urn || '',
              ref_id: rn.ref_id || '',
              name: rn.name || 'Unnamed Node',
              description: rn.description || '',
              assessable: !!rn.assessable,
              depth: rn.depth || 1,
              parent_urn: rn.parent_urn || null,
            }));
            result.totalNodes = reqNodes.length;
            result.assessableNodes = assessableNodes.length;
            result.policies = refControls.map((rc, i) => ({
              id: 'gp-' + (i + 1),
              code: rc.ref_id || `RC-${i + 1}`,
              name: rc.name || 'Unnamed Control',
              description: rc.description || '',
              category: rc.category || 'policy',
              csfFunction: rc.csf_function || 'govern',
              sourceFile: files.length === 1 ? files[0].name : 'Multiple files',
              sourcePages: '',
              linkedRequirements: assessableNodes.filter(n => (n.reference_controls || []).includes(rc.urn)).map(n => n.ref_id || n.name).slice(0, 5),
              linkedFrameworks: config.linkedFrameworkIds || [],
            }));
            result.csfDistribution = csfFunctions;
            result.categoryDistribution = categories;
          }

          // Save to DB
          const now3 = new Date().toISOString();
          dbUpdatePolicyCollection.run(row.name, row.description, 'generated', JSON.stringify(config), JSON.stringify(result), now3, collId);

          // Save to generation history
          const historyId = 'gh-' + crypto.randomUUID();
          const historySummary = {
            libraryName: config.libraryName,
            provider: config.provider,
            language: config.language,
            detailLevel: config.detailLevel,
            csfDistribution: csfFunctions,
            categoryDistribution: categories,
          };
          dbInsertGenHistory.run(
            historyId, collId, generationType, 'generated',
            JSON.stringify(config), JSON.stringify(historySummary),
            null, // library_urn (not yet approved)
            refControls.length, reqNodes.length, avgConfidence,
            elapsed + 's', files.length, null,
            JSON.stringify(result), // extraction_data — full generated result
            now3
          );
          result.historyId = historyId;

          console.log(`[Policy Extraction] ✅ [${generationType}] Extracted ${refControls.length} reference controls, ${reqNodes.length} requirement nodes (${assessableNodes.length} assessable)`);

          sendJSON(res, 200, { success: true, data: result });

          // Cleanup: delete uploaded files from Gemini (optional, they expire automatically)
          for (const uf of uploadedFiles) {
            try { await genai.files.delete({ name: uf.name }); } catch (e) { /* ignore */ }
          }

        } catch (extractErr) {
          console.error('[Policy Extraction] Error:', extractErr.message);
          const now3 = new Date().toISOString();
          dbUpdatePolicyCollection.run(row.name, row.description, 'ready', JSON.stringify(config), null, now3, collId);
          // Save failed extraction to history
          try {
            const histErrId = 'gh-' + crypto.randomUUID();
            dbInsertGenHistory.run(
              histErrId, collId, config.generationType || 'both', 'failed',
              JSON.stringify(config), '{}', null, 0, 0, 0, '', files.length,
              extractErr.message, null, now3
            );
          } catch (e) { /* ignore history save error */ }
          sendJSON(res, 500, { error: extractErr.message });
        }
        return;
      }

      // POST /api/policy-collections/:id/approve — Push full library + policies to GRC
      if (collId && subResource === 'approve' && req.method === 'POST') {
        const row = dbGetPolicyCollection.get(collId);
        if (!row) { sendJSON(res, 404, { error: 'Not found' }); return; }
        if (!row.extraction_result) { sendJSON(res, 400, { error: 'No extraction result to approve.' }); return; }

        const body = await parseBody(req);
        const folder = body.folder; // Required for controls/both — GRC folder UUID

        const result = JSON.parse(row.extraction_result);
        const config = JSON.parse(row.config || '{}');
        const generationType = result.generationType || config.generationType || 'both';

        // Folder is optional — used for organizational context only (applied controls are created manually by the user)

        // The AI returns the full library structure including urn, name, objects, etc.
        const extractedLibrary = result.extractedLibrary || {};
        const libObjects = extractedLibrary.objects || extractedLibrary;

        console.log(`[Policy Approve] Generation type: ${generationType}`);

        // ── Build library payload based on generation type ──

        let uploadObjects = {};
        if (generationType === 'framework') {
          // Framework-only: include framework, no reference_controls
          uploadObjects = { framework: libObjects.framework || {} };
        } else if (generationType === 'controls') {
          // Controls-only: include reference_controls, no framework
          // Apply edits from frontend to reference_controls
          const editedPolicies = body.policies && body.policies.length ? body.policies : null;
          const refControls = libObjects.reference_controls || [];
          if (editedPolicies && refControls.length) {
            libObjects.reference_controls = refControls.map(rc => {
              const edited = editedPolicies.find(p =>
                (p.code || p.ref_id) === rc.ref_id || p.name === rc.name
              );
              if (edited) {
                rc.name = edited.name || rc.name;
                rc.description = edited.description || rc.description;
                rc.category = edited.category || rc.category;
                rc.csf_function = edited.csfFunction || edited.csf_function || rc.csf_function;
              }
              return rc;
            });
          }
          uploadObjects = { reference_controls: libObjects.reference_controls || [] };
        } else {
          // "Both" mode: include framework AND reference_controls
          const editedPolicies = body.policies && body.policies.length ? body.policies : null;
          const refControls = libObjects.reference_controls || [];
          if (editedPolicies && refControls.length) {
            libObjects.reference_controls = refControls.map(rc => {
              const edited = editedPolicies.find(p =>
                (p.code || p.ref_id) === rc.ref_id || p.name === rc.name
              );
              if (edited) {
                rc.name = edited.name || rc.name;
                rc.description = edited.description || rc.description;
                rc.category = edited.category || rc.category;
                rc.csf_function = edited.csfFunction || edited.csf_function || rc.csf_function;
              }
              return rc;
            });
          }
          uploadObjects = {};
          if (libObjects.framework) uploadObjects.framework = libObjects.framework;
          if (libObjects.reference_controls && libObjects.reference_controls.length > 0) {
            uploadObjects.reference_controls = libObjects.reference_controls;
          }
        }

        const libraryPayload = {
          urn: extractedLibrary.urn || `urn:${(config.provider || 'org').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}:risk:library:${(config.libraryName || row.name || 'policy').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
          locale: extractedLibrary.locale || config.language || 'en',
          ref_id: extractedLibrary.ref_id || (config.libraryName || row.name || 'policy').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          name: extractedLibrary.name || config.libraryName || row.name,
          description: extractedLibrary.description || row.description || `AI-extracted ${generationType} library from ${result.sourceFileCount || 0} document(s).`,
          copyright: extractedLibrary.copyright || `© ${config.provider || 'Organization'} ${new Date().getFullYear()}`,
          version: extractedLibrary.version || 1,
          provider: extractedLibrary.provider || config.provider || '',
          packager: extractedLibrary.packager || 'wathba',
          objects: uploadObjects,
        };

        const libSlug = libraryPayload.ref_id || 'ai-policy-library';
        const filename = `${libSlug}.yaml`;

        console.log(`[Policy Approve] Step 1: Uploading ${generationType} library "${libraryPayload.name}" (${libraryPayload.urn}) as ${filename}`);

        // ── Step 1: Upload library via the existing YAML upload API ──
        let libraryCreated = false;
        let libraryError = null;
        let storedLibraryData = null;

        try {
          const libBody = Buffer.from(JSON.stringify(libraryPayload, null, 2), 'utf-8');
          const libRes = await grcFetch(`${GRC_API_URL}/api/stored-libraries/upload/`, {
            method: 'POST',
            headers: {
              'Content-Disposition': `attachment; filename=${filename}`,
              'Content-Length': String(libBody.length),
            },
            body: libBody,
          }, reqToken);

          if (libRes.ok) {
            storedLibraryData = await libRes.json();
            libraryCreated = true;
            console.log(`[Policy Approve] ✅ Library uploaded & loaded: ${storedLibraryData.id || storedLibraryData.status}`);
          } else {
            const errText = await libRes.text();
            libraryError = `Library upload failed (${libRes.status}): ${errText}`;
            console.warn(`[Policy Approve] ⚠ Library upload failed: ${libRes.status} ${errText}`);
          }
        } catch (libErr) {
          libraryError = libErr.message;
          console.error(`[Policy Approve] ⚠ Library upload exception: ${libErr.message}`);
        }

        // Reference controls are created automatically when the library is uploaded.
        // Applied controls are added manually by the user in the GRC platform.
        const grcResults = [];
        const grcErrors = [];

        // Verify reference controls were created in GRC after library upload
        if (libraryCreated && storedLibraryData && generationType !== 'framework') {
          try {
            const rcRes = await grcFetch(
              `${GRC_API_URL}/api/reference-controls/?library=${storedLibraryData.loaded_library || ''}&page_size=500`,
              {}, reqToken
            );
            if (rcRes.ok) {
              const rcData = await rcRes.json();
              const rcList = rcData.results || rcData || [];
              console.log(`[Policy Approve] ✅ Verified ${rcList.length} reference controls created in GRC from library upload`);
              rcList.forEach(rc => {
                grcResults.push({ id: rc.id, name: rc.name || rc.ref_id, success: true });
              });
            }
          } catch (e) {
            console.warn(`[Policy Approve] Could not verify reference controls: ${e.message}`);
          }
        }

        // ── Step 3: Save approved state ──
        const now2 = new Date().toISOString();
        result.approved = true;
        result.approvedAt = now2;
        result.libraryCreated = libraryCreated;
        result.libraryUrn = libraryPayload.urn;
        result.libraryError = libraryError;
        result.grcResults = grcResults;
        result.grcErrors = grcErrors;
        dbUpdatePolicyCollection.run(row.name, row.description, 'approved', row.config, JSON.stringify(result), now2, collId);

        // Update the generation history record with approve result
        const historyId = result.historyId;
        if (historyId) {
          const approveStatus = grcErrors.length > 0 ? 'approved_with_errors' : 'approved';
          dbUpdateGenHistoryStatus.run(approveStatus, libraryPayload.urn, grcErrors.length > 0 ? `${grcErrors.length} errors during push` : null, historyId);
        }

        const totalItems = generationType === 'framework'
          ? (libObjects.framework?.requirement_nodes?.length || 0)
          : (uploadObjects.reference_controls?.length || 0);
        console.log(`[Policy Approve] ✅ [${generationType}] Done: library=${libraryCreated ? 'created' : 'failed'}, ${grcResults.length} reference controls verified (${grcErrors.length} errors)`);

        sendJSON(res, 200, {
          success: true,
          data: {
            approved: true,
            generationType,
            libraryCreated,
            libraryUrn: libraryPayload.urn,
            libraryError,
            created: grcResults.length,
            errors: grcErrors.length,
            total: totalItems,
            grcResults,
            grcErrors,
          }
        });
        return;
      }

      // GET /api/policy-collections/:id/history/:historyId — Single history entry with full data
      if (collId && subResource === 'history' && fileId && req.method === 'GET') {
        const r = dbGetGenHistoryById.get(fileId);
        if (!r) { sendJSON(res, 404, { error: 'History entry not found' }); return; }
        sendJSON(res, 200, {
          success: true,
          data: {
            id: r.id,
            collectionId: r.collection_id,
            generationType: r.generation_type,
            status: r.status,
            config: JSON.parse(r.config || '{}'),
            summary: JSON.parse(r.summary || '{}'),
            libraryUrn: r.library_urn,
            controlsCount: r.controls_count,
            nodesCount: r.nodes_count,
            confidenceScore: r.confidence_score,
            generationTime: r.generation_time,
            sourceFileCount: r.source_file_count,
            errorMessage: r.error_message,
            extractionData: r.extraction_data ? JSON.parse(r.extraction_data) : null,
            createdAt: r.created_at,
          },
        });
        return;
      }

      // GET /api/policy-collections/:id/history — List generation history
      if (collId && subResource === 'history' && !fileId && req.method === 'GET') {
        const rows = dbListGenHistory.all(collId);
        const history = rows.map(r => ({
          id: r.id,
          collectionId: r.collection_id,
          generationType: r.generation_type,
          status: r.status,
          config: JSON.parse(r.config || '{}'),
          summary: JSON.parse(r.summary || '{}'),
          libraryUrn: r.library_urn,
          controlsCount: r.controls_count,
          nodesCount: r.nodes_count,
          confidenceScore: r.confidence_score,
          generationTime: r.generation_time,
          sourceFileCount: r.source_file_count,
          errorMessage: r.error_message,
          hasData: !!r.extraction_data,
          createdAt: r.created_at,
        }));
        sendJSON(res, 200, { success: true, data: history });
        return;
      }

      // ── POST /api/policy-collections/chat — Chat with files using Gemini 2.5 Pro + File Search grounding ──
      // Also handles: POST /api/policy-collections/:collectionId/chat
      if (subResource === 'chat' && req.method === 'POST') {
        if (!apiKey) {
          sendJSON(res, 401, { error: 'Gemini API key not configured.' });
          return;
        }

        const body = await parseBody(req);
        const userMessage = (body.message || '').trim();
        if (!userMessage) {
          sendJSON(res, 400, { error: 'message is required.' });
          return;
        }

        // Collect File Search Store IDs — from body or from the collection's storeId
        let storeIds = body.storeIds || [];
        if (typeof storeIds === 'string') storeIds = [storeIds];

        // If called as /api/policy-collections/:id/chat, auto-include that collection's store
        if (collId && collId !== 'chat') {
          const coll = dbGetPolicyCollection.get(collId);
          if (coll && coll.store_id && !storeIds.includes(coll.store_id)) {
            storeIds.unshift(coll.store_id);
          }
        }

        // Session management — allow multi-turn conversations
        let sessionId = body.sessionId || null;
        const systemInstruction = body.systemInstruction || 'You are Wathbah AI, a helpful assistant specialized in governance, risk, compliance (GRC), and organizational policy analysis. Answer questions based on the provided documents. Be precise, cite specific sections when possible, and format your responses clearly.';

        // Build File Search grounding tool (SDK Tool_2.FileSearch format)
        const tools = [];
        if (storeIds.length > 0) {
          const fileSearchStoreNames = storeIds.map(id =>
            id.startsWith('fileSearchStores/') ? id : `fileSearchStores/${id}`
          );
          tools.push({ type: 'file_search', file_search_store_names: fileSearchStoreNames });
          console.log(`[Chat] Using File Search Stores:`, fileSearchStoreNames);
        }

        try {
          // Ensure Gemini SDK is initialized
          if (!genai) genai = new GoogleGenAI({ apiKey });

          // Reuse or create chat session
          if (!sessionId || !policyChats[sessionId]) {
            sessionId = 'pchat-' + crypto.randomUUID();
            console.log(`[Chat] Creating new session ${sessionId} with ${storeIds.length} store(s)`);

            const chatConfig = {
              systemInstruction,
              temperature: 0.7,
              maxOutputTokens: 8192,
            };

            if (tools.length > 0) {
              chatConfig.tools = tools;
            }

            policyChats[sessionId] = {
              chat: genai.chats.create({
                model: 'gemini-2.5-pro',
                config: chatConfig,
              }),
              storeIds,
              history: [],
              createdAt: new Date().toISOString(),
            };
          }

          const session = policyChats[sessionId];
          console.log(`[Chat] Session ${sessionId} — user: "${userMessage.substring(0, 80)}..."`);

          // Send message via SDK chat (multi-turn)
          const result = await session.chat.sendMessage({ message: userMessage });

          // Extract text response
          const aiText = result.text || '';

          // Extract grounding metadata if present
          const groundingMetadata = result.candidates?.[0]?.groundingMetadata || null;
          const groundingChunks = groundingMetadata?.groundingChunks || [];
          const sources = groundingChunks.map(chunk => ({
            title: chunk.retrievedContext?.title || null,
            uri: chunk.retrievedContext?.uri || null,
          })).filter(s => s.title || s.uri);

          // Track history
          session.history.push(
            { role: 'user', text: userMessage, timestamp: new Date().toISOString() },
            { role: 'model', text: aiText, sources, timestamp: new Date().toISOString() }
          );

          sendJSON(res, 200, {
            success: true,
            sessionId,
            message: aiText,
            sources,
            turnCount: Math.floor(session.history.length / 2),
          });

        } catch (chatErr) {
          console.error(`[Chat] Error in session ${sessionId}:`, chatErr.message);
          sendJSON(res, 500, { error: chatErr.message });
        }
        return;
      }

      // Fallback
      sendJSON(res, 405, { error: 'Method not allowed' });

    } catch (error) {
      console.error('Policy Collections API Error:', error.message);
      sendJSON(res, 500, { error: error.message });
    }
    return;
  }

  // ---- Collections API ----
  const collectionsMatch = url.pathname.match(/^\/api\/collections(?:\/([^\/]+))?(?:\/(files)(?:\/([^\/]+))?)?$/);
  if (collectionsMatch) {
    const storeId = collectionsMatch[1];
    const isFiles = collectionsMatch[2] === 'files';
    const fileId = collectionsMatch[3]; // optional file ID for single-file ops
    const apiKey = GEMINI_API_KEY || req.headers['x-api-key'];

    if (!apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API key not configured.' }));
      return;
    }

    try {
      // POST /api/collections — Create a new file search store
      if (!storeId && req.method === 'POST') {
        const body = await parseBody(req);
        const displayName = body.displayName || 'Untitled Collection';
        console.log(`Creating file search store: "${displayName}"`);
        
        const store = await createFileSearchStore(displayName, apiKey);
        console.log('Store created:', store);
        
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: store }));
        return;
      }

      // GET /api/collections — List all file search stores
      if (!storeId && req.method === 'GET') {
        console.log('Listing file search stores...');
        const stores = await listFileSearchStores(apiKey);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: stores }));
        return;
      }

      // DELETE /api/collections/:id — Delete a file search store
      if (storeId && !isFiles && req.method === 'DELETE') {
        const storeName = `fileSearchStores/${storeId}`;
        console.log(`Deleting store: ${storeName}`);
        
        await deleteFileSearchStore(storeName, apiKey);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // POST /api/collections/:id/files — Upload file to a store
      if (storeId && isFiles && req.method === 'POST') {
        const body = await parseBody(req);
        const { fileName, mimeType, data } = body;

        if (!fileName || !data) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'fileName and data (base64) are required.' }));
          return;
        }

        const storeName = `fileSearchStores/${storeId}`;
        console.log(`Uploading file "${fileName}" to store ${storeName}`);

        // Upload directly to the file search store (resumable protocol)
        const fileBuffer = Buffer.from(data, 'base64');
        const result = await uploadFileToStore(
          storeName,
          fileName,
          mimeType || 'application/octet-stream',
          fileBuffer,
          apiKey
        );
        console.log('Upload + index result:', JSON.stringify(result).slice(0, 200));

        // Poll the operation if it's a long-running operation
        let finalResult = result;
        if (result.name && !result.done) {
          console.log('Polling upload operation...');
          finalResult = await pollOperation(result.name, apiKey);
          console.log('Upload complete:', finalResult.done);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          data: finalResult
        }));
        return;
      }

      // GET /api/collections/:id/files — List files in a store
      if (storeId && isFiles && req.method === 'GET') {
        const storeName = `fileSearchStores/${storeId}`;
        console.log(`Listing documents in ${storeName}`);
        
        const docs = await listStoreDocuments(storeName, apiKey);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: docs }));
        return;
      }

      // DELETE /api/collections/:id/files/:fileId — Delete a single file
      if (storeId && isFiles && fileId && req.method === 'DELETE') {
        const documentName = `fileSearchStores/${storeId}/documents/${fileId}`;
        console.log(`Deleting document: ${documentName}`);
        
        await deleteDocument(documentName, apiKey);

      res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // Fallback — method not allowed
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));

    } catch (error) {
      console.error('Collections API Error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- Client-side routes (serve admin.html for SPA pages) ----
  const SPA_PREFIXES = ['/', '/dashboard', '/audit-sessions', '/audit-studio', '/controls-studio', '/merge-optimizer', '/policy-ingestion', '/org-contexts', '/prompts', '/file-collections'];
  const isSpaRoute = SPA_PREFIXES.some(p => url.pathname === p || (p !== '/' && url.pathname.startsWith(p + '/')));
  if (isSpaRoute) {
    serveStaticFile(res, path.join(__dirname, 'admin.html'));
    return;
  }

  // ---- Static Files ----
  let filePath = path.join(__dirname, url.pathname);
  serveStaticFile(res, filePath);
});

server.listen(PORT, () => {
  const apiKeyStatus = GEMINI_API_KEY ? '✅ Configured' : '❌ Not configured';
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 Wathbah Auditor Assistant                            ║
║                                                           ║
║   Server running at: http://localhost:${PORT}               ║
║                                                           ║
║   Gemini API Key: ${apiKeyStatus.padEnd(36)}║
║                                                           ║
║   Endpoints:                                              ║
║   • GET  /                        - Serve the app         ║
║   • POST /api/analyze             - Analyze requirements  ║
║   • GET  /api/collections         - List collections      ║
║   • POST /api/collections         - Create collection     ║
║   • DELETE /api/collections/:id   - Delete collection     ║
║   • GET  /api/collections/:id/files - List files          ║
║   • POST /api/collections/:id/files - Upload file         ║
║   • DELETE /api/collections/:id/files/:fid - Delete file  ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
