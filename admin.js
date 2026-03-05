/* ============================
   WathbaGRC Admin Panel JS
   ============================ */

// ─── Auth Guard ──────────────────────────────────────────────
(function checkAuth() {
  const hasCookie = document.cookie.split(';').some(c => c.trim().startsWith('wathba_token='));
  if (!hasCookie) {
    window.location.replace('/login.html');
  }
})();

async function adminLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) { /* ignore */ }
  document.cookie = 'wathba_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  window.location.replace('/login.html');
}
window.adminLogout = adminLogout;

const API = {
  sessions: '/api/chat/sessions',
  collections: '/api/collections',
  localPrompts: '/api/local-prompts',
  prompts: 'https://muraji-api.wathbahs.com/api/prompts',
  libraries: 'https://muraji-api.wathbahs.com/api/libraries',
  orgContexts: '/api/org-contexts',
  csSessions: '/api/cs-sessions',
  controlsGenerate: '/api/controls/generate',
};

// ─── State ────────────────────────────────────────────────────
let sessions = [];
let collections = [];
let collectionFiles = {};  // storeId -> files[]
let orgContexts = [];      // placeholder for org contexts data
let frameworks = [];       // libraries/frameworks from API
let csSessions = null;     // Controls Studio sessions (cached)
let csMode = 'sessions';   // 'sessions' | 'wizard'
let csCurrentStep = 0;
let csSessionData = null;
let csLibraries = [];          // fetched frameworks for controls studio
let csCollectionsData = [];    // fetched collections with files for controls studio
let csPendingPoll = null;

// ─── DOM refs ─────────────────────────────────────────────────
const headerTitle = document.getElementById('admin-header-title'); // may be null in new layout
const toastContainer = document.getElementById('toast-container');

// ─── Navigation ───────────────────────────────────────────────

function navigateTo(page) {
  // Update sidebar
  document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
  const target = document.querySelector(`.sidebar-item[data-page="${page}"]`);
  if (target) target.classList.add('active');

  // Update pages
  document.querySelectorAll('.admin-page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');

  // Update header
  const names = {
    'dashboard': 'Dashboard',
    'audit-sessions': 'Audit Sessions',
    'audit-studio': 'Audit Studio',
    'controls-studio': 'Applied Controls Studio',
    'merge-optimizer': 'Control Merge Optimizer',
    'org-contexts': 'Organization Contexts',
    'prompts': 'Prompts',
    'file-collections': 'File Collections',
  };
  if (headerTitle) headerTitle.textContent = names[page] || page;

  // Load data for the page
  if (page === 'dashboard') loadDashboard();
  if (page === 'audit-sessions') loadSessions();
  if (page === 'audit-studio') loadAuditStudio();
  if (page === 'file-collections') loadCollections();
  if (page === 'org-contexts') loadOrgContexts();
  if (page === 'prompts') loadPrompts();
  if (page === 'controls-studio') loadControlsStudio();
  if (page === 'merge-optimizer') loadMergeOptimizer();
}
window.navigateTo = navigateTo;

// Sidebar nav click handlers
document.querySelectorAll('.sidebar-item[data-page]').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.page));
});

// Sidebar section toggles
document.querySelectorAll('.sidebar-section-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const sec = document.getElementById('section-' + btn.dataset.section);
    if (sec) sec.classList.toggle('open');
    btn.classList.toggle('collapsed');
  });
});

// ─── Toast ────────────────────────────────────────────────────

function toast(type, title, msg, dur) {
  dur = dur || 4000;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const ic = {
    success: '<path d="M9 12L11 14L15 10M21 12C21 16.97 16.97 21 12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    error: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 8V12M12 16V16.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    info: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 16V12M12 8V8.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  };
  el.innerHTML = '<div class="toast-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none">' + (ic[type] || ic.info) + '</svg></div><div class="toast-content"><div class="toast-title">' + esc(title) + '</div><div class="toast-message">' + esc(msg) + '</div></div><button class="toast-close"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>';
  el.querySelector('.toast-close').addEventListener('click', () => { el.classList.add('removing'); setTimeout(() => el.remove(), 300); });
  toastContainer.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { if (el.parentNode) { el.classList.add('removing'); setTimeout(() => el.remove(), 300); } }, dur);
}

// ─── Helpers ──────────────────────────────────────────────────

function esc(t) { if (!t) return ''; const d = document.createElement('div'); d.textContent = String(t); return d.innerHTML; }

function fmtDate(s) {
  try {
    const d = new Date(s), now = new Date(), ms = now - d;
    const m = Math.floor(ms / 60000), h = Math.floor(ms / 3600000), dy = Math.floor(ms / 86400000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    if (h < 24) return h + 'h ago';
    if (dy < 7) return dy + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return s || '—'; }
}

function fmtDateShort(s) {
  try { return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return s || '—'; }
}

function parseContext(raw) {
  try { return typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); } catch { return {}; }
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// ─── Data Fetching ────────────────────────────────────────────

async function fetchSessions() {
  try {
    const d = await fetchJSON(API.sessions);
    sessions = d.sessions || [];
  } catch (e) { console.error('Sessions fetch error:', e); sessions = []; }
}

async function fetchCollections() {
  try {
    const d = await fetchJSON(API.collections);
    collections = d.data || [];
  } catch (e) { console.error('Collections fetch error:', e); collections = []; }
}

async function fetchCollectionFiles(storeId) {
  try {
    const d = await fetchJSON(API.collections + '/' + storeId + '/files');
    const docs = d.data?.documents || d.data?.fileSearchDocuments || [];
    collectionFiles[storeId] = docs;
    return docs;
  } catch (e) { console.error('Files fetch error:', e); collectionFiles[storeId] = []; return []; }
}

async function fetchFrameworks() {
  try {
    const d = await fetchJSON(API.libraries);
    frameworks = Array.isArray(d) ? d : (d.data || d.libraries || []);
  } catch (e) { console.error('Frameworks fetch error:', e); frameworks = []; }
}

async function fetchCsSessions() {
  try {
    const d = await fetchJSON(API.csSessions);
    csSessions = d.sessions || [];
  } catch (e) { console.error('CS sessions fetch error:', e); csSessions = []; }
}

async function fetchPromptCounts() {
  let localCount = 0, apiCount = 0;
  try {
    const d = await fetchJSON(API.localPrompts);
    localCount = (d.prompts || []).length;
  } catch (e) {}
  try {
    const d = await fetchJSON(API.prompts);
    const all = Array.isArray(d) ? d : (d.data || d.prompts || []);
    apiCount = all.length;
  } catch (e) {}
  return localCount + apiCount;
}

// ─── Dashboard ────────────────────────────────────────────────

async function loadDashboard() {
  console.log('[admin.js] loadDashboard started');
  try {
    const promptCountPromise = fetchPromptCounts();
    await Promise.all([fetchSessions(), fetchCollections(), fetchFrameworks(), fetchCsSessions()]);
    const promptCount = await promptCountPromise;
    console.log('[admin.js] Data fetched:', { sessions: sessions.length, collections: collections.length, frameworks: frameworks.length, csSessions: (csSessions||[]).length, promptCount });
    renderDashStats(promptCount);
    renderDashSessions();
    renderDashStudioSessions();
    renderDashFrameworks();
    console.log('[admin.js] Dashboard rendered');
  } catch (e) {
    console.error('[admin.js] loadDashboard error:', e);
    // Still try to render what we can
    try { renderDashStats(0); } catch (e2) { console.error('renderDashStats error:', e2); }
    try { renderDashSessions(); } catch (e2) { console.error('renderDashSessions error:', e2); }
    try { renderDashStudioSessions(); } catch (e2) { console.error('renderDashStudioSessions error:', e2); }
    try { renderDashFrameworks(); } catch (e2) { console.error('renderDashFrameworks error:', e2); }
  }
}

function renderDashStats(promptCount) {
  const el = document.getElementById('dash-stats');
  if (!el) { console.error('dash-stats element not found'); return; }
  const totalSessions = sessions.length;
  const totalCollections = collections.length;
  const totalFrameworks = frameworks.length;
  const totalFiles = collections.reduce((a, c) => a + (c.file_counts?.active || c.fileCount || 0), 0);
  promptCount = promptCount || 0;

  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-primary"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 4H16L18 6V16C18 16.6 17.6 17 17 17H3C2.4 17 2 16.6 2 16V5C2 4.4 2.4 4 3 4Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10H13M7 13H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
      <div class="stat-card-value">${totalSessions}</div>
      <div class="stat-card-label">Audit Sessions</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-emerald"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 4H17M3 8H12M3 12H15M3 16H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
      <div class="stat-card-value">${promptCount}</div>
      <div class="stat-card-label">Prompts</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-amber"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 7V15C3 15.6 3.4 16 4 16H16C16.6 16 17 15.6 17 15V9C17 8.4 16.6 8 16 8H10L8.5 6H4C3.4 6 3 6.4 3 7Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div class="stat-card-value">${totalCollections}</div>
      <div class="stat-card-label">File Collections</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-violet"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 4H16V16H4V4Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 8H16M4 12H16M8 4V16M12 4V16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
      <div class="stat-card-value">${totalFrameworks}</div>
      <div class="stat-card-label">Frameworks Loaded</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-rose"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M14 2V18M6 6V14C6 16.2 7.8 18 10 18H14M6 6L4 8M6 6L8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div class="stat-card-value">${(csSessions || []).length}</div>
      <div class="stat-card-label">Merge Suggestions</div>
    </div>`;
}

function renderDashSessions() {
  const list = document.getElementById('dash-sessions-list');
  const footer = document.getElementById('dash-sessions-footer');
  if (!list || !footer) return;
  const recent = sessions.slice(0, 5);

  if (!recent.length) {
    list.innerHTML = '<div style="padding:32px 20px;text-align:center;color:#9ca3af;font-size:13px">No sessions yet. Go to <a href="javascript:navigateTo(\'audit-studio\')" style="color:var(--admin-primary)">Audit Studio</a> to start.</div>';
    footer.textContent = '';
    return;
  }

  list.innerHTML = recent.map(s => {
    // Handle both API format (camelCase) and raw DB format (snake_case)
    const id = s.sessionId || s.id;
    const createdAt = s.createdAt || s.created_at;
    const msgCount = s.messageCount || s.message_count || 0;

    // Get framework name from requirements or context
    let fw = 'Unknown';
    let reqCount = 0;
    let fileCount = 0;

    if (s.requirements && s.requirements.length) {
      fw = s.requirements[0].frameworkName || 'Unknown';
      reqCount = s.requirementsCount || s.requirements.length;
    } else if (s.context) {
      const ctx = parseContext(s.context);
      fw = ctx.frameworkName || 'Unknown';
      reqCount = (ctx.selectedRequirements || ctx.requirements || []).length;
      fileCount = (ctx.selectedFiles || []).length + (ctx.contextFiles || []).length;
    }

    fileCount = fileCount || s.filesCount || 0;

    return `
      <div class="dash-session-row" onclick="goToSession('${esc(id)}')">
        <div class="dash-session-info">
          <div class="dash-session-name">${esc(fw)}</div>
          <div class="dash-session-date">${fmtDate(createdAt)}</div>
        </div>
        <div class="dash-session-stats">
          <div class="dash-session-stat"><div class="dash-session-stat-val dash-stat-purple">${reqCount}</div><div class="dash-session-stat-label">Req</div></div>
          <div class="dash-session-stat"><div class="dash-session-stat-val dash-stat-blue">${fileCount}</div><div class="dash-session-stat-label">Files</div></div>
          <div class="dash-session-stat"><div class="dash-session-stat-val dash-stat-amber">${msgCount}</div><div class="dash-session-stat-label">Msgs</div></div>
        </div>
        <svg class="dash-session-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </div>`;
  }).join('');

  const totalMsgs = sessions.reduce((a, s) => a + (s.messageCount || s.message_count || 0), 0);
  const totalFiles = sessions.reduce((a, s) => {
    if (s.filesCount) return a + s.filesCount;
    const ctx = parseContext(s.context);
    return a + (ctx.selectedFiles || []).length + (ctx.contextFiles || []).length;
  }, 0);
  footer.textContent = `${sessions.length} sessions • ${totalMsgs} total messages • ${totalFiles} reference files`;
}

