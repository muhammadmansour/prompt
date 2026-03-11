const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GoogleGenAI } = require('@google/genai');
const Database = require('better-sqlite3');

const PORT = 5555;
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
// Authentication
// ==========================================

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@wathbahs.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin@admin';
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

// Active tokens (in-memory; survives until server restart)
const authTokens = new Set();

function generateToken() {
  const token = crypto.randomBytes(48).toString('hex');
  authTokens.add(token);
  return token;
}

function isValidToken(token) {
  return token && authTokens.has(token);
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
`);

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
  INSERT INTO org_contexts (id, name_en, name_ar, sector, sector_custom, size, compliance_maturity, regulatory_mandates, governance_structure, data_classification, geographic_scope, it_infrastructure, strategic_objectives, obligatory_frameworks, notes, is_active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const dbUpdateOrgContext = db.prepare(`
  UPDATE org_contexts SET name_en = ?, name_ar = ?, sector = ?, sector_custom = ?, size = ?, compliance_maturity = ?, regulatory_mandates = ?, governance_structure = ?, data_classification = ?, geographic_scope = ?, it_infrastructure = ?, strategic_objectives = ?, obligatory_frameworks = ?, notes = ?, is_active = ?, updated_at = ? WHERE id = ?
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

// Gemini SDK client + in-memory chat sessions (SDK ChatSession objects)
let genai = null;
const chatSessions = {};  // sessionId -> { chat: SDK ChatSession, systemPrompt: string }

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

  // ---- Auth: Login endpoint (public) ----
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const { email, password } = body;
      if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
        const token = generateToken();
        console.log('Admin login successful:', email);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, token }));
      } else {
        console.log('Login failed for:', email);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid email or password' }));
      }
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
    return;
  }

  // ---- Auth: Logout endpoint ----
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    const token = getTokenFromRequest(req);
    if (token) authTokens.delete(token);
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
      // For page requests, redirect to login
      if (url.pathname === '/' || url.pathname.endsWith('.html')) {
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
      const grcRes = await fetch(`${GRC_API_URL}/api/frameworks/`);
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
      const grcRes = await fetch(`${GRC_API_URL}/api/frameworks/${fwId}/tree/`);
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
      const grcRes = await fetch(`${GRC_API_URL}/api/compliance-assessments/${caId}/tree/`);
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
      const grcRes = await fetch(`${GRC_API_URL}/api/requirement-nodes/${qs}`);
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
      const grcRes = await fetch(`${GRC_API_URL}/api/compliance-assessments/`);
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

  // ---- GRC Platform Proxy: Get folders ----
  if (url.pathname === '/api/grc/folders' && req.method === 'GET') {
    try {
      const grcRes = await fetch(`${GRC_API_URL}/api/folders/`);
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
      const grcRes = await fetch(`${GRC_API_URL}/api/requirement-assessments/${qs}`);
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
      const grcRes = await fetch(`${GRC_API_URL}/api/requirement-assessments/${raId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
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
        const listRes = await fetch(`${GRC_API_URL}/api/applied-controls/?page_size=1000`);
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

          const grcRes = await fetch(`${GRC_API_URL}/api/applied-controls/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(grcBody)
          });

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
          const caRes = await fetch(`${GRC_API_URL}/api/compliance-assessments/`);
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
              const raRes = await fetch(raUrl);
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

                const patchRes = await fetch(`${GRC_API_URL}/api/requirement-assessments/${raId}/`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ applied_controls: merged })
                });

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

  // ---- Static Files ----
  let filePath = path.join(__dirname, url.pathname === '/' ? 'admin.html' : url.pathname);
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
