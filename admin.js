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

const PAGE_NAMES = {
  'dashboard': 'Dashboard',
  'audit-sessions': 'Audit Sessions',
  'audit-studio': 'Audit Studio',
  'controls-studio': 'Applied Controls Studio',
  'merge-optimizer': 'Control Merge Optimizer',
  'policy-ingestion': 'Organization Policy Ingestion',
  'org-contexts': 'Organization Contexts',
  'prompts': 'Prompts',
  'file-collections': 'File Collections',
};
const VALID_PAGES = Object.keys(PAGE_NAMES);
let currentPage = null;
let currentSubId = null; // Sub-route ID (e.g. collection UUID)

function navigateTo(page, pushState = true, subId = null) {
  if (!VALID_PAGES.includes(page)) page = 'dashboard';

  const isSamePage = page === currentPage && subId === currentSubId;
  if (isSamePage) return;

  currentPage = page;
  currentSubId = subId;

  // Update URL path
  if (pushState) {
    const newPath = subId ? `/${page}/${subId}` : `/${page}`;
    if (window.location.pathname !== newPath) {
      history.pushState({ page, subId }, '', newPath);
    }
  }

  // Update sidebar
  document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
  const target = document.querySelector(`.sidebar-item[data-page="${page}"]`);
  if (target) target.classList.add('active');

  // Update pages
  document.querySelectorAll('.admin-page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');

  // Update header
  if (headerTitle) headerTitle.textContent = PAGE_NAMES[page] || page;

  // Update document title
  document.title = (PAGE_NAMES[page] || 'Admin') + ' — WathbaGRC';

  // Load data for the page
  if (page === 'dashboard') loadDashboard();
  if (page === 'audit-sessions') loadSessions();
  if (page === 'audit-studio') loadAuditStudio();
  if (page === 'file-collections') loadCollections();
  if (page === 'org-contexts') loadOrgContexts(subId);
  if (page === 'prompts') loadPrompts();
  if (page === 'controls-studio') loadControlsStudio();
  if (page === 'merge-optimizer') loadMergeOptimizer();
  if (page === 'policy-ingestion') loadPolicyIngestion(subId);

  // Scroll to top
  window.scrollTo(0, 0);
}
window.navigateTo = navigateTo;

// Update URL without full page reload (for sub-navigation within a page)
function updateRoute(page, subId) {
  currentSubId = subId;
  const newPath = subId ? `/${page}/${subId}` : `/${page}`;
  if (window.location.pathname !== newPath) {
    history.pushState({ page, subId }, '', newPath);
  }
}

// Handle browser back/forward
window.addEventListener('popstate', (e) => {
  const { page, subId } = e.state || parseRoute();
  currentPage = null; // Reset so navigateTo doesn't skip
  currentSubId = null;
  navigateTo(page, false, subId);
});

// Parse page + optional sub-ID from URL pathname
function parseRoute() {
  const parts = window.location.pathname.replace(/^\//, '').split('/');
  const page = (parts[0] && VALID_PAGES.includes(parts[0])) ? parts[0] : 'dashboard';
  const subId = parts[1] || null;
  return { page, subId };
}

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

/**
 * Show a custom confirm dialog (replaces window.confirm).
 * @param {Object} opts
 * @param {string} opts.title - Dialog title
 * @param {string} opts.message - Dialog body text
 * @param {string} [opts.confirmText='Delete'] - Confirm button label
 * @param {string} [opts.cancelText='Cancel'] - Cancel button label
 * @param {string} [opts.type='danger'] - 'danger' | 'warning' | 'info'
 * @returns {Promise<boolean>} true if confirmed, false if cancelled
 */
function showConfirm({ title = 'Are you sure?', message = '', confirmText = 'Delete', cancelText = 'Cancel', type = 'danger' } = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-dialog-overlay');
    const iconEl = document.getElementById('confirm-dialog-icon');
    const titleEl = document.getElementById('confirm-dialog-title');
    const msgEl = document.getElementById('confirm-dialog-message');
    const confirmBtn = document.getElementById('confirm-dialog-confirm');
    const cancelBtn = document.getElementById('confirm-dialog-cancel');

    titleEl.textContent = title;
    msgEl.textContent = message;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;

    // Icon based on type
    const icons = {
      danger: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 6H21M8 6V4C8 3.4 8.4 3 9 3H15C15.6 3 16 3.4 16 4V6M10 11V17M14 11V17M5 6L6 20C6 20.6 6.4 21 7 21H17C17.6 21 18 20.6 18 20L19 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      warning: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 9V13M12 17H12.01M4.93 19H19.07C20.14 19 20.81 17.83 20.28 16.91L13.21 4.58C12.68 3.67 11.32 3.67 10.79 4.58L3.72 16.91C3.19 17.83 3.86 19 4.93 19Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      info: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><path d="M12 8V12M12 16H12.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    };
    iconEl.className = 'confirm-dialog-icon ' + type;
    iconEl.innerHTML = icons[type] || icons.danger;

    // Style confirm button
    confirmBtn.className = 'confirm-dialog-btn confirm-dialog-confirm' + (type === 'info' ? ' primary' : '');

    // Show
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('active'));

    function cleanup(result) {
      overlay.classList.remove('active');
      setTimeout(() => { overlay.style.display = 'none'; }, 200);
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onConfirm() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onOverlay(e) { if (e.target === overlay) cleanup(false); }
    function onKey(e) { if (e.key === 'Escape') cleanup(false); if (e.key === 'Enter') cleanup(true); }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);

    cancelBtn.focus();
  });
}

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
    const stores = d.data?.fileSearchStores || d.data || [];
    collections = Array.isArray(stores) ? stores : [];
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
  const totalFiles = collections.reduce((a, c) => a + parseInt(c.activeDocumentsCount || c.file_counts?.active || c.fileCount || 0, 10), 0);
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
  if (!await showConfirm({ title: 'Delete Session', message: 'Are you sure you want to delete this session?', confirmText: 'Delete' })) return;
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

// View a file from a collection (opens in new tab via the local copy)
function viewFileInCollection(storeId, docId) {
  if (!storeId || !docId) {
    toast('error', 'Cannot View', 'File identifier not available.');
    return;
  }
  const viewUrl = `/api/collections/${encodeURIComponent(storeId)}/files/${encodeURIComponent(docId)}/view`;
  window.open(viewUrl, '_blank');
}
window.viewFileInCollection = viewFileInCollection;

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
    const isActive = state === 'STATE_ACTIVE';
    const docId = (f.name || '').split('/').pop();
    return `
      <div class="org-ctx-doc" style="display:flex;align-items:center;gap:8px">
        <div class="org-ctx-doc-name" style="flex:1">${esc(name)}</div>
        <span class="badge ${stateClass}">${stateLabel}</span>
        ${isActive && docId ? `<button class="btn-admin-sm" onclick="event.stopPropagation();viewFileInCollection('${esc(storeId)}','${esc(docId)}')" title="View file" style="padding:2px 6px;font-size:11px"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 7C1 7 3.5 2.5 7 2.5C10.5 2.5 13 7 13 7C13 7 10.5 11.5 7 11.5C3.5 11.5 1 7 1 7Z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.3"/></svg></button>` : ''}
      </div>`;
  }).join('') + '</div>';
}

// ─── Organization Contexts Page ───────────────────────────────

async function loadOrgContexts(subId) {
  try {
    const d = await fetchJSON(API.orgContexts);
    orgContexts = d.contexts || [];
  } catch (e) { console.error('Org contexts fetch error:', e); orgContexts = []; }
  // Ensure frameworks are loaded for mandate checkboxes
  if (!frameworks || !frameworks.length) await fetchFrameworks();
  renderOrgStats();
  renderOrgContextsList();

  // If a subId is provided (deep link), open that context's detail page
  if (subId) {
    const idx = orgContexts.findIndex(c => c.id === subId);
    if (idx >= 0) {
      orgDetailCtxId = subId;
      renderOrgContextDetail(orgContexts[idx], idx);
      return; // detail page renders its own FAB
    }
  }

  // Show chat FAB on the main list page (no specific org pre-selected)
  renderOrgChatFAB(null);
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
    const policies = ctx.policies || [];
    const policiesHtml = policies.map(p => {
      const name = typeof p === 'object' ? p.name : p;
      const refId = typeof p === 'object' && p.refId ? ` (${esc(p.refId)})` : '';
      return `<span class="org-fw-pill" style="color:#4338ca;background:#eef2ff;border-color:#c7d2fe">${esc(name)}${refId}</span>`;
    }).join('');

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
            <button class="org-ctx-action-btn" onclick="event.stopPropagation();openOrgContextDetail(${origIdx})" title="Open">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2H12V5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 2L7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M10 8V11C10 11.6 9.6 12 9 12H3C2.4 12 2 11.6 2 11V5C2 4.4 2.4 4 3 4H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
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
          ${policies.length ? `<div class="org-ctx-detail-section"><span class="org-ctx-detail-label">Policies</span><div class="org-ctx-detail-pills">${policiesHtml}</div></div>` : ''}
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

let grcFrameworksCache = null; // cached GRC frameworks for mandate checkboxes

async function populateMandatesFromFrameworks() {
  const container = document.getElementById('org-mandates-options');
  if (!container) return;

  // Show loading state
  container.innerHTML = '<span class="admin-form-hint" style="color:#9ca3af">Loading frameworks from GRC…</span>';

  // Fetch from GRC frameworks API (use cache if available)
  if (!grcFrameworksCache) {
    try {
      const d = await fetch('/api/grc/frameworks').then(r => r.json());
      if (d.success && Array.isArray(d.results)) {
        grcFrameworksCache = d.results;
      } else {
        grcFrameworksCache = [];
      }
    } catch (e) {
      console.error('GRC frameworks fetch error for mandates:', e);
      grcFrameworksCache = [];
    }
  }

  const fwNames = grcFrameworksCache
    .map(fw => fw.name || fw.ref_id || '')
    .filter(Boolean);

  if (!fwNames.length) {
    container.innerHTML = '<span class="admin-form-hint" style="color:#9ca3af">No frameworks loaded. Please check your connection.</span>';
    return;
  }
  container.innerHTML = fwNames.map(n =>
    `<label class="mandate-chip-option"><input type="checkbox" value="${esc(n)}"> ${esc(n)}</label>`
  ).join('');
}

async function openOrgModal() {
  await populateMandatesFromFrameworks();
  orgModal.classList.add('active');
  document.body.style.overflow = 'hidden';

  // Fetch GRC objectives if not cached
  if (!grcObjectivesCache) {
    const labelEl = document.getElementById('org-objectives-label');
    if (labelEl) labelEl.textContent = 'Loading objectives…';
    await fetchGrcObjectives();
  }
  // Render checkboxes (editOrgContext will call with selectedIds separately)
  if (editingOrgIdx === null) {
    renderObjectivesCheckboxes([]);
  }
  // Close dropdown by default
  const dd = document.getElementById('org-objectives-dropdown');
  if (dd) dd.classList.remove('open');

  // Fetch GRC policies if not cached
  if (!grcPoliciesCache) {
    const polLabel = document.getElementById('org-policies-label');
    if (polLabel) polLabel.textContent = 'Loading policies…';
    await fetchGrcPolicies();
  }
  if (editingOrgIdx === null) {
    renderPoliciesCheckboxes([]);
  }
  const polDd = document.getElementById('org-policies-dropdown');
  if (polDd) polDd.classList.remove('open');
}
function closeOrgModal() { orgModal.classList.remove('active'); document.body.style.overflow = ''; editingOrgIdx = null; clearOrgForm(); }
let orgObjectives = []; // temp state for objectives list (now stores {id, name} objects)
let grcObjectivesCache = null; // cache fetched GRC objectives

async function fetchGrcObjectives() {
  try {
    const res = await fetch('/api/grc/organisation-objectives');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    grcObjectivesCache = (data.results || []).map(o => ({ id: o.id, name: o.name, description: o.description || '' }));
    return grcObjectivesCache;
  } catch (err) {
    console.error('Failed to fetch GRC objectives:', err);
    grcObjectivesCache = [];
    return [];
  }
}

function renderObjectivesCheckboxes(selectedIds = []) {
  const labelEl = document.getElementById('org-objectives-label');
  const optionsEl = document.getElementById('org-objectives-options');
  if (!optionsEl) return;

  if (!grcObjectivesCache || grcObjectivesCache.length === 0) {
    if (labelEl) labelEl.textContent = 'No objectives available';
    optionsEl.innerHTML = '';
    return;
  }

  optionsEl.innerHTML = grcObjectivesCache.map(obj => {
    const checked = selectedIds.includes(obj.id) ? 'checked' : '';
    return `<label>
      <input type="checkbox" value="${esc(obj.id)}" ${checked} onchange="updateObjectivesLabel()">
      <span><strong>${esc(obj.name)}</strong>${obj.description ? '<br><span style="font-size:10px;color:#9ca3af">' + esc(obj.description) + '</span>' : ''}</span>
    </label>`;
  }).join('');

  updateObjectivesLabel();
}

function toggleObjectivesDropdown() {
  const dd = document.getElementById('org-objectives-dropdown');
  if (dd) dd.classList.toggle('open');
}
window.toggleObjectivesDropdown = toggleObjectivesDropdown;

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  const dd = document.getElementById('org-objectives-dropdown');
  if (dd && !dd.contains(e.target)) dd.classList.remove('open');
});

function updateObjectivesLabel() {
  const labelEl = document.getElementById('org-objectives-label');
  const chipsEl = document.getElementById('org-objectives-chips');
  const checkboxes = document.querySelectorAll('#org-objectives-options input[type="checkbox"]:checked');
  const count = checkboxes.length;

  if (labelEl) {
    if (count === 0) {
      labelEl.textContent = 'Select objectives…';
      labelEl.classList.remove('has-selection');
    } else {
      labelEl.textContent = `${count} objective${count > 1 ? 's' : ''} selected`;
      labelEl.classList.add('has-selection');
    }
  }

  // Render chips
  if (chipsEl) {
    if (count === 0) {
      chipsEl.innerHTML = '';
    } else {
      chipsEl.innerHTML = Array.from(checkboxes).map(cb => {
        const obj = grcObjectivesCache?.find(o => o.id === cb.value);
        if (!obj) return '';
        return `<span class="multiselect-chip">
          ${esc(obj.name)}
          <button type="button" class="multiselect-chip-remove" onclick="removeObjectiveById('${esc(obj.id)}')">&times;</button>
        </span>`;
      }).join('');
    }
  }
}
window.updateObjectivesLabel = updateObjectivesLabel;

function removeObjectiveById(id) {
  const cb = document.querySelector(`#org-objectives-options input[value="${id}"]`);
  if (cb) { cb.checked = false; updateObjectivesLabel(); }
}
window.removeObjectiveById = removeObjectiveById;

function getSelectedObjectives() {
  const checkboxes = document.querySelectorAll('#org-objectives-options input[type="checkbox"]:checked');
  const selected = [];
  checkboxes.forEach(cb => {
    const obj = grcObjectivesCache?.find(o => o.id === cb.value);
    if (obj) selected.push(obj.name);
  });
  return selected;
}