function renderDashStudioSessions() {
  const el = document.getElementById('dash-studio-sessions');
  if (!el) return;
  const list = (csSessions || []).slice(0, 3);

  if (!list.length) {
    el.innerHTML = `<div style="padding:20px;text-align:center;font-size:12px;color:#9ca3af">
      <p>No Controls Studio sessions yet.</p>
      <button class="btn-admin-outline btn-admin-sm" onclick="navigateTo('controls-studio')" style="margin-top:8px">Open Studio</button>
    </div>`;
    return;
  }

  el.innerHTML = list.map(s => {
    const name = s.name || 'Untitled Session';
    const orgCtx = s.orgContext || (s.org_context ? (typeof s.org_context === 'string' ? JSON.parse(s.org_context) : s.org_context) : null);
    const orgName = orgCtx?.nameEn || orgCtx?.name_en || orgCtx?.nameAr || orgCtx?.name_ar || '';
    const status = s.status || 'draft';
    const statusColors = {
      draft: 'color:#9ca3af',
      generating: 'color:#f59e0b',
      generated: 'color:#10b981',
      exported: 'color:#0077cc',
      merged: 'color:#8b5cf6'
    };
    const statusBadges = {
      merged: '<span class="badge badge-purple" style="font-size:9px;margin-right:4px">⅓ merge</span>',
    };
    return `
      <div class="dash-studio-row" onclick="navigateTo('controls-studio')">
        <div class="dash-studio-info">
          <div class="dash-studio-name">${esc(name.length > 28 ? name.substring(0, 28) + '...' : name)}</div>
          ${orgName ? `<div class="dash-studio-org">${esc(orgName)}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:4px">
          ${statusBadges[status] || ''}
          <span class="dash-studio-status" style="${statusColors[status] || ''};font-size:11px;font-weight:500">${status}</span>
        </div>
      </div>`;
  }).join('');
}

function renderDashFrameworks() {
  const el = document.getElementById('dash-frameworks');
  if (!el) return;

  if (!frameworks.length) {
    el.innerHTML = '<div style="padding:16px;text-align:center;font-size:12px;color:#9ca3af">No frameworks loaded.</div>';
    return;
  }

  // Build framework summary: name + requirement count
  const fwList = frameworks.map(lib => {
    const fw = lib.content?.framework;
    if (!fw) return null;
    const name = fw.name || lib.name || 'Unknown';
    const nodes = (fw.requirement_nodes || []).filter(n => n.description);
    return { name, reqCount: nodes.length };
  }).filter(Boolean);

  const MAX_SHOW = 4;
  const visible = fwList.slice(0, MAX_SHOW);
  const remaining = fwList.length - MAX_SHOW;

  let html = '<div class="dash-fw-list">';
  visible.forEach(fw => {
    html += `
      <div class="dash-fw-row">
        <div class="dash-fw-name">${esc(fw.name.length > 28 ? fw.name.substring(0, 28) + '...' : fw.name)}</div>
        <span class="dash-fw-count">${fw.reqCount} req</span>
      </div>`;
  });
  if (remaining > 0) {
    html += `<div class="dash-fw-more">+${remaining} more framework${remaining > 1 ? 's' : ''}</div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

// ─── Audit Sessions Page ──────────────────────────────────────

async function loadSessions() {
  await fetchSessions();
  renderSessionsList();
}

function renderSessionsList(query) {
  const el = document.getElementById('sessions-list-full');
  if (!el) return;
  let list = sessions;
  if (query) {
    list = sessions.filter(s => {
      const fw = (s.requirements && s.requirements[0]?.frameworkName) || '';
      const q = s.query || '';
      const text = fw + ' ' + q;
      return text.toLowerCase().includes(query);
    });
  }

  if (!list.length) {
    el.innerHTML = '<div style="padding:32px 20px;text-align:center;color:#9ca3af;font-size:13px">No sessions found.</div>';
    return;
  }

  el.innerHTML = list.map(s => {
    const id = s.sessionId || s.id;
    const createdAt = s.createdAt || s.created_at;
    const msgCount = s.messageCount || s.message_count || 0;
    const fw = (s.requirements && s.requirements[0]?.frameworkName) || 'Unknown';
    const reqCount = s.requirementsCount || (s.requirements || []).length;
    const fileCount = s.filesCount || 0;
    const queryPreview = (s.query || '').substring(0, 80);
    return `
      <div class="session-row" onclick="goToSession('${esc(id)}')">
        <div>
          <div class="session-row-name">${esc(fw)}</div>
          <div class="session-row-query">${esc(queryPreview)}</div>
        </div>
        <div class="session-row-stat">${reqCount}</div>
        <div class="session-row-stat">${fileCount}</div>
        <div class="session-row-stat">${msgCount}</div>
        <div class="session-row-date">${fmtDateShort(createdAt)}</div>
        <div class="col-action">
          <button class="btn-admin-ghost btn-admin-sm" onclick="event.stopPropagation();deleteSession('${esc(id)}')" title="Delete">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');
}

// Session search
const sessionsSearch = document.getElementById('sessions-search');
if (sessionsSearch) {
  sessionsSearch.addEventListener('input', e => renderSessionsList(e.target.value.toLowerCase().trim() || undefined));
}

function goToSession(id) {
  // Find session and set context in sessionStorage, then redirect to chat page
  const s = sessions.find(x => (x.sessionId || x.id) === id);
  if (s) {
    sessionStorage.setItem('chatSessionId', s.sessionId || s.id);
    window.location.href = 'chat.html';
  }
}
window.goToSession = goToSession;

async function deleteSession(id) {
  if (!confirm('Delete this session?')) return;
  try {
    const r = await fetch(API.sessions + '/' + id, { method: 'DELETE' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    toast('success', 'Deleted', 'Session deleted.');
    sessions = sessions.filter(s => (s.sessionId || s.id) !== id);
    renderSessionsList();
  } catch (e) { toast('error', 'Error', e.message); }
}
window.deleteSession = deleteSession;

// ─── File Collections Page ────────────────────────────────────

async function loadCollections() {
  await fetchCollections();
  renderFCStats();
  renderFCCollections();
}

function renderFCStats() {
  const el = document.getElementById('fc-stats');
  const total = collections.length;
  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-primary"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 7V15C3 15.6 3.4 16 4 16H16C16.6 16 17 15.6 17 15V9C17 8.4 16.6 8 16 8H10L8.5 6H4C3.4 6 3 6.4 3 7Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div class="stat-card-value">${total}</div>
      <div class="stat-card-label">Total Collections</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-emerald"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 4H12L16 8V16C16 16.6 15.6 17 15 17H4C3.4 17 3 16.6 3 16V5C3 4.4 3.4 4 4 4Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 4V8H16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
      <div class="stat-card-value" id="fc-total-files">—</div>
      <div class="stat-card-label">Total Files</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-amber"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M7 10L9 12L13 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div class="stat-card-value" id="fc-active-files">—</div>
      <div class="stat-card-label">Active Files</div>
    </div>`;
}

function renderFCCollections() {
  const el = document.getElementById('fc-collections-list');
  if (!collections.length) {
    el.innerHTML = '<div class="admin-card empty-state-box"><h3>No collections</h3><p>File collections will appear here once created from the Auditor page.</p></div>';
    return;
  }

  let totalFiles = 0, totalActive = 0;

  el.innerHTML = collections.map(c => {
    const name = c.displayName || c.name || 'Untitled';
    const id = (c.name || '').replace('fileSearchStores/', '');
    return `
      <div class="fc-collection-card" data-store-id="${esc(id)}">
        <div class="fc-collection-inner" onclick="toggleFCExpand('${esc(id)}')">
          <div class="fc-collection-left">
            <div class="fc-collection-icon">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M3 7V15C3 15.6 3.4 16 4 16H16C16.6 16 17 15.6 17 15V9C17 8.4 16.6 8 16 8H10L8.5 6H4C3.4 6 3 6.4 3 7Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div>
              <div class="fc-collection-name">${esc(name)}</div>
              <div class="fc-collection-id">${esc(id)}</div>
            </div>
          </div>
          <div class="fc-collection-right">
            <span class="badge badge-gray" id="fc-badge-${esc(id)}">Loading…</span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 5L6 7L8 5" stroke="#9ca3af" stroke-width="1.5" stroke-linecap="round"/></svg>
          </div>
        </div>
        <div class="fc-files-body" id="fc-files-${esc(id)}" style="display:none"></div>
      </div>`;
  }).join('');

  // Load file counts for each collection
  collections.forEach(async c => {
    const id = (c.name || '').replace('fileSearchStores/', '');
    const files = await fetchCollectionFiles(id);
    const badge = document.getElementById('fc-badge-' + id);
    const active = files.filter(f => f.state === 'STATE_ACTIVE').length;
    if (badge) badge.textContent = files.length + ' file' + (files.length !== 1 ? 's' : '');

    totalFiles += files.length;
    totalActive += active;

    const tfEl = document.getElementById('fc-total-files');
    const afEl = document.getElementById('fc-active-files');
    if (tfEl) tfEl.textContent = totalFiles;
    if (afEl) afEl.textContent = totalActive;
  });
}

function toggleFCExpand(storeId) {
  const body = document.getElementById('fc-files-' + storeId);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) renderFCFiles(storeId);
}
window.toggleFCExpand = toggleFCExpand;

function renderFCFiles(storeId) {
  const body = document.getElementById('fc-files-' + storeId);
  const files = collectionFiles[storeId] || [];
  if (!files.length) {
    body.innerHTML = '<div style="padding:16px;text-align:center;font-size:12px;color:#9ca3af">No files in this collection.</div>';
    return;
  }

  body.innerHTML = '<div style="padding:8px 16px">' + files.map(f => {
    const name = f.displayName || f.name || 'Unknown';
    const state = f.state || 'UNKNOWN';
    const stateClass = state === 'STATE_ACTIVE' ? 'badge-emerald' : (state === 'STATE_PENDING' ? 'badge-amber' : 'badge-red');
    const stateLabel = state.replace('STATE_', '');
    return `
      <div class="org-ctx-doc">
        <div class="org-ctx-doc-name">${esc(name)}</div>
        <span class="badge ${stateClass}">${stateLabel}</span>
      </div>`;
  }).join('') + '</div>';
}

// ─── Organization Contexts Page ───────────────────────────────

async function loadOrgContexts() {
  try {
    const d = await fetchJSON(API.orgContexts);
    orgContexts = d.contexts || [];
  } catch (e) { console.error('Org contexts fetch error:', e); orgContexts = []; }
  // Ensure frameworks are loaded for mandate checkboxes
  if (!frameworks || !frameworks.length) await fetchFrameworks();
  renderOrgStats();
  renderOrgContextsList();
}

function renderOrgStats() {
  const el = document.getElementById('org-stats');
  if (!el) return;
  const totalDocs = orgContexts.reduce((a, c) => a + (c.documents || []).length, 0);
  const fullCoverage = orgContexts.filter(c => (c.obligatoryFrameworks || []).length >= 2).length;
  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-primary"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5V15C3 15.6 3.4 16 4 16H16C16.6 16 17 15.6 17 15V8C17 7.4 16.6 7 16 7H10.5L9 5H4C3.4 5 3 5.4 3 6Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
      <div class="stat-card-value">${orgContexts.length}</div>
      <div class="stat-card-label">Total Contexts</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-emerald"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 4H12L16 8V16C16 16.6 15.6 17 15 17H4C3.4 17 3 16.6 3 16V5C3 4.4 3.4 4 4 4Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
      <div class="stat-card-value">${totalDocs}</div>
      <div class="stat-card-label">Total Documents</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-amber"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M7 10L9 12L13 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div class="stat-card-value">${fullCoverage}</div>
      <div class="stat-card-label">Full Regulatory Coverage</div>
    </div>`;
}

function renderOrgContextsList(query) {
  const el = document.getElementById('org-contexts-list');
  let list = orgContexts;
  if (query) {
    list = orgContexts.filter((ctx, i) => {
      const text = (ctx.nameEn || ctx.name || '') + ' ' + (ctx.nameAr || '') + ' ' + (ctx.sector || '') + ' ' + (ctx.obligatoryFrameworks || []).join(' ');
      return text.toLowerCase().includes(query);
    });
  }

  if (!list.length && !orgContexts.length) {
    el.innerHTML = `
      <div class="admin-card empty-state-box">
        <div class="empty-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M4 8V24C4 25.1 4.9 26 6 26H26C27.1 26 28 25.1 28 24V12C28 10.9 27.1 10 26 10H17L14.5 7H6C4.9 7 4 7.9 4 9Z" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/></svg></div>
        <h3>No Organization Contexts</h3>
        <p>Organization Contexts are client and entity profiles for AI-contextualized control suggestions. Click "+ New Context" to create one.</p>
      </div>`;
    return;
  }

  if (!list.length) {
    el.innerHTML = '<div style="padding:32px 20px;text-align:center;color:#9ca3af;font-size:13px">No contexts match your search.</div>';
    return;
  }

  const sectorLabels = { banking: 'Banking & Financial Services', financial: 'Financial', government: 'Government', healthcare: 'Healthcare', energy: 'Energy & Utilities', telecom: 'Telecommunications', education: 'Education', retail: 'Retail & E-Commerce', insurance: 'Insurance', technology: 'Technology', defense: 'Defense & Military', manufacturing: 'Manufacturing', transportation: 'Transportation & Logistics', custom: 'Custom', other: 'Other' };
  const sectorBadgeLabels = { banking: 'Financial', financial: 'Financial', government: 'Government', healthcare: 'Healthcare', energy: 'Energy', telecom: 'Telecom', education: 'Education', retail: 'Retail', insurance: 'Insurance', technology: 'Technology', defense: 'Defense', manufacturing: 'Manufacturing', transportation: 'Transport', custom: 'Custom', other: 'Other' };
  const sizeLabels = { small: 'Small', medium: 'Medium', large: 'Large', enterprise: 'Enterprise' };
  const maturityLabels = { 1: 'Initial', 2: 'Developing', 3: 'Defined', 4: 'Managed', 5: 'Optimizing' };

  // Badge colors: [bg, text] — light transparent backgrounds
  const maturityBadge = { 1: ['#fef2f2','#dc2626'], 2: ['#fff7ed','#ea580c'], 3: ['#eff6ff','#2563eb'], 4: ['#ecfdf5','#059669'], 5: ['#ecfdf5','#047857'] };
  const sectorBadge = { banking: ['#eff6ff','#1d4ed8'], financial: ['#eff6ff','#1d4ed8'], government: ['#eff6ff','#2563eb'], healthcare: ['#f0fdfa','#0d9488'], energy: ['#fffbeb','#b45309'], telecom: ['#f5f3ff','#7c3aed'], education: ['#ecfdf5','#059669'], retail: ['#fdf2f8','#db2777'], insurance: ['#eef2ff','#4f46e5'], technology: ['#f0f9ff','#0369a1'], defense: ['#f8fafc','#475569'], manufacturing: ['#fafaf9','#57534e'], transportation: ['#ecfeff','#0e7490'], custom: ['#f9fafb','#4b5563'], other: ['#f9fafb','#4b5563'] };
  const sectorAvatarColor = { banking: '#0077cc', financial: '#0077cc', government: '#2563eb', healthcare: '#0d9488', energy: '#d97706', telecom: '#8b5cf6', education: '#10b981', retail: '#ec4899', insurance: '#6366f1', technology: '#0284c7', defense: '#64748b', manufacturing: '#78716c', transportation: '#0891b2', custom: '#6b7280', other: '#6b7280' };

  el.innerHTML = list.map(ctx => {
    const origIdx = orgContexts.indexOf(ctx);
    const sectorDisplay = ctx.sectorCustom || sectorBadgeLabels[ctx.sector] || ctx.sector || '';
    const matLvl = ctx.complianceMaturity || 1;
    const [matBg, matFg] = maturityBadge[matLvl] || ['#f9fafb','#4b5563'];
    const [secBg, secFg] = sectorBadge[ctx.sector] || ['#f0fdfa','#0d9488'];
    const avatarColor = sectorAvatarColor[ctx.sector] || '#0d9488';

    // Framework pills: show max 2, then +N
    const fws = ctx.obligatoryFrameworks || [];
    const fwVisible = fws.slice(0, 2);
    const fwExtra = fws.length - 2;
    const fwHtml = fwVisible.map(f => `<span class="org-fw-pill">${esc(f.length > 18 ? f.substring(0,16) + '...' : f)}</span>`).join('') + (fwExtra > 0 ? `<span class="org-fw-pill org-fw-more">+${fwExtra}</span>` : '');

    // Doc count
    const docCount = (ctx.documents || []).length;

    // Build detail rows
    const govLabel = { centralized: 'Centralized', decentralized: 'Decentralized', federated: 'Federated', hybrid: 'Hybrid' };
    const detailPairs = [
      ctx.governanceStructure ? ['Governance', govLabel[ctx.governanceStructure] || ctx.governanceStructure] : null,
      ctx.dataClassification ? ['Data Classification', ctx.dataClassification] : null,
      ctx.geographicScope ? ['Geographic Scope', ctx.geographicScope] : null,
      ctx.itInfrastructure ? ['IT Infrastructure', ctx.itInfrastructure] : null,
    ].filter(Boolean);
    const allFwHtml = fws.map(f => `<span class="org-fw-pill">${esc(f)}</span>`).join('');
    const mandates = ctx.regulatoryMandates || [];
    const mandHtml = mandates.map(m => `<span class="org-fw-pill" style="color:#b45309;background:#fffbeb;border-color:#fde68a">${esc(m)}</span>`).join('');
    const objectives = ctx.strategicObjectives || [];

    return `
      <div class="org-ctx-card" id="org-card-${origIdx}">
        <div class="org-ctx-header" onclick="toggleOrgContext(${origIdx})">
          <div class="org-ctx-header-left">
            <div class="org-ctx-avatar" style="background:${avatarColor}">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M4 16V6C4 5.4 4.4 5 5 5H9L10.5 3H15C15.6 3 16 3.4 16 4V16C16 16.6 15.6 17 15 17H5C4.4 17 4 16.6 4 16Z" stroke="white" stroke-width="1.5" stroke-linecap="round"/><path d="M7 10H13M7 13H10" stroke="white" stroke-width="1.3" stroke-linecap="round"/></svg>
            </div>
            <div class="org-ctx-names">
              <div class="org-ctx-name-row">
                <span class="org-ctx-name">${esc(ctx.nameEn || ctx.name)}</span>
                ${ctx.nameAr ? `<span class="org-ctx-name-ar">${esc(ctx.nameAr)}</span>` : ''}
              </div>
              <div class="org-ctx-tags">
                ${sectorDisplay ? `<span class="org-ctx-tag" style="background:${secBg};color:${secFg}">${esc(sectorDisplay)}</span>` : ''}
                ${ctx.size ? `<span class="org-ctx-tag org-ctx-tag-gray">${esc(sizeLabels[ctx.size] || ctx.size)}</span>` : ''}
                <span class="org-ctx-tag" style="background:${matBg};color:${matFg}">${maturityLabels[matLvl] || matLvl}</span>
              </div>
            </div>
          </div>
          <div class="org-ctx-right">
            <div class="org-ctx-fws">${fwHtml}</div>
            ${docCount > 0 ? `<span class="org-ctx-docs">${docCount} docs</span>` : ''}
            <button class="org-ctx-action-btn" onclick="event.stopPropagation();editOrgContext(${origIdx})" title="Edit">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 2L12 4L5 11H3V9L10 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="org-ctx-action-btn" onclick="event.stopPropagation();deleteOrgContext(${origIdx})" title="Delete">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <svg class="org-ctx-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </div>
        </div>
        <div class="org-ctx-expand">
          ${detailPairs.length ? `<div class="org-ctx-detail-grid">${detailPairs.map(([k,v]) => `<div class="org-ctx-detail-item"><span class="org-ctx-detail-label">${k}</span><span class="org-ctx-detail-value">${esc(v)}</span></div>`).join('')}</div>` : ''}
          ${fws.length ? `<div class="org-ctx-detail-section"><span class="org-ctx-detail-label">Obligatory Frameworks</span><div class="org-ctx-detail-pills">${allFwHtml}</div></div>` : ''}
          ${mandates.length ? `<div class="org-ctx-detail-section"><span class="org-ctx-detail-label">Regulatory Mandates</span><div class="org-ctx-detail-pills">${mandHtml}</div></div>` : ''}
          ${objectives.length ? `<div class="org-ctx-detail-section"><span class="org-ctx-detail-label">Strategic Objectives</span><ul class="org-ctx-objectives">${objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ul></div>` : ''}
          ${ctx.notes ? `<div class="org-ctx-detail-section"><span class="org-ctx-detail-label">Notes</span><p class="org-ctx-notes-text">${esc(ctx.notes)}</p></div>` : ''}
        </div>
      </div>`;
  }).join('');
}
window.toggleOrgContext = function(idx) {
  const card = document.getElementById('org-card-' + idx);
  if (!card) return;
  card.classList.toggle('expanded');
};

// Org Context Modal
const orgModal = document.getElementById('org-modal-overlay');
const orgModalClose = document.getElementById('org-modal-close');
const orgModalCancel = document.getElementById('org-modal-cancel');
const orgModalSave = document.getElementById('org-modal-save');
const orgModalTitle = document.getElementById('org-modal-title');
let editingOrgIdx = null;

function populateMandatesFromFrameworks() {
  const container = document.getElementById('org-mandates-options');
  if (!container) return;
  // Build list from Muraji frameworks
  const fwNames = [];
  if (frameworks && frameworks.length) {
    frameworks.forEach(lib => {
      const fw = lib.content?.framework;
      const name = fw?.name || lib.name || '';
      if (name) fwNames.push(name);
    });
  }
  if (!fwNames.length) {
    container.innerHTML = '<span class="admin-form-hint" style="color:#9ca3af">No frameworks loaded. Please check your connection.</span>';
    return;
  }
  container.innerHTML = fwNames.map(n =>
    `<label class="mandate-chip-option"><input type="checkbox" value="${esc(n)}"> ${esc(n)}</label>`
  ).join('');
}

function openOrgModal() { populateMandatesFromFrameworks(); orgModal.classList.add('active'); document.body.style.overflow = 'hidden'; }
function closeOrgModal() { orgModal.classList.remove('active'); document.body.style.overflow = ''; editingOrgIdx = null; clearOrgForm(); }
let orgObjectives = []; // temp state for objectives list

function clearOrgForm() {
  document.getElementById('org-name-en').value = '';
  document.getElementById('org-name-ar').value = '';
  document.getElementById('org-sector').value = '';
  document.getElementById('org-sector-custom').value = '';
  document.getElementById('org-sector-custom-row').style.display = 'none';
  document.getElementById('org-size').value = '';
  document.getElementById('org-maturity').value = 1;
  updateMaturityLabels(1);
  document.querySelectorAll('#org-mandates-options input[type="checkbox"]').forEach(c => c.checked = false);
  document.getElementById('org-governance').value = '';
  document.getElementById('org-data-classification').value = '';
  document.getElementById('org-geographic').value = '';
  document.getElementById('org-it-infra').value = '';
  orgObjectives = [];
  renderObjectivesList();
  document.getElementById('org-notes').value = '';
}

function updateMaturityLabels(val) {
  document.querySelectorAll('.maturity-labels span').forEach(s => {
    s.classList.toggle('active', s.dataset.val === String(val));
  });
}

function renderObjectivesList() {
  const el = document.getElementById('org-objectives-list');
  if (!el) return;
  if (!orgObjectives.length) { el.innerHTML = ''; return; }
  el.innerHTML = orgObjectives.map((obj, i) => `
    <div class="objective-chip">
      <span>${esc(obj)}</span>
      <button type="button" onclick="removeObjective(${i})" class="objective-chip-remove">&times;</button>
    </div>`).join('');
}
function removeObjective(i) { orgObjectives.splice(i, 1); renderObjectivesList(); }
window.removeObjective = removeObjective;

// Maturity slider
document.getElementById('org-maturity')?.addEventListener('input', e => updateMaturityLabels(e.target.value));

// Sector "custom" toggle
document.getElementById('org-sector')?.addEventListener('change', e => {
  document.getElementById('org-sector-custom-row').style.display = e.target.value === 'custom' ? '' : 'none';
});

// Objectives add
document.getElementById('org-objective-add')?.addEventListener('click', () => {
  const inp = document.getElementById('org-objective-input');
  const val = inp.value.trim();
  if (val) { orgObjectives.push(val); inp.value = ''; renderObjectivesList(); }
});
document.getElementById('org-objective-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('org-objective-add')?.click(); }
});

document.getElementById('btn-new-context').addEventListener('click', () => {
  editingOrgIdx = null;
  orgModalTitle.textContent = 'New Organization Context';
  orgModalSave.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Create Context';
  clearOrgForm();
  openOrgModal();
  document.getElementById('org-name-en').focus();
});

orgModalClose.addEventListener('click', closeOrgModal);
orgModalCancel.addEventListener('click', closeOrgModal);
orgModal.addEventListener('click', e => { if (e.target === orgModal) closeOrgModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && orgModal.classList.contains('active')) closeOrgModal(); });

orgModalSave.addEventListener('click', async () => {
  const nameEn = document.getElementById('org-name-en').value.trim();
  const nameAr = document.getElementById('org-name-ar').value.trim();
  const sector = document.getElementById('org-sector').value;
  const sectorCustom = document.getElementById('org-sector-custom').value.trim();
  const size = document.getElementById('org-size').value;
  const maturity = parseInt(document.getElementById('org-maturity').value) || 1;
  const mandates = [];
  document.querySelectorAll('#org-mandates-options input[type="checkbox"]:checked').forEach(c => mandates.push(c.value));
  const governance = document.getElementById('org-governance').value;
  const dataCls = document.getElementById('org-data-classification').value;
  const geo = document.getElementById('org-geographic').value;
  const itInfra = document.getElementById('org-it-infra').value;
  const notes = document.getElementById('org-notes').value.trim();

  if (!nameEn) { toast('error', 'Validation', 'Name (English) is required.'); document.getElementById('org-name-en').focus(); return; }
  if (!sector) { toast('error', 'Validation', 'Industry vertical is required.'); document.getElementById('org-sector').focus(); return; }
  if (!size) { toast('error', 'Validation', 'Entity size is required.'); document.getElementById('org-size').focus(); return; }

  const body = {
    nameEn,
    nameAr,
    sector,
    sectorCustom: sector === 'custom' ? sectorCustom : '',
    size,
    complianceMaturity: maturity,
    regulatoryMandates: mandates,
    governanceStructure: governance,
    dataClassification: dataCls,
    geographicScope: geo,
    itInfrastructure: itInfra,
    strategicObjectives: orgObjectives,
    obligatoryFrameworks: mandates,
    notes,
    isActive: true,
  };

  orgModalSave.disabled = true;
  try {
    let r;
    if (editingOrgIdx !== null) {
      const id = orgContexts[editingOrgIdx].id;
      r = await fetch(API.orgContexts + '/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } else {
      r = await fetch(API.orgContexts, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'HTTP ' + r.status); }

    toast('success', editingOrgIdx !== null ? 'Updated' : 'Created', 'Context "' + nameEn + '" saved.');
    closeOrgModal();
    await loadOrgContexts();
  } catch (e) {
    console.error('Save org profile error:', e);
    toast('error', 'Save Failed', e.message);
  } finally {
    orgModalSave.disabled = false;
  }
});

// Edit org profile
function editOrgContext(idx) {
  const ctx = orgContexts[idx];
  if (!ctx) return;
  editingOrgIdx = idx;
  orgModalTitle.textContent = 'Edit Organization Context';
  orgModalSave.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7L6 10L11 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Save Changes';
  document.getElementById('org-name-en').value = ctx.nameEn || ctx.name || '';
  document.getElementById('org-name-ar').value = ctx.nameAr || '';
  document.getElementById('org-sector').value = ctx.sector || '';
  document.getElementById('org-sector-custom').value = ctx.sectorCustom || '';
  document.getElementById('org-sector-custom-row').style.display = ctx.sector === 'custom' ? '' : 'none';
  document.getElementById('org-size').value = ctx.size || '';
  document.getElementById('org-maturity').value = ctx.complianceMaturity || 1;
  updateMaturityLabels(ctx.complianceMaturity || 1);
  document.getElementById('org-governance').value = ctx.governanceStructure || '';
  document.getElementById('org-data-classification').value = ctx.dataClassification || '';
  document.getElementById('org-geographic').value = ctx.geographicScope || '';
  document.getElementById('org-it-infra').value = ctx.itInfrastructure || '';
  orgObjectives = [...(ctx.strategicObjectives || [])];
  renderObjectivesList();
  document.getElementById('org-notes').value = ctx.notes || '';
  openOrgModal(); // populates mandate checkboxes from frameworks first
  // Now set mandates checkboxes after they've been populated
  const mandates = ctx.regulatoryMandates || [];
  document.querySelectorAll('#org-mandates-options input[type="checkbox"]').forEach(c => {
    c.checked = mandates.includes(c.value);
  });
  document.getElementById('org-name-en').focus();
}
window.editOrgContext = editOrgContext;

// Delete org profile
async function deleteOrgContext(idx) {
  const ctx = orgContexts[idx];
  if (!ctx) return;
  if (!confirm('Delete profile "' + (ctx.nameEn || ctx.name) + '"? Any Controls Studio sessions using this profile will lose their org context.')) return;
  try {
    const r = await fetch(API.orgContexts + '/' + ctx.id, { method: 'DELETE' });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'HTTP ' + r.status); }
    toast('success', 'Deleted', 'Context deleted.');
    await loadOrgContexts();
  } catch (e) {
    console.error('Delete org context error:', e);
    toast('error', 'Delete Failed', e.message);
  }
}
window.deleteOrgContext = deleteOrgContext;

// Org search
const orgSearch = document.getElementById('org-search');
if (orgSearch) {
  orgSearch.addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    renderOrgContextsList(q);
  });
}

// ─── Prompts Page ────────────────────────────────────────────

const PROMPTS_API_URL = 'https://muraji-api.wathbahs.com/api/prompts';
const LOCAL_PROMPTS_URL = '/api/local-prompts';
const PROMPTS_HIDDEN_IDS = ['64d28cc6-e8c2-4de1-8842-e1f9c65e9173'];

let adminLocalPrompts = [];
let adminApiPrompts = [];
let promptEditId = null;
let promptEditSource = null; // 'local' | 'api'

async function loadPrompts() {
  const listEl = document.getElementById('admin-prompts-list');
  if (listEl) listEl.innerHTML = '<div class="studio-loading"><svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-opacity="0.2"/><path d="M12 2C17.5 2 22 6.5 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Loading prompts...</span></div>';
  await Promise.all([fetchLocalPrompts(), fetchApiPrompts()]);
  renderPromptsList();
}

async function fetchLocalPrompts() {
  try {
    const r = await fetch(LOCAL_PROMPTS_URL);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    adminLocalPrompts = d.prompts || [];
  } catch (e) { console.error('Local prompts error:', e); adminLocalPrompts = []; }
}

async function fetchApiPrompts() {
  try {
    const r = await fetch(PROMPTS_API_URL);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    adminApiPrompts = Array.isArray(d) ? d : (d.data || d.prompts || []);
    adminApiPrompts = adminApiPrompts.filter(p => !PROMPTS_HIDDEN_IDS.includes(p._id || p.id));
  } catch (e) { console.error('API prompts error:', e); adminApiPrompts = []; }
}

function renderPromptsList(q) {
  const listEl = document.getElementById('admin-prompts-list');
  if (!listEl) return;

  let fLocal = adminLocalPrompts;
  let fApi = adminApiPrompts;
  if (q) {
    fLocal = adminLocalPrompts.filter(p => (p.name || '').toLowerCase().includes(q) || (p.content || '').toLowerCase().includes(q));
    fApi = adminApiPrompts.filter(p => (p.name || '').toLowerCase().includes(q) || (p.content || '').toLowerCase().includes(q));
  }

  let html = '';

  if (fLocal.length > 0) {
    html += '<div class="ap-section-header"><h3 class="ap-section-title">Local Prompts</h3><span class="badge badge-primary badge-round">Used by App</span></div>';
    html += '<div class="ap-grid">';
    fLocal.forEach(p => { html += promptCard(p, 'local'); });
    html += '</div>';
  }

  if (fApi.length > 0) {
    html += '<div class="ap-section-header" style="margin-top:20px"><h3 class="ap-section-title">API Prompts</h3><span class="badge badge-gray badge-round">From Muraji API</span></div>';
    html += '<div class="ap-grid">';
    fApi.forEach(p => { html += promptCard(p, 'api'); });
    html += '</div>';
  }

  if (!html) {
    html = '<div class="admin-card empty-state-box" style="text-align:center;padding:40px"><h3>No prompts found</h3><p style="color:#6b7280;font-size:12px">Create a new prompt or check your API connection.</p></div>';
  }

  listEl.innerHTML = html;
}

function promptCard(p, src) {
  const id = p._id || p.id;
  const nm = p.name || 'Untitled';
  const v = p.version || 1;
  const ct = p.content || '';
  const prev = ct.substring(0, 180);
  const isL = src === 'local';
  const cAt = p.created_at || p.createdAt;
  const uAt = p.updated_at || p.updatedAt;

  let note = '';
  if (id === '8c0a228d-1fa7-47f6-9df6-4354b72f8134') note = 'Used in both applied control and requirement evidence assessments';
  if (id === 'b596eb43-d411-4fe6-9d80-0ab113673678') note = 'Used in extracting entities from evidence in CISO version';

  return `
    <div class="ap-card ${isL ? 'ap-card-local' : ''}">
      <div class="ap-card-top">
        <div class="ap-card-name-row">
          <span class="ap-card-name">${esc(nm)}</span>
          ${isL ? '<span class="badge badge-emerald" style="font-size:9px">LOCAL</span>' : ''}
          ${!isL ? '<span class="badge badge-gray" style="font-size:9px">v' + v + '</span>' : ''}
        </div>
        <div class="ap-card-actions">
          <button class="btn-admin-ghost btn-admin-sm" onclick="adminEditPrompt('${esc(id)}','${src}')" title="Edit">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M10 2L12 4L5 11H3V9L10 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          ${!isL ? `<button class="btn-admin-ghost btn-admin-sm" onclick="adminDeletePrompt('${esc(id)}','${esc(nm).replace(/'/g, "\\\\'")}')" title="Delete">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>` : ''}
        </div>
      </div>
      ${prev ? `<div class="ap-card-preview"><pre>${esc(prev)}${ct.length > 180 ? '…' : ''}</pre></div>` : ''}
      <div class="ap-card-footer">
        ${uAt ? `<span class="ap-card-date">Updated ${fmtRelDate(uAt)}</span>` : ''}
        ${cAt ? `<span class="ap-card-date">Created ${fmtRelDate(cAt)}</span>` : ''}
      </div>
      ${note ? `<div class="ap-card-note">${esc(note)}</div>` : ''}
    </div>`;
}

function fmtRelDate(s) {
  try {
    const d = new Date(s), n = new Date(), ms = n - d;
    const m = Math.floor(ms / 60000), h = Math.floor(ms / 3600000), dy = Math.floor(ms / 86400000);
    if (m < 1) return 'just now'; if (m < 60) return m + 'm ago'; if (h < 24) return h + 'h ago'; if (dy < 7) return dy + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return s; }
}

// Prompts search
const adminPromptsSearch = document.getElementById('admin-prompts-search');
if (adminPromptsSearch) {
  adminPromptsSearch.addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    renderPromptsList(q || undefined);
  });
}

// Prompt modal
const promptModal = document.getElementById('prompt-modal-overlay');
const promptModalTitle = document.getElementById('prompt-modal-title');
const promptModalClose = document.getElementById('prompt-modal-close');
const promptModalCancel = document.getElementById('prompt-modal-cancel');
const promptModalSave = document.getElementById('prompt-modal-save');

function openPromptModal() { promptModal.classList.add('active'); document.body.style.overflow = 'hidden'; }
function closePromptModal() { promptModal.classList.remove('active'); document.body.style.overflow = ''; promptEditId = null; promptEditSource = null; document.getElementById('prompt-edit-name').value = ''; document.getElementById('prompt-edit-content').value = ''; }

promptModalClose?.addEventListener('click', closePromptModal);
promptModalCancel?.addEventListener('click', closePromptModal);
promptModal?.addEventListener('click', e => { if (e.target === promptModal) closePromptModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && promptModal?.classList.contains('active')) closePromptModal(); });

// New prompt
document.getElementById('btn-new-prompt')?.addEventListener('click', () => {
  promptEditId = null;
  promptEditSource = 'api';
  promptModalTitle.textContent = 'New Prompt';
  document.getElementById('prompt-edit-name').value = '';
  document.getElementById('prompt-edit-content').value = '';
  openPromptModal();
  document.getElementById('prompt-edit-name').focus();
});

// Edit prompt
async function adminEditPrompt(id, src) {
  promptEditId = id;
  promptEditSource = src || 'api';
  promptModalTitle.textContent = 'Edit Prompt';

  const nameEl = document.getElementById('prompt-edit-name');
  const contentEl = document.getElementById('prompt-edit-content');

  if (src === 'local') {
    const c = adminLocalPrompts.find(p => p.id === id);
    nameEl.value = c?.name || '';
    contentEl.value = c?.content || '';
    openPromptModal();
    try {
      const r = await fetch(LOCAL_PROMPTS_URL + '/' + id);
      if (r.ok) { const d = await r.json(); const p = d.prompt || d; nameEl.value = p.name || ''; contentEl.value = p.content || ''; }
    } catch (e) { console.error(e); toast('error', 'Error', e.message); }
  } else {
    const c = adminApiPrompts.find(p => (p._id || p.id) === id);
    nameEl.value = c?.name || '';
    contentEl.value = c?.content || '';
    openPromptModal();
    try {
      const r = await fetch(PROMPTS_API_URL + '/' + id);
      if (r.ok) { const d = await r.json(); const p = d.data || d.prompt || d; nameEl.value = p.name || ''; contentEl.value = p.content || ''; }
    } catch (e) { console.error(e); toast('error', 'Error', e.message); }
  }
  nameEl.focus();
}
window.adminEditPrompt = adminEditPrompt;

// Save prompt
promptModalSave?.addEventListener('click', async () => {
  const nm = document.getElementById('prompt-edit-name').value.trim();
  const ct = document.getElementById('prompt-edit-content').value.trim();
  if (!nm) { toast('error', 'Validation', 'Name is required.'); document.getElementById('prompt-edit-name').focus(); return; }
  if (!ct) { toast('error', 'Validation', 'Content is required.'); document.getElementById('prompt-edit-content').focus(); return; }

  const body = { name: nm, content: ct };
  const btnT = promptModalSave.querySelector('.btn-text');
  const btnL = promptModalSave.querySelector('.btn-loading');

  try {
    promptModalSave.disabled = true;
    if (btnT) btnT.classList.add('hidden');
    if (btnL) btnL.classList.remove('hidden');

    let r;
    if (promptEditSource === 'local' && promptEditId) {
      r = await fetch(LOCAL_PROMPTS_URL + '/' + promptEditId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } else if (promptEditId) {
      r = await fetch(PROMPTS_API_URL + '/' + promptEditId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } else {
      r = await fetch(PROMPTS_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || e.error || 'HTTP ' + r.status); }

    closePromptModal();
    toast('success', promptEditId ? 'Updated' : 'Created', 'Prompt "' + nm + '" saved.');
    await loadPrompts();
  } catch (e) {
    console.error(e);
    toast('error', 'Save Failed', e.message);
  } finally {
    promptModalSave.disabled = false;
    if (btnT) btnT.classList.remove('hidden');
    if (btnL) btnL.classList.add('hidden');
  }
});

// Delete prompt
async function adminDeletePrompt(id, nm) {
  if (!confirm('Delete "' + nm + '"?')) return;
  try {
    const r = await fetch(PROMPTS_API_URL + '/' + id, { method: 'DELETE' });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || e.error || 'HTTP ' + r.status); }
    toast('success', 'Deleted', '"' + nm + '" deleted.');
    await loadPrompts();
  } catch (e) { console.error(e); toast('error', 'Delete Failed', e.message); }
}
window.adminDeletePrompt = adminDeletePrompt;

// Clear cache
document.getElementById('btn-prompts-clear-cache')?.addEventListener('click', async () => {
  try {
    const r = await fetch(PROMPTS_API_URL + '/cache/clear', { method: 'POST' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    toast('success', 'Cache Cleared', 'API prompt cache cleared.');
    await loadPrompts();
  } catch (e) { console.error(e); toast('error', 'Failed', e.message); }
});

// ─── Controls Studio ──────────────────────────────────────────

const CS_STEPS = [
  { label: 'Requirements', icon: '1' },
  { label: 'References', icon: '2' },
  { label: 'Org Context', icon: '3' },
  { label: 'Generate', icon: '4' },
  { label: 'Review', icon: '5' },
  { label: 'Export', icon: '6' },
];

// CS Sessions — DB-backed via API
let csCachedSessions = null; // in-memory cache, loaded from API

async function csGetSessions() {
  if (csCachedSessions !== null) return csCachedSessions;
  try {
    const d = await fetchJSON(API.csSessions);
    csCachedSessions = d.sessions || [];
  } catch (e) { console.error('csGetSessions:', e); csCachedSessions = []; }
  return csCachedSessions;
}

async function csSaveSession(session) {
  try {
    const existing = (await csGetSessions()).find(s => s.id === session.id);
    const method = existing ? 'PUT' : 'POST';
    const url = existing ? API.csSessions + '/' + session.id : API.csSessions;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });
    const data = await res.json();
    if (data.success && data.session) {
      // Update cache
      if (csCachedSessions) {
        const idx = csCachedSessions.findIndex(s => s.id === data.session.id);
        if (idx >= 0) csCachedSessions[idx] = data.session;
        else csCachedSessions.unshift(data.session);
      }
      return data.session;
    }
  } catch (e) { console.error('csSaveSession:', e); }
  return session;
}

async function csDeleteSession(id) {
  try {
    await fetch(API.csSessions + '/' + id, { method: 'DELETE' });
    if (csCachedSessions) csCachedSessions = csCachedSessions.filter(s => s.id !== id);
  } catch (e) { console.error('csDeleteSession:', e); }
}

function loadControlsStudio() {
  if (csMode === 'sessions') csShowSessions();
}

async function csShowSessions() {
  csMode = 'sessions';
  csJustExported = false;
  document.getElementById('cs-step-indicator').style.display = 'none';
  document.getElementById('cs-back-to-sessions').style.display = 'none';

  // Reset subtitle
  const subtitleEl = document.querySelector('#page-controls-studio .page-subtitle');
  if (subtitleEl) subtitleEl.textContent = 'AI-powered control suggestions for framework requirements — proactive setup before audits';

  const content = document.getElementById('cs-content');
  content.innerHTML = '<div class="studio-loading"><svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-opacity="0.2"/><path d="M12 2C17.5 2 22 6.5 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Loading sessions...</span></div>';

  csCachedSessions = null;
  const csSessions = await csGetSessions();

  // Compute stats
  const totalSessions = csSessions.length;
  const totalControls = csSessions.reduce((a, s) => a + (s.controls || []).length, 0);
  const totalExported = csSessions.filter(s => s.status === 'exported').reduce((a, s) => a + (s.controls || []).length, 0);
  const exported = csSessions.filter(s => s.status === 'exported').length;
  const mergeAvailable = 0; // placeholder for future merge feature

  let h = `
    <div class="cs-stats-grid">
      <div class="cs-stat-card">
        <div class="cs-stat-icon cs-stat-icon-primary">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4H14M2 8H14M2 12H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </div>
        <div class="cs-stat-value">${totalSessions}</div>
        <div class="cs-stat-label">Total Sessions</div>
      </div>
      <div class="cs-stat-card">
        <div class="cs-stat-icon cs-stat-icon-emerald">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M6 8L7.5 9.5L10 6.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="cs-stat-value">${totalControls}</div>
        <div class="cs-stat-label">Controls Generated</div>
      </div>
      <div class="cs-stat-card">
        <div class="cs-stat-icon cs-stat-icon-sky">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 8L7 11L12 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 8A5 5 0 1 1 3 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </div>
        <div class="cs-stat-value">${totalExported}</div>
        <div class="cs-stat-label">Controls Exported</div>
      </div>
      <div class="cs-stat-card">
        <div class="cs-stat-icon cs-stat-icon-amber">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5 4L8 7L11 4M5 9L8 12L11 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="cs-stat-value">${mergeAvailable}</div>
        <div class="cs-stat-label">Merge Available</div>
      </div>
    </div>`;

  // Session list card
  h += `<div class="cs-list-card">`;
  h += `<div class="cs-list-header">
    <div>
      <h2 class="cs-list-title">Studio Sessions</h2>
      <p class="cs-list-subtitle">${exported} exported, ${totalSessions - exported} in progress</p>
    </div>
    <button class="btn-admin-primary btn-admin-sm" onclick="csNewSession()">
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      New Session
    </button>
  </div>`;

  if (!csSessions.length) {
    h += `<div class="cs-empty-state">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="16" stroke="#e5e7eb" stroke-width="2"/><path d="M14 20L18 24L26 16" stroke="#d1d5db" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <h3>No studio sessions yet</h3>
      <p>Start a new session to generate AI-suggested applied controls for your framework requirements.</p>
    </div>`;
  } else {
    h += '<div class="cs-list-rows">';
    h += csSessions.map(s => {
      const reqCount = (s.requirements || []).length;
      const ctrlCount = (s.controls || []).length;
      const exportedCtrl = s.status === 'exported' ? ctrlCount : 0;

      // Status badge
      const statusCfg = s.status === 'exported'
        ? { label: 'Exported', cls: 'cs-badge-emerald' }
        : s.status === 'generated'
        ? { label: 'Generated', cls: 'cs-badge-amber' }
        : { label: 'Draft', cls: 'cs-badge-gray' };

      // Org context name
      const orgName = s.orgContext?.nameEn || s.orgContext?.name || '';

      // Framework names from requirements
      const fwSet = new Set();
      (s.requirements || []).forEach(r => { if (r.frameworkName) fwSet.add(r.frameworkName); });
      const fwNames = [...fwSet];

      // Action config
      let actionLabel, actionIcon;
      if (s.status === 'draft') { actionLabel = 'Resume'; actionIcon = '<path d="M5 3L12 8L5 13V3Z" fill="currentColor"/>'; }
      else if (s.status === 'generated') { actionLabel = 'Review'; actionIcon = '<path d="M2 8C2 8 5 3 8 3C11 3 14 8 14 8C14 8 11 13 8 13C5 13 2 8 2 8Z" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.3"/>'; }
      else { actionLabel = 'View Results'; actionIcon = '<path d="M2 8C2 8 5 3 8 3C11 3 14 8 14 8C14 8 11 13 8 13C5 13 2 8 2 8Z" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.3"/>'; }

      return `
        <div class="cs-session-row" onclick="csOpenSession('${esc(s.id)}')">
          <div class="cs-session-main">
            <div class="cs-session-name-row">
              <span class="cs-session-name">${esc(s.name || 'Unnamed Session')}</span>
              <span class="cs-badge ${statusCfg.cls}">${statusCfg.label}</span>
            </div>
            <div class="cs-session-meta">
              <span class="cs-meta-date">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><rect x="2" y="3" width="10" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M2 6H12M5 2V4M9 2V4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
                ${fmtDate(s.created_at || s.createdAt)}
              </span>
              ${orgName ? `<span>${esc(orgName)}</span>` : ''}
              ${fwNames.length ? `<span class="cs-meta-sep">|</span><span>${esc(fwNames.join(', '))}</span>` : ''}
            </div>
          </div>
          <div class="cs-session-numbers">
            <div class="cs-num-col">
              <div class="cs-num-val">${reqCount}</div>
              <div class="cs-num-label">Reqs</div>
            </div>
            <div class="cs-num-col">
              <div class="cs-num-val">${ctrlCount}</div>
              <div class="cs-num-label">Generated</div>
            </div>
            <div class="cs-num-col">
              <div class="cs-num-val cs-num-emerald">${exportedCtrl}</div>
              <div class="cs-num-label">Exported</div>
            </div>
          </div>
          <div class="cs-session-actions">
            <button class="cs-action-btn" onclick="event.stopPropagation();csOpenSession('${esc(s.id)}')">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">${actionIcon}</svg>
              ${actionLabel}
            </button>
            <button class="cs-delete-btn" onclick="event.stopPropagation();csDeleteSessionConfirm('${esc(s.id)}','${esc((s.name || 'Unnamed').replace(/'/g, "\\'"))}')">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
          <svg class="cs-row-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </div>`;
    }).join('');
    h += '</div>';
  }
  h += '</div>';

  content.innerHTML = h;
}
window.csShowSessions = csShowSessions;

