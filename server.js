const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 6060;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
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

// Load the prompt template
const promptTemplatePath = path.join(__dirname, 'prompts', 'requirement-analyzer.txt');
let promptTemplate = '';

try {
  promptTemplate = fs.readFileSync(promptTemplatePath, 'utf-8');
} catch (error) {
  console.error('Error loading prompt template:', error.message);
  process.exit(1);
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
async function callGeminiAPIForSingle(requirement, userPrompt, apiKey) {
  const fullPrompt = promptTemplate
    .replace('{{REQUIREMENT}}', JSON.stringify(requirement, null, 2))
    .replace('{{USER_PROMPT}}', userPrompt || 'No additional context provided.');

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
async function callGeminiAPIForMultiple(requirements, userPrompt, apiKey) {
  console.log(`Processing ${requirements.length} requirements...`);
  
  const CONCURRENCY_LIMIT = 3;
  const results = [];
  
  for (let i = 0; i < requirements.length; i += CONCURRENCY_LIMIT) {
    const batch = requirements.slice(i, i + CONCURRENCY_LIMIT);
    const batchPromises = batch.map(async (requirement, batchIndex) => {
      const index = i + batchIndex;
      console.log(`Analyzing requirement ${index + 1}/${requirements.length}: ${requirement.refId || 'No ref'}`);
      
      try {
        const analysis = await callGeminiAPIForSingle(requirement, userPrompt, apiKey);
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

// Upload file to Gemini Files API (step 1 of 2)
async function uploadFileToGemini(fileName, mimeType, fileBuffer, apiKey) {
  const boundary = `===boundary_${Date.now()}_${Math.random().toString(36).slice(2)}===`;
  const metadata = JSON.stringify({ file: { displayName: fileName } });

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const res = await fetch(`${GEMINI_UPLOAD_URL}/files?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`File upload failed (${res.status}): ${err}`);
  }
  return res.json();
}

// Import file into a file search store (step 2 of 2)
async function importFileToStore(storeName, fileName, apiKey) {
  const res = await fetch(`${GEMINI_BASE_URL}/${storeName}:importFile?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Import file failed (${res.status}): ${err}`);
  }
  return res.json();
}

// List documents in a file search store
async function listStoreDocuments(storeName, apiKey) {
  const res = await fetch(`${GEMINI_BASE_URL}/${storeName}/fileSearchDocuments?key=${apiKey}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`List documents failed (${res.status}): ${err}`);
  }
  return res.json();
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ---- Analyze API ----
  if (url.pathname === '/api/analyze' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      console.log('Received analysis request');
      
      const { requirement, requirements, prompt } = body;
      
      const apiKey = GEMINI_API_KEY || req.headers['x-api-key'];

      if (!apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API key not configured. Add GEMINI_API_KEY to .env file.' }));
        return;
      }

      if (requirements && Array.isArray(requirements) && requirements.length > 0) {
        console.log(`Batch analysis for ${requirements.length} requirements`);
        const result = await callGeminiAPIForMultiple(requirements, prompt, apiKey);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: result }));
        return;
      }
      
      if (!requirement) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Requirement(s) required.' }));
        return;
      }

      const result = await callGeminiAPIForSingle(requirement, prompt, apiKey);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (error) {
      console.error('Analyze API Error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ---- Collections API ----
  const collectionsMatch = url.pathname.match(/^\/api\/collections(?:\/([^\/]+))?(?:\/(files))?$/);
  if (collectionsMatch) {
    const storeId = collectionsMatch[1];
    const isFiles = collectionsMatch[2] === 'files';
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

        console.log(`Uploading file "${fileName}" to store fileSearchStores/${storeId}`);

        // Step 1: Upload to Gemini Files API
        const fileBuffer = Buffer.from(data, 'base64');
        const fileResult = await uploadFileToGemini(
          fileName,
          mimeType || 'application/octet-stream',
          fileBuffer,
          apiKey
        );
        console.log('File uploaded to Files API:', fileResult.file?.name);

        // Step 2: Import into the file search store
        const storeName = `fileSearchStores/${storeId}`;
        const importResult = await importFileToStore(storeName, fileResult.file.name, apiKey);
        console.log('Import started:', importResult.name || 'immediate');

        // Step 3: Poll operation if it's async
        let finalResult = importResult;
        if (importResult.name && !importResult.done) {
          console.log('Polling import operation...');
          finalResult = await pollOperation(importResult.name, apiKey);
          console.log('Import complete:', finalResult.done);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          data: {
            file: fileResult.file,
            import: finalResult
          }
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
  let filePath = path.join(__dirname, url.pathname === '/' ? 'index.html' : url.pathname);
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
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