function getSelectedObjectiveIds() {
  const checkboxes = document.querySelectorAll('#org-objectives-options input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

// ── Policies (from GRC applied-controls) ──
let grcPoliciesCache = null;

async function fetchGrcPolicies() {
  try {
    const res = await fetch('/api/grc/policies');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    grcPoliciesCache = (data.results || []).map(p => ({
      id: p.id,
      name: p.name || '',
      refId: p.ref_id || '',
      category: p.category || '',
      status: p.status || '',
      csfFunction: p.csf_function || '',
      folder: p.folder ? (p.folder.str || '') : '',
    }));
    return grcPoliciesCache;
  } catch (err) {
    console.error('Failed to fetch GRC policies:', err);
    grcPoliciesCache = [];
    return [];
  }
}

function renderPoliciesCheckboxes(selectedIds = []) {
  const labelEl = document.getElementById('org-policies-label');
  const optionsEl = document.getElementById('org-policies-options');
  if (!optionsEl) return;

  if (!grcPoliciesCache || grcPoliciesCache.length === 0) {
    if (labelEl) labelEl.textContent = 'No policies available';
    optionsEl.innerHTML = '';
    return;
  }

  optionsEl.innerHTML = grcPoliciesCache.map(pol => {
    const checked = selectedIds.includes(pol.id) ? 'checked' : '';
    const badge = pol.refId ? `<span style="color:#6b7280;font-size:10px;margin-left:4px">${esc(pol.refId)}</span>` : '';
    return `<label>
      <input type="checkbox" value="${esc(pol.id)}" ${checked} onchange="updatePoliciesLabel()">
      <span>${esc(pol.name)}${badge}</span>
    </label>`;
  }).join('');

  updatePoliciesLabel();
}

function togglePoliciesDropdown() {
  const dd = document.getElementById('org-policies-dropdown');
  if (dd) dd.classList.toggle('open');
}
window.togglePoliciesDropdown = togglePoliciesDropdown;

// Close policies dropdown when clicking outside
document.addEventListener('click', e => {
  const dd = document.getElementById('org-policies-dropdown');
  if (dd && !dd.contains(e.target)) dd.classList.remove('open');
});

function filterPoliciesDropdown(query) {
  const q = (query || '').toLowerCase();
  const options = document.querySelectorAll('#org-policies-options label');
  options.forEach(lbl => {
    const text = lbl.textContent.toLowerCase();
    lbl.style.display = text.includes(q) ? '' : 'none';
  });
}
window.filterPoliciesDropdown = filterPoliciesDropdown;

function updatePoliciesLabel() {
  const labelEl = document.getElementById('org-policies-label');
  const chipsEl = document.getElementById('org-policies-chips');
  const checkboxes = document.querySelectorAll('#org-policies-options input[type="checkbox"]:checked');
  const count = checkboxes.length;

  if (labelEl) {
    labelEl.textContent = count === 0 ? 'Select policies…' : `${count} polic${count === 1 ? 'y' : 'ies'} selected`;
  }

  if (chipsEl) {
    if (count === 0) {
      chipsEl.innerHTML = '';
    } else {
      chipsEl.innerHTML = Array.from(checkboxes).map(cb => {
        const pol = grcPoliciesCache?.find(p => p.id === cb.value);
        if (!pol) return '';
        return `<span class="multiselect-chip">
          ${esc(pol.name)}
          <button type="button" onclick="removePolicyById('${esc(pol.id)}')" class="multiselect-chip-remove">&times;</button>
        </span>`;
      }).join('');
    }
  }
}
window.updatePoliciesLabel = updatePoliciesLabel;

function removePolicyById(id) {
  const cb = document.querySelector(`#org-policies-options input[value="${id}"]`);
  if (cb) { cb.checked = false; updatePoliciesLabel(); }
}
window.removePolicyById = removePolicyById;

function getSelectedPolicies() {
  const checkboxes = document.querySelectorAll('#org-policies-options input[type="checkbox"]:checked');
  const selected = [];
  checkboxes.forEach(cb => {
    const pol = grcPoliciesCache?.find(p => p.id === cb.value);
    if (pol) selected.push({ id: pol.id, name: pol.name, refId: pol.refId });
  });
  return selected;
}

function getSelectedPolicyIds() {
  const checkboxes = document.querySelectorAll('#org-policies-options input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

// ── Add Objective Modal ──
const addObjModal = document.getElementById('add-obj-modal-overlay');

async function openAddObjectiveModal() {
  if (!addObjModal) return;
  addObjModal.classList.add('active');
  document.getElementById('add-obj-name').value = '';

  // Fetch folders for the select
  const folderSelect = document.getElementById('add-obj-folder');
  folderSelect.innerHTML = '<option value="">Loading folders…</option>';
  try {
    const res = await fetch('/api/grc/folders?content_type=DO&content_type=GL');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const folders = data.folders || data.results || [];
    if (folders.length === 0) {
      folderSelect.innerHTML = '<option value="">No folders available</option>';
    } else {
      folderSelect.innerHTML = '<option value="">Select a folder…</option>' +
        folders.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
    }
  } catch (err) {
    console.error('Failed to fetch folders:', err);
    folderSelect.innerHTML = '<option value="">Error loading folders</option>';
  }
  document.getElementById('add-obj-name').focus();
}
window.openAddObjectiveModal = openAddObjectiveModal;

function closeAddObjectiveModal() {
  if (addObjModal) addObjModal.classList.remove('active');
}
window.closeAddObjectiveModal = closeAddObjectiveModal;

async function saveNewObjective() {
  const name = document.getElementById('add-obj-name').value.trim();
  const folder = document.getElementById('add-obj-folder').value;

  if (!name) {
    toast('error', 'Validation', 'Name is required.');
    document.getElementById('add-obj-name').focus();
    return;
  }
  if (!folder) {
    toast('error', 'Validation', 'Please select a folder.');
    document.getElementById('add-obj-folder').focus();
    return;
  }

  const saveBtn = document.getElementById('add-obj-save');
  saveBtn.disabled = true;
  try {
    const res = await fetch('/api/grc/organisation-objectives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, folder })
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || 'HTTP ' + res.status);
    }
    const data = await res.json();
    toast('success', 'Created', `Objective "${name}" created in GRC.`);
    closeAddObjectiveModal();

    // Refresh the objectives cache and re-render checkboxes
    grcObjectivesCache = null;
    await fetchGrcObjectives();
    // Preserve any currently checked items
    const currentlySelected = getSelectedObjectiveIds();
    // Auto-select the newly created objective
    const newId = data.result?.id;
    if (newId && !currentlySelected.includes(newId)) currentlySelected.push(newId);
    renderObjectivesCheckboxes(currentlySelected);
  } catch (err) {
    console.error('Create objective error:', err);
    toast('error', 'Failed', err.message);
  } finally {
    saveBtn.disabled = false;
  }
}
window.saveNewObjective = saveNewObjective;

// Close modal on Escape / overlay click
if (addObjModal) {
  addObjModal.addEventListener('click', e => { if (e.target === addObjModal) closeAddObjectiveModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && addObjModal.classList.contains('active')) closeAddObjectiveModal(); });
}

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
  renderObjectivesCheckboxes([]);
  renderPoliciesCheckboxes([]);
  document.getElementById('org-notes').value = '';
}

function updateMaturityLabels(val) {
  document.querySelectorAll('.maturity-labels span').forEach(s => {
    s.classList.toggle('active', s.dataset.val === String(val));
  });
}

// Maturity slider
document.getElementById('org-maturity')?.addEventListener('input', e => updateMaturityLabels(e.target.value));

// Sector "custom" toggle
document.getElementById('org-sector')?.addEventListener('change', e => {
  document.getElementById('org-sector-custom-row').style.display = e.target.value === 'custom' ? '' : 'none';
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
    strategicObjectives: getSelectedObjectives(),
    obligatoryFrameworks: mandates,
    policies: getSelectedPolicies(),
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
async function editOrgContext(idx) {
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
  document.getElementById('org-notes').value = ctx.notes || '';
  await openOrgModal(); // populates mandate checkboxes from frameworks first + fetches objectives

  // Pre-select saved objectives by matching name → id
  const savedObjNames = ctx.strategicObjectives || [];
  const selectedIds = (grcObjectivesCache || [])
    .filter(o => savedObjNames.includes(o.name))
    .map(o => o.id);
  renderObjectivesCheckboxes(selectedIds);

  // Now set mandates checkboxes after they've been populated
  const mandates = ctx.regulatoryMandates || [];
  document.querySelectorAll('#org-mandates-options input[type="checkbox"]').forEach(c => {
    c.checked = mandates.includes(c.value);
  });

  // Pre-select saved policies by matching id
  const savedPolicies = ctx.policies || [];
  const savedPolicyIds = savedPolicies.map(p => typeof p === 'object' ? p.id : p).filter(Boolean);
  renderPoliciesCheckboxes(savedPolicyIds);

  document.getElementById('org-name-en').focus();
}
window.editOrgContext = editOrgContext;

// Delete org profile
async function deleteOrgContext(idx) {
  const ctx = orgContexts[idx];
  if (!ctx) return;
  if (!await showConfirm({ title: 'Delete Profile', message: `Delete "${ctx.nameEn || ctx.name}"? Any Controls Studio sessions using this profile will lose their org context.`, confirmText: 'Delete' })) return;
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

// ─── Org Context Detail Page ─────────────────────────────────
let orgDetailCtxId = null;

function openOrgContextDetail(idx) {
  const ctx = orgContexts[idx];
  if (!ctx) return;
  orgDetailCtxId = ctx.id;
  updateRoute('org-contexts', ctx.id);
  renderOrgContextDetail(ctx, idx);
}
window.openOrgContextDetail = openOrgContextDetail;

function orgBackToList() {
  orgDetailCtxId = null;
  updateRoute('org-contexts', null);
  // Show list UI, hide detail
  const container = document.getElementById('page-org-contexts').querySelector('.page-container');
  container.querySelectorAll('.org-detail-page').forEach(el => el.remove());
  container.querySelectorAll('.org-list-section').forEach(el => el.style.display = '');
  // Also show the header
  const hdr = container.querySelector('.page-header');
  if (hdr) hdr.style.display = '';
}
window.orgBackToList = orgBackToList;

function renderOrgContextDetail(ctx, idx) {
  const container = document.getElementById('page-org-contexts').querySelector('.page-container');

  // Hide list sections
  const header = container.querySelector('.page-header');
  if (header) header.style.display = 'none';
  container.querySelectorAll('.org-stats-grid, .admin-search-bar, #org-contexts-list').forEach(el => {
    el.classList.add('org-list-section');
    el.style.display = 'none';
  });
  // Remove old detail if any
  container.querySelectorAll('.org-detail-page').forEach(el => el.remove());

  const sectorLabels = { banking: 'Banking & Financial Services', financial: 'Financial', government: 'Government', healthcare: 'Healthcare', energy: 'Energy & Utilities', telecom: 'Telecommunications', education: 'Education', retail: 'Retail & E-Commerce', insurance: 'Insurance', technology: 'Technology', defense: 'Defense & Military', manufacturing: 'Manufacturing', transportation: 'Transportation & Logistics', custom: 'Custom', other: 'Other' };
  const sizeLabels = { small: 'Small', medium: 'Medium', large: 'Large', enterprise: 'Enterprise' };
  const govLabel = { centralized: 'Centralized', decentralized: 'Decentralized', federated: 'Federated', hybrid: 'Hybrid' };
  const matLabels = { 1: 'Initial', 2: 'Developing', 3: 'Defined', 4: 'Managed', 5: 'Optimizing' };

  const name = ctx.nameEn || ctx.name || 'Untitled';
  const nameAr = ctx.nameAr || '';
  const sector = ctx.sectorCustom || sectorLabels[ctx.sector] || ctx.sector || '—';
  const size = sizeLabels[ctx.size] || ctx.size || '—';
  const maturity = ctx.complianceMaturity || 1;
  const gov = govLabel[ctx.governanceStructure] || ctx.governanceStructure || '—';
  const dataCls = ctx.dataClassification || '—';
  const geo = ctx.geographicScope || '—';
  const itInfra = ctx.itInfrastructure || '—';
  const fws = ctx.obligatoryFrameworks || [];
  const mandates = ctx.regulatoryMandates || [];
  const objectives = ctx.strategicObjectives || [];
  const policies = ctx.policies || [];
  const docs = ctx.documents || [];
  const notes = ctx.notes || '';

  const fwPills = fws.map(f => `<span class="org-fw-pill">${esc(f)}</span>`).join('') || '<span style="color:#9ca3af">None</span>';
  const mandPills = mandates.map(m => `<span class="org-fw-pill" style="color:#b45309;background:#fffbeb;border-color:#fde68a">${esc(m)}</span>`).join('') || '<span style="color:#9ca3af">None</span>';
  const policyPills = policies.map(p => {
    const pName = typeof p === 'object' ? p.name : p;
    const refId = typeof p === 'object' && p.refId ? ` (${esc(p.refId)})` : '';
    return `<span class="org-fw-pill" style="color:#4338ca;background:#eef2ff;border-color:#c7d2fe">${esc(pName)}${refId}</span>`;
  }).join('') || '<span style="color:#9ca3af">None</span>';

  const objHtml = objectives.length
    ? `<ul class="org-ctx-objectives">${objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ul>`
    : '<span style="color:#9ca3af">None</span>';

  const docsHtml = docs.length
    ? docs.map(d => `<div class="org-detail-doc-row"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2H10L13 5V13C13 13.6 12.6 14 12 14H3C2.4 14 2 13.6 2 13V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.3"/></svg><span>${esc(d.name || d)}</span></div>`).join('')
    : '<span style="color:#9ca3af">No documents</span>';

  const matDots = [1,2,3,4,5].map(n =>
    `<span class="org-detail-mat-dot ${n <= maturity ? 'active' : ''}" title="Level ${n}: ${matLabels[n]}">${n}</span>`
  ).join('');

  const detailEl = document.createElement('div');
  detailEl.className = 'org-detail-page';
  detailEl.innerHTML = `
    <div class="org-detail-top">
      <button class="pi-back-btn" onclick="orgBackToList()"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div class="org-detail-top-info">
        <div class="org-detail-breadcrumb">Admin &gt; Organization Contexts</div>
        <div class="org-detail-title">${esc(name)} ${nameAr ? `<span class="org-detail-title-ar">${esc(nameAr)}</span>` : ''}</div>
      </div>
      <div class="org-detail-top-actions">
        <button class="pi-btn pi-btn-view" onclick="editOrgContext(${idx})"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 2L12 4L5 11H3V9L10 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Edit</button>
        <button class="org-ctx-action-btn" style="color:#ef4444" onclick="deleteOrgContext(${idx})" title="Delete"><svg width="16" height="16" viewBox="0 0 14 14" fill="none"><path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
    </div>

    <div class="org-detail-grid">
      <div class="org-detail-card">
        <div class="org-detail-card-title">General Information</div>
        <div class="org-detail-field-grid">
          <div class="org-detail-field"><div class="org-detail-field-label">Sector</div><div class="org-detail-field-value">${esc(sector)}</div></div>
          <div class="org-detail-field"><div class="org-detail-field-label">Organization Size</div><div class="org-detail-field-value">${esc(size)}</div></div>
          <div class="org-detail-field"><div class="org-detail-field-label">Governance Structure</div><div class="org-detail-field-value">${esc(gov)}</div></div>
          <div class="org-detail-field"><div class="org-detail-field-label">Data Classification</div><div class="org-detail-field-value">${esc(dataCls)}</div></div>
          <div class="org-detail-field"><div class="org-detail-field-label">Geographic Scope</div><div class="org-detail-field-value">${esc(geo)}</div></div>
          <div class="org-detail-field"><div class="org-detail-field-label">IT Infrastructure</div><div class="org-detail-field-value">${esc(itInfra)}</div></div>
        </div>
      </div>

      <div class="org-detail-card">
        <div class="org-detail-card-title">Compliance Maturity</div>
        <div class="org-detail-maturity">
          <div class="org-detail-mat-bar">${matDots}</div>
          <div class="org-detail-mat-label">Level ${maturity} — ${matLabels[maturity] || maturity}</div>
        </div>
      </div>
    </div>

    <div class="org-detail-card">
      <div class="org-detail-card-title">Obligatory Frameworks</div>
      <div class="org-detail-pills">${fwPills}</div>
    </div>

    <div class="org-detail-card">
      <div class="org-detail-card-title">Regulatory Mandates</div>
      <div class="org-detail-pills">${mandPills}</div>
    </div>

    ${policies.length ? `<div class="org-detail-card">
      <div class="org-detail-card-title">Policies</div>
      <div class="org-detail-pills">${policyPills}</div>
    </div>` : ''}

    <div class="org-detail-card">
      <div class="org-detail-card-title">Strategic Objectives</div>
      <div class="org-detail-section-body">${objHtml}</div>
    </div>

    ${docs.length ? `<div class="org-detail-card">
      <div class="org-detail-card-title">Documents</div>
      <div class="org-detail-section-body">${docsHtml}</div>
    </div>` : ''}

    ${notes ? `<div class="org-detail-card">
      <div class="org-detail-card-title">Notes</div>
      <div class="org-detail-notes">${esc(notes)}</div>
    </div>` : ''}

    <div class="org-detail-card">
      <div class="org-detail-card-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>File Attachments</span>
        <label class="pi-btn pi-btn-primary" style="cursor:pointer;font-size:12px;padding:5px 12px;margin:0">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="margin-right:4px;vertical-align:-2px"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>Upload File
          <input type="file" id="org-file-upload-${esc(ctx.id)}" style="display:none" onchange="orgUploadFile('${esc(ctx.id)}', this)" multiple accept=".pdf,.doc,.docx,.txt,.csv,.xls,.xlsx,.pptx,.ppt,.png,.jpg,.jpeg,.gif,.webp" />
        </label>
      </div>
      <div id="org-files-list-${esc(ctx.id)}" class="org-files-list">
        <div style="text-align:center;padding:16px;color:#9ca3af"><svg class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-opacity="0.2"/><path d="M12 2C17.5 2 22 6.5 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Loading files...</div>
      </div>
    </div>
  `;

  container.appendChild(detailEl);

  // Load files for this org context
  orgLoadFiles(ctx.id);

  // Add floating chat button + chat panel
  renderOrgChatFAB(ctx);
}

// ---- Org Context Chat ----

let orgChatSessionId = null;
let orgChatOrgId = null;
let orgChatOpen = false;
let orgChatSelectedStores = []; // store IDs selected by user

let orgChatStep = 1; // 1 = select stores, 2 = chat

function renderOrgChatFAB(ctx) {
  // Remove previous FAB/panel if any
  document.querySelectorAll('.org-chat-fab, .org-chat-panel').forEach(el => el.remove());

  const ctxName = ctx ? esc(ctx.nameEn || ctx.name || 'Organization') : 'Organizations';

  // Floating action button
  const fab = document.createElement('button');
  fab.className = 'org-chat-fab';
  fab.title = 'Chat with organization documents';
  fab.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  fab.onclick = () => toggleOrgChat(ctx);
  document.body.appendChild(fab);

  // Chat panel (hidden initially)
  const panel = document.createElement('div');
  panel.className = 'org-chat-panel';
  panel.id = 'org-chat-panel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <div class="org-chat-header">
      <div class="org-chat-header-info">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span id="org-chat-header-title">Chat — ${ctxName}</span>
      </div>
      <div class="org-chat-header-actions">
        <button class="org-chat-header-btn" id="org-chat-back-btn" title="Back to stores" onclick="orgChatGoToStep1()" style="display:none"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="org-chat-header-btn" id="org-chat-expand-btn" title="Expand" onclick="orgChatToggleExpand()"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2h4M2 2v4M14 14h-4M14 14v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
        <button class="org-chat-header-btn" title="Close" onclick="toggleOrgChat()"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
      </div>
    </div>

    <!-- STEP 1: Select collections -->
    <div class="org-chat-step" id="org-chat-step1">
      <div class="org-chat-stores" id="org-chat-stores">
        <div class="org-chat-stores-label">Select document stores to include:</div>
        <div class="org-chat-stores-list" id="org-chat-stores-list">
          <div style="padding:8px;color:#9ca3af;font-size:12px">Loading stores...</div>
        </div>
      </div>
      <div class="org-chat-step1-footer">
        <div class="org-chat-selected-count" id="org-chat-selected-count">0 stores selected</div>
        <button class="org-chat-start-btn" id="org-chat-start-btn" onclick="orgChatGoToStep2()" disabled>Start Chat <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
    </div>

    <!-- STEP 2: Chat conversation -->
    <div class="org-chat-step" id="org-chat-step2" style="display:none">
      <div class="org-chat-messages" id="org-chat-messages">
        <div class="org-chat-welcome">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style="color:#6366f1"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="1.5"/></svg>
          <div class="org-chat-welcome-title">Organization Assistant</div>
          <div class="org-chat-welcome-sub">Ask questions about the uploaded documents and policies.</div>
        </div>
      </div>
      <div class="org-chat-input-area">
        <textarea id="org-chat-input" class="org-chat-input" placeholder="Ask about organization documents..." rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();orgChatSend();}"></textarea>
        <button class="org-chat-send-btn" id="org-chat-send-btn" onclick="orgChatSend()" title="Send">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  orgChatStep = 1;
  orgChatLoadStores(ctx);
}

function orgChatUpdateSelectedCount() {
  const countEl = document.getElementById('org-chat-selected-count');
  const startBtn = document.getElementById('org-chat-start-btn');
  const n = orgChatSelectedStores.length;
  if (countEl) countEl.textContent = n + ' store' + (n !== 1 ? 's' : '') + ' selected';
  if (startBtn) startBtn.disabled = n === 0;
}

function orgChatGoToStep2() {
  if (!orgChatSelectedStores.length) return;
  orgChatStep = 2;
  const step1 = document.getElementById('org-chat-step1');
  const step2 = document.getElementById('org-chat-step2');
  const backBtn = document.getElementById('org-chat-back-btn');
  const titleEl = document.getElementById('org-chat-header-title');
  if (step1) step1.style.display = 'none';
  if (step2) step2.style.display = 'flex';
  if (backBtn) backBtn.style.display = 'flex';
  if (titleEl) titleEl.textContent = 'Chat — ' + orgChatSelectedStores.length + ' store' + (orgChatSelectedStores.length !== 1 ? 's' : '');
  const input = document.getElementById('org-chat-input');
  if (input) setTimeout(() => input.focus(), 100);
}
window.orgChatGoToStep2 = orgChatGoToStep2;

function orgChatGoToStep1() {
  orgChatStep = 1;
  const step1 = document.getElementById('org-chat-step1');
  const step2 = document.getElementById('org-chat-step2');
  const backBtn = document.getElementById('org-chat-back-btn');
  if (step1) step1.style.display = 'flex';
  if (step2) step2.style.display = 'none';
  if (backBtn) backBtn.style.display = 'none';
}
window.orgChatGoToStep1 = orgChatGoToStep1;

let orgChatExpanded = false;
function orgChatToggleExpand() {
  const panel = document.getElementById('org-chat-panel');
  const btn = document.getElementById('org-chat-expand-btn');
  const fab = document.querySelector('.org-chat-fab');
  if (!panel) return;
  orgChatExpanded = !orgChatExpanded;
  panel.classList.toggle('expanded', orgChatExpanded);
  if (fab) fab.style.display = orgChatExpanded ? 'none' : '';
  if (btn) {
    btn.title = orgChatExpanded ? 'Collapse' : 'Expand';
    btn.innerHTML = orgChatExpanded
      ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5 2v3H2M11 14v-3h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2h4M2 2v4M14 14h-4M14 14v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  }
}
window.orgChatToggleExpand = orgChatToggleExpand;

async function orgChatLoadStores(currentCtx) {
  const listEl = document.getElementById('org-chat-stores-list');
  if (!listEl) return;
  orgChatSelectedStores = [];
  try {
    const r = await fetch('/api/org-contexts');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const allOrgs = d.contexts || [];
    const orgsWithStores = allOrgs.filter(o => o.storeId);
    if (!orgsWithStores.length) {
      listEl.innerHTML = '<div style="padding:8px;color:#9ca3af;font-size:12px">No document stores available. Upload files to an organization first.</div>';
      return;
    }

    const currentId = currentCtx ? currentCtx.id : null;

    if (currentCtx && currentCtx.storeId) {
      orgChatSelectedStores = [currentCtx.storeId];
    } else {
      orgChatSelectedStores = orgsWithStores.map(o => o.storeId);
    }

    listEl.innerHTML = orgsWithStores.map((org, i) => {
      const isChecked = orgChatSelectedStores.includes(org.storeId);
      const isCurrent = org.id === currentId;
      return `<div class="org-chat-store-accordion ${isChecked ? 'selected' : ''}" data-storeid="${esc(org.storeId)}">
        <div class="org-chat-store-header" onclick="orgChatToggleAccordion(this)">
          <input type="checkbox" value="${esc(org.storeId)}" data-orgid="${esc(org.id)}" ${isChecked ? 'checked' : ''} onchange="orgChatToggleStore(this)" onclick="event.stopPropagation()" />
          <span class="org-chat-store-name">${esc(org.nameEn || org.name || 'Organization')}</span>
          ${isCurrent ? '<span class="org-chat-store-badge">Current</span>' : ''}
          <svg class="org-chat-store-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 5.5L7 8.5L10 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="org-chat-store-files" id="org-chat-files-${esc(org.id)}" style="display:none">
          <div class="org-chat-files-loading"><svg class="spinner" width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-opacity="0.2"/><path d="M12 2C17.5 2 22 6.5 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Loading files...</div>
        </div>
      </div>`;
    }).join('');

    // Pre-fetch files for each store
    orgsWithStores.forEach(org => orgChatFetchStoreFiles(org.id));
    orgChatUpdateSelectedCount();

  } catch (err) {
    console.error('Load org stores error:', err);
    listEl.innerHTML = '<div style="padding:8px;color:#ef4444;font-size:12px">Failed to load stores.</div>';
  }
}

function orgChatToggleAccordion(headerEl) {
  const accordion = headerEl.closest('.org-chat-store-accordion');
  if (!accordion) return;
  const filesEl = accordion.querySelector('.org-chat-store-files');
  if (!filesEl) return;
  const isOpen = filesEl.style.display !== 'none';
  filesEl.style.display = isOpen ? 'none' : 'block';
  accordion.classList.toggle('open', !isOpen);
}
window.orgChatToggleAccordion = orgChatToggleAccordion;

async function orgChatFetchStoreFiles(orgId) {
  const filesEl = document.getElementById('org-chat-files-' + orgId);
  if (!filesEl) return;
  try {
    const r = await fetch(`/api/org-contexts/${orgId}/files`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const files = (d.data && d.data.documents) || [];
    if (!files.length) {
      filesEl.innerHTML = '<div class="org-chat-files-empty">No files uploaded</div>';
      return;
    }
    filesEl.innerHTML = files.map(f => {
      const displayName = f.displayName || (f.name || '').split('/').pop();
      const state = (f.state || '').toUpperCase();
      const isActive = state === 'ACTIVE';
      return `<div class="org-chat-file-row">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 2H10L13 5V13C13 13.6 12.6 14 12 14H3C2.4 14 2 13.6 2 13V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.3"/></svg>
        <span class="org-chat-file-name">${esc(displayName)}</span>
        ${isActive ? '<span class="org-chat-file-status active">●</span>' : '<span class="org-chat-file-status processing">●</span>'}
      </div>`;
    }).join('');
  } catch (err) {
    console.error('Fetch store files error:', err);
    filesEl.innerHTML = '<div class="org-chat-files-empty" style="color:#ef4444">Failed to load</div>';
  }
}

function orgChatToggleStore(checkbox) {
  const storeId = checkbox.value;
  const accordion = checkbox.closest('.org-chat-store-accordion');
  if (checkbox.checked) {
    if (!orgChatSelectedStores.includes(storeId)) orgChatSelectedStores.push(storeId);
    if (accordion) accordion.classList.add('selected');
  } else {
    orgChatSelectedStores = orgChatSelectedStores.filter(s => s !== storeId);
    if (accordion) accordion.classList.remove('selected');
  }
  orgChatSessionId = null;
  orgChatUpdateSelectedCount();
}
window.orgChatToggleStore = orgChatToggleStore;

function toggleOrgChat(ctx) {
  const panel = document.getElementById('org-chat-panel');
  if (!panel) return;
  orgChatOpen = !orgChatOpen;
  panel.style.display = orgChatOpen ? 'flex' : 'none';
  if (orgChatOpen) {
    // Use provided ctx, or fall back to first org that has a store
    if (ctx) {
      orgChatOrgId = ctx.id;
    } else if (!orgChatOrgId) {
      const withStore = orgContexts.find(o => o.storeId);
      orgChatOrgId = withStore ? withStore.id : (orgContexts[0] ? orgContexts[0].id : null);
    }
    const input = document.getElementById('org-chat-input');
    if (input) setTimeout(() => input.focus(), 100);
  }
}
window.toggleOrgChat = toggleOrgChat;

function orgChatReset() {
  orgChatSessionId = null;
  // Clear messages
  const msgs = document.getElementById('org-chat-messages');
  if (msgs) {
    msgs.innerHTML = `<div class="org-chat-welcome">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style="color:#6366f1"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="1.5"/></svg>
      <div class="org-chat-welcome-title">Organization Assistant</div>
      <div class="org-chat-welcome-sub">Ask questions about the uploaded documents and policies.</div>
    </div>`;
  }
  const input = document.getElementById('org-chat-input');
  if (input) input.value = '';
  // Go back to step 1
  orgChatGoToStep1();
}
window.orgChatReset = orgChatReset;

async function orgChatSend() {
  const input = document.getElementById('org-chat-input');
  const sendBtn = document.getElementById('org-chat-send-btn');
  const msgsEl = document.getElementById('org-chat-messages');
  if (!input || !msgsEl) return;

  const message = input.value.trim();
  if (!message) return;
  if (!orgChatOrgId) return;

  // Clear welcome if present
  const welcome = msgsEl.querySelector('.org-chat-welcome');
  if (welcome) welcome.remove();

  // Add user message bubble
  const userBubble = document.createElement('div');
  userBubble.className = 'org-chat-msg user';
  userBubble.innerHTML = `<div class="org-chat-msg-content">${escHtml(message)}</div>`;
  msgsEl.appendChild(userBubble);

  // Add thinking indicator
  const thinkingEl = document.createElement('div');
  thinkingEl.className = 'org-chat-msg ai';
  thinkingEl.innerHTML = `<div class="org-chat-msg-content org-chat-thinking"><svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-opacity="0.2"/><path d="M12 2C17.5 2 22 6.5 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Thinking...</div>`;
  msgsEl.appendChild(thinkingEl);
  msgsEl.scrollTop = msgsEl.scrollHeight;

  input.value = '';
  input.disabled = true;
  if (sendBtn) sendBtn.disabled = true;

  try {
    const payload = {
      message,
      storeIds: orgChatSelectedStores,
    };
    if (orgChatSessionId) payload.sessionId = orgChatSessionId;

    const r = await fetch(`/api/org-contexts/${orgChatOrgId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const d = await r.json();
    thinkingEl.remove();

    if (!r.ok || !d.success) {
      throw new Error(d.error || 'Chat request failed');
    }

    orgChatSessionId = d.sessionId;

    // Add AI response bubble
    const aiBubble = document.createElement('div');
    aiBubble.className = 'org-chat-msg ai';
    let sourcesHtml = '';
    if (d.sources && d.sources.length) {
      sourcesHtml = `<div class="org-chat-sources">${d.sources.map(s => `<span class="org-chat-source-pill" title="${esc(s.uri || '')}">${esc(s.title || 'Source')}</span>`).join('')}</div>`;
    }
    aiBubble.innerHTML = `<div class="org-chat-msg-content">${formatOrgChatMarkdown(d.message || '')}</div>${sourcesHtml}`;
    msgsEl.appendChild(aiBubble);
    msgsEl.scrollTop = msgsEl.scrollHeight;

  } catch (err) {
    thinkingEl.remove();
    console.error('[OrgChat] Error:', err);
    const errBubble = document.createElement('div');
    errBubble.className = 'org-chat-msg ai';
    errBubble.innerHTML = `<div class="org-chat-msg-content org-chat-error">Error: ${escHtml(err.message)}</div>`;
    msgsEl.appendChild(errBubble);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  } finally {
    input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    input.focus();
  }
}
window.orgChatSend = orgChatSend;

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatOrgChatMarkdown(text) {
  // Simple markdown-like formatting
  let html = escHtml(text);
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Code blocks
  html = html.replace(/```[\s\S]*?```/g, m => {
    const code = m.replace(/```\w*\n?/, '').replace(/\n?```$/, '');
    return `<pre><code>${code}</code></pre>`;
  });
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  // Lists
  html = html.replace(/(?:^|<br>)[-•]\s+(.*?)(?=<br>|$)/g, '<li>$1</li>');
  if (html.includes('<li>')) html = html.replace(/(<li>.*?<\/li>)+/g, '<ul>$&</ul>');
  return html;
}

// Clean up chat on navigating away
const origOrgBackToList = window.orgBackToList;
window.orgBackToList = function() {
  document.querySelectorAll('.org-chat-fab, .org-chat-panel').forEach(el => el.remove());
  orgChatSessionId = null;
  orgChatOrgId = null;
  orgChatOpen = false;
  orgChatExpanded = false;
  orgChatSelectedStores = [];
  if (origOrgBackToList) origOrgBackToList();
};

// ---- Org Context File Attachments ----

async function orgLoadFiles(orgId) {
  const listEl = document.getElementById('org-files-list-' + orgId);
  if (!listEl) return;
  try {
    const r = await fetch(`/api/org-contexts/${orgId}/files`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const files = (d.data && d.data.documents) || [];
    const storeId = d.storeId || '';
    if (!files.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#9ca3af;font-size:13px">No files attached yet. Upload files to attach them to this organization.</div>';
      return;
    }
    listEl.innerHTML = files.map(f => {
      const docName = f.name || '';
      const docId = docName.split('/').pop();
      const displayName = f.displayName || docId;
      const state = (f.state || '').toUpperCase();
      const isActive = state === 'ACTIVE';
      const statusBadge = isActive
        ? '<span class="pi-file-status active">Active</span>'
        : `<span class="pi-file-status processing">${esc(state || 'PROCESSING')}</span>`;
      return `<div class="org-file-row">
        <div class="org-file-info">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2H10L13 5V13C13 13.6 12.6 14 12 14H3C2.4 14 2 13.6 2 13V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.3"/></svg>
          <span class="org-file-name">${esc(displayName)}</span>
          ${statusBadge}
        </div>
        <div class="org-file-actions">
          ${isActive ? `<button class="pi-file-action-btn view" title="View file" onclick="event.stopPropagation();orgViewFile('${esc(orgId)}','${esc(docId)}','${esc(displayName)}')"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 7s2.2-4.5 6-4.5S13 7 13 7s-2.2 4.5-6 4.5S1 7 1 7z" stroke="currentColor" stroke-width="1.2"/><circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.2"/></svg></button>` : ''}
          <button class="pi-file-action-btn delete" title="Delete file" onclick="event.stopPropagation();orgDeleteFile('${esc(orgId)}','${esc(docId)}','${esc(displayName)}')"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('Org files load error:', err);
    listEl.innerHTML = '<div style="text-align:center;padding:16px;color:#ef4444;font-size:13px">Failed to load files.</div>';
  }
}
window.orgLoadFiles = orgLoadFiles;

async function orgUploadFile(orgId, input) {
  const files = input.files;
  if (!files || !files.length) return;
  const listEl = document.getElementById('org-files-list-' + orgId);
  if (listEl) {
    listEl.innerHTML = '<div style="text-align:center;padding:16px;color:#6366f1"><svg class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-opacity="0.2"/><path d="M12 2C17.5 2 22 6.5 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Uploading ' + files.length + ' file(s)...</div>';
  }

  for (const file of files) {
    try {
      const data = await fileToBase64(file);
      const r = await fetch(`/api/org-contexts/${orgId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type || 'application/octet-stream', data })
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Upload failed'); }
      console.log(`[OrgFiles] Uploaded: ${file.name}`);
    } catch (err) {
      console.error(`[OrgFiles] Upload error for ${file.name}:`, err);
      alert(`Failed to upload "${file.name}": ${err.message}`);
    }
  }

  input.value = '';
  // Reload files list
  orgLoadFiles(orgId);
}
window.orgUploadFile = orgUploadFile;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function orgViewFile(orgId, fileId, fileName) {
  const url = `/api/org-contexts/${orgId}/files/${fileId}`;
  window.open(url, '_blank');
}
window.orgViewFile = orgViewFile;

async function orgDeleteFile(orgId, fileId, fileName) {
  if (!confirm(`Delete "${fileName}"?`)) return;
  try {
    const r = await fetch(`/api/org-contexts/${orgId}/files/${fileId}`, { method: 'DELETE' });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Delete failed'); }
    console.log(`[OrgFiles] Deleted: ${fileName}`);
    orgLoadFiles(orgId);
  } catch (err) {
    console.error('[OrgFiles] Delete error:', err);
    alert(`Failed to delete: ${err.message}`);
  }
}
window.orgDeleteFile = orgDeleteFile;

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
  if (!await showConfirm({ title: 'Delete Prompt', message: `Delete "${nm}"?`, confirmText: 'Delete' })) return;
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
    complianceAssessment: '',
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
  if (!await showConfirm({ title: 'Delete Session', message: `Delete session "${name}"?`, confirmText: 'Delete' })) return;
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
        <div id="cs-fw-list" class="studio-fw-list" style="max-height:55vh;overflow-y:auto">
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

  // Fetch frameworks from GRC + compliance assessments
  (async () => {
    if (!csLibraries.length) {
      try {
        const d = await fetch('/api/grc/frameworks').then(r => r.json());
        if (d.success && Array.isArray(d.results)) csLibraries = d.results;
      } catch (e) { console.error('CS GRC frameworks fetch:', e); }
    }
    csRenderFwList();
    csAttachFwSearch();
  })();
}

// When compliance assessment changes, fetch its tree (keys = RA UUIDs)
async function csOnComplianceAssessmentChange() {
  const caSelect = document.getElementById('cs-compliance-assessment');
  const statusEl = document.getElementById('cs-ca-status');
  const caId = caSelect ? caSelect.value : '';

  csSessionData.complianceAssessment = caId;
  csSessionData.caTree = null; // reset cached CA tree

  // Clear framework tree caches so they reload from CA tree
  Object.keys(csFrameworkTrees).forEach(k => delete csFrameworkTrees[k]);

  if (!caId) {
    if (statusEl) statusEl.textContent = 'Select the compliance assessment to link requirements from';
    return;
  }

  if (statusEl) statusEl.innerHTML = '<span style="color:#60a5fa">Loading compliance assessment tree...</span>';

  try {
    const d = await fetch(`/api/grc/compliance-assessments/${caId}/tree`).then(r => r.json());
    if (!d.success || !d.tree) throw new Error('No tree data');
    csSessionData.caTree = d.tree;
    console.log(`[Step 1] CA tree loaded for ${caId}`, Object.keys(d.tree).length, 'top-level entries');
    if (statusEl) statusEl.innerHTML = `<span style="color:#10b981">✓ Compliance assessment loaded</span>`;

    // Re-render the framework list to update counts
    csRenderFwList();
  } catch (err) {
    console.error('[Step 1] Failed to fetch CA tree:', err);
    if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444">⚠ ${err.message}</span>`;
  }
}
window.csOnComplianceAssessmentChange = csOnComplianceAssessmentChange;

// Cache for loaded framework trees  { fwId -> flatNodes[] }
const csFrameworkTrees = {};

function csRenderFwList() {
  const listEl = document.getElementById('cs-fw-list');
  if (!listEl) return;
  const reqs = csSessionData.requirements || [];

  if (!csLibraries.length) {
    listEl.innerHTML = '<div class="studio-empty-msg">No frameworks loaded from GRC.</div>';
    return;
  }

  let html = '';
  csLibraries.forEach((fw, li) => {
    const fwName = fw.name || fw.ref_id || 'Unknown Framework';
    const groupId = 'csg-' + li;
    const fwId = fw.id;
    // Count selected requirements in this framework
    const selectedInGroup = reqs.filter(r => r.frameworkId === fwId).length;
    const cachedNodes = csFrameworkTrees[fwId];
    const nodeCount = cachedNodes ? cachedNodes.length : '';

    html += `<div class="studio-fw-group collapsed" data-group-id="${groupId}" data-fw-id="${fwId}">
      <div class="studio-fw-group-header">
        <div class="cs-fw-cb" onclick="event.stopPropagation();csToggleFwGroup('${groupId}','${esc(fwName)}')" style="cursor:pointer">
          <span class="studio-cb-mark ${cachedNodes && selectedInGroup === cachedNodes.length && cachedNodes.length > 0 ? 'checked' : (selectedInGroup > 0 ? 'indeterminate' : '')}"></span>
        </div>
        <div class="studio-fw-group-toggle" onclick="csGrcFwToggleGroup(this, '${fwId}')">
          <svg class="chevron-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>${esc(fwName)}</span>
          ${fw.provider ? `<span style="font-size:10px;color:#6b7280;margin-left:6px">(${esc(fw.provider)})</span>` : ''}
        </div>
        <div class="studio-fw-group-actions">
          <span class="studio-fw-group-count">${selectedInGroup > 0 ? selectedInGroup + '/' : ''}${nodeCount || '…'} req</span>
        </div>
      </div>
      <div class="studio-fw-group-items" id="cs-fw-items-${fwId}">
        ${cachedNodes ? csRenderFwTreeItems(cachedNodes, fwId, fwName, groupId, reqs) : '<div class="studio-loading"><svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-opacity="0.2"/><path d="M12 2C17.5 2 22 6.5 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Loading requirements…</span></div>'}
      </div>
    </div>`;
  });

  listEl.innerHTML = html;
}

// Flatten a GRC tree into assessable leaf nodes
function csFlattenTree(tree, depth = 0) {
  const nodes = [];
  for (const [nodeId, node] of Object.entries(tree)) {
    if (node.assessable) {
      nodes.push({
        nodeId,
        urn: node.urn || '',
        ref_id: node.ref_id || '',
        name: node.name || '',
        description: node.description || '',
        depth,
        assessable: true,
      });
    }
    if (node.children && Object.keys(node.children).length > 0) {
      nodes.push(...csFlattenTree(node.children, depth + 1));
    }
  }
  return nodes;
}

// Render requirement items for a loaded tree
function csRenderFwTreeItems(nodes, fwId, fwName, groupId, reqs) {
  return nodes.map(node => {
    const opt = {
      frameworkId: fwId,
      frameworkName: fwName,
      nodeId: node.nodeId,
      nodeUrn: node.urn,
      refId: node.ref_id,
      name: node.name,
      description: node.description,
      depth: node.depth,
      assessable: node.assessable,
    };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(opt))));
    const isSelected = reqs.some(r => r.nodeUrn === node.urn || r.nodeId === node.nodeId);
    const depthDot = node.depth === 0 ? '●' : node.depth === 1 ? '○' : node.depth === 2 ? '◦' : '·';
    const label = node.description || node.name || node.ref_id || '';
    return `<div class="studio-fw-item${isSelected ? ' selected' : ''}" data-opt="${encoded}" data-group-id="${groupId}" data-search="${esc((node.ref_id + ' ' + label + ' ' + fwName).toLowerCase())}" onclick="csToggleReq(this)">
      <div class="studio-fw-item-checkbox"><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div class="studio-fw-item-content">
        ${node.ref_id ? `<span class="studio-fw-ref">${esc(node.ref_id)}</span>` : ''}
        <span class="studio-fw-desc"><span class="studio-fw-depth">${depthDot}</span> ${esc(label)}</span>
      </div>
    </div>`;
  }).join('');
}

// Toggle group: expand/collapse. On first expand, fetch tree from GRC.
async function csGrcFwToggleGroup(el, fwId) {
  const group = el.closest('.studio-fw-group');
  if (!group) return;
  const wasCollapsed = group.classList.contains('collapsed');
  group.classList.toggle('collapsed');

  // If expanding and tree not yet loaded, fetch it
  if (wasCollapsed && !csFrameworkTrees[fwId]) {
    const itemsEl = document.getElementById('cs-fw-items-' + fwId);
    if (!itemsEl) return;
    itemsEl.innerHTML = '<div class="studio-loading"><svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-opacity="0.2"/><path d="M12 2C17.5 2 22 6.5 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Loading requirements…</span></div>';
    try {
      let tree;
      // If CA tree is loaded, extract this framework's subtree (keys = RA UUIDs)
      const caTree = csSessionData.caTree;
      if (caTree && caTree[fwId]) {
        // CA tree has framework IDs at top level, children underneath
        tree = caTree[fwId].children || caTree[fwId];
        console.log(`[GRC] Using CA tree for framework ${fwId}`);
      } else {
        // Fallback: fetch from framework tree endpoint (keys = requirement node UUIDs)
        const d = await fetch(`/api/grc/frameworks/${fwId}/tree`).then(r => r.json());
        if (!d.success || !d.tree) throw new Error('No tree data');
        tree = d.tree;
        console.log(`[GRC] Using framework tree for ${fwId} (no CA tree available)`);
      }
      const flat = csFlattenTree(tree);
      csFrameworkTrees[fwId] = flat;
      // Find framework info
      const fw = csLibraries.find(f => f.id === fwId);
      const fwName = fw ? (fw.name || fw.ref_id) : 'Unknown';
      const groupId = group.dataset.groupId;
      const reqs = csSessionData.requirements || [];
      itemsEl.innerHTML = csRenderFwTreeItems(flat, fwId, fwName, groupId, reqs);
      // Update count in header
      const countEl = group.querySelector('.studio-fw-group-count');
      const selectedInGroup = reqs.filter(r => r.frameworkId === fwId).length;
      if (countEl) countEl.textContent = (selectedInGroup > 0 ? selectedInGroup + '/' : '') + flat.length + ' req';
    } catch (err) {
      console.error('[GRC] Tree fetch error:', err);
      itemsEl.innerHTML = '<div class="studio-empty-msg">Failed to load requirements.</div>';
    }
  }
}
window.csGrcFwToggleGroup = csGrcFwToggleGroup;

function csDecodeOpt(enc) {
  return JSON.parse(decodeURIComponent(escape(atob(enc))));
}

function csFwToggleGroup(el) {
  el.closest('.studio-fw-group').classList.toggle('collapsed');
}
window.csFwToggleGroup = csFwToggleGroup;

// Match a requirement by nodeId or nodeUrn (GRC uses nodeId, legacy uses nodeUrn)
function csReqMatch(r, opt) {
  if (opt.nodeId && r.nodeId === opt.nodeId) return true;
  if (opt.nodeUrn && r.nodeUrn === opt.nodeUrn) return true;
  return false;
}

function csToggleReq(itemEl) {
  const opt = csDecodeOpt(itemEl.dataset.opt);
  if (!csSessionData.requirements) csSessionData.requirements = [];
  const idx = csSessionData.requirements.findIndex(r => csReqMatch(r, opt));
  if (idx === -1) {
    csSessionData.requirements.push(opt);
    itemEl.classList.add('selected');
    console.log(`[Req Selected] refId=${opt.refId}, nodeId=${opt.nodeId}, nodeUrn=${opt.nodeUrn}, name=${opt.name}`);
  } else {
    csSessionData.requirements.splice(idx, 1);
    itemEl.classList.remove('selected');
    console.log(`[Req Deselected] refId=${opt.refId}, nodeId=${opt.nodeId}, nodeUrn=${opt.nodeUrn}`);
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
    const idx = csSessionData.requirements.findIndex(r => csReqMatch(r, opt));
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
        if (!csSessionData.requirements.some(r => csReqMatch(r, opt))) {
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

        const csDocId = (f.name || '').split('/').pop();
        html += `<div class="studio-file-item ${isFileSelected ? 'file-selected' : ''}" data-file-key="${esc(fileKey)}">
          ${isActive ? `<div class="studio-file-cb" onclick="event.stopPropagation();csToggleFile('${esc(storeId)}','${esc(fileKey).replace(/'/g, "\\'")}')"><span class="studio-cb-mark ${isFileSelected ? 'checked' : ''}"></span></div>` : '<span style="width:22px;display:inline-block"></span>'}
          <svg class="studio-file-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2H9L13 6V14C13 14.6 12.6 15 12 15H3C2.4 15 2 14.6 2 14V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9 2V6H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <span class="studio-file-name">${esc(fName)}</span>
          <span class="studio-file-state ${stateClass}">${stateIcon} ${stateLabel}</span>
          ${isActive && csDocId ? `<button class="btn-admin-sm" onclick="event.stopPropagation();viewFileInCollection('${esc(storeId)}','${esc(csDocId)}')" title="View file" style="padding:2px 6px;font-size:11px;margin-left:auto"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 7C1 7 3.5 2.5 7 2.5C10.5 2.5 13 7 13 7C13 7 10.5 11.5 7 11.5C3.5 11.5 1 7 1 7Z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.3"/></svg></button>` : ''}
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
  if (!await showConfirm({ title: 'Delete Collection', message: `Delete "${displayName}"? This removes all files.`, confirmText: 'Delete' })) return;
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
        nodeId: r.nodeId,
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
                  ${readOnly ? `
                    ${c.implementation_guidance ? `<div class="cs-ctrl-detail"><span class="cs-ctrl-detail-label">Implementation Guidance</span><p>${esc(c.implementation_guidance)}</p></div>` : ''}
                    ${c.rationale ? `<div class="cs-ctrl-detail"><span class="cs-ctrl-detail-label">Rationale</span><p>${esc(c.rationale)}</p></div>` : ''}
                    ${c.requirementRefId ? `<div class="cs-ctrl-detail"><span class="cs-ctrl-detail-label">Cross-Framework Mapping</span><div class="cs-ctrl-detail-pills"><span class="cs-tag cs-tag-mono">${esc(c.requirementRefId)}</span>${c.requirementName ? `<span class="cs-tag cs-tag-primary">${esc(c.requirementName)}</span>` : ''}</div></div>` : ''}
                    ${c.framework ? `<div class="cs-ctrl-detail"><span class="cs-ctrl-detail-label">Framework</span><span class="cs-tag cs-tag-primary">${esc(c.framework)}</span></div>` : ''}
                    ${(c.effort || c.effort_estimate) ? `<div class="cs-ctrl-detail"><span class="cs-ctrl-detail-label">Effort</span><span class="cs-tag cs-tag-gray">${esc(c.effort || c.effort_estimate)}</span></div>` : ''}
                    ${c.status ? `<div class="cs-ctrl-detail"><span class="cs-ctrl-detail-label">Status</span><span class="cs-tag cs-tag-gray">${esc(c.status)}</span></div>` : ''}
                    ${(c.evidence_examples && c.evidence_examples.length) ? `<div class="cs-ctrl-detail"><span class="cs-ctrl-detail-label">Evidence Examples</span><div class="cs-ctrl-detail-pills">${c.evidence_examples.map(e => `<span class="cs-tag cs-tag-gray">${esc(e)}</span>`).join('')}</div></div>` : ''}
                  ` : `
                    <form class="cs-edit-form" data-ctrl-id="${esc(c.id)}" onsubmit="event.preventDefault();csSaveControl('${esc(c.id)}')">
                      <div class="cs-edit-row">
                        <div class="cs-edit-field cs-edit-field-full">
                          <label>Name</label>
                          <input type="text" name="name" value="${esc(c.name || c.name_ar || '')}" placeholder="Control name" />
                        </div>
                      </div>
                      <div class="cs-edit-row">
                        <div class="cs-edit-field cs-edit-field-full">
                          <label>Description</label>
                          <textarea name="description" rows="3" placeholder="Control description">${esc(c.description || c.description_ar || '')}</textarea>
                        </div>
                      </div>
                      <div class="cs-edit-row cs-edit-row-grid">
                        <div class="cs-edit-field">
                          <label>Category</label>
                          <select name="category">
                            <option value="">— None —</option>
                            ${Object.entries(catLabel).map(([k,v]) => `<option value="${k}" ${(c.category||c.control_type)===k?'selected':''}>${v}</option>`).join('')}
                          </select>
                        </div>
                        <div class="cs-edit-field">
                          <label>CSF Function</label>
                          <select name="csf_function">
                            <option value="">— None —</option>
                            ${Object.entries(csfLabel).map(([k,v]) => `<option value="${k}" ${(c.csf_function||c.csfFunction)===k?'selected':''}>${v}</option>`).join('')}
                          </select>
                        </div>
                        <div class="cs-edit-field">
                          <label>Priority</label>
                          <select name="priority">
                            <option value="1" ${String(c.priority)==='1'||c.priority==='critical'?'selected':''}>Critical (1)</option>
                            <option value="2" ${String(c.priority)==='2'||c.priority==='high'?'selected':''}>High (2)</option>
                            <option value="3" ${String(c.priority)==='3'||c.priority==='medium'||!c.priority?'selected':''}>Medium (3)</option>
                            <option value="4" ${String(c.priority)==='4'||c.priority==='low'?'selected':''}>Low (4)</option>
                          </select>
                        </div>
                        <div class="cs-edit-field">
                          <label>Effort</label>
                          <select name="effort">
                            <option value="S" ${(c.effort||c.effort_estimate||'').toUpperCase()==='S'?'selected':''}>S (Small)</option>
                            <option value="M" ${(c.effort||c.effort_estimate||'M').toUpperCase()==='M'?'selected':''}>M (Medium)</option>
                            <option value="L" ${(c.effort||c.effort_estimate||'').toUpperCase()==='L'?'selected':''}>L (Large)</option>
                            <option value="XL" ${(c.effort||c.effort_estimate||'').toUpperCase()==='XL'?'selected':''}>XL (Extra Large)</option>
                          </select>
                        </div>
                      </div>
                      <div class="cs-edit-row">
                        <div class="cs-edit-field cs-edit-field-full">
                          <label>Implementation Guidance</label>
                          <textarea name="implementation_guidance" rows="2" placeholder="How to implement this control">${esc(c.implementation_guidance || '')}</textarea>
                        </div>
                      </div>
                      <div class="cs-edit-row cs-edit-row-grid">
                        <div class="cs-edit-field">
                          <label>Status</label>
                          <select name="status">
                            <option value="to_do" ${(c.status||'to_do')==='to_do'?'selected':''}>To Do</option>
                            <option value="in_progress" ${c.status==='in_progress'?'selected':''}>In Progress</option>
                            <option value="active" ${c.status==='active'?'selected':''}>Active</option>
                            <option value="done" ${c.status==='done'?'selected':''}>Done</option>
                          </select>
                        </div>
                        <div class="cs-edit-field">
                          <label>Framework</label>
                          <input type="text" name="framework" value="${esc(c.framework || '')}" placeholder="e.g. PDPL, NCA-ECC" />
                        </div>
                      </div>
                      <div class="cs-edit-actions">
                        <button type="submit" class="btn-admin-primary cs-edit-save-btn">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                          Save Changes
                        </button>
                        <button type="button" class="cs-toolbar-btn cs-toolbar-btn-ghost" onclick="csExpandControl('${esc(c.id)}')">Cancel</button>
                        <button type="button" class="cs-edit-delete-btn" onclick="csDeleteControl('${esc(c.id)}')">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                          Remove
                        </button>
                      </div>
                    </form>
                  `}
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
  const newId = 'ctrl-manual-' + Date.now();
  const newCtrl = {
    id: newId,
    name: '',
    description: '',
    category: 'process',
    csf_function: 'govern',
    priority: 3,
    effort: 'M',
    status: 'to_do',
    selected: true,
    framework: '',
    requirementRefId: '',
  };
  controls.push(newCtrl);
  csSaveStep();
  csRenderWizard();
  // Auto-expand the new control for editing
  setTimeout(() => {
    const item = document.querySelector(`.cs-ctrl-item[data-ctrl-id="${newId}"]`);
    if (item) {
      item.classList.add('expanded');
      item.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const nameInput = item.querySelector('input[name="name"]');
      if (nameInput) nameInput.focus();
    }
  }, 100);
  toast('info', 'Added', 'New control added — fill in the details below.');
}
window.csAddManualControl = csAddManualControl;

function csSaveControl(ctrlId) {
  const form = document.querySelector(`.cs-edit-form[data-ctrl-id="${ctrlId}"]`);
  if (!form) return;
  const ctrl = (csSessionData.controls || []).find(c => c.id === ctrlId);
  if (!ctrl) return;

  const fd = new FormData(form);
  ctrl.name = fd.get('name') || 'Untitled Control';
  ctrl.description = fd.get('description') || '';
  ctrl.category = fd.get('category') || '';
  ctrl.csf_function = fd.get('csf_function') || '';
  ctrl.csfFunction = fd.get('csf_function') || '';
  ctrl.priority = parseInt(fd.get('priority'), 10) || 3;
  ctrl.effort = fd.get('effort') || 'M';
  ctrl.status = fd.get('status') || 'to_do';
  ctrl.implementation_guidance = fd.get('implementation_guidance') || '';
  ctrl.framework = fd.get('framework') || '';

  csSaveStep();
  csRenderWizard();
  toast('success', 'Saved', `Control "${ctrl.name}" updated.`);
}
window.csSaveControl = csSaveControl;

async function csDeleteControl(ctrlId) {
  const ctrl = (csSessionData.controls || []).find(c => c.id === ctrlId);
  const name = ctrl?.name || 'this control';
  if (!await showConfirm({ title: 'Remove Control', message: `Remove "${name}"?`, confirmText: 'Remove', type: 'warning' })) return;
  csSessionData.controls = (csSessionData.controls || []).filter(c => c.id !== ctrlId);
  csSaveStep();
  csRenderWizard();
  toast('info', 'Removed', `Control removed.`);
}
window.csDeleteControl = csDeleteControl;

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

        <div id="cs-export-grc-status" style="font-size:11px;margin-top:6px;color:#9ca3af"></div>

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

  // Check GRC connection status
  csCheckGrcStatus();
}

async function csCheckGrcStatus() {
  const statusEl = document.getElementById('cs-export-grc-status');
  if (!statusEl) return;

  try {
    const statusRes = await fetch('/api/grc/status');
    if (statusRes.status === 401) {
      statusEl.innerHTML = '<span style="color:#f59e0b">⚠ Session expired — please re-login to export.</span>';
      return;
    }
    const statusData = await statusRes.json();

    if (!statusData.configured) {
      statusEl.innerHTML = '<span style="color:#ef4444">⚠ GRC not configured. Export will save locally only.</span>';
      return;
    }

    statusEl.innerHTML = `<span style="color:#10b981">✓ Connected to WathbaGRC</span> <span style="color:#9ca3af;font-size:11px">(${statusData.url})</span>`;

  } catch (err) {
    console.error('[GRC] Status check error:', err);
    statusEl.innerHTML = `<span style="color:#ef4444">⚠ ${err.message}</span>`;
  }
}

async function csDoExport() {
  const btn = document.getElementById('cs-export-btn');
  const progressEl = document.getElementById('cs-export-progress');
  const fillEl = document.getElementById('cs-export-fill');
  const textEl = document.getElementById('cs-export-progress-text');

  const controls = (csSessionData.controls || []).filter(c => c.selected !== false);
  const total = controls.length;

  // Check if GRC is configured
  let grcConfigured = false;
  try {
    const statusRes = await fetch('/api/grc/status');
    const statusData = await statusRes.json();
    grcConfigured = statusData.configured;
  } catch (_) {}

  if (btn) btn.style.display = 'none';
  if (progressEl) progressEl.style.display = '';

  if (grcConfigured) {
    // ── Real GRC Export ──
    try {
      if (textEl) textEl.textContent = 'Creating applied controls in WathbaGRC...';
      if (fillEl) fillEl.style.width = '10%';

      const complianceAssessment = csSessionData.complianceAssessment || '';
      console.log(`[Export] Sending ${controls.length} controls to GRC (CA: ${complianceAssessment || 'none'})`);

      const res = await fetch('/api/grc/applied-controls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ controls, complianceAssessment })
      });

      if (fillEl) fillEl.style.width = '70%';
      if (textEl) textEl.textContent = 'Processing results...';

      const data = await res.json();

      if (fillEl) fillEl.style.width = '100%';

      if (data.exported > 0) {
        const linkedMsg = data.linked > 0 ? `, ${data.linked} requirement assessments linked` : '';
        if (textEl) textEl.textContent = `${data.exported} controls exported${linkedMsg}${data.failed > 0 ? `, ${data.failed} failed` : ''}`;
        toast('success', 'Export Complete', `${data.exported} controls exported to WathbaGRC.${data.linked > 0 ? ` ${data.linked} requirement assessments linked.` : ''}${data.failed > 0 ? ` ${data.failed} failed.` : ''}`);

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

        const studioDocId = (f.name || '').split('/').pop();
        html += `<div class="studio-file-item ${isFailed ? 'file-failed' : ''} ${isFileSelected ? 'file-selected' : ''}" data-file-key="${esc(fileKey)}">
          ${isActive ? `<div class="studio-file-cb" onclick="event.stopPropagation();studioToggleFileSel('${esc(storeId)}','${esc(fileKey).replace(/'/g, "\\'")}')"><span class="studio-cb-mark ${isFileSelected ? 'checked' : ''}"></span></div>` : '<span style="width:22px;display:inline-block"></span>'}
          <svg class="studio-file-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2H9L13 6V14C13 14.6 12.6 15 12 15H3C2.4 15 2 14.6 2 14V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9 2V6H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <span class="studio-file-name">${esc(fName)}</span>
          <span class="studio-file-state ${stateClass}">${stateIcon} ${stateLabel}</span>
          ${isActive && studioDocId ? `<button class="btn-admin-sm" onclick="event.stopPropagation();viewFileInCollection('${esc(storeId)}','${esc(studioDocId)}')" title="View file" style="padding:2px 6px;font-size:11px;margin-left:auto"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 7C1 7 3.5 2.5 7 2.5C10.5 2.5 13 7 13 7C13 7 10.5 11.5 7 11.5C3.5 11.5 1 7 1 7Z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.3"/></svg></button>` : ''}
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
  if (!await showConfirm({ title: 'Delete Collection', message: `Delete "${displayName}"? This removes all files.`, confirmText: 'Delete' })) return;
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

// ═══════════════════════════════════════════════════════════════
// POLICY INGESTION
// ═══════════════════════════════════════════════════════════════

let piCollections = [];
let piPhase = 'collections'; // collections | collection-detail | config-modal | generating | review | success
let piSelectedCollectionId = null;
let piSelectedFileIds = [];
let piGenerationResult = null;
let piReviewPolicies = [];
let piReviewNodes = [];
let piGrcFrameworksCache = null;
let piActiveTab = 'files'; // 'files' | 'history'
let piHistoryCache = {}; // collectionId -> history array

// API base for policy collections
const PI_API = '/api/policy-collections';

// Fetch GRC frameworks for the config modal (reuses existing cache)
async function piFetchFrameworks() {
  if (piGrcFrameworksCache) return piGrcFrameworksCache;
  try {
    const res = await fetch('/api/grc/frameworks');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    piGrcFrameworksCache = (data.results || []).map(fw => ({
      id: fw.id || fw.urn || '',
      name: fw.name || fw.ref_id || 'Unknown',
      requirementCount: fw.requirement_count || 0,
    }));
    return piGrcFrameworksCache;
  } catch (err) {
    console.warn('Failed to fetch GRC frameworks for PI:', err);
    piGrcFrameworksCache = [];
    return [];
  }
}

// Fetch collections from API
async function piFetchCollections() {
  try {
    const res = await fetch(PI_API);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    piCollections = data.data || [];
    return piCollections;
  } catch (err) {
    console.error('Failed to fetch policy collections:', err);
    piCollections = [];
    return [];
  }
}

async function loadPolicyIngestion(collectionId) {
  piPhase = 'collections';
  piSelectedCollectionId = null;
  piSelectedFileIds = [];
  piGenerationResult = null;
  piReviewPolicies = [];
  piReviewNodes = [];
  piActiveTab = 'files';
  // Show loading state
  const el = document.getElementById('pi-content');
  if (el) el.innerHTML = '<div style="text-align:center;padding:60px;color:#9ca3af"><div class="pi-spinner-icon" style="margin:0 auto 12px"><svg width="24" height="24" class="pi-spinner" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.3"/><path d="M7 2C10 2 12 4.7 12 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>Loading collections…</div>';
  await piFetchCollections();
  await piFetchFrameworks();

  // If a collection ID was provided in the URL, open it directly
  if (collectionId) {
    const coll = piCollections.find(c => c.id === collectionId);
    if (coll) {
      await piOpenCollection(collectionId);
      return; // piOpenCollection calls piRender()
    }
  }

  piRender();
}

function piRender() {
  const el = document.getElementById('pi-content');
  if (!el) return;
  const coll = piCollections.find(c => c.id === piSelectedCollectionId) || null;

  if (piPhase === 'collections') {
    el.innerHTML = piRenderCollectionsList();
  } else if (piPhase === 'collection-detail' || piPhase === 'config-modal') {
    el.innerHTML = coll ? piRenderCollectionDetail(coll) : '';
    if (piPhase === 'config-modal' && coll) {
      el.innerHTML += piRenderConfigModal(coll);
      piLoadFoldersForConfig(); // Load GRC folders into the selector
    }
  } else if (piPhase === 'generating') {
    el.innerHTML = piRenderProgress();
    piStartProgressAnimation();
  } else if (piPhase === 'review') {
    el.innerHTML = piRenderReview();
  } else if (piPhase === 'success') {
    el.innerHTML = piRenderSuccess();
  } else if (piPhase === 'history-detail') {
    // Rendered directly by piRenderHistoryDetail — do nothing here
  }
}

// ─── Collections List ──────────────────────────────────
function piRenderCollectionsList() {
  const statusCfg = { ready: { label: 'Ready', cls: 'pi-status-ready' }, empty: { label: 'Empty', cls: 'pi-status-empty' }, generating: { label: 'Generating', cls: 'pi-status-generating' }, generated: { label: 'Generated', cls: 'pi-status-generated' }, approved: { label: 'Approved', cls: 'pi-status-generated' } };

  if (piCollections.length === 0) {
    return `
      <div class="pi-header">
        <div class="pi-header-left">
          <div class="pi-header-title"><svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M3 2H10L13 5V13C13 13.6 12.6 14 12 14H3C2.4 14 2 13.6 2 13V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.5"/><path d="M5 8H10M5 10.5H8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><h1>Organization Policy Ingestion</h1></div>
          <p class="pi-header-subtitle">Upload your organizational policy documents and automatically convert them into a system-compliant policy library</p>
        </div>
        <button class="btn-admin-primary" onclick="piCreateNew()"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> New Collection</button>
      </div>
      <div class="pi-empty">
        <div class="pi-empty-icon"><svg width="32" height="32" viewBox="0 0 16 16" fill="none"><path d="M2 5V12C2 12.6 2.4 13 3 13H13C13.6 13 14 12.6 14 12V7C14 6.4 13.6 6 13 6H8L6.5 4H3C2.4 4 2 4.4 2 5Z" stroke="currentColor" stroke-width="1.5"/></svg></div>
        <h3>No collections created yet</h3>
        <p>Create a new collection and upload your policy documents</p>
        <button class="btn-admin-primary" onclick="piCreateNew()"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> New Collection</button>
      </div>`;
  }

  const rows = piCollections.map(c => {
    const sc = statusCfg[c.status] || statusCfg.empty;
    const genCount = c.generatedPoliciesCount != null ? ` (${c.generatedPoliciesCount} policies)` : '';
    return `<tr>
      <td><div class="pi-coll-name"><div class="pi-coll-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2H10L13 5V13C13 13.6 12.6 14 12 14H3C2.4 14 2 13.6 2 13V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.5"/><path d="M5 8H10M5 10.5H8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></div><div class="pi-coll-info"><div class="pi-coll-title">${esc(c.name)}</div>${c.description ? `<div class="pi-coll-desc">${esc(c.description)}</div>` : ''}</div></div></td>
      <td class="center"><span class="pi-files-count">${c.files.length} ${c.files.length === 1 ? 'file' : 'files'}</span></td>
      <td class="center"><span class="pi-status ${sc.cls}">${c.status === 'generated' ? '<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> ' : ''}${sc.label}${genCount}</span></td>
      <td class="center"><span class="pi-date">${esc(c.lastUpdated)}</span></td>
      <td class="right"><div class="pi-actions">
        <button class="pi-btn pi-btn-view" onclick="piOpenCollection('${c.id}')"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M1 6C1 6 3 2 6 2C9 2 11 6 11 6C11 6 9 10 6 10C3 10 1 6 1 6Z" stroke="currentColor" stroke-width="1.2"/></svg> View</button>
        ${c.status === 'ready' ? `<button class="pi-btn pi-btn-generate" onclick="piStartGeneration('${c.id}')"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1L7.5 4L11 4.5L8.5 7L9 10.5L6 9L3 10.5L3.5 7L1 4.5L4.5 4L6 1Z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg> Generate Policies</button>` : ''}
        ${c.status === 'generated' ? `<button class="pi-btn pi-btn-library"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 2H10L13 5V13C13 13.6 12.6 14 12 14H3C2.4 14 2 13.6 2 13V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.5"/></svg> View Library</button>` : ''}
        <button class="pi-btn pi-btn-delete" onclick="event.stopPropagation();piDeleteCollection('${c.id}')" title="Delete collection"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 4H13M5.5 4V3C5.5 2.4 5.9 2 6.5 2H9.5C10.1 2 10.5 2.4 10.5 3V4M6.5 7V11.5M9.5 7V11.5M4 4L4.5 13C4.5 13.6 4.9 14 5.5 14H10.5C11.1 14 11.5 13.6 11.5 13L12 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div></td>
    </tr>`;
  }).join('');

  return `
    <div class="pi-header">
      <div class="pi-header-left">
        <div class="pi-header-title"><svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M3 2H10L13 5V13C13 13.6 12.6 14 12 14H3C2.4 14 2 13.6 2 13V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.5"/><path d="M5 8H10M5 10.5H8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><h1>Organization Policy Ingestion</h1></div>
        <p class="pi-header-subtitle">Upload your organizational policy documents and automatically convert them into a system-compliant policy library</p>
      </div>
      <button class="btn-admin-primary" onclick="piCreateNew()"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> New Collection</button>
    </div>
    <div class="pi-table-card"><table class="pi-table"><thead><tr>
      <th>Collection Name</th><th class="center">Files</th><th class="center">Status</th><th class="center">Last Updated</th><th class="right">Actions</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function piCreateNew() {
  try {
    toast('info', 'Creating…', 'Creating new collection…');
    const res = await fetch(PI_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Collection', description: '' }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to create collection');
    piCollections.push(data.data);
    piSelectedCollectionId = data.data.id;
    piSelectedFileIds = [];
    piPhase = 'collection-detail';
    piRender();
    toast('success', 'Created', 'Collection created successfully.');
  } catch (err) {
    toast('error', 'Error', err.message);
  }
}
window.piCreateNew = piCreateNew;

async function piOpenCollection(id) {
  piSelectedCollectionId = id;
  piSelectedFileIds = [];
  piActiveTab = 'files';
  piPhase = 'collection-detail';

  // Update URL to include collection ID
  updateRoute('policy-ingestion', id);

  // Files are already fetched in policyCollectionToJSON (from Gemini Store) — no separate call needed
  const coll = piCollections.find(c => c.id === id);
  if (coll && !coll.files) coll.files = [];
  piRender();
}
window.piOpenCollection = piOpenCollection;

function piStartGeneration(id) {
  piSelectedCollectionId = id;
  piSelectedFileIds = [];
  piPhase = 'config-modal';
  piRender();
}
window.piStartGeneration = piStartGeneration;

function piBackToCollections() {
  piPhase = 'collections';
  piSelectedCollectionId = null;
  piSelectedFileIds = [];
  piActiveTab = 'files';
  // Remove collection ID from URL
  updateRoute('policy-ingestion', null);
  piRender();
}
window.piBackToCollections = piBackToCollections;

async function piDeleteCollection(id) {
  const coll = piCollections.find(c => c.id === id);
  const name = coll ? coll.name : 'this collection';
  if (!await showConfirm({ title: 'Delete Collection', message: `Delete "${name}"? This will permanently remove the collection, all its files, and generation history. This action cannot be undone.`, confirmText: 'Delete' })) return;
  try {
    const res = await fetch(`${PI_API}/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      toast('success', 'Deleted', `Collection "${name}" has been deleted`);
      piCollections = piCollections.filter(c => c.id !== id);
      delete piHistoryCache[id];
      delete piHistoryDetailCache[id];
      if (piSelectedCollectionId === id) {
        piSelectedCollectionId = null;
        piPhase = 'collections';
      }
      piRender();
    } else {
      toast('error', 'Error', data.error || 'Failed to delete collection');
    }
  } catch (e) {
    console.error('Delete collection error:', e);
    toast('error', 'Error', 'Failed to delete collection');
  }
}
window.piDeleteCollection = piDeleteCollection;

// ─── Collection Detail ─────────────────────────────────
function piRenderCollectionDetail(coll) {
  const fileTypeIcons = { pdf: 'pi-file-icon-pdf', docx: 'pi-file-icon-docx', pptx: 'pi-file-icon-pptx', txt: 'pi-file-icon-txt', png: 'pi-file-icon-png', jpg: 'pi-file-icon-jpg' };
  const allSelected = piSelectedFileIds.length === coll.files.length && coll.files.length > 0;
  const hasSelectedFiles = piSelectedFileIds.length > 0;
  const genLabel = hasSelectedFiles ? `Generate (${piSelectedFileIds.length} files)` : 'Generate';
  const genDisabled = !hasSelectedFiles;

  // ── Files Tab Content ──
  let filesHtml = '';
  if (coll.files.length > 0) {
    const selectAll = `<div class="pi-select-all">
      <label><input type="checkbox" ${allSelected ? 'checked' : ''} onchange="piToggleAllFiles()"><span>Select All</span></label>
      ${piSelectedFileIds.length > 0 ? `<span class="pi-selected-count">(${piSelectedFileIds.length} selected)</span>` : ''}
    </div>`;

    const cards = coll.files.map(f => {
      const sel = piSelectedFileIds.includes(f.id);
      const isActive = f.state === 'STATE_ACTIVE';
      const stateLabel = isActive ? '☁ Active' : (f.state === 'STATE_PENDING' ? '⏳ Processing...' : '⏳ ' + (f.state || ''));
      const stateClass = isActive ? 'pi-gemini-synced' : 'pi-gemini-pending';
      return `<div class="pi-file-card${sel ? ' selected' : ''}">
        <input type="checkbox" ${sel ? 'checked' : ''} onchange="piToggleFile('${f.id}')">
        <div class="pi-file-icon ${fileTypeIcons[f.type] || 'pi-file-icon-txt'}"><svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M3 2H10L13 5V13C13 13.6 12.6 14 12 14H3C2.4 14 2 13.6 2 13V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.5"/></svg></div>
        <div class="pi-file-info"><div class="pi-file-name">${esc(f.name)}</div><div class="pi-file-meta">${esc(f.size)} · <span class="${stateClass}">${stateLabel}</span></div></div>
        <div class="pi-file-actions">
          ${isActive ? `<button class="pi-file-action-btn view" title="Open file" onclick="event.stopPropagation();piOpenFile('${f.id}','${esc(f.name)}','${esc(f.type || '')}')"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 7s2.2-4.5 6-4.5S13 7 13 7s-2.2 4.5-6 4.5S1 7 1 7z" stroke="currentColor" stroke-width="1.2"/><circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.2"/></svg></button>` : ''}
          <button class="pi-file-action-btn delete" title="Delete" onclick="piDeleteFile('${f.id}')"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4H12M4 4V3C4 2.4 4.4 2 5 2H9C9.6 2 10 2.4 10 3V4M5 6.5V10.5M7 6.5V10.5M9 6.5V10.5M3 4L4 12H10L11 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
        ${sel ? '<div class="pi-file-selected-check"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' : ''}
      </div>`;
    }).join('');

    filesHtml = selectAll + `<div class="pi-files-grid">${cards}</div>`;
  } else {
    filesHtml = `<div class="pi-files-empty"><div class="pi-files-empty-icon"><svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M14 10V13C14 13.6 13.6 14 13 14H3C2.4 14 2 13.6 2 13V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M11 5L8 2L5 5M8 2V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div><p>No files in this collection</p></div>`;
  }

  const filesTabContent = `
    ${filesHtml}
    <div id="pi-upload-progress-container"></div>
    <div class="pi-dropzone" onclick="piTriggerUpload()">
      <svg width="24" height="24" viewBox="0 0 16 16" fill="none"><path d="M14 10V13C14 13.6 13.6 14 13 14H3C2.4 14 2 13.6 2 13V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M11 5L8 2L5 5M8 2V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <p>Drag files here or click to browse</p>
      <p class="pi-dropzone-hint">PDF, DOCX, PPTX, TXT, PNG, JPG — Max 50 MB per file</p>
    </div>
    <input type="file" id="pi-file-input" style="display:none" multiple accept=".pdf,.docx,.pptx,.txt,.png,.jpg,.jpeg" onchange="piHandleFileUpload(event)">`;

  // ── History Tab Content ──
  const history = piHistoryCache[coll.id] || [];
  const historyLoading = !piHistoryCache.hasOwnProperty(coll.id);
  let historyTabContent = '';
  if (historyLoading) {
    historyTabContent = `<div style="text-align:center;padding:32px 0;color:#9ca3af"><svg class="pi-spin" width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#e5e7eb" stroke-width="2"/><path d="M10 2A8 8 0 0 1 18 10" stroke="#6366f1" stroke-width="2" stroke-linecap="round"/></svg><p style="margin-top:8px;font-size:12px">Loading history…</p></div>`;
  } else if (history.length === 0) {
    historyTabContent = `<div style="text-align:center;padding:40px 0;color:#9ca3af">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style="margin:0 auto 12px"><circle cx="12" cy="12" r="10" stroke="#d1d5db" stroke-width="1.5"/><path d="M12 6V12L16 14" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <p style="font-size:13px;font-weight:500;color:#6b7280">No generation history yet</p>
      <p style="font-size:11px;margin-top:4px">Run a policy generation to see results here</p>
    </div>`;
  } else {
    const rows = history.map(h => {
      const date = new Date(h.createdAt);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const genTypeLabels = { framework: 'Framework', controls: 'Controls', both: 'Both' };
      const genTypeLabel = genTypeLabels[h.generationType] || h.generationType;
      const genTypeClass = h.generationType === 'framework' ? 'pi-hist-type-framework' :
                           h.generationType === 'controls' ? 'pi-hist-type-controls' : 'pi-hist-type-both';

      const statusLabels = {
        generated: { label: 'Generated', cls: 'pi-hist-status-generated' },
        approved: { label: 'Approved', cls: 'pi-hist-status-approved' },
        approved_with_errors: { label: 'Approved (errors)', cls: 'pi-hist-status-warning' },
        failed: { label: 'Failed', cls: 'pi-hist-status-failed' },
      };
      const st = statusLabels[h.status] || { label: h.status, cls: '' };

      const confClass = h.confidenceScore >= 80 ? 'pi-confidence-high' : h.confidenceScore >= 60 ? 'pi-confidence-mid' : 'pi-confidence-low';

      let itemsLabel = '';
      if (h.generationType === 'framework') {
        itemsLabel = `${h.nodesCount} nodes`;
      } else if (h.generationType === 'controls') {
        itemsLabel = `${h.controlsCount} controls`;
      } else {
        itemsLabel = `${h.nodesCount} nodes · ${h.controlsCount} controls`;
      }

      const canView = h.hasData && h.status !== 'failed';
      const viewBtn = canView
        ? `<button class="pi-hist-view-btn" onclick="event.stopPropagation();piViewHistoryEntry('${esc(h.id)}')" title="View generated data"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.3"/></svg></button>`
        : '';

      return `<div class="pi-hist-row ${canView ? 'pi-hist-row-clickable' : ''}" ${canView ? `onclick="piViewHistoryEntry('${esc(h.id)}')"` : ''}>
        <div class="pi-hist-cell pi-hist-date">
          <div class="pi-hist-date-main">${dateStr}</div>
          <div class="pi-hist-date-time">${timeStr}</div>
        </div>
        <div class="pi-hist-cell"><span class="pi-hist-type-badge ${genTypeClass}">${genTypeLabel}</span></div>
        <div class="pi-hist-cell"><span class="pi-hist-status-badge ${st.cls}">${st.label}</span></div>
        <div class="pi-hist-cell pi-hist-items">${itemsLabel}</div>
        <div class="pi-hist-cell"><span class="pi-confidence-badge ${confClass}" style="font-size:10px;padding:2px 8px">${h.confidenceScore}%</span></div>
        <div class="pi-hist-cell pi-hist-time-cell">${esc(h.generationTime || '-')}</div>
        <div class="pi-hist-cell pi-hist-files-cell">${h.sourceFileCount} file${h.sourceFileCount !== 1 ? 's' : ''}</div>
        <div class="pi-hist-cell pi-hist-urn">${h.libraryUrn ? `<span class="pi-hist-urn-text" title="${esc(h.libraryUrn)}">${esc(h.libraryUrn)}</span>` : '<span style="color:#d1d5db">—</span>'}</div>
        <div class="pi-hist-cell">${viewBtn}</div>
        ${h.errorMessage ? `<div class="pi-hist-cell pi-hist-error" title="${esc(h.errorMessage)}"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="#ef4444" stroke-width="1.3"/><path d="M8 5V9M8 11V11.5" stroke="#ef4444" stroke-width="1.3" stroke-linecap="round"/></svg></div>` : ''}
      </div>`;
    }).join('');

    historyTabContent = `
      <div class="pi-hist-header-row">
        <div class="pi-hist-hcell">Date</div>
        <div class="pi-hist-hcell">Type</div>
        <div class="pi-hist-hcell">Status</div>
        <div class="pi-hist-hcell">Items</div>
        <div class="pi-hist-hcell">Confidence</div>
        <div class="pi-hist-hcell">Duration</div>
        <div class="pi-hist-hcell">Files</div>
        <div class="pi-hist-hcell">Library URN</div>
        <div class="pi-hist-hcell"></div>
      </div>
      <div class="pi-hist-body">${rows}</div>`;
  }

  const historyCount = history.length;

  return `
    <div class="pi-detail-header">
      <button class="pi-back-btn" onclick="piBackToCollections()"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div style="flex:1">
        <div class="pi-detail-breadcrumb">Admin &gt; Organization Policy Ingestion</div>
        <div class="pi-detail-title" onclick="piStartEditName()" id="pi-name-display">${esc(coll.name)} <svg class="pi-edit-icon" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10.5 2.5L11.5 3.5L4 11H2.5V9.5L10.5 2.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg></div>
        <input type="text" class="pi-detail-title-input" id="pi-name-input" value="${esc(coll.name)}" style="display:none" onblur="piCommitName()" onkeydown="piNameKeydown(event)">
      </div>
      <button class="pi-delete-collection-btn" onclick="piDeleteCollection('${coll.id}')" title="Delete collection"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4H13M5.5 4V3C5.5 2.4 5.9 2 6.5 2H9.5C10.1 2 10.5 2.4 10.5 3V4M6.5 7V11.5M9.5 7V11.5M4 4L4.5 13C4.5 13.6 4.9 14 5.5 14H10.5C11.1 14 11.5 13.6 11.5 13L12 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>
    <div class="pi-detail-card">
      <div class="pi-detail-card-header">
        <div>
          <div class="pi-detail-desc" onclick="piStartEditDesc()" id="pi-desc-display">${coll.description || 'Add a description...'} <svg class="pi-edit-icon" width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M10.5 2.5L11.5 3.5L4 11H2.5V9.5L10.5 2.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg></div>
          <input type="text" class="pi-detail-desc-input" id="pi-desc-input" value="${esc(coll.description)}" style="display:none" placeholder="Add a description..." onblur="piCommitDesc()" onkeydown="piDescKeydown(event)">
          <div class="pi-detail-file-count">${coll.files.length} ${coll.files.length === 1 ? 'file' : 'files'}</div>
        </div>
        <div class="pi-detail-actions">
          <button class="pi-btn pi-btn-view" onclick="piTriggerUpload()"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 8V11C12 11.6 11.6 12 11 12H3C2.4 12 2 11.6 2 11V8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M9.5 4L7 1.5L4.5 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 1.5V8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg> Upload Files</button>
          <button class="btn-admin-primary" onclick="piGenerateFromDetail()" ${genDisabled ? 'disabled' : ''} title="${genDisabled ? 'Select files first' : ''}"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1L8.5 4L12 4.5L9.5 7L10 10.5L7 9L4 10.5L4.5 7L2 4.5L5.5 4L7 1Z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg> ${genLabel}</button>
        </div>
      </div>
      <div class="pi-tabs">
        <button class="pi-tab${piActiveTab === 'files' ? ' active' : ''}" onclick="piSwitchTab('files')">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2H10L13 5V13C13 13.6 12.6 14 12 14H3C2.4 14 2 13.6 2 13V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.3"/></svg>
          Files <span class="pi-tab-count">${coll.files.length}</span>
        </button>
        <button class="pi-tab${piActiveTab === 'history' ? ' active' : ''}" onclick="piSwitchTab('history')">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 1H10L13 4V14C13 14.6 12.6 15 12 15H3C2.4 15 2 14.6 2 14V2C2 1.4 2.4 1 3 1Z" stroke="currentColor" stroke-width="1.3"/><path d="M5 8H11M5 10.5H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          Extracted Policies ${historyCount > 0 ? `<span class="pi-tab-count">${historyCount}</span>` : ''}
        </button>
      </div>
      <div class="pi-tab-content">
        ${piActiveTab === 'files' ? filesTabContent : historyTabContent}
      </div>
    </div>`;
}

function piStartEditName() {
  document.getElementById('pi-name-display').style.display = 'none';
  const inp = document.getElementById('pi-name-input');
  inp.style.display = '';
  inp.focus();
  inp.select();
}
window.piStartEditName = piStartEditName;

async function piCommitName() {
  const inp = document.getElementById('pi-name-input');
  const coll = piCollections.find(c => c.id === piSelectedCollectionId);
  if (coll && inp.value.trim()) {
    coll.name = inp.value.trim();
    try {
      await fetch(`${PI_API}/${coll.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: coll.name }),
      });
    } catch (e) { console.warn('Save name error:', e); }
  }
  piRender();
}
window.piCommitName = piCommitName;

function piNameKeydown(e) { if (e.key === 'Enter') piCommitName(); if (e.key === 'Escape') piRender(); }
window.piNameKeydown = piNameKeydown;

function piStartEditDesc() {
  document.getElementById('pi-desc-display').style.display = 'none';
  const inp = document.getElementById('pi-desc-input');
  inp.style.display = '';
  inp.focus();
  inp.select();
}
window.piStartEditDesc = piStartEditDesc;

async function piCommitDesc() {
  const inp = document.getElementById('pi-desc-input');
  const coll = piCollections.find(c => c.id === piSelectedCollectionId);
  if (coll) {
    coll.description = inp.value.trim();
    try {
      await fetch(`${PI_API}/${coll.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: coll.description }),
      });
    } catch (e) { console.warn('Save desc error:', e); }
  }
  piRender();
}
window.piCommitDesc = piCommitDesc;

function piDescKeydown(e) { if (e.key === 'Enter') piCommitDesc(); if (e.key === 'Escape') piRender(); }
window.piDescKeydown = piDescKeydown;

function piSwitchTab(tab) {
  piActiveTab = tab;
  if (tab === 'history' && piSelectedCollectionId && !piHistoryCache.hasOwnProperty(piSelectedCollectionId)) {
    piLoadHistory(piSelectedCollectionId);
  }
  piRender();
}
window.piSwitchTab = piSwitchTab;

async function piLoadHistory(collId) {
  try {
    const res = await fetch(`${PI_API}/${collId}/history`);
    const data = await res.json();
    if (data.success) {
      piHistoryCache[collId] = data.data || [];
    } else {
      piHistoryCache[collId] = [];
    }
  } catch (e) {
    console.warn('Failed to load history:', e);
    piHistoryCache[collId] = [];
  }
  piRender();
}

// ── History Detail Viewer ──
let piHistoryDetailCache = {};

async function piViewHistoryEntry(historyId) {
  if (!piSelectedCollectionId) return;

  // If we already have it cached, render immediately
  if (piHistoryDetailCache[historyId]) {
    piRenderHistoryDetail(piHistoryDetailCache[historyId]);
    return;
  }

  // Show loading state
  piPhase = 'history-detail';
  const contentEl = document.getElementById('pi-content');
  if (contentEl) contentEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;min-height:400px;flex-direction:column;gap:12px">
    <svg class="pi-spin" width="28" height="28" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#e5e7eb" stroke-width="2"/><path d="M10 2A8 8 0 0 1 18 10" stroke="#0077cc" stroke-width="2" stroke-linecap="round"/></svg>
    <p style="color:#6b7280;font-size:13px">Loading generation data…</p>
  </div>`;

  try {
    const res = await fetch(`${PI_API}/${piSelectedCollectionId}/history/${historyId}`);
    const data = await res.json();
    if (data.success && data.data) {
      piHistoryDetailCache[historyId] = data.data;
      piRenderHistoryDetail(data.data);
    } else {
      toast('error', 'Error', data.error || 'Failed to load history detail');
      piPhase = 'collection-detail';
      piRender();
    }
  } catch (e) {
    console.error('Failed to load history detail:', e);
    toast('error', 'Error', 'Failed to load history entry');
    piPhase = 'collection-detail';
    piRender();
  }
}
window.piViewHistoryEntry = piViewHistoryEntry;

function piRenderHistoryDetail(entry) {
  const pageEl = document.getElementById('pi-content');
  if (!pageEl) return;
  piPhase = 'history-detail';

  const date = new Date(entry.createdAt);
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const genTypeLabels = { framework: 'Framework', controls: 'Controls', both: 'Both' };
  const genTypeLabel = genTypeLabels[entry.generationType] || entry.generationType;
  const genTypeClass = entry.generationType === 'framework' ? 'pi-hist-type-framework' :
                       entry.generationType === 'controls' ? 'pi-hist-type-controls' : 'pi-hist-type-both';
  const statusLabels = {
    generated: { label: 'Generated', cls: 'pi-hist-status-generated' },
    approved: { label: 'Approved', cls: 'pi-hist-status-approved' },
    approved_with_errors: { label: 'Approved (errors)', cls: 'pi-hist-status-warning' },
    failed: { label: 'Failed', cls: 'pi-hist-status-failed' },
  };
  const st = statusLabels[entry.status] || { label: entry.status, cls: '' };

  const exData = entry.extractionData || {};
  const policies = exData.policies || [];
  const reqNodes = exData.requirementNodes || [];
  const csfDist = exData.csfDistribution || entry.summary?.csfDistribution || {};
  const catDist = exData.categoryDistribution || entry.summary?.categoryDistribution || {};

  // Build framework nodes section
  let nodesSection = '';
  if (reqNodes.length > 0) {
    const nodesHtml = reqNodes.map((n, i) => {
      const indent = Math.min((n.depth || 1) - 1, 4) * 20;
      return `<div class="pi-hist-detail-node" style="padding-left:${indent}px">
        <div class="pi-hist-detail-node-header">
          <span class="pi-hist-detail-node-ref">${esc(n.ref_id || n.urn || `N-${i+1}`)}</span>
          <span class="pi-hist-detail-node-name">${esc(n.name)}</span>
          ${n.assessable ? '<span class="pi-hist-detail-badge pi-hist-detail-badge-assess">Assessable</span>' : ''}
        </div>
        ${n.description ? `<div class="pi-hist-detail-node-desc">${esc(n.description)}</div>` : ''}
      </div>`;
    }).join('');
    nodesSection = `
      <div class="pi-hist-detail-section">
        <div class="pi-hist-detail-section-header">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L12 5V11L8 14L4 11V5L8 2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
          Framework Nodes <span class="pi-tab-count">${reqNodes.length}</span>
          <span style="color:#9ca3af;font-weight:400;margin-left:6px">(${(exData.assessableNodes || reqNodes.filter(n=>n.assessable).length)} assessable)</span>
        </div>
        <div class="pi-hist-detail-nodes-list">${nodesHtml}</div>
      </div>`;
  }

  // Build controls/policies section
  let controlsSection = '';
  if (policies.length > 0) {
    const controlsHtml = policies.map((p, i) => {
      const csfColors = { govern:'#6366f1', protect:'#0ea5e9', detect:'#f59e0b', respond:'#ef4444', recover:'#10b981', identify:'#8b5cf6' };
      const csfColor = csfColors[p.csfFunction] || '#6b7280';
      return `<div class="pi-hist-detail-control">
        <div class="pi-hist-detail-control-header">
          <span class="pi-hist-detail-control-code">${esc(p.code || `RC-${i+1}`)}</span>
          <span class="pi-hist-detail-control-name">${esc(p.name)}</span>
          <span class="pi-hist-detail-badge" style="background:${csfColor}15;color:${csfColor};border:1px solid ${csfColor}30">${esc((p.csfFunction||'').charAt(0).toUpperCase()+(p.csfFunction||'').slice(1))}</span>
          <span class="pi-hist-detail-badge" style="background:#f3f4f6;color:#374151">${esc((p.category||'').charAt(0).toUpperCase()+(p.category||'').slice(1))}</span>
        </div>
        ${p.description ? `<div class="pi-hist-detail-control-desc">${esc(p.description)}</div>` : ''}
      </div>`;
    }).join('');
    controlsSection = `
      <div class="pi-hist-detail-section">
        <div class="pi-hist-detail-section-header">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M5 8L7 10L11 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Reference Controls <span class="pi-tab-count">${policies.length}</span>
        </div>
        <div class="pi-hist-detail-controls-list">${controlsHtml}</div>
      </div>`;
  }

  // Distribution charts
  let distSection = '';
  const csfEntries = Object.entries(csfDist).filter(([,v]) => v > 0);
  const catEntries = Object.entries(catDist).filter(([,v]) => v > 0);
  if (csfEntries.length > 0 || catEntries.length > 0) {
    const csfColors = { govern:'#6366f1', protect:'#0ea5e9', detect:'#f59e0b', respond:'#ef4444', recover:'#10b981', identify:'#8b5cf6' };
    const csfBars = csfEntries.map(([fn, cnt]) => {
      const total = csfEntries.reduce((s,[,v])=>s+v,0);
      const pct = total > 0 ? Math.round(cnt/total*100) : 0;
      const color = csfColors[fn] || '#6b7280';
      return `<div class="pi-hist-dist-item"><div class="pi-hist-dist-label">${fn.charAt(0).toUpperCase()+fn.slice(1)}</div><div class="pi-hist-dist-bar"><div class="pi-hist-dist-fill" style="width:${pct}%;background:${color}"></div></div><div class="pi-hist-dist-val">${cnt}</div></div>`;
    }).join('');
    const catBars = catEntries.map(([cat, cnt]) => {
      const total = catEntries.reduce((s,[,v])=>s+v,0);
      const pct = total > 0 ? Math.round(cnt/total*100) : 0;
      return `<div class="pi-hist-dist-item"><div class="pi-hist-dist-label">${cat.charAt(0).toUpperCase()+cat.slice(1)}</div><div class="pi-hist-dist-bar"><div class="pi-hist-dist-fill" style="width:${pct}%;background:#0077cc"></div></div><div class="pi-hist-dist-val">${cnt}</div></div>`;
    }).join('');
    distSection = `<div class="pi-hist-detail-section">
      <div class="pi-hist-detail-section-header">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="9" width="3" height="5" rx="0.5" stroke="currentColor" stroke-width="1.2"/><rect x="6.5" y="5" width="3" height="9" rx="0.5" stroke="currentColor" stroke-width="1.2"/><rect x="11" y="2" width="3" height="12" rx="0.5" stroke="currentColor" stroke-width="1.2"/></svg>
        Distribution
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
        ${csfBars ? `<div><div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px">CSF Functions</div>${csfBars}</div>` : ''}
        ${catBars ? `<div><div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px">Categories</div>${catBars}</div>` : ''}
      </div>
    </div>`;
  }

  // Config summary
  const cfg = entry.config || {};
  const cfgItems = [];
  if (cfg.libraryName) cfgItems.push(['Library', cfg.libraryName]);
  if (cfg.language) cfgItems.push(['Language', cfg.language]);
  if (cfg.detailLevel) cfgItems.push(['Detail Level', cfg.detailLevel]);
  if (cfg.provider) cfgItems.push(['Provider', cfg.provider]);
  const cfgHtml = cfgItems.map(([k,v]) => `<div class="pi-hist-cfg-item"><span class="pi-hist-cfg-key">${esc(k)}</span><span class="pi-hist-cfg-val">${esc(v)}</span></div>`).join('');

  // No data message
  let noDataMsg = '';
  if (policies.length === 0 && reqNodes.length === 0) {
    noDataMsg = `<div style="text-align:center;padding:40px 0;color:#9ca3af">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style="margin:0 auto 12px"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="#d1d5db" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="#d1d5db" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="#d1d5db" stroke-width="1.5" stroke-linejoin="round"/></svg>
      <p style="font-size:13px;font-weight:500;color:#6b7280">No extraction data available for this entry</p>
      <p style="font-size:11px;margin-top:4px">This generation was recorded before data storage was enabled</p>
    </div>`;
  }

  pageEl.innerHTML = `
    <div class="pi-detail-header">
      <button class="pi-back-btn" onclick="piBackFromHistoryDetail()"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div style="flex:1">
        <div class="pi-detail-breadcrumb">Extracted Policies &gt; Generation Detail</div>
        <div class="pi-detail-title" style="font-size:18px">${dateStr} at ${timeStr}</div>
      </div>
    </div>
    <div class="pi-detail-card">
      <div style="padding:16px 20px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;border-bottom:1px solid #f3f4f6">
        <span class="pi-hist-type-badge ${genTypeClass}" style="font-size:12px;padding:4px 12px">${genTypeLabel}</span>
        <span class="pi-hist-status-badge ${st.cls}" style="font-size:12px;padding:4px 12px">${st.label}</span>
        <div style="display:flex;gap:20px;margin-left:auto;font-size:12px;color:#6b7280">
          <span>⏱ ${esc(entry.generationTime || '-')}</span>
          <span>📄 ${entry.sourceFileCount} file${entry.sourceFileCount !== 1 ? 's' : ''}</span>
          ${entry.nodesCount > 0 ? `<span>🔷 ${entry.nodesCount} nodes</span>` : ''}
          ${entry.controlsCount > 0 ? `<span>✅ ${entry.controlsCount} controls</span>` : ''}
        </div>
      </div>
      ${cfgHtml ? `<div style="padding:12px 20px;border-bottom:1px solid #f3f4f6;display:flex;flex-wrap:wrap;gap:8px">${cfgHtml}</div>` : ''}
      <div style="padding:20px">
        ${noDataMsg || ''}
        ${nodesSection}
        ${controlsSection}
        ${distSection}
      </div>
    </div>
    ${entry.libraryUrn ? `<div style="margin-top:12px;padding:12px 16px;background:#f8fafc;border-radius:8px;font-size:12px;color:#6b7280">Library URN: <code style="background:#e5e7eb;padding:2px 6px;border-radius:4px;font-size:11px">${esc(entry.libraryUrn)}</code></div>` : ''}
    ${entry.errorMessage ? `<div style="margin-top:12px;padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:12px;color:#b91c1c"><strong>Error:</strong> ${esc(entry.errorMessage)}</div>` : ''}
  `;
}

function piBackFromHistoryDetail() {
  piPhase = 'collection-detail';
  piActiveTab = 'history';
  piRender();
}
window.piBackFromHistoryDetail = piBackFromHistoryDetail;

function piToggleFile(id) {
  const idx = piSelectedFileIds.indexOf(id);
  if (idx === -1) piSelectedFileIds.push(id); else piSelectedFileIds.splice(idx, 1);
  piRender();
}
window.piToggleFile = piToggleFile;

function piToggleAllFiles() {
  const coll = piCollections.find(c => c.id === piSelectedCollectionId);
  if (!coll) return;
  if (piSelectedFileIds.length === coll.files.length) piSelectedFileIds = [];
  else piSelectedFileIds = coll.files.map(f => f.id);
  piRender();
}
window.piToggleAllFiles = piToggleAllFiles;

function piOpenFile(fileId, fileName, fileType) {
  const url = `${PI_API}/${piSelectedCollectionId}/files/${fileId}`;
  const viewable = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt'].includes((fileType || '').toLowerCase());

  if (viewable) {
    // Open in a modal viewer
    const overlay = document.createElement('div');
    overlay.className = 'pi-file-viewer-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const isPdf = fileType === 'pdf';
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(fileType);
    const isTxt = fileType === 'txt';

    let content = '';
    if (isPdf) {
      content = `<iframe src="${url}" class="pi-file-viewer-frame"></iframe>`;
    } else if (isImage) {
      content = `<img src="${url}" class="pi-file-viewer-image" alt="${esc(fileName)}">`;
    } else if (isTxt) {
      content = `<iframe src="${url}" class="pi-file-viewer-frame" style="background:#fff"></iframe>`;
    }

    overlay.innerHTML = `
      <div class="pi-file-viewer">
        <div class="pi-file-viewer-header">
          <div class="pi-file-viewer-title">${esc(fileName)}</div>
          <div class="pi-file-viewer-actions">
            <a href="${url}" download="${esc(fileName)}" class="pi-file-viewer-btn" title="Download"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 11V13C2 13.6 2.4 14 3 14H13C13.6 14 14 13.6 14 13V11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M5 7L8 10L11 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 2V10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></a>
            <a href="${url}" target="_blank" class="pi-file-viewer-btn" title="Open in new tab"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M9 2H14V7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 2L7 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M12 9V13C12 13.6 11.6 14 11 14H3C2.4 14 2 13.6 2 13V5C2 4.4 2.4 4 3 4H7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></a>
            <button class="pi-file-viewer-btn close" onclick="this.closest('.pi-file-viewer-overlay').remove()" title="Close"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
          </div>
        </div>
        <div class="pi-file-viewer-body">${content}</div>
      </div>`;
    document.body.appendChild(overlay);
    // Allow escape key to close
    const onKey = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  } else {
    // Non-viewable files: just download
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  }
}
window.piOpenFile = piOpenFile;

async function piDeleteFile(fileId) {
  const coll = piCollections.find(c => c.id === piSelectedCollectionId);
  if (!coll) return;
  try {
    const res = await fetch(`${PI_API}/${coll.id}/files/${fileId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Delete failed');

    // Refresh collection from server (files come from Gemini)
    const freshData = await fetchJSON(`${PI_API}/${coll.id}`);
    if (freshData.success && freshData.data) {
      const idx = piCollections.findIndex(c => c.id === coll.id);
      if (idx >= 0) piCollections[idx] = freshData.data;
    }
    piSelectedFileIds = piSelectedFileIds.filter(id => id !== fileId);
    piRender();
    toast('success', 'Deleted', 'File removed from collection');
  } catch (err) {
    toast('error', 'Delete Error', err.message);
  }
}
window.piDeleteFile = piDeleteFile;

function piTriggerUpload() {
  document.getElementById('pi-file-input')?.click();
}
window.piTriggerUpload = piTriggerUpload;

async function piHandleFileUpload(event) {
  const coll = piCollections.find(c => c.id === piSelectedCollectionId);
  if (!coll) return;
  const filesToUpload = Array.from(event.target.files);
  event.target.value = '';

  const container = document.getElementById('pi-upload-progress-container');

  for (const file of filesToUpload) {
    // Create a unique progress bar element for this file
    const uid = 'up-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const progressEl = document.createElement('div');
    progressEl.className = 'pi-upload-progress';
    progressEl.id = uid;
    progressEl.innerHTML = `
      <div class="pi-upload-progress-info">
        <span class="pi-upload-progress-name" title="${esc(file.name)}">${esc(file.name)}</span>
        <span class="pi-upload-progress-pct">0%</span>
      </div>
      <div class="pi-upload-progress-bar"><div class="pi-upload-progress-fill" style="width:0%"></div></div>
      <div class="pi-upload-progress-status">Preparing file…</div>`;
    if (container) container.prepend(progressEl);

    const pctEl = progressEl.querySelector('.pi-upload-progress-pct');
    const fillEl = progressEl.querySelector('.pi-upload-progress-fill');
    const statusEl = progressEl.querySelector('.pi-upload-progress-status');

    const setProgress = (pct, statusText) => {
      if (pctEl) pctEl.textContent = Math.round(pct) + '%';
      if (fillEl) fillEl.style.width = pct + '%';
      if (statusEl && statusText) statusEl.textContent = statusText;
    };

    try {
      // Step 1: Read file as base64
      setProgress(10, 'Reading file…');
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Step 2: Uploading to server + Wathbah AI
      setProgress(30, 'Uploading to server…');

      // Use XMLHttpRequest for real upload progress
      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${PI_API}/${coll.id}/files`);
        xhr.setRequestHeader('Content-Type', 'application/json');

        let uploadDone = false;
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const uploadPct = 30 + (e.loaded / e.total) * 40; // 30% → 70%
            setProgress(uploadPct, 'Uploading…');
          }
        });
        xhr.upload.addEventListener('load', () => {
          uploadDone = true;
          setProgress(75, 'Syncing to Wathbah AI… please wait');
        });

        xhr.onload = () => {
          try {
            const resp = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300 && resp.success) {
              resolve(resp);
            } else {
              reject(new Error(resp.error || `Upload failed (${xhr.status})`));
            }
          } catch (e) {
            reject(new Error('Invalid server response'));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.ontimeout = () => reject(new Error('Upload timed out'));
        xhr.timeout = 300000; // 5 min timeout

        xhr.send(JSON.stringify({ fileName: file.name, mimeType: file.type || 'application/octet-stream', data: base64 }));
      });

      // Step 3: Processing response
      setProgress(90, 'Processing…');

      // Step 4: Done — show success
      setProgress(100, 'Uploaded successfully ✓');
      progressEl.classList.add('pi-upload-success');

      // Auto-remove success indicator after 3 seconds
      setTimeout(() => {
        progressEl.style.transition = 'opacity 0.4s ease, max-height 0.4s ease, margin 0.4s ease, padding 0.4s ease';
        progressEl.style.opacity = '0';
        progressEl.style.maxHeight = '0';
        progressEl.style.marginBottom = '0';
        progressEl.style.padding = '0 14px';
        setTimeout(() => progressEl.remove(), 450);
      }, 3000);

    } catch (err) {
      // Show error state — keep visible so user can see what failed
      setProgress(100, `Failed: ${err.message}`);
      progressEl.classList.add('pi-upload-error');

      // Auto-remove error indicator after 6 seconds
      setTimeout(() => {
        progressEl.style.transition = 'opacity 0.4s ease, max-height 0.4s ease, margin 0.4s ease, padding 0.4s ease';
        progressEl.style.opacity = '0';
        progressEl.style.maxHeight = '0';
        progressEl.style.marginBottom = '0';
        progressEl.style.padding = '0 14px';
        setTimeout(() => progressEl.remove(), 450);
      }, 6000);

      toast('error', 'Upload Error', `"${file.name}": ${err.message}`);
    }
  }
  // Refresh collection data from server (files come from Gemini now)
  try {
    const freshData = await fetchJSON(`${PI_API}/${coll.id}`);
    if (freshData.success && freshData.data) {
      const idx = piCollections.findIndex(c => c.id === coll.id);
      if (idx >= 0) piCollections[idx] = freshData.data;
    }
  } catch (e) { console.warn('Could not refresh collection:', e); }

  // Save any still-visible progress bars before re-render
  const liveProgressBars = container ? Array.from(container.children) : [];
  piRender();
  // Re-attach surviving progress bars
  const newContainer = document.getElementById('pi-upload-progress-container');
  if (newContainer) {
    liveProgressBars.forEach(bar => newContainer.appendChild(bar));
  }
}
window.piHandleFileUpload = piHandleFileUpload;

function piGenerateFromDetail() {
  piPhase = 'config-modal';
  piRender();
}
window.piGenerateFromDetail = piGenerateFromDetail;

// ─── Config Modal ──────────────────────────────────────
function piRenderConfigModal(coll) {
  const files = piSelectedFileIds.length > 0 ? coll.files.filter(f => piSelectedFileIds.includes(f.id)) : coll.files;

  const filesList = files.map(f => `
    <div class="pi-included-file"><span>${esc(f.name)}</span><button onclick="piRemoveIncludedFile('${f.id}')"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9 3L3 9M3 3L9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div>
  `).join('');

  return `
    <div class="pi-modal-overlay" onclick="piCloseConfigModal(event)">
      <div class="pi-modal" onclick="event.stopPropagation()">
        <div class="pi-modal-header">
          <div><h2>Policy Generation Settings</h2><p>Configure generation settings before starting</p></div>
          <button class="pi-modal-close" onclick="piCloseConfig()"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
        </div>
        <div class="pi-modal-body">
          <div>
            <label class="pi-form-label">Generation Type <span style="color:#ef4444">*</span></label>
            <p class="pi-form-hint" style="margin-bottom:8px">Choose what to extract from the documents</p>
            <div class="pi-detail-radio-group">
              <label class="pi-radio-option active" id="pi-radio-framework" onclick="piSetGenerationType('framework')">
                <input type="radio" name="pi-gen-type" value="framework" checked>
                <div>
                  <div class="pi-radio-title" style="display:flex;align-items:center;gap:6px">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2L12 5V11L8 14L4 11V5L8 2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
                    Generate Policy Framework
                  </div>
                  <div class="pi-radio-desc">Extract document structure as a compliance framework with requirement nodes for assessments</div>
                </div>
              </label>
              <label class="pi-radio-option" id="pi-radio-controls" onclick="piSetGenerationType('controls')">
                <input type="radio" name="pi-gen-type" value="controls">
                <div>
                  <div class="pi-radio-title" style="display:flex;align-items:center;gap:6px">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M5 8L7 10L11 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    Generate Reference Controls
                  </div>
                  <div class="pi-radio-desc">Extract reusable procedures and controls that become Applied Controls (Policies) in GRC</div>
                </div>
              </label>
              <label class="pi-radio-option" id="pi-radio-both" onclick="piSetGenerationType('both')">
                <input type="radio" name="pi-gen-type" value="both">
                <div>
                  <div class="pi-radio-title" style="display:flex;align-items:center;gap:6px">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2L12 5V11L8 14L4 11V5L8 2Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M5.5 8L7 9.5L10.5 6.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    Generate Both
                  </div>
                  <div class="pi-radio-desc">Extract framework structure + reference controls in a single library (full extraction)</div>
                </div>
              </label>
            </div>
          </div>
          <div><label class="pi-form-label">Library Name</label><input type="text" class="pi-form-input" id="pi-cfg-lib-name" value="${esc(coll.name)}" placeholder="e.g., Information Security Policies"></div>
          <div><label class="pi-form-label">Provider / Organization</label><input type="text" class="pi-form-input" id="pi-cfg-provider" value="" placeholder="Organization name"></div>
          <div id="pi-cfg-folder-row" style="display:none"><label class="pi-form-label">GRC Folder <span style="color:#ef4444">*</span></label><p class="pi-form-hint">Policies will be created in this GRC folder</p><select class="pi-form-select" id="pi-cfg-folder"><option value="">Loading folders…</option></select></div>
          <div><label class="pi-form-label">Language</label><select class="pi-form-select" id="pi-cfg-lang"><option value="en">English</option><option value="ar">Arabic</option><option value="ar+en">Arabic + English</option></select></div>
          <div>
            <label class="pi-form-label">Detail Level</label>
            <div class="pi-detail-radio-group">
              <label class="pi-radio-option active" id="pi-radio-comprehensive" onclick="piSetDetailLevel('comprehensive')"><input type="radio" name="pi-detail" checked><div><div class="pi-radio-title">Comprehensive</div><div class="pi-radio-desc">Extract all sections and sub-sections</div></div></label>
              <label class="pi-radio-option" id="pi-radio-summary" onclick="piSetDetailLevel('summary')"><input type="radio" name="pi-detail"><div><div class="pi-radio-title">Summary</div><div class="pi-radio-desc">Main sections only</div></div></label>
            </div>
          </div>
          <div><label class="pi-form-label">Included Files</label><div class="pi-included-files" id="pi-cfg-files">${filesList || '<div style="text-align:center;padding:8px"><span style="font-size:10px;color:#9ca3af">No files selected</span></div>'}</div></div>
        </div>
        <div class="pi-modal-footer">
          <button class="pi-btn pi-btn-view" onclick="piCloseConfig()">Cancel</button>
          <button class="btn-admin-primary" onclick="piStartGenerate()"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1L8.5 4L12 4.5L9.5 7L10 10.5L7 9L4 10.5L4.5 7L2 4.5L5.5 4L7 1Z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg> Start Generation</button>
        </div>
      </div>
    </div>`;
}

async function piLoadFoldersForConfig() {
  const sel = document.getElementById('pi-cfg-folder');
  if (!sel) return;
  try {
    const res = await fetch('/api/grc/folders?content_type=DO&content_type=GL');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const folders = data.folders || data.results || [];
    if (folders.length === 0) {
      sel.innerHTML = '<option value="">No folders available</option>';
    } else {
      sel.innerHTML = '<option value="">Select a folder…</option>' +
        folders.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
      // Auto-select the "Global" folder/domain by default
      const globalFolder = folders.find(f => /^global$/i.test((f.name || '').trim()));
      if (globalFolder) sel.value = globalFolder.id;
    }
  } catch (err) {
    console.warn('Failed to load GRC folders for PI config:', err);
    sel.innerHTML = '<option value="">Error loading folders</option>';
  }
}

function piCloseConfigModal(e) { if (e.target === e.currentTarget) piCloseConfig(); }
window.piCloseConfigModal = piCloseConfigModal;

function piCloseConfig() { piPhase = 'collection-detail'; piRender(); }
window.piCloseConfig = piCloseConfig;

function piSetGenerationType(type) {
  document.getElementById('pi-radio-framework')?.classList.toggle('active', type === 'framework');
  document.getElementById('pi-radio-controls')?.classList.toggle('active', type === 'controls');
  document.getElementById('pi-radio-both')?.classList.toggle('active', type === 'both');
  // Show/hide folder selector: needed for controls and both (policies are created in a folder)
  const needsFolder = type === 'controls' || type === 'both';
  const folderRow = document.getElementById('pi-cfg-folder-row');
  if (folderRow) folderRow.style.display = needsFolder ? '' : 'none';
}
window.piSetGenerationType = piSetGenerationType;

function piSetDetailLevel(level) {
  document.getElementById('pi-radio-comprehensive')?.classList.toggle('active', level === 'comprehensive');
  document.getElementById('pi-radio-summary')?.classList.toggle('active', level === 'summary');
}
window.piSetDetailLevel = piSetDetailLevel;

function piRemoveIncludedFile(fileId) {
  const el = document.getElementById('pi-cfg-files');
  if (el) {
    const item = el.querySelector(`[onclick*="${fileId}"]`)?.closest('.pi-included-file');
    if (item) item.remove();
  }
}
window.piRemoveIncludedFile = piRemoveIncludedFile;

let piCurrentConfig = {}; // Store config for approve step

function piStartGenerate() {
  // Collect config values from the modal
  const generationType = document.getElementById('pi-radio-framework')?.classList.contains('active') ? 'framework'
    : document.getElementById('pi-radio-controls')?.classList.contains('active') ? 'controls' : 'both';
  const libraryName = document.getElementById('pi-cfg-lib-name')?.value?.trim() || 'Untitled Library';
  const provider = document.getElementById('pi-cfg-provider')?.value?.trim() || '';
  const folder = document.getElementById('pi-cfg-folder')?.value || '';
  const language = document.getElementById('pi-cfg-lang')?.value || 'en';
  const detailLevel = document.getElementById('pi-radio-comprehensive')?.classList.contains('active') ? 'comprehensive' : 'summary';

  // For controls/both mode, folder is required (policies are created in a folder)
  if ((generationType === 'controls' || generationType === 'both') && !folder) {
    toast('error', 'Missing Folder', 'Please select a GRC folder for policy creation.');
    return;
  }

  // Collect selected framework IDs
  const linkedFrameworkIds = [];
  document.querySelectorAll('.pi-fw-item input[type="checkbox"]:checked').forEach(cb => {
    linkedFrameworkIds.push(cb.value);
  });

  // Collect selected file IDs from included files
  const selectedFileIds = piSelectedFileIds.length > 0 ? piSelectedFileIds : undefined;

  piCurrentConfig = { generationType, libraryName, provider, folder, language, detailLevel, linkedFrameworkIds };

  piPhase = 'generating';
  piRender();

  // Call the extraction API with generationType
  piRunExtraction(piSelectedCollectionId, {
    generationType, libraryName, provider, language, detailLevel, linkedFrameworkIds, selectedFileIds,
  });
}
window.piStartGenerate = piStartGenerate;

async function piRunExtraction(collId, config) {
  try {
    const res = await fetch(`${PI_API}/${collId}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    piStopProgressAnimation();
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Extraction failed');

    piGenerationResult = data.data;
    piReviewPolicies = data.data.policies || [];
    piReviewNodes = data.data.requirementNodes || [];
    // Invalidate history cache so next visit shows the new entry
    delete piHistoryCache[collId];
    piPhase = 'review';
    piRender();

    const genType = data.data.generationType || 'both';
    if (genType === 'framework') {
      toast('success', 'Framework Extracted', `${piReviewNodes.length} requirement nodes (${data.data.assessableNodes || 0} assessable) extracted from ${data.data.sourceFileCount || 0} files.`);
    } else if (genType === 'both') {
      toast('success', 'Full Extraction Complete', `${piReviewNodes.length} requirement nodes + ${piReviewPolicies.length} reference controls extracted from ${data.data.sourceFileCount || 0} files.`);
    } else {
      toast('success', 'Controls Extracted', `${piReviewPolicies.length} reference controls extracted from ${data.data.sourceFileCount || 0} files.`);
    }
  } catch (err) {
    piStopProgressAnimation();
    console.error('Policy extraction error:', err);
    toast('error', 'Extraction Failed', err.message);
    piPhase = 'collection-detail';
    piRender();
  }
}

// ─── Generation Progress ───────────────────────────────
const PI_STEPS = [
  { label: 'Reading Documents', icon: 'search' },
  { label: 'Analyzing Content & Extracting Policies', icon: 'sparkles' },
  { label: 'Building Library Structure', icon: 'network' },
  { label: 'Linking Policies to Frameworks', icon: 'link' },
  { label: 'Quality Review', icon: 'shield' },
];

function piRenderProgress() {
  const stepsHtml = PI_STEPS.map((s, i) => `
    <div class="pi-step" id="pi-step-${i}">
      <div class="pi-step-icon pending" id="pi-step-icon-${i}"><svg width="14" height="14" class="${i === 0 ? 'pi-spinner' : ''}" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.3"/><path d="M7 2C10 2 12 4.7 12 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
      <span class="pi-step-label pending" id="pi-step-label-${i}">${s.label}</span>
    </div>
  `).join('');

  return `
    <div class="pi-header">
      <div class="pi-header-left">
        <div class="pi-header-title"><svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M3 2H10L13 5V13C13 13.6 12.6 14 12 14H3C2.4 14 2 13.6 2 13V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.5"/><path d="M5 8H10M5 10.5H8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><h1>Organization Policy Ingestion</h1></div>
      </div>
    </div>
    <div class="pi-progress-card">
      <div class="pi-progress-inner">
        <div class="pi-progress-icon"><svg width="36" height="36" viewBox="0 0 14 14" fill="none"><path d="M7 1L8.5 4L12 4.5L9.5 7L10 10.5L7 9L4 10.5L4.5 7L2 4.5L5.5 4L7 1Z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg></div>
        <h3 class="pi-progress-title">Analyzing documents and generating policies...</h3>
        <p class="pi-progress-desc">You can navigate away and come back later — generation will continue in the background</p>
        <div class="pi-steps">${stepsHtml}</div>
        <div class="pi-progress-bar"><div class="pi-progress-fill" id="pi-progress-fill" style="width:0%"></div></div>
        <div class="pi-progress-stats"><span id="pi-progress-pct">0%</span><span id="pi-progress-remaining">Remaining: ~6s</span></div>
      </div>
    </div>`;
}

let piProgressTimer = null;

function piStartProgressAnimation() {
  let currentStep = 0;
  let progress = 0;

  // Activate first step
  piUpdateStepUI(0, 'active');

  // Slowly advance progress bar (indeterminate-ish, max 90% until real API responds)
  piProgressTimer = setInterval(() => {
    progress = Math.min(progress + 0.5, 90);
    const fillEl = document.getElementById('pi-progress-fill');
    const pctEl = document.getElementById('pi-progress-pct');
    const remEl = document.getElementById('pi-progress-remaining');
    if (fillEl) fillEl.style.width = progress + '%';
    if (pctEl) pctEl.textContent = Math.round(progress) + '%';
    if (remEl) remEl.textContent = 'Analyzing documents with Wathbah AI…';

    // Advance steps based on progress
    const stepIdx = Math.min(Math.floor(progress / (90 / PI_STEPS.length)), PI_STEPS.length - 1);
    if (stepIdx > currentStep) {
      piUpdateStepUI(currentStep, 'done');
      currentStep = stepIdx;
      piUpdateStepUI(currentStep, 'active');
    }
  }, 200);
}

function piStopProgressAnimation() {
  if (piProgressTimer) { clearInterval(piProgressTimer); piProgressTimer = null; }
}

function piUpdateStepUI(idx, state) {
  const iconEl = document.getElementById(`pi-step-icon-${idx}`);
  const labelEl = document.getElementById(`pi-step-label-${idx}`);
  if (!iconEl || !labelEl) return;

  iconEl.className = 'pi-step-icon ' + state;
  labelEl.className = 'pi-step-label ' + state;

  if (state === 'done') {
    iconEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  } else if (state === 'active') {
    iconEl.innerHTML = '<svg width="14" height="14" class="pi-spinner" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.3"/><path d="M7 2C10 2 12 4.7 12 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  }
}

// ─── Policy Review ─────────────────────────────────────
function piRenderReview() {
  if (!piGenerationResult) return '';
  const r = piGenerationResult;
  const genType = r.generationType || 'both';
  const confClass = r.confidenceScore >= 80 ? 'pi-confidence-high' : r.confidenceScore >= 60 ? 'pi-confidence-mid' : 'pi-confidence-low';
  const confBarClass = r.confidenceScore >= 80 ? 'background:#059669' : r.confidenceScore >= 60 ? 'background:#d97706' : 'background:#dc2626';

  // ── Framework mode: render requirement nodes tree ──
  if (genType === 'framework') {
    const nodes = piReviewNodes || [];
    const totalNodes = nodes.length;
    const assessableCount = nodes.filter(n => n.assessable).length;
    const structuralCount = totalNodes - assessableCount;

    // Build indented tree view of requirement nodes
    const nodesHtml = nodes.map((n, idx) => {
      const indent = Math.max(0, (n.depth || 1) - 1) * 20;
      const isAssessable = !!n.assessable;
      const depthLabel = n.depth === 1 ? 'Root' : n.depth === 2 ? 'Section' : n.depth === 3 ? 'Sub-section' : 'Requirement';
      const assessBadge = isAssessable
        ? '<span class="pi-policy-tag" style="background:#dcfce7;color:#166534;font-size:9px;padding:1px 6px;border-radius:4px">Assessable</span>'
        : '<span class="pi-policy-tag" style="background:#f3f4f6;color:#6b7280;font-size:9px;padding:1px 6px;border-radius:4px">Structural</span>';

      return `
        <div class="pi-policy-item" style="margin-left:${indent}px">
          <div class="pi-policy-item-header" onclick="piTogglePolicy('${n.id}')">
            <div class="pi-policy-toggle"><svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="${idx === 0 ? 'M3 5L6 8L9 5' : 'M5 3L8 6L5 9'}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            <span class="pi-policy-code" style="min-width:40px">${esc(n.ref_id || '')}</span>
            <span class="pi-policy-name">${esc(n.name)}</span>
            <div class="pi-policy-tags">
              ${assessBadge}
              <span style="font-size:9px;color:#9ca3af">${depthLabel}</span>
            </div>
          </div>
          <div class="pi-policy-detail${idx === 0 ? ' open' : ''}" id="pi-policy-detail-${n.id}">
            ${n.description ? `<div class="pi-policy-detail-section"><div class="pi-policy-detail-label">Description</div><p class="pi-policy-detail-text">${esc(n.description)}</p></div>` : ''}
            <div class="pi-policy-detail-section" style="display:flex;gap:16px;flex-wrap:wrap">
              <div><span class="pi-policy-detail-label">Depth:</span> ${n.depth}</div>
              <div><span class="pi-policy-detail-label">URN:</span> <span style="font-size:10px;color:#6b7280;font-family:monospace">${esc(n.urn || '')}</span></div>
            </div>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="pi-review-header">
        <svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M8 2L12 5V11L8 14L4 11V5L8 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
        <h1>Review Generated Framework</h1>
      </div>
      <p class="pi-review-subtitle">Review the framework structure extracted from your documents before creating the library</p>

      <div class="pi-review-stats"><div class="pi-review-stats-grid">
        <div><div class="pi-review-stat-label">Library Name</div><div class="pi-review-stat-value">${esc(r.libraryName)}</div></div>
        <div><div class="pi-review-stat-label">Source Files</div><div class="pi-review-stat-value">${r.sourceFileCount} files</div></div>
        <div><div class="pi-review-stat-label">Total Nodes</div><div class="pi-review-stat-value">${totalNodes} nodes</div></div>
        <div><div class="pi-review-stat-label">Assessable</div><div class="pi-review-stat-value">${assessableCount} requirements</div></div>
      </div></div>

      <div class="pi-policy-panel">
        <div class="pi-policy-panel-header" style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%)">
          <h3><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L12 5V11L8 14L4 11V5L8 2Z" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg> ${esc(r.libraryName)}</h3>
          <p>${totalNodes} requirement nodes — ${assessableCount} assessable, ${structuralCount} structural</p>
        </div>
        <div class="pi-policy-list" style="max-height:500px;overflow-y:auto">
          ${nodesHtml}
        </div>
      </div>

      <div class="pi-review-footer">
        <button class="pi-btn pi-btn-discard" onclick="piDiscard()">Discard & Delete</button>
        <div style="display:flex;gap:8px">
          <button class="pi-btn pi-btn-regenerate" onclick="piRegenerate()"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 6C1 3.2 3.2 1 6 1C8.8 1 11 3.2 11 6C11 8.8 8.8 11 6 11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M4 6L1 6L1 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Regenerate</button>
          <button class="pi-btn pi-btn-approve" onclick="piApprove()"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Approve & Upload Library</button>
        </div>
      </div>`;
  }

  // ── Controls / Both mode: render reference controls ──
  const catLabels = { policy: { label: 'Policy', cls: 'pi-tag-policy' }, process: { label: 'Process', cls: 'pi-tag-process' }, technical: { label: 'Technical', cls: 'pi-tag-technical' }, physical: { label: 'Physical', cls: 'pi-tag-physical' }, procedure: { label: 'Procedure', cls: 'pi-tag-process' } };
  const csfLabels = { govern: { label: 'Govern', cls: 'pi-tag-govern' }, protect: { label: 'Protect', cls: 'pi-tag-protect' }, detect: { label: 'Detect', cls: 'pi-tag-detect' }, respond: { label: 'Respond', cls: 'pi-tag-respond' }, recover: { label: 'Recover', cls: 'pi-tag-recover' }, identify: { label: 'Identify', cls: 'pi-tag-identify' } };

  const policiesHtml = piReviewPolicies.map((p, idx) => {
    const cat = catLabels[p.category] || catLabels.policy;
    const csf = csfLabels[p.csfFunction] || csfLabels.govern;
    const expanded = idx === 0;

    return `
      <div class="pi-policy-item">
        <div class="pi-policy-item-header" onclick="piTogglePolicy('${p.id}')">
          <div class="pi-policy-toggle"><svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="${expanded ? 'M3 5L6 8L9 5' : 'M5 3L8 6L5 9'}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <span class="pi-policy-code">${esc(p.code)}</span>
          <span class="pi-policy-name">${esc(p.name)}</span>
          <div class="pi-policy-tags">
            <span class="pi-policy-tag ${cat.cls}">${cat.label}</span>
            <span class="pi-policy-tag ${csf.cls}">${csf.label}</span>
            <button class="pi-policy-edit-btn" onclick="event.stopPropagation();piEditPolicy('${p.id}')" title="Edit"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M10.5 2.5L11.5 3.5L4 11H2.5V9.5L10.5 2.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg></button>
            <button class="pi-policy-delete-btn" onclick="event.stopPropagation();piDeletePolicy('${p.id}')"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2 4H12M4 4V3C4 2.4 4.4 2 5 2H9C9.6 2 10 2.4 10 3V4M5 6.5V10.5M7 6.5V10.5M9 6.5V10.5M3 4L4 12H10L11 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          </div>
        </div>
        <div class="pi-policy-detail${expanded ? ' open' : ''}" id="pi-policy-detail-${p.id}">
          <div class="pi-policy-detail-section"><div class="pi-policy-detail-label">Description</div><p class="pi-policy-detail-text">${esc(p.description)}</p></div>
          ${p.sourceFile ? `<div class="pi-policy-detail-section"><div class="pi-policy-detail-label">Source</div><div class="pi-policy-detail-source"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 2H10L13 5V13C13 13.6 12.6 14 12 14H3C2.4 14 2 13.6 2 13V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.3"/></svg><span>${esc(p.sourceFile)}</span>${p.sourcePages ? `<span class="pages">(${esc(p.sourcePages)})</span>` : ''}</div></div>` : ''}
          <div class="pi-policy-detail-section">
            <div class="pi-policy-detail-label">Linked Requirements</div>
            <div class="pi-policy-reqs">${(p.linkedRequirements || []).map(r2 => `<span class="pi-policy-req-pill">${esc(r2)}</span>`).join('') || '<span style="color:#9ca3af;font-size:11px">None</span>'}</div>
            <div class="pi-policy-reqs" style="margin-top:6px">${(p.linkedFrameworks || []).map(fw => `<span class="pi-policy-fw-pill">${esc(fw)}</span>`).join('')}</div>
          </div>
        </div>
      </div>`;
  }).join('');

  // ── For "both" mode: also build framework nodes panel ──
  let bothNodesHtml = '';
  if (genType === 'both' && piReviewNodes.length > 0) {
    const nodes = piReviewNodes;
    bothNodesHtml = `
      <div class="pi-policy-panel" style="margin-bottom:16px">
        <div class="pi-policy-panel-header" style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%)">
          <h3><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L12 5V11L8 14L4 11V5L8 2Z" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg> Framework — ${esc(r.libraryName)}</h3>
          <p>${nodes.length} requirement nodes — ${nodes.filter(n => n.assessable).length} assessable</p>
        </div>
        <div class="pi-policy-list" style="max-height:300px;overflow-y:auto">
          ${nodes.map((n, idx) => {
            const indent = Math.max(0, (n.depth || 1) - 1) * 20;
            const isAssessable = !!n.assessable;
            const depthLabel = n.depth === 1 ? 'Root' : n.depth === 2 ? 'Section' : n.depth === 3 ? 'Sub-section' : 'Requirement';
            const assessBadge = isAssessable
              ? '<span class="pi-policy-tag" style="background:#dcfce7;color:#166534;font-size:9px;padding:1px 6px;border-radius:4px">Assessable</span>'
              : '<span class="pi-policy-tag" style="background:#f3f4f6;color:#6b7280;font-size:9px;padding:1px 6px;border-radius:4px">Structural</span>';
  return `
              <div class="pi-policy-item" style="margin-left:${indent}px">
                <div class="pi-policy-item-header" onclick="piTogglePolicy('${n.id}')">
                  <div class="pi-policy-toggle"><svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M5 3L8 6L5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
                  <span class="pi-policy-code" style="min-width:40px">${esc(n.ref_id || '')}</span>
                  <span class="pi-policy-name">${esc(n.name)}</span>
                  <div class="pi-policy-tags">${assessBadge}<span style="font-size:9px;color:#9ca3af">${depthLabel}</span></div>
                </div>
                <div class="pi-policy-detail" id="pi-policy-detail-${n.id}">
                  ${n.description ? `<div class="pi-policy-detail-section"><div class="pi-policy-detail-label">Description</div><p class="pi-policy-detail-text">${esc(n.description)}</p></div>` : ''}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  const isBoth = genType === 'both';
  const panelTitle = isBoth ? 'Framework + Reference Controls' : 'Reference Controls';
  const reviewSubtitle = isBoth
    ? 'Review the framework and reference controls extracted from your documents'
    : 'Review the reference controls extracted from your documents before creating the library and policies';
  const approveLabel = 'Approve & Upload Library';

  return `
    <div class="pi-review-header"><svg width="20" height="20" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M5 8L7 10L11 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><h1>Review Generated ${esc(panelTitle)}</h1></div>
    <p class="pi-review-subtitle">${reviewSubtitle}</p>

    <div class="pi-review-stats"><div class="pi-review-stats-grid">
      <div><div class="pi-review-stat-label">Library Name</div><div class="pi-review-stat-value">${esc(r.libraryName)}</div></div>
      <div><div class="pi-review-stat-label">Source Files</div><div class="pi-review-stat-value">${r.sourceFileCount} files</div></div>
      <div><div class="pi-review-stat-label">Extracted Controls</div><div class="pi-review-stat-value">${piReviewPolicies.length} controls</div></div>
      ${isBoth ? `<div><div class="pi-review-stat-label">Requirement Nodes</div><div class="pi-review-stat-value">${piReviewNodes.length} nodes</div></div>` : ''}
    </div></div>

    ${bothNodesHtml}

    <div class="pi-policy-panel">
      <div class="pi-policy-panel-header">
        <h3><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke="white" stroke-width="1.5"/><path d="M5.5 8L7 9.5L10.5 6.5" stroke="white" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> ${isBoth ? 'Reference Controls' : esc(r.libraryName)}</h3>
        <p>${piReviewPolicies.length} extracted reference controls — click to view details or edit</p>
      </div>
      <div class="pi-policy-list">
        ${policiesHtml}
        <button class="pi-add-policy-btn" onclick="piAddControl()"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Add Control Manually</button>
      </div>
    </div>

    <div class="pi-review-footer">
      <button class="pi-btn pi-btn-discard" onclick="piDiscard()">Discard & Delete</button>
      <div style="display:flex;gap:8px">
        <button class="pi-btn pi-btn-regenerate" onclick="piRegenerate()"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 6C1 3.2 3.2 1 6 1C8.8 1 11 3.2 11 6C11 8.8 8.8 11 6 11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M4 6L1 6L1 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Regenerate</button>
        <button class="pi-btn pi-btn-approve" onclick="piApprove()"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> ${approveLabel}</button>
      </div>
    </div>`;
}

function piTogglePolicy(id) {
  const detail = document.getElementById(`pi-policy-detail-${id}`);
  if (detail) detail.classList.toggle('open');
  // Update toggle arrow
  const item = detail?.closest('.pi-policy-item');
  if (item) {
    const toggle = item.querySelector('.pi-policy-toggle svg path');
    if (toggle) {
      const isOpen = detail.classList.contains('open');
      toggle.setAttribute('d', isOpen ? 'M3 5L6 8L9 5' : 'M5 3L8 6L5 9');
    }
  }
}
window.piTogglePolicy = piTogglePolicy;

async function piDeletePolicy(id) {
  if (!await showConfirm({ title: 'Remove Control', message: 'Remove this control from the list?', confirmText: 'Remove', type: 'warning' })) return;
  piReviewPolicies = piReviewPolicies.filter(p => p.id !== id);
  piRender();
}
window.piDeletePolicy = piDeletePolicy;

function piEditPolicy(id) {
  const p = piReviewPolicies.find(x => x.id === id);
  if (!p) return;
  const catOpts = ['policy','process','technical','physical','procedure'];
  const csfOpts = ['govern','protect','detect','respond','recover','identify'];
  const catSel = catOpts.map(c => `<option value="${c}"${p.category===c?' selected':''}>${c[0].toUpperCase()+c.slice(1)}</option>`).join('');
  const csfSel = csfOpts.map(c => `<option value="${c}"${p.csfFunction===c?' selected':''}>${c[0].toUpperCase()+c.slice(1)}</option>`).join('');
  const det = document.getElementById(`pi-policy-detail-${id}`);
  if (!det) return;
  det.classList.add('open');
  const item = det.closest('.pi-policy-item');
  if (item) { const t = item.querySelector('.pi-policy-toggle svg path'); if (t) t.setAttribute('d','M3 5L6 8L9 5'); }
  det.innerHTML = `<div class="pi-edit-form">
    <div class="pi-edit-row"><label>Name</label><input type="text" id="pi-edit-name-${id}" class="pi-form-input" value="${esc(p.name)}"></div>
    <div class="pi-edit-row"><label>Ref ID</label><input type="text" id="pi-edit-code-${id}" class="pi-form-input" value="${esc(p.code)}"></div>
    <div class="pi-edit-row"><label>Description</label><textarea id="pi-edit-desc-${id}" class="pi-form-input" rows="3">${esc(p.description)}</textarea></div>
    <div style="display:flex;gap:12px"><div class="pi-edit-row" style="flex:1"><label>Category</label><select id="pi-edit-cat-${id}" class="pi-form-select">${catSel}</select></div><div class="pi-edit-row" style="flex:1"><label>CSF Function</label><select id="pi-edit-csf-${id}" class="pi-form-select">${csfSel}</select></div></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid #f3f4f6"><button class="pi-btn pi-btn-view" onclick="piRender()">Cancel</button><button class="btn-admin-primary" onclick="piSaveEdit('${id}')">Save Changes</button></div>
  </div>`;
}
window.piEditPolicy = piEditPolicy;

function piSaveEdit(id) {
  const p = piReviewPolicies.find(x => x.id === id);
  if (!p) return;
  p.name = document.getElementById(`pi-edit-name-${id}`)?.value?.trim() || p.name;
  p.code = document.getElementById(`pi-edit-code-${id}`)?.value?.trim() || p.code;
  p.description = document.getElementById(`pi-edit-desc-${id}`)?.value?.trim() || p.description;
  p.category = document.getElementById(`pi-edit-cat-${id}`)?.value || p.category;
  p.csfFunction = document.getElementById(`pi-edit-csf-${id}`)?.value || p.csfFunction;
  toast('success', 'Saved', `Updated "${p.name}"`);
  piRender();
}
window.piSaveEdit = piSaveEdit;

function piAddControl() {
  const newId = 'gp-manual-' + Date.now();
  const idx = piReviewPolicies.length + 1;
  piReviewPolicies.push({ id: newId, code: `RC-NEW-${String(idx).padStart(2,'0')}`, name: 'New Control', description: '', category: 'policy', csfFunction: 'govern', sourceFile: 'Manual', sourcePages: '', linkedRequirements: [] });
  piRender();
  setTimeout(() => piEditPolicy(newId), 100);
}
window.piAddControl = piAddControl;

function piDiscard() { piBackToCollections(); }
window.piDiscard = piDiscard;

function piRegenerate() {
  piPhase = 'generating';
  piRender();
  // Re-run extraction with the same config
  piRunExtraction(piSelectedCollectionId, piCurrentConfig);
}
window.piRegenerate = piRegenerate;

async function piApprove() {
  if (!piSelectedCollectionId) return;
  const genType = piGenerationResult?.generationType || piCurrentConfig?.generationType || 'both';
  const folder = piCurrentConfig.folder || '';

  // Set approve buttons to loading state
  document.querySelectorAll('.pi-btn-approve').forEach(btn => {
    btn.disabled = true;
    btn.dataset.origHtml = btn.innerHTML;
    btn.innerHTML = '<svg class="pi-spin" width="14" height="14" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="rgba(255,255,255,0.3)" stroke-width="2"/><path d="M10 2A8 8 0 0 1 18 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Uploading…';
  });

  try {
    toast('info', 'Approving…', 'Uploading library to GRC platform…');

    const approveBody = { folder, generationType: genType };
    if (genType === 'controls' || genType === 'both') {
      approveBody.policies = piReviewPolicies;
    }
    if (genType === 'framework' || genType === 'both') {
      approveBody.requirementNodes = piReviewNodes;
    }

    const res = await fetch(`${PI_API}/${piSelectedCollectionId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(approveBody),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Approve failed');

    const coll = piCollections.find(c => c.id === piSelectedCollectionId);
    if (coll) {
      coll.status = 'approved';
      coll.generatedPoliciesCount = genType === 'framework' ? piReviewNodes.length : piReviewPolicies.length;
      coll.lastUpdated = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    if (data.data.libraryCreated) {
      const rcCount = data.data.created || 0;
      const rcMsg = rcCount > 0 ? ` ${rcCount} reference controls verified.` : '';
      toast('success', 'Library Created!', `Library uploaded to GRC successfully.${rcMsg} Applied controls can be added manually in the GRC platform.`);
    } else {
      toast('error', 'Library Error', data.data.libraryError || 'Failed to upload library to GRC.');
    }

    // Invalidate history cache after approve
    if (piSelectedCollectionId) delete piHistoryCache[piSelectedCollectionId];
    piPhase = 'success';
    piRender();
  } catch (err) {
    toast('error', 'Approve Error', err.message);
    // Restore approve buttons
    document.querySelectorAll('.pi-btn-approve').forEach(btn => {
      btn.disabled = false;
      if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
    });
  }
}
window.piApprove = piApprove;

// ─── Success Screen ────────────────────────────────────
function piRenderSuccess() {
  if (!piGenerationResult) return '';
  const r = piGenerationResult;
  const genType = r.generationType || 'both';
  const isFramework = genType === 'framework';
  const isBoth = genType === 'both';
  const hasControls = genType === 'controls' || isBoth;

  const controlsCount = piReviewPolicies.length;
  const nodesCount = piReviewNodes.length;

  const successTitle = isFramework ? 'Framework library created successfully!'
    : isBoth ? 'Full library created successfully!'
    : 'Controls library created successfully!';
  const successDesc = isFramework
    ? 'Your documents have been converted into a compliance framework for assessments'
    : isBoth ? 'Your documents have been converted into a framework + reference controls with applied policies'
    : 'Your documents have been converted into reference controls and applied policies';
  const genTypeLabel = isFramework ? 'Policy Framework' : isBoth ? 'Framework + Reference Controls' : 'Reference Controls';

  const infoText = isFramework
    ? `The framework library has been created under Governance → Libraries with ${nodesCount} requirement nodes. You can now use this framework for compliance assessments.`
    : isBoth
    ? `The library has been created under Governance → Libraries with ${nodesCount} requirement nodes and ${controlsCount} reference controls. ${controlsCount} policies have been generated under Governance → Policies.`
    : `The library has been created under Governance → Libraries, and ${controlsCount} reference controls have been generated as policies under Governance → Policies. You can now audit these policies and link them to requirement assessments.`;

  return `
    <div class="pi-header">
      <div class="pi-header-left">
        <div class="pi-header-title"><svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M3 2H10L13 5V13C13 13.6 12.6 14 12 14H3C2.4 14 2 13.6 2 13V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.5"/><path d="M5 8H10M5 10.5H8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><h1>Organization Policy Ingestion</h1></div>
      </div>
    </div>
    <div class="pi-success-card">
      <div class="pi-success-banner" ${isFramework ? 'style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%)"' : ''}>
        <h3><svg width="20" height="20" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="white" stroke-width="1.5"/><path d="M5 8L7 10L11 6" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> ${successTitle}</h3>
        <p>${successDesc}</p>
      </div>
      <div class="pi-success-body" style="text-align:center">
        <div class="pi-success-icon"><svg width="32" height="32" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="#059669" stroke-width="1.5"/><path d="M5 8L7 10L11 6" stroke="#059669" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>

        <div class="pi-success-stats">
          ${hasControls ? `<div class="pi-success-stat pi-success-stat-green"><div class="pi-success-stat-val">${controlsCount}</div><div class="pi-success-stat-label">Reference Controls</div></div>` : ''}
          ${(isFramework || isBoth) ? `<div class="pi-success-stat pi-success-stat-blue"><div class="pi-success-stat-val">${nodesCount}</div><div class="pi-success-stat-label">Requirement Nodes</div></div>` : ''}
          <div class="pi-success-stat pi-success-stat-gray"><div class="pi-success-stat-val">${r.sourceFileCount}</div><div class="pi-success-stat-label">Source Files</div></div>
        </div>

        <div class="pi-success-details">
          <div class="pi-success-detail-row"><span class="label">Library Name</span><span class="value">${esc(r.libraryName)}</span></div>
          <div class="pi-success-detail-row"><span class="label">Generation Type</span><span class="value">${genTypeLabel}</span></div>
          ${hasControls ? `<div class="pi-success-detail-row"><span class="label">Policies Created</span><span class="value">${controlsCount}</span></div>` : ''}
          <div class="pi-success-detail-row"><span class="label">Confidence Score</span><span class="value" style="color:#059669">${r.confidenceScore}%</span></div>
        </div>

        <div class="pi-success-info"><p>${infoText}</p></div>

        <div class="pi-success-actions">
          <button class="btn-admin-primary"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2H10L13 5V13C13 13.6 12.6 14 12 14H3C2.4 14 2 13.6 2 13V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.5"/></svg> View Library in Governance</button>
          ${hasControls ? `<button class="pi-btn pi-btn-view"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2H10L13 5V13C13 13.6 12.6 14 12 14H3C2.4 14 2 13.6 2 13V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.3"/></svg> View Policies</button>` : ''}
          <button class="pi-btn pi-btn-view" onclick="piBackToCollections()"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Generate More</button>
        </div>

        <button class="pi-success-back" onclick="piBackToCollections()"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8 2L3 6L8 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Back to Admin</button>
      </div>
    </div>`;
}

// ─── Init ─────────────────────────────────────────────────────

console.log('[admin.js] Script loaded, readyState:', document.readyState);

function initApp() {
  const { page, subId } = parseRoute();
  console.log(`[admin.js] Initializing → route: /${page}${subId ? '/' + subId : ''}`);
  navigateTo(page, true, subId);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