async function csNewSession() {
  const sessions = await csGetSessions();
  csSessionData = {
    id: Date.now().toString(),
    name: 'Session ' + (sessions.length + 1),
    created_at: new Date().toISOString(),
    step: 0,
    requirements: [],
    collections: [],
    selectedFiles: [],
    sessionFiles: [],
    orgContext: null,
    controls: [],
    status: 'draft',
  };
  // Save to DB immediately
  await csSaveSession(csSessionData);
  csCurrentStep = 0;
  csMode = 'wizard';
  document.getElementById('cs-back-to-sessions').style.display = '';
  csRenderWizard();
}
window.csNewSession = csNewSession;

async function csOpenSession(id) {
  try {
    const d = await fetchJSON(API.csSessions + '/' + id);
    if (d.success && d.session) {
      csSessionData = d.session;
      // For exported/generated sessions, jump straight to the review step
      if (csSessionData.status === 'exported' || csSessionData.status === 'generated') {
        csCurrentStep = 4; // Review step
      } else {
        csCurrentStep = csSessionData.step || 0;
      }
      csMode = 'wizard';
      document.getElementById('cs-back-to-sessions').style.display = '';

      // Update subtitle with session name
      const subtitleEl = document.querySelector('#page-controls-studio .page-subtitle');
      if (subtitleEl && csSessionData.name) {
        subtitleEl.innerHTML = 'Viewing results for: <strong>' + esc(csSessionData.name) + '</strong>';
      }

      csRenderWizard();
    }
  } catch (e) {
    console.error('csOpenSession:', e);
    toast('error', 'Error', 'Could not load session.');
  }
}
window.csOpenSession = csOpenSession;

async function csDeleteSessionConfirm(id, name) {
  if (!confirm(`Delete session "${name}"?`)) return;
  await csDeleteSession(id);
  toast('success', 'Deleted', 'Session deleted.');
  csCachedSessions = null; // Force refresh
  csShowSessions();
}
window.csDeleteSessionConfirm = csDeleteSessionConfirm;

function csRenderWizard() {
  // Step indicator - hide for exported/generated sessions viewing results
  const indEl = document.getElementById('cs-step-indicator');
  const isReadOnly = csSessionData.status === 'exported' || csSessionData.status === 'generated';
  if (isReadOnly && csCurrentStep === 4) {
    indEl.style.display = 'none';
  } else {
    indEl.style.display = '';
  }
  let stepsH = '<div class="cs-steps-row">';
  CS_STEPS.forEach((s, i) => {
    const state = i < csCurrentStep ? 'completed' : (i === csCurrentStep ? 'current' : 'future');
    const clickable = i <= csCurrentStep ? 'clickable' : '';
    stepsH += `
      <div class="cs-step-item ${clickable}" ${clickable ? `onclick="csGoStep(${i})"` : ''}>
        <div class="cs-step-circle ${state}">
          ${state === 'completed' ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7L6 10L11 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : (i + 1)}
        </div>
        <span class="cs-step-label ${state}">${s.label}</span>
      </div>`;
    if (i < CS_STEPS.length - 1) {
      stepsH += `<div class="cs-step-line ${i < csCurrentStep ? 'completed' : 'future'}"></div>`;
    }
  });
  stepsH += '</div>';
  indEl.innerHTML = stepsH;

  // Render current step content
  const content = document.getElementById('cs-content');
  switch (csCurrentStep) {
    case 0: csRenderStepRequirements(content); break;
    case 1: csRenderStepReferences(content); break;
    case 2: csRenderStepOrgContext(content); break;
    case 3: csRenderStepGenerate(content); break;
    case 4: csRenderStepReview(content); break;
    case 5: csRenderStepExport(content); break;
    default: csRenderStepRequirements(content);
  }
}

function csGoStep(i) {
  if (i <= csCurrentStep) {
    csCurrentStep = i;
    if (csSessionData) csSessionData.step = i;
    csRenderWizard();
  }
}
window.csGoStep = csGoStep;

// Step 1: Requirements — with real data
function csRenderStepRequirements(el) {
  const reqs = csSessionData.requirements || [];
  const fwCount = new Set(reqs.map(r => r.frameworkName)).size;
  el.innerHTML = `
    <div class="cs-wizard-card">
      <div class="cs-wizard-header navy">
        <div class="cs-wizard-header-title">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="white" stroke-width="1.5"/><path d="M6 9L8 11L12 7" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Step 1: Select Requirements
        </div>
        <div class="cs-wizard-header-desc">Choose which framework requirements to generate controls for. Select entire frameworks or expand to pick sections.</div>
        <div class="cs-wizard-header-stat">
          <span class="big" id="cs-req-count">${reqs.length}</span>
          <span class="label">requirements from ${fwCount} frameworks</span>
        </div>
      </div>
      <div class="cs-wizard-body">
        <div class="studio-search-bar" style="margin-bottom:10px">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M9 9L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <input type="text" placeholder="Search frameworks..." id="cs-fw-search" autocomplete="off">
          <div class="studio-search-actions">
            <button type="button" class="btn-studio-filter" id="cs-select-all-btn">Select All</button>
            <button type="button" class="btn-studio-filter" id="cs-clear-all-btn">Clear</button>
          </div>
        </div>
        <div id="cs-fw-list" class="studio-fw-list" style="max-height:360px;overflow-y:auto">
          <div class="studio-loading"><svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-opacity="0.2"/><path d="M12 2C17.5 2 22 6.5 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Loading frameworks...</span></div>
        </div>
      </div>
      <div class="cs-wizard-footer">
        <div></div>
        <button class="btn-admin-primary" onclick="csSaveStep();csCurrentStep=1;csSessionData.step=1;csRenderWizard()">
          Next &nbsp;→
        </button>
      </div>
    </div>`;

  // Fetch and render frameworks
  (async () => {
    if (!csLibraries.length) {
      try {
        const d = await fetch(API.libraries).then(r => r.json());
        if (d.success && d.data) csLibraries = d.data;
      } catch (e) { console.error('CS libraries fetch:', e); }
    }
    csRenderFwList();
    csAttachFwSearch();
  })();
}

function csRenderFwList() {
  const listEl = document.getElementById('cs-fw-list');
  if (!listEl) return;
  const reqs = csSessionData.requirements || [];

  if (!csLibraries.length) {
    listEl.innerHTML = '<div class="studio-empty-msg">No frameworks loaded.</div>';
    return;
  }

  let html = '';
  csLibraries.forEach((lib, li) => {
    const fw = lib.content?.framework;
    if (!fw || !fw.requirement_nodes) return;
    const fwName = fw.name || lib.name;
    const nodes = fw.requirement_nodes.filter(n => n.description);
    const groupId = 'csg-' + li;
    const selectedInGroup = nodes.filter(n => reqs.some(r => r.nodeUrn === n.urn)).length;

    html += `<div class="studio-fw-group collapsed" data-group-id="${groupId}">
      <div class="studio-fw-group-header">
        <div class="cs-fw-cb" onclick="event.stopPropagation();csToggleFwGroup('${groupId}','${esc(fwName)}')" style="cursor:pointer">
          <span class="studio-cb-mark ${selectedInGroup === nodes.length && nodes.length > 0 ? 'checked' : (selectedInGroup > 0 ? 'indeterminate' : '')}"></span>
        </div>
        <div class="studio-fw-group-toggle" onclick="csFwToggleGroup(this)">
          <svg class="chevron-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>${esc(fwName)}</span>
        </div>
        <div class="studio-fw-group-actions">
          <span class="studio-fw-group-count">${selectedInGroup > 0 ? selectedInGroup + '/' : ''}${nodes.length} req</span>
        </div>
      </div>
      <div class="studio-fw-group-items">`;

    nodes.forEach(node => {
      const opt = {
        libraryId: lib.id,
        frameworkUrn: fw.urn,
        frameworkName: fwName,
        nodeUrn: node.urn,
        refId: node.ref_id,
        name: node.name,
        description: node.description,
        depth: node.depth,
        assessable: node.assessable,
      };
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(opt))));
      const isSelected = reqs.some(r => r.nodeUrn === node.urn);
      const depthDot = node.depth === 1 ? '●' : node.depth === 2 ? '○' : node.depth === 3 ? '◦' : '·';

      html += `<div class="studio-fw-item${isSelected ? ' selected' : ''}" data-opt="${encoded}" data-group-id="${groupId}" data-search="${esc((node.ref_id + ' ' + node.description + ' ' + fwName).toLowerCase())}" onclick="csToggleReq(this)">
        <div class="studio-fw-item-checkbox"><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div class="studio-fw-item-content">
          ${node.ref_id ? `<span class="studio-fw-ref">${esc(node.ref_id)}</span>` : ''}
          <span class="studio-fw-desc"><span class="studio-fw-depth">${depthDot}</span> ${esc(node.description)}</span>
        </div>
      </div>`;
    });

    html += '</div></div>';
  });

  listEl.innerHTML = html;
}

function csDecodeOpt(enc) {
  return JSON.parse(decodeURIComponent(escape(atob(enc))));
}

function csFwToggleGroup(el) {
  el.closest('.studio-fw-group').classList.toggle('collapsed');
}
window.csFwToggleGroup = csFwToggleGroup;

function csToggleReq(itemEl) {
  const opt = csDecodeOpt(itemEl.dataset.opt);
  if (!csSessionData.requirements) csSessionData.requirements = [];
  const idx = csSessionData.requirements.findIndex(r => r.nodeUrn === opt.nodeUrn);
  if (idx === -1) {
    csSessionData.requirements.push(opt);
    itemEl.classList.add('selected');
  } else {
    csSessionData.requirements.splice(idx, 1);
    itemEl.classList.remove('selected');
  }
  csUpdateReqCount();
  csUpdateFwGroupCheckboxes();
}
window.csToggleReq = csToggleReq;

function csToggleFwGroup(groupId, fwName) {
  if (!csSessionData.requirements) csSessionData.requirements = [];
  const group = document.querySelector(`.studio-fw-group[data-group-id="${groupId}"]`);
  if (!group) return;
  const items = group.querySelectorAll('.studio-fw-item');
  // Check if all visible items in group are selected
  const allSelected = Array.from(items).every(i => i.classList.contains('selected'));

  items.forEach(item => {
    const opt = csDecodeOpt(item.dataset.opt);
    const idx = csSessionData.requirements.findIndex(r => r.nodeUrn === opt.nodeUrn);
    if (allSelected) {
      // Deselect all in group
      if (idx >= 0) csSessionData.requirements.splice(idx, 1);
      item.classList.remove('selected');
    } else {
      // Select all in group
      if (idx === -1) csSessionData.requirements.push(opt);
      item.classList.add('selected');
    }
  });
  csUpdateReqCount();
  csUpdateFwGroupCheckboxes();
}
window.csToggleFwGroup = csToggleFwGroup;

function csUpdateReqCount() {
  const reqs = csSessionData.requirements || [];
  const countEl = document.getElementById('cs-req-count');
  if (countEl) countEl.textContent = reqs.length;
  const fwCount = new Set(reqs.map(r => r.frameworkName)).size;
  const labelEl = countEl?.nextElementSibling;
  if (labelEl) labelEl.textContent = `requirements from ${fwCount} framework${fwCount !== 1 ? 's' : ''}`;
}

function csUpdateFwGroupCheckboxes() {
  const reqs = csSessionData.requirements || [];
  document.querySelectorAll('#cs-fw-list .studio-fw-group').forEach(group => {
    const items = group.querySelectorAll('.studio-fw-item');
    const total = items.length;
    const selected = Array.from(items).filter(i => i.classList.contains('selected')).length;
    const cb = group.querySelector('.cs-fw-cb .studio-cb-mark');
    if (cb) {
      cb.classList.toggle('checked', selected === total && total > 0);
      cb.classList.toggle('indeterminate', selected > 0 && selected < total);
    }
    const countEl = group.querySelector('.studio-fw-group-count');
    if (countEl) countEl.textContent = (selected > 0 ? selected + '/' : '') + total + ' req';
  });
}

function csAttachFwSearch() {
  const input = document.getElementById('cs-fw-search');
  if (input) {
    input.addEventListener('input', e => {
      const q = e.target.value.toLowerCase().trim();
      document.querySelectorAll('#cs-fw-list .studio-fw-group').forEach(group => {
        const items = group.querySelectorAll('.studio-fw-item');
        let vis = 0;
        items.forEach(item => {
          const match = !q || (item.dataset.search || '').includes(q);
          item.style.display = match ? '' : 'none';
          if (match) vis++;
        });
        group.style.display = vis > 0 ? '' : 'none';
        if (q && vis > 0) group.classList.remove('collapsed');
        else if (!q) group.classList.add('collapsed');
      });
    });
  }
  const selAllBtn = document.getElementById('cs-select-all-btn');
  if (selAllBtn) {
    selAllBtn.addEventListener('click', () => {
      if (!csSessionData.requirements) csSessionData.requirements = [];
      document.querySelectorAll('#cs-fw-list .studio-fw-item:not([style*="display: none"])').forEach(item => {
        const opt = csDecodeOpt(item.dataset.opt);
        if (!csSessionData.requirements.some(r => r.nodeUrn === opt.nodeUrn)) {
          csSessionData.requirements.push(opt);
          item.classList.add('selected');
        }
      });
      csUpdateReqCount();
      csUpdateFwGroupCheckboxes();
    });
  }
  const clearBtn = document.getElementById('cs-clear-all-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      csSessionData.requirements = [];
      document.querySelectorAll('#cs-fw-list .studio-fw-item.selected').forEach(i => i.classList.remove('selected'));
      csUpdateReqCount();
      csUpdateFwGroupCheckboxes();
    });
  }
}

async function csSaveStep() {
  // Save current session to DB
  if (csSessionData) {
    await csSaveSession(csSessionData);
  }
}
window.csSaveStep = csSaveStep;

// Step 2: References — with real data (collections + files + upload)
function csRenderStepReferences(el) {
  if (!csSessionData.selectedFiles) csSessionData.selectedFiles = [];
  if (!csSessionData.collections) csSessionData.collections = [];
  if (!csSessionData.sessionFiles) csSessionData.sessionFiles = [];

  const selectedFileCount = csSessionData.selectedFiles.length;
  const selectedCollCount = csSessionData.collections.length;

  el.innerHTML = `
    <div class="cs-wizard-card">
      <div class="cs-wizard-header emerald">
        <div class="cs-wizard-header-title">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M16 11V15C16 15.6 15.6 16 15 16H3C2.4 16 2 15.6 2 15V11" stroke="white" stroke-width="1.5" stroke-linecap="round"/><path d="M12 6L9 3L6 6M9 3V11" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Step 2: Attach Reference Files
        </div>
        <div class="cs-wizard-header-desc">Select file collections with regulatory guidance, best practices, or existing control catalogs to inform AI suggestions.</div>
        <div class="cs-wizard-header-stat">
          <span class="big" id="cs-ref-file-count">${selectedFileCount}</span>
          <span class="label" id="cs-ref-coll-label">files from ${selectedCollCount} collections</span>
        </div>
      </div>
      <div class="cs-wizard-body">
        <button class="btn-studio-new-coll" type="button" id="cs-new-coll-btn">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5V11C2 11.6 2.4 12 3 12H11C11.6 12 12 11.6 12 11V7C12 6.4 11.6 6 11 6H7L5.5 4H3C2.4 4 2 4.4 2 5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 7V10M5.5 8.5H8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          New Collection
        </button>
        <div id="cs-ref-collections" class="studio-coll-list" style="max-height:280px;overflow-y:auto">
          <div class="studio-loading"><svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-opacity="0.2"/><path d="M12 2C17.5 2 22 6.5 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Loading collections...</span></div>
        </div>
        <div class="cs-session-upload-section">
          <label class="studio-field-label" style="margin-top:12px">Per-Session Upload</label>
          <div class="cs-drop-zone" id="cs-drop-zone">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M17 12V15C17 15.6 16.6 16 16 16H4C3.4 16 3 15.6 3 15V12" stroke="#9ca3af" stroke-width="1.5" stroke-linecap="round"/><path d="M13 7L10 4L7 7" stroke="#9ca3af" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 4V13" stroke="#9ca3af" stroke-width="1.5" stroke-linecap="round"/></svg>
            <div class="cs-drop-text">Drop additional files for this session</div>
            <div class="cs-drop-hint">PDF, DOCX, XLSX</div>
          </div>
          <div id="cs-session-files-list" class="cs-session-files"></div>
        </div>
      </div>
      <div class="cs-wizard-footer">
        <button class="btn-admin-ghost" onclick="csSaveStep();csCurrentStep=0;csSessionData.step=0;csRenderWizard()">← Back</button>
        <button class="btn-admin-primary" onclick="csSaveStep();csCurrentStep=2;csSessionData.step=2;csRenderWizard()">
          Next &nbsp;→
        </button>
      </div>
    </div>`;

  // Load and render collections
  (async () => {
    await csFetchCollections();
    csRenderRefCollections();
    csRenderSessionFiles();
  })();

  // New Collection button
  const newCollBtn = document.getElementById('cs-new-coll-btn');
  if (newCollBtn) {
    newCollBtn.onclick = () => {
      const name = prompt('Collection name:');
      if (!name || !name.trim()) return;
      (async () => {
        try {
          toast('info', 'Creating...', `Setting up "${name}"...`);
          const res = await fetch('/api/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: name.trim() }) });
          const data = await res.json();
          if (data.success) {
            toast('success', 'Created', `"${name}" is ready.`);
            await csFetchCollections();
            csRenderRefCollections();
          } else throw new Error(data.error || 'Failed');
        } catch (err) { toast('error', 'Error', err.message); }
      })();
    };
  }

  // Per-session file upload (click + drag-and-drop)
  const dropZone = document.getElementById('cs-drop-zone');
  if (dropZone) {
    dropZone.onclick = () => csUploadSessionFiles();
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); };
    dropZone.ondragleave = () => dropZone.classList.remove('drag-over');
    dropZone.ondrop = (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files);
      csProcessSessionFiles(files);
    };
  }
}

async function csFetchCollections() {
  try {
    const d = await fetchJSON(API.collections);
    const stores = d.data?.fileSearchStores || d.data || [];
    csCollectionsData = Array.isArray(stores) ? stores : [];
    await Promise.all(csCollectionsData.map(async store => {
      try {
        const sid = store.name.split('/').pop();
        const fd = await fetchJSON(API.collections + '/' + sid + '/files');
        store.files = fd.data?.documents || fd.data?.fileSearchDocuments || [];
      } catch { store.files = []; }
    }));
  } catch (e) { console.error('CS collections fetch:', e); csCollectionsData = []; }
}

function csRenderRefCollections() {
  const listEl = document.getElementById('cs-ref-collections');
  if (!listEl) return;

  if (!csCollectionsData.length) {
    listEl.innerHTML = '<div class="studio-empty-msg">No collections yet. Create one above.</div>';
    return;
  }

  let html = '';
  csCollectionsData.forEach(store => {
    const storeId = store.name.split('/').pop();
    const displayName = store.displayName || store.name || 'Untitled';
    const files = store.files || [];
    const activeFiles = files.filter(f => f.state === 'STATE_ACTIVE');
    const isCollSelected = csSessionData.collections.includes(storeId);
    const someFilesSelected = files.some(f => (csSessionData.selectedFiles || []).includes(storeId + '::' + (f.name || f.displayName)));

    html += `<div class="studio-coll-group collapsed" data-store-id="${storeId}">
      <div class="studio-coll-header">
        <div class="studio-coll-cb" onclick="event.stopPropagation();csToggleColl('${esc(storeId)}')">
          <span class="studio-cb-mark ${isCollSelected ? 'checked' : (someFilesSelected ? 'indeterminate' : '')}"></span>
        </div>
        <div class="studio-coll-toggle" onclick="this.closest('.studio-coll-group').classList.toggle('collapsed')">
          <svg class="chevron-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span class="studio-coll-name">${esc(displayName)}</span>
        </div>
        <div class="studio-coll-actions">
          <span class="studio-coll-badge">${files.length} files</span>
          <button type="button" class="btn-studio-coll-upload" onclick="event.stopPropagation();csUploadToColl('${esc(storeId)}')" title="Upload">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M12 9V11.5C12 12.1 11.6 12.5 11 12.5H3C2.4 12.5 2 12.1 2 11.5V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9.5 4.5L7 2L4.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 2V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            Upload
          </button>
          <button type="button" class="btn-studio-coll-delete" onclick="event.stopPropagation();csDeleteColl('${esc(storeId)}','${esc(displayName).replace(/'/g, "\\'")}')" title="Delete">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
      <div class="studio-coll-files">`;

    if (!files.length) {
      html += '<div class="studio-empty-msg" style="font-size:11px">No files — click Upload.</div>';
    } else {
      files.forEach(f => {
        const fName = f.displayName || f.name || 'File';
        const state = f.state || 'UNKNOWN';
        const isActive = state === 'STATE_ACTIVE';
        const fileKey = storeId + '::' + (f.name || f.displayName);
        const isFileSelected = (csSessionData.selectedFiles || []).includes(fileKey);
        const stateClass = isActive ? 'active' : (state === 'STATE_PENDING' ? 'pending' : 'failed');
        const stateLabel = isActive ? 'Active' : (state === 'STATE_PENDING' ? 'Processing...' : 'Failed');
        const stateIcon = isActive ? '✓' : (state === 'STATE_PENDING' ? '◌' : '✗');

        html += `<div class="studio-file-item ${isFileSelected ? 'file-selected' : ''}" data-file-key="${esc(fileKey)}">
          ${isActive ? `<div class="studio-file-cb" onclick="event.stopPropagation();csToggleFile('${esc(storeId)}','${esc(fileKey).replace(/'/g, "\\'")}')"><span class="studio-cb-mark ${isFileSelected ? 'checked' : ''}"></span></div>` : '<span style="width:22px;display:inline-block"></span>'}
          <svg class="studio-file-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2H9L13 6V14C13 14.6 12.6 15 12 15H3C2.4 15 2 14.6 2 14V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9 2V6H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <span class="studio-file-name">${esc(fName)}</span>
          <span class="studio-file-state ${stateClass}">${stateIcon} ${stateLabel}</span>
        </div>`;
      });
    }

    html += '</div></div>';
  });

  listEl.innerHTML = html;

  // Auto-poll pending
  const pendingTotal = csCollectionsData.reduce((s, c) => s + (c.files || []).filter(f => f.state === 'STATE_PENDING').length, 0);
  if (csPendingPoll) clearTimeout(csPendingPoll);
  if (pendingTotal > 0) {
    csPendingPoll = setTimeout(async () => {
      await csFetchCollections();
      csRenderRefCollections();
    }, 5000);
  }
}

function csToggleColl(storeId) {
  if (!csSessionData.collections) csSessionData.collections = [];
  if (!csSessionData.selectedFiles) csSessionData.selectedFiles = [];
  const store = csCollectionsData.find(s => s.name.split('/').pop() === storeId);
  const activeFiles = (store?.files || []).filter(f => f.state === 'STATE_ACTIVE');
  const idx = csSessionData.collections.indexOf(storeId);

  if (idx >= 0) {
    csSessionData.collections.splice(idx, 1);
    activeFiles.forEach(f => {
      const key = storeId + '::' + (f.name || f.displayName);
      const fi = csSessionData.selectedFiles.indexOf(key);
      if (fi >= 0) csSessionData.selectedFiles.splice(fi, 1);
    });
  } else {
    csSessionData.collections.push(storeId);
    activeFiles.forEach(f => {
      const key = storeId + '::' + (f.name || f.displayName);
      if (!csSessionData.selectedFiles.includes(key)) csSessionData.selectedFiles.push(key);
    });
  }
  csUpdateRefCheckboxes();
  csUpdateRefCounts();
}
window.csToggleColl = csToggleColl;

function csToggleFile(storeId, fileKey) {
  if (!csSessionData.selectedFiles) csSessionData.selectedFiles = [];
  if (!csSessionData.collections) csSessionData.collections = [];
  const idx = csSessionData.selectedFiles.indexOf(fileKey);
  if (idx >= 0) csSessionData.selectedFiles.splice(idx, 1);
  else csSessionData.selectedFiles.push(fileKey);

  // Update collection state
  const store = csCollectionsData.find(s => s.name.split('/').pop() === storeId);
  if (store) {
    const activeFiles = (store.files || []).filter(f => f.state === 'STATE_ACTIVE');
    const allSelected = activeFiles.length > 0 && activeFiles.every(f => csSessionData.selectedFiles.includes(storeId + '::' + (f.name || f.displayName)));
    const ci = csSessionData.collections.indexOf(storeId);
    if (allSelected && ci === -1) csSessionData.collections.push(storeId);
    else if (!allSelected && ci >= 0) csSessionData.collections.splice(ci, 1);
  }
  csUpdateRefCheckboxes();
  csUpdateRefCounts();
}
window.csToggleFile = csToggleFile;

function csUpdateRefCheckboxes() {
  document.querySelectorAll('#cs-ref-collections .studio-coll-group[data-store-id]').forEach(g => {
    const sid = g.dataset.storeId;
    const isC = csSessionData.collections.includes(sid);
    const store = csCollectionsData.find(s => s.name.split('/').pop() === sid);
    const someSelected = (store?.files || []).some(f => (csSessionData.selectedFiles || []).includes(sid + '::' + (f.name || f.displayName)));

    const cb = g.querySelector('.studio-coll-header .studio-cb-mark');
    if (cb) { cb.classList.toggle('checked', isC); cb.classList.toggle('indeterminate', !isC && someSelected); }

    g.querySelectorAll('.studio-file-item[data-file-key]').forEach(fEl => {
      const key = fEl.dataset.fileKey;
      const isSel = (csSessionData.selectedFiles || []).includes(key);
      fEl.classList.toggle('file-selected', isSel);
      const fcb = fEl.querySelector('.studio-cb-mark');
      if (fcb) fcb.classList.toggle('checked', isSel);
    });
  });
}

function csUpdateRefCounts() {
  const fileCount = (csSessionData.selectedFiles || []).length;
  const collCount = (csSessionData.collections || []).length;
  const el1 = document.getElementById('cs-ref-file-count');
  const el2 = document.getElementById('cs-ref-coll-label');
  if (el1) el1.textContent = fileCount;
  if (el2) el2.textContent = `files from ${collCount} collection${collCount !== 1 ? 's' : ''}`;
}

async function csUploadToColl(storeId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.json,.html,.xml,.md,.pptx,.rtf,.zip';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append('file', file);
      toast('info', 'Uploading...', `Uploading "${file.name}"...`);
      const res = await fetch(`/api/collections/${storeId}/files`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        toast('success', 'Uploaded', `"${file.name}" uploaded.`);
        await csFetchCollections();
        csRenderRefCollections();
      } else throw new Error(data.error || 'Upload failed');
    } catch (err) { toast('error', 'Upload Error', err.message); }
  };
  input.click();
}
window.csUploadToColl = csUploadToColl;

async function csDeleteColl(storeId, displayName) {
  if (!confirm(`Delete collection "${displayName}"? This removes all files.`)) return;
  try {
    const res = await fetch(`/api/collections/${storeId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      toast('success', 'Deleted', `"${displayName}" deleted.`);
      // Remove from selections
      csSessionData.collections = (csSessionData.collections || []).filter(c => c !== storeId);
      csSessionData.selectedFiles = (csSessionData.selectedFiles || []).filter(f => !f.startsWith(storeId + '::'));
      await csFetchCollections();
      csRenderRefCollections();
      csUpdateRefCounts();
    } else throw new Error(data.error || 'Delete failed');
  } catch (err) { toast('error', 'Delete Error', err.message); }
}
window.csDeleteColl = csDeleteColl;

// Per-session file upload (context files embedded in prompt)
function csUploadSessionFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.json,.html,.xml,.md,.pptx';
  input.onchange = (e) => csProcessSessionFiles(Array.from(e.target.files));
  input.click();
}

async function csProcessSessionFiles(files) {
  if (!csSessionData.sessionFiles) csSessionData.sessionFiles = [];
  for (const file of files) {
    if (csSessionData.sessionFiles.some(f => f.name === file.name)) { toast('info', 'Duplicate', `"${file.name}" already attached.`); continue; }
    if (file.size > 20 * 1024 * 1024) { toast('error', 'Too Large', `"${file.name}" exceeds 20MB.`); continue; }
    try {
      const content = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Read failed')); r.readAsText(file); });
      csSessionData.sessionFiles.push({ name: file.name, size: file.size, content });
    } catch (err) { toast('error', 'Read Error', err.message); }
  }
  csRenderSessionFiles();
}

function csRenderSessionFiles() {
  const listEl = document.getElementById('cs-session-files-list');
  if (!listEl) return;
  const files = csSessionData.sessionFiles || [];
  if (!files.length) { listEl.innerHTML = ''; return; }
  listEl.innerHTML = files.map((f, i) => {
    const sizeKB = (f.size / 1024).toFixed(1);
    return `<div class="studio-ctx-item">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2H9L13 6V14C13 14.6 12.6 15 12 15H3C2.4 15 2 14.6 2 14V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9 2V6H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      <div class="studio-ctx-item-info">
        <span class="studio-ctx-item-name">${esc(f.name)}</span>
        <span class="studio-ctx-item-size">${sizeKB} KB</span>
      </div>
      <button class="studio-ctx-item-remove" onclick="csRemoveSessionFile(${i})" title="Remove">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9 3L3 9M3 3L9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>`;
  }).join('');
}

function csRemoveSessionFile(idx) {
  if (!csSessionData.sessionFiles) return;
  csSessionData.sessionFiles.splice(idx, 1);
  csRenderSessionFiles();
}
window.csRemoveSessionFile = csRemoveSessionFile;

// Step 3: Org Context — with real data from DB
function csRenderStepOrgContext(el) {
  const selected = csSessionData.orgContext;
  el.innerHTML = `
    <div class="cs-wizard-card">
      <div class="cs-wizard-header sky">
        <div class="cs-wizard-header-title">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2L14 5V9C14 12 11.5 14.5 9 15C6.5 14.5 4 12 4 9V5L9 2Z" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Step 3: Organization Context <span style="background:rgba(255,255,255,0.2);padding:1px 6px;border-radius:4px;font-size:10px;font-weight:500;margin-left:4px">Required</span>
        </div>
        <div class="cs-wizard-header-desc">Select the organization profile to tailor AI-generated controls. Different profiles produce different controls for the same requirement.</div>
        <div class="cs-wizard-header-stat">
          <span class="big" id="cs-org-selected">${selected ? '✓' : '⚠'}</span>
          <span class="label">${selected ? esc(selected.nameEn || selected.name || '') : 'no profile selected — required for generation'}</span>
        </div>
      </div>
      <div class="cs-wizard-body">
        <div id="cs-org-list" style="display:flex;flex-direction:column;gap:8px">
          <div class="studio-loading"><svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-opacity="0.2"/><path d="M12 2C17.5 2 22 6.5 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Loading profiles...</span></div>
        </div>
        <p style="font-size:11px;color:#9ca3af;margin-top:10px;text-align:center">
          Don't see your org? <button class="inline-link" onclick="navigateTo('org-contexts')">Create a new Organization Context</button>.
        </p>
      </div>
      <div class="cs-wizard-footer">
        <button class="btn-admin-ghost" onclick="csSaveStep();csCurrentStep=1;csSessionData.step=1;csRenderWizard()">← Back</button>
        <button class="btn-admin-primary" onclick="csSaveStep();csCurrentStep=3;csSessionData.step=3;csRenderWizard()" ${!selected ? 'disabled title="Select an Organization Context first"' : ''}>
          Next &nbsp;→
        </button>
      </div>
    </div>`;

  // Fetch org contexts
  (async () => {
    let contexts = [];
    try {
      const d = await fetchJSON(API.orgContexts);
      contexts = d.contexts || [];
    } catch (e) { console.error('CS org contexts fetch:', e); }

    const listEl = document.getElementById('cs-org-list');
    if (!listEl) return;

    if (!contexts.length) {
      listEl.innerHTML = '<div class="studio-empty-msg" style="color:#dc2626">No Organization Contexts found. You must <button class="inline-link" onclick="navigateTo(\'org-contexts\')">create a context</button> before generating controls.</div>';
      return;
    }

    const sectorLabels = { banking: 'Banking & Financial Services', government: 'Government', healthcare: 'Healthcare', energy: 'Energy & Utilities', telecom: 'Telecommunications', education: 'Education', retail: 'Retail & E-Commerce', insurance: 'Insurance', technology: 'Technology', defense: 'Defense & Military', manufacturing: 'Manufacturing', transportation: 'Transportation & Logistics', custom: 'Custom', other: 'Other' };
    const sizeLabels = { small: 'Small', medium: 'Medium', large: 'Large', enterprise: 'Enterprise' };
    const maturityLabels = { 1: 'Initial', 2: 'Developing', 3: 'Defined', 4: 'Managed', 5: 'Optimizing' };

    let html = '';

    contexts.forEach(ctx => {
      const isSelected = selected && String(selected.id) === String(ctx.id);
      const tags = (ctx.obligatoryFrameworks || []).map(f => `<span class="badge badge-primary badge-round" style="font-size:9px">${esc(f)}</span>`).join(' ');
      const mandTags = (ctx.regulatoryMandates || []).map(m => `<span class="badge badge-amber badge-round" style="font-size:9px">${esc(m)}</span>`).join(' ');
      const sectorDisplay = ctx.sectorCustom || sectorLabels[ctx.sector] || ctx.sector || '';
      const mat = ctx.complianceMaturity || 1;
      html += `<div class="cs-org-option ${isSelected ? 'selected' : ''}" onclick="csSelectOrg('${esc(String(ctx.id))}', this)">
        <div class="cs-org-radio"><span class="cs-org-radio-dot ${isSelected ? 'active' : ''}"></span></div>
        <div class="cs-org-option-content">
          <div class="cs-org-option-name">${esc(ctx.nameEn || ctx.name)}${ctx.nameAr ? ` <span style="color:#9ca3af;font-weight:400">${esc(ctx.nameAr)}</span>` : ''}</div>
          <div class="cs-org-option-desc">
            ${sectorDisplay ? esc(sectorDisplay) : ''}
            ${ctx.size ? ' • ' + esc(sizeLabels[ctx.size] || ctx.size) : ''}
            • Maturity ${mat}/5 (${maturityLabels[mat] || mat})
            ${tags ? ' ' + tags : ''}
            ${mandTags ? ' ' + mandTags : ''}
          </div>
        </div>
      </div>`;
    });

    listEl.innerHTML = html;

    // Store contexts for selection lookup
    listEl._contexts = contexts;
  })();
}

function csSelectOrg(ctxId, rowEl) {
  // Deselect all
  document.querySelectorAll('#cs-org-list .cs-org-option').forEach(o => {
    o.classList.remove('selected');
    const dot = o.querySelector('.cs-org-radio-dot');
    if (dot) dot.classList.remove('active');
  });
  // Select clicked
  rowEl.classList.add('selected');
  const dot = rowEl.querySelector('.cs-org-radio-dot');
  if (dot) dot.classList.add('active');

  if (ctxId === null || ctxId === 'null') {
    csSessionData.orgContext = null;
  } else {
    const listEl = document.getElementById('cs-org-list');
    const contexts = listEl?._contexts || [];
    csSessionData.orgContext = contexts.find(c => String(c.id) === String(ctxId)) || null;
  }
  // Update header
  const countEl = document.getElementById('cs-org-selected');
  if (countEl) {
    countEl.textContent = csSessionData.orgContext ? '✓' : '⚠';
    const labelEl = countEl.nextElementSibling;
    if (labelEl) labelEl.textContent = csSessionData.orgContext ? (csSessionData.orgContext.nameEn || csSessionData.orgContext.name || '') : 'no profile selected — required for generation';
  }
  // Enable/disable Next button
  const nextBtn = document.querySelector('.cs-wizard-footer .btn-admin-primary');
  if (nextBtn && nextBtn.textContent.includes('Next')) {
    nextBtn.disabled = !csSessionData.orgContext;
    nextBtn.title = csSessionData.orgContext ? '' : 'Select an Organization Context first';
  }
}
window.csSelectOrg = csSelectOrg;

// Step 4: Generate
function csRenderStepGenerate(el) {
  const reqs = (csSessionData.requirements || []).length;
  const files = (csSessionData.selectedFiles || []).length + (csSessionData.sessionFiles || []).length;
  const cols = (csSessionData.collections || []).length;
  const orgCtx = csSessionData.orgContext;
  const hasOrg = orgCtx && orgCtx.nameEn;
  const maturityLabels = { 1: 'Initial', 2: 'Developing', 3: 'Defined', 4: 'Managed', 5: 'Optimizing' };

  el.innerHTML = `
    <div class="cs-wizard-card">
      <div class="cs-wizard-header navy">
        <div class="cs-wizard-header-title">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2V4M9 14V16M4 9H2M16 9H14M5 5L3.5 3.5M14.5 14.5L13 13M5 13L3.5 14.5M14.5 3.5L13 5" stroke="white" stroke-width="1.5" stroke-linecap="round"/><circle cx="9" cy="9" r="3" stroke="white" stroke-width="1.5"/></svg>
          Generate Controls
        </div>
        <div class="cs-wizard-header-desc">AI will analyze requirements and suggest applied controls tailored to your organization profile</div>
      </div>
      <div class="cs-wizard-body">
        ${!hasOrg ? `
          <div class="cs-gen-blocked">
            <div class="cs-gen-blocked-icon">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M16 4L28 28H4L16 4Z" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 13V19M16 23V23.01" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/></svg>
            </div>
            <h3 style="font-size:14px;font-weight:600;color:#dc2626;margin:0 0 4px">Organization Context Required</h3>
            <p style="font-size:12px;color:#6b7280;max-width:400px;margin:0 auto 16px">
              An Organization Context is required to generate contextual controls.
              A "Government, Enterprise, Maturity 2" org gets different controls than "Healthcare, Medium, Maturity 4" for the same requirement.
            </p>
            <button class="btn-admin-primary" onclick="csCurrentStep=2;csSessionData.step=2;csRenderWizard()">
              ← Go back to select a profile
            </button>
            <p style="font-size:11px;color:#9ca3af;margin-top:12px">
              No contexts yet? <button class="inline-link" onclick="navigateTo('org-contexts')">Create one in Org Contexts</button>.
            </p>
          </div>
        ` : `
        <div class="cs-gen-summary">
          <div class="cs-gen-box">
            <div class="cs-gen-box-header">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="#6b7280" stroke-width="1.2"/><path d="M5 7L6.5 8.5L9 5.5" stroke="#6b7280" stroke-width="1.2" stroke-linecap="round"/></svg>
              Requirements
            </div>
            <div class="cs-gen-box-val">${reqs}</div>
            <div class="cs-gen-box-sub">from selected frameworks</div>
          </div>
          <div class="cs-gen-box">
            <div class="cs-gen-box-header">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5V11C2 11.6 2.4 12 3 12H11C11.6 12 12 11.6 12 11V7C12 6.4 11.6 6 11 6H7L5.5 4H3C2.4 4 2 4.4 2 5Z" stroke="#6b7280" stroke-width="1.2" stroke-linecap="round"/></svg>
              Reference Files
            </div>
            <div class="cs-gen-box-val">${files}</div>
            <div class="cs-gen-box-sub">${cols} collection${cols !== 1 ? 's' : ''} + session files</div>
          </div>
          <div class="cs-gen-box">
            <div class="cs-gen-box-header">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1L12 4V7C12 10 9.5 12.5 7 13C4.5 12.5 2 10 2 7V4L7 1Z" stroke="#6b7280" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Organization Context
            </div>
            <div class="cs-gen-box-val">${esc(orgCtx.nameEn || orgCtx.name || '')}</div>
            <div class="cs-gen-box-sub">${esc(orgCtx.sectorCustom || orgCtx.sector || '')}, ${esc(orgCtx.size || '')}, Maturity ${orgCtx.complianceMaturity || 1}/5</div>
          </div>
        </div>
        <div class="cs-gen-ready">
          <div class="cs-gen-ready-icon">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><path d="M14 4V7M14 21V24M7 14H4M24 14H21M8 8L5.5 5.5M22.5 22.5L20 20M8 20L5.5 22.5M22.5 5.5L20 8" stroke="var(--admin-primary)" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="14" r="4" stroke="var(--admin-primary)" stroke-width="2"/></svg>
          </div>
          <h3 style="font-size:14px;font-weight:600;color:#111827;margin:0 0 4px">Ready to Generate</h3>
          <p style="font-size:12px;color:#6b7280;max-width:380px;margin:0 auto">AI will analyze each requirement against your reference documents and organization profile to suggest tailored applied controls. Existing controls from this session will be considered to avoid duplicates.</p>
        </div>
        `}
      </div>
      <div class="cs-wizard-footer">
        <button class="btn-admin-ghost" onclick="csCurrentStep=2;csSessionData.step=2;csRenderWizard()">← Back</button>
        ${hasOrg ? `<button class="btn-admin-primary" onclick="csStartGenerate()">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1V3M7 11V13M3 7H1M13 7H11M4 4L2.5 2.5M11.5 11.5L10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="7" cy="7" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg>
          Generate Controls
        </button>` : '<div></div>'}
      </div>
    </div>`;
}

let csGenerating = false;
let csJustExported = false; // true right after csDoExport, reset when navigating away

async function csStartGenerate() {
  if (csGenerating) return;
  const reqs = csSessionData.requirements || [];
  if (!reqs.length) { toast('error', 'No Requirements', 'Select at least one requirement before generating.'); return; }
  if (!csSessionData.orgContext || !csSessionData.orgContext.nameEn) {
    toast('error', 'Context Required', 'An Organization Context is required to generate controls. Go back and select one.');
    return;
  }

  csGenerating = true;
  const content = document.getElementById('cs-content');

  // Show generating progress UI
  content.innerHTML = `
    <div class="cs-wizard-card">
      <div class="cs-wizard-header navy">
        <div class="cs-wizard-header-title">
          <svg class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="2" stroke-opacity="0.3"/><path d="M12 2C17.5 2 22 6.5 22 12" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>
          Generating Controls...
        </div>
        <div class="cs-wizard-header-desc">AI is analyzing ${reqs.length} requirement${reqs.length !== 1 ? 's' : ''} and generating applied controls. This may take a few minutes.</div>
      </div>
      <div class="cs-wizard-body" style="padding:32px">
        <div class="cs-gen-progress">
          <div class="cs-gen-progress-bar-wrap">
            <div class="cs-gen-progress-bar" id="cs-progress-bar" style="width:0%"></div>
          </div>
          <div class="cs-gen-progress-text" id="cs-progress-text">Starting... 0 / ${reqs.length}</div>
          <div class="cs-gen-progress-log" id="cs-progress-log"></div>
        </div>
      </div>
    </div>`;

  try {
    // Prepare context files from session uploads
    const ctxFiles = (csSessionData.sessionFiles || []).map(f => ({
      name: f.name,
      content: f.content,
    }));

    // Build body
    const body = {
      requirements: reqs.map(r => ({
        refId: r.refId,
        name: r.name,
        description: r.description,
        frameworkName: r.frameworkName,
        nodeUrn: r.nodeUrn,
        depth: r.depth,
      })),
      orgContext: csSessionData.orgContext || null,
      contextFiles: ctxFiles.length ? ctxFiles : undefined,
    };

    // Show progress updates in the log
    const logEl = document.getElementById('cs-progress-log');
    const barEl = document.getElementById('cs-progress-bar');
    const textEl = document.getElementById('cs-progress-text');

    const addLog = (msg, type = 'info') => {
      if (logEl) {
        const d = document.createElement('div');
        d.className = 'cs-progress-log-item ' + type;
        d.textContent = msg;
        logEl.appendChild(d);
        logEl.scrollTop = logEl.scrollHeight;
      }
    };

    addLog(`Sending ${reqs.length} requirements to AI engine...`);

    const res = await fetch('/api/controls/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (barEl) barEl.style.width = '100%';
    if (textEl) textEl.textContent = `Done!`;

    if (!data.success) {
      throw new Error(data.error || 'Generation failed');
    }

    const controls = data.data?.controls || [];
    const progress = data.data?.progress || {};

    addLog(`✓ Generated ${controls.length} controls for ${progress.completed || reqs.length} requirements`, 'success');
    if (progress.failed > 0) addLog(`⚠ ${progress.failed} requirements failed`, 'warn');

    // Tag each control with a unique ID and selected=true
    csSessionData.controls = controls.map((c, i) => ({ ...c, id: 'ctrl-' + Date.now() + '-' + i, selected: true }));
    csSessionData.status = 'generated';
    csSessionData.step = 4;
    csCurrentStep = 4;

    // Save session
    csSaveStep();

    toast('success', 'Controls Generated', `${controls.length} controls generated successfully.`);

    // Brief delay to show success state
    await new Promise(r => setTimeout(r, 1200));
    csRenderWizard();

  } catch (err) {
    console.error('Controls generation error:', err);
    toast('error', 'Generation Failed', err.message);
    const logEl = document.getElementById('cs-progress-log');
    if (logEl) {
      const d = document.createElement('div');
      d.className = 'cs-progress-log-item error';
      d.textContent = '✗ ' + err.message;
      logEl.appendChild(d);
    }
    // Show retry button
    const content = document.getElementById('cs-content');
    if (content) {
      const footer = content.querySelector('.cs-wizard-footer');
      if (!footer) {
        content.querySelector('.cs-wizard-card')?.insertAdjacentHTML('beforeend', `
          <div class="cs-wizard-footer">
            <button class="btn-admin-ghost" onclick="csCurrentStep=3;csSessionData.step=3;csRenderWizard()">← Back</button>
            <button class="btn-admin-primary" onclick="csStartGenerate()">Retry</button>
          </div>`);
      }
    }
  } finally {
    csGenerating = false;
  }
}
window.csStartGenerate = csStartGenerate;

// Step 5: Review
function csRenderStepReview(el) {
  const controls = csSessionData.controls || [];
  const selectedCount = controls.filter(c => c.selected !== false).length;
  let exportedIds = csSessionData.exportedControlIds || [];
  // Legacy: if session exported but no IDs tracked, treat all as exported
  if (exportedIds.length === 0 && csSessionData.status === 'exported') {
    exportedIds = controls.map(c => c.id).filter(Boolean);
  }
  const hasExported = exportedIds.length > 0;
  const alreadyExportedCount = hasExported ? controls.filter(c => exportedIds.includes(c.id)).length : 0;
  const newCount = hasExported ? controls.length - alreadyExportedCount : controls.length;

  // Category / CSF / Priority configs (GRC-compatible)
  const catLabel = { policy: 'Policy', process: 'Process', technical: 'Technical', physical: 'Physical', preventive: 'Preventive', detective: 'Detective', corrective: 'Corrective', directive: 'Directive' };
  const catColor = { policy: 'cs-tag-blue', process: 'cs-tag-amber', technical: 'cs-tag-emerald', physical: 'cs-tag-gray', preventive: 'cs-tag-blue', detective: 'cs-tag-orange', corrective: 'cs-tag-red', directive: 'cs-tag-teal' };
  const csfLabel = { identify: 'Identify', protect: 'Protect', detect: 'Detect', respond: 'Respond', recover: 'Recover', govern: 'Govern' };
  const csfColor = { identify: 'cs-tag-sky', protect: 'cs-tag-teal', detect: 'cs-tag-orange', respond: 'cs-tag-red', recover: 'cs-tag-emerald', govern: 'cs-tag-gray' };
  // Support both integer (GRC: 1-4) and string (legacy) priorities
  const prioLabel = { 1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low', critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
  const prioColor = { 1: 'cs-tag-red', 2: 'cs-tag-red', 3: 'cs-tag-amber', 4: 'cs-tag-gray', critical: 'cs-tag-red', high: 'cs-tag-red', medium: 'cs-tag-amber', low: 'cs-tag-gray' };

  // Read-only mode for exported sessions
  const readOnly = csSessionData.status === 'exported';

  el.innerHTML = `
    <div class="cs-review-card">
      <div class="cs-review-header">
        <div class="cs-review-header-row">
          ${readOnly
            ? '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 9C2 9 5 4 9 4C13 4 16 9 16 9C16 9 13 14 9 14C5 14 2 9 2 9Z" stroke="white" stroke-width="1.5"/><circle cx="9" cy="9" r="2.5" stroke="white" stroke-width="1.5"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M5 9L8 12L13 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'}
          <span class="cs-review-header-title">${readOnly ? 'Export Results' : 'Step 5: Review & Edit'}</span>
        </div>
        <p class="cs-review-header-desc">${readOnly
          ? 'Viewing previously exported controls. You can re-export selected controls or start a new session.'
          : 'Review AI-generated control suggestions. Edit, add, or remove controls before exporting.'}</p>
        <div class="cs-review-header-stats">
          <span class="cs-review-big" id="cs-review-selected">${selectedCount}</span>
          <span class="cs-review-of">of ${controls.length} selected</span>
          ${hasExported ? `
            <span class="cs-review-divider"></span>
            <span class="cs-review-exported-badge">${alreadyExportedCount} already exported</span>
            <span class="cs-review-of">|</span>
            <span class="cs-review-new-badge">${newCount} new</span>
          ` : ''}
        </div>
      </div>
      <div class="cs-review-body">
        ${controls.length ? `
          <div class="cs-review-toolbar">
            <div class="cs-review-toolbar-left">
              ${!readOnly ? `
                <button class="cs-toolbar-btn" onclick="csSelectAllControls(true)">Select All</button>
                <button class="cs-toolbar-btn cs-toolbar-btn-ghost" onclick="csSelectAllControls(false)">Deselect All</button>
              ` : ''}
              ${hasExported ? `
                <div class="cs-filter-tabs">
                  <svg class="cs-filter-icon" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 2H11L7 6.5V9L5 10V6.5L1 2Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  <button class="cs-filter-tab active" data-filter="all" onclick="csFilterControls('all',this)">All (${controls.length})</button>
                  <button class="cs-filter-tab" data-filter="new" onclick="csFilterControls('new',this)">New (${newCount})</button>
                  <button class="cs-filter-tab" data-filter="existing" onclick="csFilterControls('existing',this)">Existing (${alreadyExportedCount})</button>
                </div>
              ` : ''}
            </div>
            ${!readOnly ? `
              <button class="cs-toolbar-btn cs-toolbar-add" onclick="csAddManualControl()">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2V10M2 6H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                Add Manual Control
              </button>
            ` : ''}
          </div>
          <div class="cs-ctrl-list" id="cs-ctrl-list">
            ${controls.map((c, i) => {
              const isSelected = c.selected !== false;
              const isExported = exportedIds.includes(c.id);
              const cat = c.category || c.control_type || '';
              const csf = c.csf_function || c.csfFunction || '';
              const prio = c.priority || c.implementation_priority || '';
              return `<div class="cs-ctrl-item ${isSelected ? 'cs-ctrl-selected' : 'cs-ctrl-deselected'} ${isExported ? 'cs-ctrl-exported' : ''}" data-ctrl-id="${esc(c.id)}" data-exported="${isExported}">
                <div class="cs-ctrl-row-main">
                  ${!readOnly ? `
                    <div class="cs-ctrl-check" onclick="csToggleControl('${esc(c.id)}')">
                      <div class="cs-ctrl-checkbox ${isSelected ? 'checked' : ''}">
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      </div>
                    </div>
                  ` : ''}
                  <div class="cs-ctrl-content" onclick="csExpandControl('${esc(c.id)}')">
                    <div class="cs-ctrl-name-line">
                      <span class="cs-ctrl-name" dir="rtl">${esc(c.name || c.name_ar || 'Control ' + (i+1))}</span>
                      ${isExported ? `<span class="cs-exported-pill"><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.2"/><path d="M4 6L5.5 7.5L8 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg> Already exported</span>` : ''}
                    </div>
                    <div class="cs-ctrl-desc-line" dir="rtl">${esc(c.description || '')}</div>
                  </div>
                  <div class="cs-ctrl-tags">
                    ${cat ? `<span class="cs-tag ${catColor[cat] || 'cs-tag-gray'}">${esc(catLabel[cat] || cat)}</span>` : ''}
                    ${csf ? `<span class="cs-tag ${csfColor[csf] || 'cs-tag-gray'}">${esc(csfLabel[csf] || csf)}</span>` : ''}
                    ${prio ? `<span class="cs-tag ${prioColor[prio] || 'cs-tag-gray'}">${esc(prioLabel[prio] || prio)}</span>` : ''}
                  </div>
                  ${!readOnly ? `
                    <button class="cs-ctrl-edit-btn" onclick="event.stopPropagation();csExpandControl('${esc(c.id)}')" title="Edit">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                  ` : ''}
                  <svg class="cs-ctrl-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                </div>
                <div class="cs-ctrl-expand" id="cs-ctrl-expand-${esc(c.id)}">
                  ${c.implementation_guidance ? `<div class="cs-ctrl-detail"><span class="cs-ctrl-detail-label">Implementation Guidance</span><p>${esc(c.implementation_guidance)}</p></div>` : ''}
                  ${c.rationale ? `<div class="cs-ctrl-detail"><span class="cs-ctrl-detail-label">Rationale</span><p>${esc(c.rationale)}</p></div>` : ''}
                  ${c.requirementRefId ? `<div class="cs-ctrl-detail"><span class="cs-ctrl-detail-label">Cross-Framework Mapping</span><div class="cs-ctrl-detail-pills"><span class="cs-tag cs-tag-mono">${esc(c.requirementRefId)}</span>${c.requirementName ? `<span class="cs-tag cs-tag-primary">${esc(c.requirementName)}</span>` : ''}</div></div>` : ''}
                  ${c.framework ? `<div class="cs-ctrl-detail"><span class="cs-ctrl-detail-label">Framework</span><span class="cs-tag cs-tag-primary">${esc(c.framework)}</span></div>` : ''}
                  ${(c.effort || c.effort_estimate) ? `<div class="cs-ctrl-detail"><span class="cs-ctrl-detail-label">Effort</span><span class="cs-tag cs-tag-gray">${esc(c.effort || c.effort_estimate)}</span></div>` : ''}
                  ${c.status ? `<div class="cs-ctrl-detail"><span class="cs-ctrl-detail-label">Status</span><span class="cs-tag cs-tag-gray">${esc(c.status)}</span></div>` : ''}
                  ${(c.evidence_examples && c.evidence_examples.length) ? `<div class="cs-ctrl-detail"><span class="cs-ctrl-detail-label">Evidence Examples</span><div class="cs-ctrl-detail-pills">${c.evidence_examples.map(e => `<span class="cs-tag cs-tag-gray">${esc(e)}</span>`).join('')}</div></div>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>
        ` : `
          <div class="cs-review-empty">No controls generated yet. Go back and generate controls.</div>
        `}
      </div>
      <div class="cs-review-footer">
        <button class="cs-footer-back" onclick="${readOnly ? "csCachedSessions=null;csShowSessions()" : "csCurrentStep=3;csSessionData.step=3;csRenderWizard()"}">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L5 7L9 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          ${readOnly ? 'Back to Sessions' : 'Back'}
        </button>
        <div class="cs-footer-right">
          ${!readOnly ? `
            <span class="cs-footer-count" id="cs-review-footer-count">${selectedCount} controls selected</span>
            <button class="btn-admin-primary" onclick="csSaveStep();csCurrentStep=5;csSessionData.step=5;csRenderWizard()">
              Proceed to Export
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          ` : `
            <button class="btn-admin-primary" onclick="csSaveStep();csCurrentStep=5;csSessionData.step=5;csRenderWizard()">
              Re-Export Selected
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          `}
        </div>
      </div>
    </div>`;
}

function csExpandControl(ctrlId) {
  const expandEl = document.getElementById('cs-ctrl-expand-' + ctrlId);
  if (!expandEl) return;
  const item = expandEl.closest('.cs-ctrl-item');
  if (!item) return;
  item.classList.toggle('expanded');
}
window.csExpandControl = csExpandControl;

function csFilterControls(filter, btn) {
  // Update active tab
  document.querySelectorAll('.cs-filter-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const exportedIds = csSessionData.exportedControlIds || [];
  document.querySelectorAll('.cs-ctrl-item[data-ctrl-id]').forEach(item => {
    const isExported = item.getAttribute('data-exported') === 'true';
    if (filter === 'all') item.style.display = '';
    else if (filter === 'new') item.style.display = isExported ? 'none' : '';
    else if (filter === 'existing') item.style.display = isExported ? '' : 'none';
  });
}
window.csFilterControls = csFilterControls;

function csAddManualControl() {
  const controls = csSessionData.controls = csSessionData.controls || [];
  const newCtrl = {
    id: 'ctrl-manual-' + Date.now(),
    name: 'New Manual Control',
    description: '',
    category: 'process',
    csfFunction: 'govern',
    priority: 'medium',
    selected: true,
    framework: '',
    requirementRefId: '',
  };
  controls.push(newCtrl);
  csSaveStep();
  csRenderWizard();
  toast('info', 'Added', 'Manual control added. Expand it to edit details.');
}
window.csAddManualControl = csAddManualControl;

function csToggleControl(ctrlId) {
  const ctrl = (csSessionData.controls || []).find(c => c.id === ctrlId);
  if (!ctrl) return;
  ctrl.selected = ctrl.selected === false ? true : false;

  // Update DOM without full re-render
  const item = document.querySelector(`.cs-ctrl-item[data-ctrl-id="${ctrlId}"]`);
  if (item) {
    item.classList.toggle('cs-ctrl-deselected', !ctrl.selected);
    item.classList.toggle('cs-ctrl-selected', ctrl.selected);
    const cb = item.querySelector('.cs-ctrl-checkbox');
    if (cb) cb.classList.toggle('checked', ctrl.selected);
  }
  csUpdateReviewCount();
}
window.csToggleControl = csToggleControl;

function csSelectAllControls(selectAll) {
  (csSessionData.controls || []).forEach(c => c.selected = selectAll);
  document.querySelectorAll('.cs-ctrl-item[data-ctrl-id]').forEach(item => {
    item.classList.toggle('cs-ctrl-deselected', !selectAll);
    item.classList.toggle('cs-ctrl-selected', selectAll);
    const cb = item.querySelector('.cs-ctrl-checkbox');
    if (cb) cb.classList.toggle('checked', selectAll);
  });
  csUpdateReviewCount();
}
window.csSelectAllControls = csSelectAllControls;

function csUpdateReviewCount() {
  const selected = (csSessionData.controls || []).filter(c => c.selected !== false).length;
  const el = document.getElementById('cs-review-selected');
  if (el) el.textContent = selected;
  const fc = document.getElementById('cs-review-footer-count');
  if (fc) fc.textContent = selected + ' controls selected';
}


// Step 6: Export
function csRenderStepExport(el) {
  const controls = csSessionData.controls || [];
  const selected = controls.filter(c => c.selected !== false);
  const total = selected.length;
  const fwSet = new Set(); const reqSet = new Set();
  selected.forEach(c => { if (c.framework) fwSet.add(c.framework); if (c.requirementRefId) reqSet.add(c.requirementRefId); });

  if (csSessionData.status === 'exported' && csJustExported) {
    csJustExported = false; // reset the flag
    // ── Export Complete view (only shown right after actual export) ──
    el.innerHTML = `
      <div class="cs-review-card">
        <div class="cs-export-header-done">
          <div class="cs-review-header-row">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M5 9L8 12L13 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="9" r="7" stroke="white" stroke-width="1.5"/></svg>
            <span class="cs-review-header-title">Export Complete</span>
          </div>
          <p class="cs-review-header-desc" style="color:#bbf7d0">Controls have been successfully exported to WathbaGRC.</p>
        </div>
        <div class="cs-export-done-body">
          <div class="cs-export-done-icon">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="12" stroke="#10b981" stroke-width="2"/><path d="M11 16L14 19L21 12" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <h3 class="cs-export-done-title">Successfully Exported to WathbaGRC</h3>
          <div class="cs-export-done-stats">
            <div class="cs-export-done-stat cs-export-done-stat-emerald">
              <div class="cs-export-done-stat-val">${total}</div>
              <div class="cs-export-done-stat-label">Controls Created</div>
            </div>
            <div class="cs-export-done-stat cs-export-done-stat-gray">
              <div class="cs-export-done-stat-val">0</div>
              <div class="cs-export-done-stat-label">Failed</div>
            </div>
          </div>
          <div class="cs-export-done-meta">
            <div class="cs-export-meta-row"><span>Frameworks</span><span>${esc([...fwSet].join(', ') || '—')}</span></div>
            <div class="cs-export-meta-row"><span>Linked Requirements</span><span>${reqSet.size}</span></div>
            <div class="cs-export-meta-row"><span>Exported At</span><span>${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
          </div>
          <div class="cs-export-done-actions">
            <button class="btn-admin-primary" onclick="csNewSession()">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              New Session
            </button>
            <button class="cs-footer-back" onclick="csCachedSessions=null;csShowSessions()">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4H14M2 8H14M2 12H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              Session History
            </button>
            <button class="cs-footer-merge" onclick="navigateTo('merge-optimizer')">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 4L8 7L11 4M5 9L8 12L11 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Merge Optimizer
            </button>
          </div>
        </div>
      </div>`;
    return;
  }

  // Exported tracking — if session was already exported but exportedControlIds is empty (legacy), treat all as exported
  let exportedIds = csSessionData.exportedControlIds || [];
  if (exportedIds.length === 0 && csSessionData.status === 'exported') {
    exportedIds = selected.map(c => c.id).filter(Boolean);
  }
  const hasExportedIds = exportedIds.length > 0;
  const newControls = hasExportedIds ? selected.filter(c => !exportedIds.includes(c.id)) : selected;
  const skippedControls = hasExportedIds ? selected.filter(c => exportedIds.includes(c.id)) : [];
  const allExist = hasExportedIds && newControls.length === 0;

  // ── Pre-export summary ──
  el.innerHTML = `
    <div class="cs-review-card">
      <div class="cs-review-header">
        <div class="cs-review-header-row">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M14 9V14C14 14.6 13.6 15 13 15H5C4.4 15 4 14.6 4 14V9" stroke="white" stroke-width="1.5" stroke-linecap="round"/><path d="M6 7L9 4L12 7M9 4V11" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span class="cs-review-header-title">Step 6: Export to WathbaGRC</span>
        </div>
        <p class="cs-review-header-desc">Confirm and push selected controls to WathbaGRC via REST API.</p>
      </div>
      <div class="cs-export-body">
        <h3 class="cs-export-summary-title">Export Summary</h3>
        <div class="cs-export-summary-box">
          <div class="cs-export-summary-row"><span>Controls to Export</span><span class="cs-export-val-bold">${total}</span></div>
          ${hasExportedIds ? `
            <div class="cs-export-summary-row"><span>New Controls</span><span class="cs-export-val-sky">${newControls.length}</span></div>
            <div class="cs-export-summary-row"><span>Already Exist (will skip)</span><span class="cs-export-val-amber">${skippedControls.length}</span></div>
          ` : ''}
          <div class="cs-export-summary-row"><span>Target Frameworks</span><span>${fwSet.size}</span></div>
          <div class="cs-export-summary-row"><span>Linked Requirements</span><span>${reqSet.size}</span></div>
        </div>

        <div class="cs-export-folder-section">
          <label class="cs-export-folder-label">Target Folder (Domain)</label>
          <p style="font-size:11px;color:#9ca3af;margin:0 0 8px">Select the GRC folder where controls will be created</p>
          <select id="cs-export-folder" class="cs-export-folder-select">
            <option value="">Loading folders...</option>
          </select>
          <div id="cs-export-grc-status" style="font-size:11px;margin-top:6px;color:#9ca3af"></div>
        </div>

        ${allExist ? `
          <div class="cs-export-merge-warning">
            <p>All selected controls already exist in WathbaGRC. Consider using the <strong>Merge Optimizer</strong> to consolidate and upgrade existing controls instead of re-exporting.</p>
            <button class="cs-merge-btn" onclick="navigateTo('merge-optimizer')">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 4L8 7L11 4M5 9L8 12L11 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Open Merge Optimizer
            </button>
          </div>
        ` : `
          <div class="cs-export-warning">
            This will create ${newControls.length || total} AppliedControls in WathbaGRC. Controls will be linked to their originating RequirementNodes and available across all audits.
          </div>
        `}
        <div class="cs-export-cta">
          <button class="btn-admin-primary" id="cs-export-btn" onclick="csDoExport()">Confirm Export</button>
        </div>
        <div id="cs-export-progress" style="display:none">
          <div class="cs-export-progress-row">
            <svg class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-opacity="0.2"/><path d="M12 2C17.5 2 22 6.5 22 12" stroke="var(--admin-primary)" stroke-width="2" stroke-linecap="round"/></svg>
            <span>Exporting controls to WathbaGRC...</span>
          </div>
          <div class="cs-export-progress-bar"><div class="cs-export-progress-fill" id="cs-export-fill"></div></div>
          <div class="cs-export-progress-text" id="cs-export-progress-text">Starting...</div>
        </div>
      </div>
      <div class="cs-review-footer">
        <button class="cs-footer-back" onclick="csCurrentStep=4;csSessionData.step=4;csRenderWizard()">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L5 7L9 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          Back
        </button>
        <div></div>
      </div>
    </div>`;

  // Load GRC folders for the dropdown
  csLoadGrcFolders();
}

async function csLoadGrcFolders() {
  const select = document.getElementById('cs-export-folder');
  const statusEl = document.getElementById('cs-export-grc-status');
  if (!select) return;

  try {
    // First check GRC config
    const statusRes = await fetch('/api/grc/status');
    const statusData = await statusRes.json();

    if (!statusData.configured) {
      select.innerHTML = '<option value="">⚠ GRC not configured</option>';
      if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444">GRC API not reachable. Export will save locally only.</span>';
      return;
    }

    if (statusEl) statusEl.textContent = `Connected to ${statusData.url}`;

    const res = await fetch('/api/grc/folders');
    const data = await res.json();

    if (!data.success || !data.folders || data.folders.length === 0) {
      select.innerHTML = '<option value="">No folders found</option>';
      return;
    }

    select.innerHTML = '<option value="">— Select a folder —</option>' +
      data.folders.map(f => `<option value="${esc(f.id)}">${esc(f.name || f.str || f.id)}</option>`).join('');

    // Restore previously selected folder
    const savedFolder = csSessionData.exportFolder;
    if (savedFolder) select.value = savedFolder;

  } catch (err) {
    console.error('[GRC] Load folders error:', err);
    select.innerHTML = '<option value="">Error loading folders</option>';
    if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444">${err.message}</span>`;
  }
}
window.csLoadGrcFolders = csLoadGrcFolders;

async function csDoExport() {
  const btn = document.getElementById('cs-export-btn');
  const progressEl = document.getElementById('cs-export-progress');
  const fillEl = document.getElementById('cs-export-fill');
  const textEl = document.getElementById('cs-export-progress-text');

  const folderSelect = document.getElementById('cs-export-folder');
  const folder = folderSelect?.value;

  const controls = (csSessionData.controls || []).filter(c => c.selected !== false);
  const total = controls.length;

  // Check if GRC is configured
  let grcConfigured = false;
  try {
    const statusRes = await fetch('/api/grc/status');
    const statusData = await statusRes.json();
    grcConfigured = statusData.configured;
  } catch (_) {}

  // If GRC is configured, require folder
  if (grcConfigured && !folder) {
    toast('error', 'Folder Required', 'Please select a target folder before exporting.');
    return;
  }

  if (btn) btn.style.display = 'none';
  if (progressEl) progressEl.style.display = '';

  // Save selected folder for future reference
  if (folder) csSessionData.exportFolder = folder;

  if (grcConfigured && folder) {
    // ── Real GRC Export ──
    try {
      if (textEl) textEl.textContent = 'Sending controls to WathbaGRC...';
      if (fillEl) fillEl.style.width = '20%';

      const res = await fetch('/api/grc/applied-controls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ controls, folder })
      });

      if (fillEl) fillEl.style.width = '80%';

      const data = await res.json();

      if (fillEl) fillEl.style.width = '100%';

      if (data.exported > 0) {
        if (textEl) textEl.textContent = `${data.exported} controls exported successfully${data.failed > 0 ? `, ${data.failed} failed` : ''}`;
        toast('success', 'Export Complete', `${data.exported} controls exported to WathbaGRC.${data.failed > 0 ? ` ${data.failed} failed.` : ''}`);

        // Mark exported control IDs
        const prevExported = csSessionData.exportedControlIds || [];
        const newlyExported = (data.results || []).map(r => r.controlId).filter(Boolean);
        csSessionData.exportedControlIds = [...new Set([...prevExported, ...newlyExported])];

        // Store GRC IDs on the controls for future reference
        (data.results || []).forEach(r => {
          const ctrl = csSessionData.controls.find(c => c.id === r.controlId);
          if (ctrl) ctrl.grcId = r.grcId;
        });
      } else {
        throw new Error(data.error || `All ${data.failed} controls failed to export`);
      }

      csSessionData.status = 'exported';
      await csSaveSession(csSessionData);
      csJustExported = true;
      csRenderWizard();

    } catch (err) {
      console.error('[Export] GRC export error:', err);
      toast('error', 'Export Failed', err.message);
      if (btn) btn.style.display = '';
      if (progressEl) progressEl.style.display = 'none';
    }

  } else {
    // ── Local-only export (GRC not configured) ──
    for (let i = 0; i < total; i++) {
      const pct = Math.round(((i + 1) / total) * 100);
      if (fillEl) fillEl.style.width = pct + '%';
      if (textEl) textEl.textContent = `Marking control ${i + 1} of ${total}...`;
      await new Promise(r => setTimeout(r, 120));
    }

    const prevExported = csSessionData.exportedControlIds || [];
    const newlyExported = controls.map(c => c.id).filter(Boolean);
    csSessionData.exportedControlIds = [...new Set([...prevExported, ...newlyExported])];
    csSessionData.status = 'exported';
    await csSaveSession(csSessionData);
    toast('success', 'Export Complete', `${total} controls marked as exported (GRC not configured — local only).`);
    csJustExported = true;
    csRenderWizard();
  }
}
window.csDoExport = csDoExport;

// ─── Merge Optimizer ──────────────────────────────────────────

let moPhase = 'setup'; // setup | analyzing | results | applied
let moSessions = [];
let moExistingControls = [];
let moSuggestions = [];
let moMergeHistory = [];
let moSelectedSessionId = '';
let moSearchQuery = '';

async function loadMergeOptimizer() {
  moPhase = 'setup';
  moSuggestions = [];
  moSelectedSessionId = '';

  // Fetch sessions from CS API
  try {
    const res = await fetch(API.csSessions);
    const data = await res.json();
    moSessions = (data.success ? (data.sessions || data.data || []) : []).filter(s => s.status === 'exported' || s.status === 'generated' || (s.controls && s.controls.length > 0));
  } catch (e) { moSessions = []; console.error('loadMergeOptimizer sessions:', e); }

  console.log('[MO] Sessions loaded:', moSessions.length, moSessions.map(s => ({ id: s.id, name: s.name, status: s.status, controls: (s.controls||[]).length })));

  // Build existing controls from all exported sessions
  moExistingControls = [];
  moSessions.filter(s => s.status === 'exported').forEach(s => {
    (s.controls || []).forEach(c => {
      moExistingControls.push({
        id: c.id,
        name: c.name || c.name_ar || '',
        description: c.description || '',
        requirementIds: [c.requirementRefId].filter(Boolean),
        frameworkNames: [c.framework].filter(Boolean),
        exportedAt: s.updated_at || s.created_at || '',
        sessionId: s.id,
      });
    });
  });

  console.log('[MO] Existing controls built:', moExistingControls.length);

  // Build merge history from localStorage
  moMergeHistory = JSON.parse(localStorage.getItem('mo_merge_history') || '[]');

  moRender();
}

function moRender() {
  const gridEl = document.getElementById('mo-grid');
  const analyzingEl = document.getElementById('mo-analyzing');
  const appliedEl = document.getElementById('mo-applied');

  if (moPhase === 'analyzing') {
    gridEl.style.display = 'none';
    appliedEl.style.display = 'none';
    analyzingEl.style.display = '';
    analyzingEl.innerHTML = `
      <div class="mo-analyzing-card">
        <div class="mo-analyzing-icon">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><path d="M14 4L16.5 10L23 10.5L18 15L19.5 22L14 19L8.5 22L10 15L5 10.5L11.5 10L14 4Z" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round" class="mo-pulse"/></svg>
        </div>
        <h3>Analyzing Controls for Merge Opportunities</h3>
        <p>AI is comparing new controls against existing platform controls to find merge candidates...</p>
        <div class="mo-progress-bar"><div class="mo-progress-fill" id="mo-progress-fill"></div></div>
        <div class="mo-progress-text">
          <svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-opacity="0.2"/><path d="M12 2C17.5 2 22 6.5 22 12" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/></svg>
          <span>Comparing requirement mappings and control scope...</span>
        </div>
      </div>`;
    return;
  }

  if (moPhase === 'applied') {
    gridEl.style.display = 'none';
    analyzingEl.style.display = 'none';
    appliedEl.style.display = '';
    const accepted = moSuggestions.filter(s => s.status === 'accepted').length;
    const rejected = moSuggestions.filter(s => s.status === 'rejected').length;
    const unchanged = moExistingControls.length - accepted;
    appliedEl.innerHTML = `
      <div class="cs-review-card">
        <div class="cs-export-header-done">
          <div class="cs-review-header-row">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M5 9L8 12L13 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="9" r="7" stroke="white" stroke-width="1.5"/></svg>
            <span class="cs-review-header-title">Merges Applied Successfully</span>
          </div>
          <p class="cs-review-header-desc" style="color:#bbf7d0">Controls have been merged and updated in WathbaGRC.</p>
        </div>
        <div class="cs-export-done-body">
          <div class="cs-export-done-icon">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M24 8L24 24M8 10V16C8 19.3 10.7 22 14 22H24M8 10L5 13M8 10L11 13" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <h3 class="cs-export-done-title">Merge Operation Complete</h3>
          <p style="font-size:12px;color:#6b7280;margin:0 0 20px">Your controls have been consolidated in WathbaGRC</p>
          <div class="cs-export-done-stats" style="grid-template-columns:repeat(3,1fr);max-width:400px">
            <div class="cs-export-done-stat cs-export-done-stat-emerald">
              <div class="cs-export-done-stat-val">${accepted}</div>
              <div class="cs-export-done-stat-label">Controls Merged</div>
            </div>
            <div class="cs-export-done-stat cs-export-done-stat-gray">
              <div class="cs-export-done-stat-val">${unchanged}</div>
              <div class="cs-export-done-stat-label">Unchanged</div>
            </div>
            <div class="cs-export-done-stat" style="background:#fef2f2;border-color:#fecaca">
              <div class="cs-export-done-stat-val" style="color:#ef4444">${rejected}</div>
              <div class="cs-export-done-stat-label" style="color:#ef4444">Rejected</div>
            </div>
          </div>
          <div class="cs-export-done-meta">
            <div class="cs-export-meta-row"><span>Applied At</span><span>${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
            <div class="cs-export-meta-row"><span>Service Account</span><span style="font-family:var(--font-mono);font-size:10px">admin@wathba-grc</span></div>
            <div class="cs-export-meta-row"><span>Method</span><span>In-place update (existing IDs preserved)</span></div>
          </div>
          <div class="cs-export-done-actions">
            <button class="btn-admin-primary" onclick="moReset()">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              Run Another Analysis
            </button>
          </div>
        </div>
      </div>`;
    return;
  }

  // setup or results
  gridEl.style.display = '';
  analyzingEl.style.display = 'none';
  appliedEl.style.display = 'none';

  // Populate session dropdown
  const select = document.getElementById('mo-session-select');
  const currentVal = select.value;
  select.innerHTML = '<option value="">Select a session...</option>' +
    moSessions.map(s => {
      const cCount = (s.controls || []).length;
      const statusLabel = s.status === 'exported' ? '✓ exported' : s.status === 'generated' ? '● generated' : s.status;
      return `<option value="${esc(s.id)}">${esc(s.name || 'Unnamed')} — ${cCount} controls (${statusLabel})</option>`;
    }).join('');
  select.value = moSelectedSessionId || currentVal || '';
  select.onchange = function () {
    moSelectedSessionId = this.value;
    moRenderSessionInfo();
    document.getElementById('mo-analyze-btn').disabled = !moSelectedSessionId;
  };
  document.getElementById('mo-analyze-btn').disabled = !moSelectedSessionId;
  document.getElementById('mo-analyze-btn').style.display = moPhase === 'setup' ? '' : 'none';

  moRenderSessionInfo();
  moRenderHistory();
  moRenderCenter();
  moRenderExisting();
}

function moRenderSessionInfo() {
  const el = document.getElementById('mo-session-info');
  const session = moSessions.find(s => s.id === moSelectedSessionId);
  if (!session) { el.innerHTML = ''; return; }
  const ctrls = session.controls || [];
  const fwSet = new Set();
  (session.requirements || []).forEach(r => { if (r.frameworkName) fwSet.add(r.frameworkName); });
  // Fallback: get framework names from controls if requirements is empty
  if (!fwSet.size) ctrls.forEach(c => { if (c.framework) fwSet.add(c.framework); });
  const orgName = session.orgContext?.nameEn || session.orgContext?.nameAr || session.orgContext?.name || '';
  el.innerHTML = `
    <div class="mo-session-detail">
      <div class="mo-session-detail-name">${esc(session.name || 'Unnamed')}</div>
      ${orgName ? `<div class="mo-session-detail-org">${esc(orgName)}</div>` : ''}
      <div class="mo-session-detail-meta">${ctrls.length} generated <span class="mo-sep">|</span> ${ctrls.filter(c => c.selected !== false).length} selected</div>
      ${fwSet.size ? `<div class="mo-session-fw-pills">${[...fwSet].map(f => `<span class="cs-tag cs-tag-sky">${esc(f)}</span>`).join('')}</div>` : ''}
    </div>`;
}

function moRenderHistory() {
  const el = document.getElementById('mo-history-list');
  if (!moMergeHistory.length) {
    el.innerHTML = '<div class="mo-history-empty">No merge history yet</div>';
    return;
  }
  el.innerHTML = moMergeHistory.map(rec => `
    <div class="mo-history-row">
      <div class="mo-history-name">${esc(rec.sessionName)}</div>
      <div class="mo-history-stats">
        <span class="mo-history-accepted">${rec.accepted} accepted</span>
        <span class="mo-sep">|</span>
        <span class="mo-history-rejected">${rec.rejected} rejected</span>
      </div>
      <div class="mo-history-date">${esc(rec.timestamp)}</div>
    </div>`).join('');
}

function moRenderCenter() {
  const el = document.getElementById('mo-center');
  if (moPhase === 'results' && moSuggestions.length > 0) {
    const pending = moSuggestions.filter(s => s.status === 'pending').length;
    const accepted = moSuggestions.filter(s => s.status === 'accepted').length;
    const rejected = moSuggestions.filter(s => s.status === 'rejected').length;

    let h = `
      <div class="mo-suggestions-header">
        <div>
          <h2 class="mo-suggestions-title">Merge Suggestions</h2>
          <p class="mo-suggestions-subtitle">${pending} pending, ${accepted} accepted, ${rejected} rejected</p>
        </div>
        ${accepted > 0 && pending === 0 ? `
          <button class="mo-apply-btn" onclick="moApplyMerges()">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Apply ${accepted} Merges
          </button>` : ''}
      </div>
      <div class="mo-suggestions-list">`;

    moSuggestions.forEach(sug => {
      const confCfg = { high: { label: 'High confidence', cls: 'mo-conf-high' }, medium: { label: 'Medium confidence', cls: 'mo-conf-medium' }, low: { label: 'Low confidence', cls: 'mo-conf-low' } };
      const conf = confCfg[sug.confidence] || confCfg.medium;
      const statusBadge = sug.status === 'accepted' ? '<span class="mo-status-badge mo-status-accepted">Accepted</span>' : sug.status === 'rejected' ? '<span class="mo-status-badge mo-status-rejected">Rejected</span>' : '';

      h += `
        <div class="mo-sug-card mo-sug-${sug.status}" data-sug-id="${esc(sug.id)}">
          <div class="mo-sug-top">
            <div class="mo-sug-badges">
              <span class="mo-conf-badge ${conf.cls}"><span class="mo-conf-dot"></span>${conf.label}</span>
              ${statusBadge}
            </div>
            <button class="mo-sug-expand-btn" onclick="moToggleSuggestion('${esc(sug.id)}')">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="mo-sug-chevron"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="mo-sug-controls">
            <div class="mo-sug-box mo-sug-box-new">
              <div class="mo-sug-box-label">New Control</div>
              <div class="mo-sug-box-name" dir="rtl">${esc(sug.sourceControlName)}</div>
            </div>
            <svg class="mo-sug-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8H13M10 5L13 8L10 11" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <div class="mo-sug-box mo-sug-box-existing">
              <div class="mo-sug-box-label">Existing Control</div>
              <div class="mo-sug-box-name" dir="rtl">${esc(sug.targetControlName)}</div>
            </div>
          </div>
          <div class="mo-sug-merged">
            <div class="mo-sug-box-label" style="color:var(--admin-primary)">Merged Result</div>
            <div class="mo-sug-box-name" dir="rtl">${esc(sug.mergedName)}</div>
            <div class="mo-sug-merged-desc" dir="rtl">${esc(sug.mergedDescription)}</div>
          </div>
          <div class="mo-sug-expand" id="mo-sug-expand-${esc(sug.id)}">
            <div class="mo-sug-detail"><span class="mo-sug-detail-label">AI Rationale</span><p>${esc(sug.rationale)}</p></div>
            ${sug.combinedRequirementIds?.length ? `<div class="mo-sug-detail"><span class="mo-sug-detail-label">Combined Requirements</span><div class="mo-sug-pills">${sug.combinedRequirementIds.map(r => `<span class="cs-tag cs-tag-mono">${esc(r)}</span>`).join('')}</div></div>` : ''}
            ${sug.combinedFrameworkNames?.length ? `<div class="mo-sug-detail"><span class="mo-sug-detail-label">Frameworks</span><div class="mo-sug-pills">${sug.combinedFrameworkNames.map(f => `<span class="cs-tag cs-tag-primary">${esc(f)}</span>`).join('')}</div></div>` : ''}
          </div>
          ${sug.status === 'pending' ? `
            <div class="mo-sug-actions">
              <button class="mo-accept-btn" onclick="moAcceptSuggestion('${esc(sug.id)}')">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                Accept Merge
              </button>
              <button class="mo-reject-btn" onclick="moRejectSuggestion('${esc(sug.id)}')">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                Reject
              </button>
            </div>` : ''}
        </div>`;
    });

    h += '</div>';
    if (accepted > 0 && pending > 0) {
      h += `<div class="mo-pending-warning">Review all suggestions before applying. You can apply merges once all ${pending} remaining suggestions are resolved.</div>`;
    }
    el.innerHTML = h;
  } else {
    el.innerHTML = `
      <div class="mo-empty-state">
        <div class="mo-empty-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M18 3L18 21M6 6V12C6 15.3 8.7 18 12 18H18M6 6L3 9M6 6L9 9" stroke="#d1d5db" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <h3>No Analysis Yet</h3>
        <p>Select a studio session and click "Analyze for Merges" to find optimization opportunities.</p>
      </div>`;
  }
}

function moRenderExisting() {
  const listEl = document.getElementById('mo-existing-list');
  const countEl = document.getElementById('mo-existing-count');
  const q = (document.getElementById('mo-search')?.value || '').toLowerCase();

  const filtered = moExistingControls.filter(ec => {
    if (!q) return true;
    return ec.name.toLowerCase().includes(q) || ec.description.toLowerCase().includes(q) ||
      ec.requirementIds.some(r => r.toLowerCase().includes(q)) || ec.frameworkNames.some(f => f.toLowerCase().includes(q));
  });

  countEl.textContent = moExistingControls.length + ' controls';

  if (!filtered.length) {
    listEl.innerHTML = '<div class="mo-history-empty">' + (moExistingControls.length ? 'No matches' : 'No exported controls yet') + '</div>';
    return;
  }

  listEl.innerHTML = filtered.map(ec => {
    const hasMerge = moSuggestions.some(s => s.targetControlId === ec.id && s.status === 'accepted');
    return `
      <div class="mo-existing-row ${hasMerge ? 'mo-existing-merged' : ''}">
        <div class="mo-existing-name" dir="rtl">${esc(ec.name)}</div>
        ${hasMerge ? '<span class="mo-merge-queued">merge queued</span>' : ''}
        <div class="mo-existing-desc" dir="rtl">${esc(ec.description)}</div>
        <div class="mo-existing-reqs">
          ${ec.requirementIds.slice(0, 3).map(r => `<span class="cs-tag cs-tag-mono">${esc(r)}</span>`).join('')}
          ${ec.requirementIds.length > 3 ? `<span class="mo-more">+${ec.requirementIds.length - 3}</span>` : ''}
        </div>
        <div class="mo-existing-date">Exported ${fmtDate(ec.exportedAt)}</div>
      </div>`;
  }).join('');
}

function moFilterExisting() { moRenderExisting(); }
window.moFilterExisting = moFilterExisting;

async function moAnalyze() {
  if (!moSelectedSessionId) return;
  moPhase = 'analyzing';
  moRender();

  // Simulate analysis progress
  const fillEl = document.getElementById('mo-progress-fill');
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    if (fillEl) fillEl.style.width = Math.round((i / steps) * 100) + '%';
    await new Promise(r => setTimeout(r, 150));
  }

  // Generate mock suggestions by comparing session controls with existing
  const session = moSessions.find(s => s.id === moSelectedSessionId);
  const sessionControls = session?.controls || [];
  moSuggestions = [];

  sessionControls.forEach((sc, idx) => {
    // Try to find an existing control with overlapping requirement (from a different session)
    const match = moExistingControls.find(ec =>
      ec.requirementIds.some(r => r === sc.requirementRefId) && ec.id !== sc.id && ec.sessionId !== session.id
    );
    if (match) {
      moSuggestions.push({
        id: 'sug-' + idx,
        sourceControlId: sc.id,
        sourceControlName: sc.name || sc.name_ar || 'New Control',
        targetControlId: match.id,
        targetControlName: match.name,
        mergedName: sc.name || match.name,
        mergedDescription: (sc.description || '') + ' — ' + (match.description || ''),
        rationale: 'Both controls address the same requirement (' + (sc.requirementRefId || '') + ') and have overlapping scope.',
        confidence: 'high',
        status: 'pending',
        combinedRequirementIds: [...new Set([...(match.requirementIds || []), sc.requirementRefId].filter(Boolean))],
        combinedFrameworkNames: [...new Set([...(match.frameworkNames || []), sc.framework].filter(Boolean))],
      });
    }
  });

  // If no cross-session matches, try matching against same-session exported controls (re-export scenario)
  if (moSuggestions.length === 0) {
    sessionControls.forEach((sc, idx) => {
      const match = moExistingControls.find(ec =>
        ec.id === sc.id || (ec.requirementIds.some(r => r === sc.requirementRefId) && ec.sessionId === session.id)
      );
      if (match && !moSuggestions.some(s => s.targetControlId === match.id)) {
        moSuggestions.push({
          id: 'sug-' + idx,
          sourceControlId: sc.id,
          sourceControlName: sc.name || sc.name_ar || 'New Control',
          targetControlId: match.id,
          targetControlName: match.name,
          mergedName: sc.name || match.name,
          mergedDescription: (sc.description || match.description || 'Updated control scope and implementation guidance'),
          rationale: 'This control was previously exported and matches an existing platform control. Consider merging to update the existing control with any improvements.',
          confidence: 'high',
          status: 'pending',
          combinedRequirementIds: [...new Set([...(match.requirementIds || []), sc.requirementRefId].filter(Boolean))],
          combinedFrameworkNames: [...new Set([...(match.frameworkNames || []), sc.framework].filter(Boolean))],
        });
      }
    });
  }

  // Final fallback: if still no suggestions, create sample demo suggestions
  if (moSuggestions.length === 0 && sessionControls.length >= 2 && moExistingControls.length > 0) {
    moSuggestions.push({
      id: 'sug-demo-1',
      sourceControlId: sessionControls[0]?.id || 'sc0',
      sourceControlName: sessionControls[0]?.name || sessionControls[0]?.name_ar || 'New Control 1',
      targetControlId: moExistingControls[0]?.id || 'ec0',
      targetControlName: moExistingControls[0]?.name || 'Existing Control',
      mergedName: sessionControls[0]?.name || moExistingControls[0]?.name || 'Merged Control',
      mergedDescription: 'AI-suggested merge combining scope of both controls for improved coverage.',
      rationale: 'Controls share similar scope and can be consolidated for better coverage.',
      confidence: 'medium',
      status: 'pending',
      combinedRequirementIds: [sessionControls[0]?.requirementRefId].filter(Boolean),
      combinedFrameworkNames: [sessionControls[0]?.framework].filter(Boolean),
    });
  }

  moPhase = 'results';
  moRender();
}
window.moAnalyze = moAnalyze;

function moToggleSuggestion(sugId) {
  const card = document.querySelector(`.mo-sug-card[data-sug-id="${sugId}"]`);
  if (card) card.classList.toggle('expanded');
}
window.moToggleSuggestion = moToggleSuggestion;

function moAcceptSuggestion(sugId) {
  const sug = moSuggestions.find(s => s.id === sugId);
  if (sug) sug.status = 'accepted';
  moRenderCenter();
  moRenderExisting();
}
window.moAcceptSuggestion = moAcceptSuggestion;

function moRejectSuggestion(sugId) {
  const sug = moSuggestions.find(s => s.id === sugId);
  if (sug) sug.status = 'rejected';
  moRenderCenter();
  moRenderExisting();
}
window.moRejectSuggestion = moRejectSuggestion;

function moApplyMerges() {
  const accepted = moSuggestions.filter(s => s.status === 'accepted').length;
  const rejected = moSuggestions.filter(s => s.status === 'rejected').length;
  const session = moSessions.find(s => s.id === moSelectedSessionId);

  // Save to history
  moMergeHistory.unshift({
    sessionName: session?.name || 'Unknown',
    accepted,
    rejected,
    timestamp: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  });
  localStorage.setItem('mo_merge_history', JSON.stringify(moMergeHistory));

  moPhase = 'applied';
  moRender();
  toast('success', 'Merges Applied', `${accepted} controls merged successfully.`);
}
window.moApplyMerges = moApplyMerges;

function moReset() {
  moPhase = 'setup';
  moSelectedSessionId = '';
  moSuggestions = [];
  loadMergeOptimizer();
}
window.moReset = moReset;

// ─── Audit Studio ─────────────────────────────────────────────

let studioLibraries = [];
let studioAllOptions = [];       // flat list of all requirement nodes
let studioSelections = [];       // selected requirement objects
let studioCollections = [];      // fetched collection stores (with .files)
let studioSelectedColls = new Set();
let studioSelectedFiles = new Set();
let studioContextFiles = [];     // uploaded context files [{name, content, size}]
let studioPendingPoll = null;

async function loadAuditStudio() {
  // Fetch frameworks and collections in parallel
  const [libRes] = await Promise.allSettled([
    fetch(API.libraries).then(r => r.json()),
    studioFetchCollections(),
  ]);
  if (libRes.status === 'fulfilled' && libRes.value?.success) {
    studioLibraries = libRes.value.data || [];
  }
  studioRenderFrameworks();
  studioRenderCollections();
  studioUpdateSummary();
}

// ── Frameworks ───────────────────────────────────────────────

function studioRenderFrameworks() {
  const listEl = document.getElementById('studio-fw-list');
  if (!listEl) return;
  studioAllOptions = [];

  if (!studioLibraries.length) {
    listEl.innerHTML = '<div class="studio-empty-msg">No frameworks loaded.</div>';
    return;
  }

  let html = '';
  studioLibraries.forEach((lib, li) => {
    const fw = lib.content?.framework;
    if (!fw || !fw.requirement_nodes) return;
    const fwName = fw.name || lib.name;
    const nodes = fw.requirement_nodes.filter(n => n.description);
    const groupId = 'sg-' + li;

    html += `<div class="studio-fw-group collapsed" data-group-id="${groupId}">
      <div class="studio-fw-group-header">
        <div class="studio-fw-group-toggle" onclick="studioToggleGroup(this)">
          <svg class="chevron-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>${esc(fwName)}</span>
        </div>
        <div class="studio-fw-group-actions">
          <span class="studio-fw-group-count">${nodes.length} requirements</span>
          <button type="button" class="btn-studio-group-select" onclick="event.stopPropagation();studioSelectAllInGroup('${groupId}')" title="Select All">Select All</button>
        </div>
      </div>
      <div class="studio-fw-group-items">`;

    nodes.forEach(node => {
      const opt = {
        libraryId: lib.id,
        frameworkUrn: fw.urn,
        frameworkName: fwName,
        nodeUrn: node.urn,
        refId: node.ref_id,
        name: node.name,
        description: node.description,
        depth: node.depth,
        assessable: node.assessable,
      };
      studioAllOptions.push(opt);
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(opt))));
      const isSelected = studioSelections.some(s => s.nodeUrn === node.urn);
      const depthDot = node.depth === 1 ? '●' : node.depth === 2 ? '○' : node.depth === 3 ? '◦' : '·';

      html += `<div class="studio-fw-item${isSelected ? ' selected' : ''}" data-opt="${encoded}" data-group-id="${groupId}" data-search="${esc((node.ref_id + ' ' + node.description + ' ' + fwName).toLowerCase())}" onclick="studioToggleOption(this)">
        <div class="studio-fw-item-checkbox"><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div class="studio-fw-item-content">
          ${node.ref_id ? `<span class="studio-fw-ref">${esc(node.ref_id)}</span>` : ''}
          <span class="studio-fw-desc"><span class="studio-fw-depth">${depthDot}</span> ${esc(node.description)}</span>
        </div>
      </div>`;
    });

    html += '</div></div>';
  });

  listEl.innerHTML = html;
}

function studioDecodeOpt(enc) {
  return JSON.parse(decodeURIComponent(escape(atob(enc))));
}

function studioToggleGroup(el) {
  el.closest('.studio-fw-group').classList.toggle('collapsed');
}
window.studioToggleGroup = studioToggleGroup;

function studioToggleOption(itemEl) {
  const opt = studioDecodeOpt(itemEl.dataset.opt);
  const idx = studioSelections.findIndex(s => s.nodeUrn === opt.nodeUrn);
  if (idx === -1) {
    studioSelections.push(opt);
    itemEl.classList.add('selected');
  } else {
    studioSelections.splice(idx, 1);
    itemEl.classList.remove('selected');
  }
  studioUpdateSummary();
}
window.studioToggleOption = studioToggleOption;

function studioSelectAllInGroup(groupId) {
  const group = document.querySelector(`.studio-fw-group[data-group-id="${groupId}"]`);
  if (!group) return;
  group.classList.remove('collapsed');
  const items = group.querySelectorAll('.studio-fw-item:not([style*="display: none"])');
  let added = 0;
  items.forEach(item => {
    const opt = studioDecodeOpt(item.dataset.opt);
    if (!studioSelections.some(s => s.nodeUrn === opt.nodeUrn)) {
      studioSelections.push(opt);
      item.classList.add('selected');
      added++;
    }
  });
  studioUpdateSummary();
  if (added > 0) toast('success', 'Selected', `Added ${added} requirements.`);
  else toast('info', 'Already Selected', 'All visible requirements are already selected.');
}
window.studioSelectAllInGroup = studioSelectAllInGroup;

// Search frameworks
const studioFwSearch = document.getElementById('studio-fw-search');
if (studioFwSearch) {
  studioFwSearch.addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('.studio-fw-group').forEach(group => {
      const items = group.querySelectorAll('.studio-fw-item');
      let vis = 0;
      items.forEach(item => {
        const match = !q || (item.dataset.search || '').includes(q);
        item.style.display = match ? '' : 'none';
        if (match) vis++;
      });
      group.style.display = vis > 0 ? '' : 'none';
      if (q && vis > 0) group.classList.remove('collapsed');
      else if (!q) group.classList.add('collapsed');
    });
  });
}

// Select All / Clear All
const studioSelectAllBtn = document.getElementById('studio-select-all');
const studioClearAllBtn = document.getElementById('studio-clear-all');
if (studioSelectAllBtn) {
  studioSelectAllBtn.addEventListener('click', () => {
    document.querySelectorAll('.studio-fw-item:not([style*="display: none"])').forEach(item => {
      const opt = studioDecodeOpt(item.dataset.opt);
      if (!studioSelections.some(s => s.nodeUrn === opt.nodeUrn)) {
        studioSelections.push(opt);
        item.classList.add('selected');
      }
    });
    studioUpdateSummary();
  });
}
if (studioClearAllBtn) {
  studioClearAllBtn.addEventListener('click', () => {
    studioSelections = [];
    document.querySelectorAll('.studio-fw-item.selected').forEach(i => i.classList.remove('selected'));
    studioUpdateSummary();
  });
}

// ── Collections ──────────────────────────────────────────────

async function studioFetchCollections() {
  try {
    const d = await fetchJSON(API.collections);
    const stores = d.data?.fileSearchStores || d.data || [];
    // Normalize to array
    studioCollections = Array.isArray(stores) ? stores : [];
    // Fetch files for each collection in parallel
    await Promise.all(studioCollections.map(async store => {
      try {
        const sid = store.name.split('/').pop();
        const fd = await fetchJSON(API.collections + '/' + sid + '/files');
        store.files = fd.data?.documents || fd.data?.fileSearchDocuments || [];
      } catch { store.files = []; }
    }));
  } catch (e) { console.error('Studio collections fetch error:', e); studioCollections = []; }
}

function studioRenderCollections() {
  const listEl = document.getElementById('studio-coll-list');
  if (!listEl) return;

  if (!studioCollections.length) {
    listEl.innerHTML = '<div class="studio-empty-msg">No collections yet. Create one or upload from <a href="javascript:navigateTo(\'file-collections\')" style="color:var(--admin-primary)">File Collections</a>.</div>';
    return;
  }

  // Remember expanded states
  const expanded = new Set();
  listEl.querySelectorAll('.studio-coll-group:not(.collapsed)').forEach(g => expanded.add(g.dataset.storeId));

  let html = '';
  studioCollections.forEach((store, idx) => {
    const storeId = store.name.split('/').pop();
    const displayName = store.displayName || store.name || 'Untitled';
    const files = store.files || [];
    const activeFiles = files.filter(f => f.state === 'STATE_ACTIVE');
    const isCollSelected = studioSelectedColls.has(storeId);
    const someFilesSelected = files.some(f => studioSelectedFiles.has(storeId + '::' + (f.name || f.displayName)));
    const isExpanded = expanded.has(storeId);

    html += `<div class="studio-coll-group${isExpanded ? '' : ' collapsed'}" data-store-id="${storeId}">
      <div class="studio-coll-header">
        <div class="studio-coll-cb" onclick="event.stopPropagation();studioToggleCollSel('${esc(storeId)}')">
          <span class="studio-cb-mark ${isCollSelected ? 'checked' : (someFilesSelected ? 'indeterminate' : '')}"></span>
        </div>
        <div class="studio-coll-toggle" onclick="studioToggleCollGroup(this)">
          <svg class="chevron-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span class="studio-coll-name">${esc(displayName)}</span>
        </div>
        <div class="studio-coll-actions">
          <span class="studio-coll-badge">${files.length}</span>
          <button type="button" class="btn-studio-coll-upload" onclick="event.stopPropagation();studioUploadFile('${esc(storeId)}')" title="Upload file">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M12 9V11.5C12 12.1 11.6 12.5 11 12.5H3C2.4 12.5 2 12.1 2 11.5V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9.5 4.5L7 2L4.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 2V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            Upload
          </button>
          <button type="button" class="btn-studio-coll-delete" onclick="event.stopPropagation();studioDeleteColl('${esc(storeId)}','${esc(displayName).replace(/'/g, "\\'")}')" title="Delete">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
      <div class="studio-coll-files">`;

    if (!files.length) {
      html += '<div class="studio-empty-msg" style="font-size:11px">No files — click Upload.</div>';
    } else {
      files.forEach(f => {
        const fName = f.displayName || f.name || 'File';
        const state = f.state || 'UNKNOWN';
        const isActive = state === 'STATE_ACTIVE';
        const isPending = state === 'STATE_PENDING';
        const isFailed = state === 'STATE_FAILED';
        const fileKey = storeId + '::' + (f.name || f.displayName);
        const isFileSelected = studioSelectedFiles.has(fileKey);
        const stateClass = isActive ? 'active' : (isPending ? 'pending' : 'failed');
        const stateLabel = isActive ? 'Active' : (isPending ? 'Processing...' : 'Failed');
        const stateIcon = isActive ? '✓' : (isPending ? '◌' : '✗');

        html += `<div class="studio-file-item ${isFailed ? 'file-failed' : ''} ${isFileSelected ? 'file-selected' : ''}" data-file-key="${esc(fileKey)}">
          ${isActive ? `<div class="studio-file-cb" onclick="event.stopPropagation();studioToggleFileSel('${esc(storeId)}','${esc(fileKey).replace(/'/g, "\\'")}')"><span class="studio-cb-mark ${isFileSelected ? 'checked' : ''}"></span></div>` : '<span style="width:22px;display:inline-block"></span>'}
          <svg class="studio-file-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2H9L13 6V14C13 14.6 12.6 15 12 15H3C2.4 15 2 14.6 2 14V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9 2V6H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <span class="studio-file-name">${esc(fName)}</span>
          <span class="studio-file-state ${stateClass}">${stateIcon} ${stateLabel}</span>
        </div>`;
      });
    }

    html += '</div></div>';
  });

  listEl.innerHTML = html;

  // Update file/coll counts in header
  const totalFiles = studioCollections.reduce((s, c) => s + (c.files?.length || 0), 0);
  const el1 = document.getElementById('studio-file-count');
  const el2 = document.getElementById('studio-coll-count');
  if (el1) el1.textContent = totalFiles;
  if (el2) el2.textContent = studioCollections.length;

  // Auto-poll for pending files
  const pendingTotal = studioCollections.reduce((s, c) => s + (c.files || []).filter(f => f.state === 'STATE_PENDING').length, 0);
  if (studioPendingPoll) clearTimeout(studioPendingPoll);
  if (pendingTotal > 0) {
    studioPendingPoll = setTimeout(async () => {
      await studioFetchCollections();
      studioRenderCollections();
      studioUpdateSummary();
    }, 5000);
  }
}

function studioToggleCollGroup(el) {
  el.closest('.studio-coll-group').classList.toggle('collapsed');
}
window.studioToggleCollGroup = studioToggleCollGroup;

function studioToggleCollSel(storeId) {
  const store = studioCollections.find(s => s.name.split('/').pop() === storeId);
  if (!store) return;
  const activeFiles = (store.files || []).filter(f => f.state === 'STATE_ACTIVE');

  if (studioSelectedColls.has(storeId)) {
    // Deselect collection + all its files
    studioSelectedColls.delete(storeId);
    activeFiles.forEach(f => studioSelectedFiles.delete(storeId + '::' + (f.name || f.displayName)));
  } else {
    // Select collection + all its active files
    studioSelectedColls.add(storeId);
    activeFiles.forEach(f => studioSelectedFiles.add(storeId + '::' + (f.name || f.displayName)));
  }
  studioUpdateCollCheckboxes();
  studioUpdateSummary();
}
window.studioToggleCollSel = studioToggleCollSel;

function studioToggleFileSel(storeId, fileKey) {
  if (studioSelectedFiles.has(fileKey)) studioSelectedFiles.delete(fileKey);
  else studioSelectedFiles.add(fileKey);

  // Update collection selection state
  const store = studioCollections.find(s => s.name.split('/').pop() === storeId);
  if (store) {
    const activeFiles = (store.files || []).filter(f => f.state === 'STATE_ACTIVE');
    const allSelected = activeFiles.length > 0 && activeFiles.every(f => studioSelectedFiles.has(storeId + '::' + (f.name || f.displayName)));
    if (allSelected) studioSelectedColls.add(storeId);
    else studioSelectedColls.delete(storeId);
  }
  studioUpdateCollCheckboxes();
  studioUpdateSummary();
}
window.studioToggleFileSel = studioToggleFileSel;

function studioUpdateCollCheckboxes() {
  document.querySelectorAll('.studio-coll-group[data-store-id]').forEach(g => {
    const sid = g.dataset.storeId;
    const isC = studioSelectedColls.has(sid);
    const store = studioCollections.find(s => s.name.split('/').pop() === sid);
    const someSelected = (store?.files || []).some(f => studioSelectedFiles.has(sid + '::' + (f.name || f.displayName)));

    const cb = g.querySelector('.studio-coll-header .studio-cb-mark');
    if (cb) { cb.classList.toggle('checked', isC); cb.classList.toggle('indeterminate', !isC && someSelected); }

    g.querySelectorAll('.studio-file-item[data-file-key]').forEach(fEl => {
      const key = fEl.dataset.fileKey;
      const isSel = studioSelectedFiles.has(key);
      fEl.classList.toggle('file-selected', isSel);
      const fcb = fEl.querySelector('.studio-cb-mark');
      if (fcb) fcb.classList.toggle('checked', isSel);
    });
  });
}

// Upload file to collection
async function studioUploadFile(storeId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.json,.html,.xml,.md,.pptx,.rtf,.zip';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append('file', file);
      toast('info', 'Uploading...', `Uploading "${file.name}"...`);
      const res = await fetch(`/api/collections/${storeId}/files`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        toast('success', 'Uploaded', `"${file.name}" uploaded.`);
        await studioFetchCollections();
        studioRenderCollections();
        studioUpdateSummary();
      } else throw new Error(data.error || 'Upload failed');
    } catch (err) { toast('error', 'Upload Error', err.message); }
  };
  input.click();
}
window.studioUploadFile = studioUploadFile;

// Delete collection
async function studioDeleteColl(storeId, displayName) {
  if (!confirm(`Delete collection "${displayName}"? This removes all files.`)) return;
  try {
    const res = await fetch(`/api/collections/${storeId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      toast('success', 'Deleted', `"${displayName}" deleted.`);
      studioSelectedColls.delete(storeId);
      studioCollections = studioCollections.filter(s => s.name.split('/').pop() !== storeId);
      studioRenderCollections();
      studioUpdateSummary();
    } else throw new Error(data.error || 'Delete failed');
  } catch (err) { toast('error', 'Delete Error', err.message); }
}
window.studioDeleteColl = studioDeleteColl;

// New Collection button
const studioNewCollBtn = document.getElementById('studio-new-coll-btn');
if (studioNewCollBtn) {
  studioNewCollBtn.addEventListener('click', () => {
    const name = prompt('Collection name:');
    if (!name || !name.trim()) return;
    (async () => {
      try {
        toast('info', 'Creating...', `Setting up "${name}"...`);
        const res = await fetch('/api/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: name.trim() }) });
        const data = await res.json();
        if (data.success) {
          toast('success', 'Created', `"${name}" is ready.`);
          await studioFetchCollections();
          studioRenderCollections();
          studioUpdateSummary();
        } else throw new Error(data.error || 'Failed');
      } catch (err) { toast('error', 'Error', err.message); }
    })();
  });
}

// ── Context Files ────────────────────────────────────────────

const studioUploadCtxBtn = document.getElementById('studio-upload-ctx');
if (studioUploadCtxBtn) {
  studioUploadCtxBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.json,.html,.xml,.md,.pptx,.rtf,.log,.yaml,.yml';
    input.onchange = async (e) => {
      const files = Array.from(e.target.files);
      for (const file of files) {
        if (studioContextFiles.some(c => c.name === file.name)) { toast('info', 'Duplicate', `"${file.name}" already attached.`); continue; }
        if (file.size > 20 * 1024 * 1024) { toast('error', 'Too Large', `"${file.name}" exceeds 20MB.`); continue; }
        try {
          const content = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Read failed')); r.readAsText(file); });
          studioContextFiles.push({ name: file.name, size: file.size, content });
        } catch (err) { toast('error', 'Read Error', err.message); }
      }
      studioRenderContextFiles();
      studioUpdateSummary();
    };
    input.click();
  });
}

function studioRenderContextFiles() {
  const listEl = document.getElementById('studio-ctx-list');
  const countEl = document.getElementById('studio-ctx-count');
  if (countEl) countEl.textContent = studioContextFiles.length;
  if (!listEl) return;
  if (!studioContextFiles.length) { listEl.innerHTML = ''; return; }

  listEl.innerHTML = studioContextFiles.map((cf, i) => {
    const sizeKB = (cf.size / 1024).toFixed(1);
    return `<div class="studio-ctx-item">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2H9L13 6V14C13 14.6 12.6 15 12 15H3C2.4 15 2 14.6 2 14V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9 2V6H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      <div class="studio-ctx-item-info">
        <span class="studio-ctx-item-name">${esc(cf.name)}</span>
        <span class="studio-ctx-item-size">${sizeKB} KB</span>
      </div>
      <button class="studio-ctx-item-remove" onclick="studioRemoveCtxFile(${i})" title="Remove">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9 3L3 9M3 3L9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>`;
  }).join('');
}

function studioRemoveCtxFile(idx) {
  studioContextFiles.splice(idx, 1);
  studioRenderContextFiles();
  studioUpdateSummary();
}
window.studioRemoveCtxFile = studioRemoveCtxFile;

// Query character count
const studioQueryEl = document.getElementById('studio-query');
const studioCharCountEl = document.getElementById('studio-char-count');
if (studioQueryEl && studioCharCountEl) {
  studioQueryEl.addEventListener('input', () => {
    studioCharCountEl.textContent = studioQueryEl.value.length;
  });
}

// ── Summary & Start ──────────────────────────────────────────

function studioUpdateSummary() {
  const reqCount = studioSelections.length;
  const collCount = studioSelectedColls.size;
  const fileCount = studioSelectedFiles.size;
  const ctxCount = studioContextFiles.length;

  const e = id => document.getElementById(id);
  const set = (id, v) => { const el = e(id); if (el) el.textContent = v; };

  set('studio-req-count', reqCount);
  set('studio-sum-reqs', reqCount);
  set('studio-sum-colls', collCount);
  set('studio-sum-files', fileCount);
  set('studio-sum-ctx', ctxCount);

  const startBtn = document.getElementById('studio-start-btn');
  if (startBtn) startBtn.disabled = reqCount === 0;
}

// Start Audit Session button
const studioStartBtn = document.getElementById('studio-start-btn');
if (studioStartBtn) {
  studioStartBtn.addEventListener('click', () => {
    if (!studioSelections.length) return;

    // Build file resources from selected files
    const fileResources = [];
    studioCollections.forEach(store => {
      const storeId = store.name.split('/').pop();
      (store.files || []).forEach(f => {
        const key = storeId + '::' + (f.name || f.displayName);
        if (studioSelectedFiles.has(key)) {
          fileResources.push({ storeId, name: f.name, displayName: f.displayName || f.name });
        }
      });
    });

    // Build selected collections
    const selectedColls = studioCollections
      .filter(s => studioSelectedColls.has(s.name.split('/').pop()))
      .map(s => ({ storeId: s.name.split('/').pop(), displayName: s.displayName || s.name }));

    const query = (document.getElementById('studio-query')?.value || '').trim();

    const auditSession = {
      requirements: studioSelections,
      fileResources,
      collections: selectedColls,
      query,
      contextFiles: studioContextFiles.map(cf => ({ name: cf.name, content: cf.content })),
    };
    sessionStorage.setItem('auditSession', JSON.stringify(auditSession));
    window.location.href = '/chat.html';
  });
}

// ─── Init ─────────────────────────────────────────────────────

console.log('[admin.js] Script loaded, readyState:', document.readyState);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[admin.js] DOMContentLoaded fired');
    loadDashboard();
  });
} else {
  console.log('[admin.js] DOM already ready, calling loadDashboard');
  loadDashboard();
}
