/* ============================
   WathbaGRC Admin Panel JS
   ============================ */

const API = {
  sessions: '/api/chat/sessions',
  collections: '/api/collections',
  localPrompts: '/api/local-prompts',
  prompts: 'https://muraji-api.wathbahs.com/api/prompts',
  libraries: 'https://muraji-api.wathbahs.com/api/libraries',
  orgContexts: '/api/org-contexts',
};

// ─── State ────────────────────────────────────────────────────
let sessions = [];
let collections = [];
let collectionFiles = {};  // storeId -> files[]
let orgContexts = [];      // placeholder for org contexts data
let csMode = 'sessions';   // 'sessions' | 'wizard'
let csCurrentStep = 0;
let csSessionData = null;
let csLibraries = [];          // fetched frameworks for controls studio
let csCollectionsData = [];    // fetched collections with files for controls studio
let csPendingPoll = null;

// ─── DOM refs ─────────────────────────────────────────────────
const headerTitle = document.getElementById('admin-header-title');
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
  headerTitle.textContent = names[page] || page;

  // Load data for the page
  if (page === 'dashboard') loadDashboard();
  if (page === 'audit-sessions') loadSessions();
  if (page === 'audit-studio') loadAuditStudio();
  if (page === 'file-collections') loadCollections();
  if (page === 'org-contexts') loadOrgContexts();
  if (page === 'controls-studio') loadControlsStudio();
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

// ─── Dashboard ────────────────────────────────────────────────

async function loadDashboard() {
  await Promise.all([fetchSessions(), fetchCollections()]);
  renderDashStats();
  renderDashSessions();
  renderDashStudioSessions();
}

function renderDashStats() {
  const totalSessions = sessions.length;
  const totalMessages = sessions.reduce((a, s) => a + (s.message_count || 0), 0);
  const totalCollections = collections.length;
  const recentWeek = sessions.filter(s => {
    try { return (Date.now() - new Date(s.created_at).getTime()) < 7 * 86400000; } catch { return false; }
  }).length;

  document.getElementById('dash-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-primary"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M10 6V10L12.5 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
      <div class="stat-card-value">${totalSessions}</div>
      <div class="stat-card-label">Audit Sessions</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-emerald"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 4H17M3 10H17M3 16H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
      <div class="stat-card-value">${totalMessages}</div>
      <div class="stat-card-label">Total Messages</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-amber"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 7V15C3 15.6 3.4 16 4 16H16C16.6 16 17 15.6 17 15V9C17 8.4 16.6 8 16 8H10L8.5 6H4C3.4 6 3 6.4 3 7Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div class="stat-card-value">${totalCollections}</div>
      <div class="stat-card-label">File Collections</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-sky"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2V5M10 15V18M5 10H2M18 10H15M5 5L3.5 3.5M16.5 16.5L15 15M5 15L3.5 16.5M16.5 3.5L15 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/></svg></div>
      <div class="stat-card-value">${recentWeek}</div>
      <div class="stat-card-label">This Week</div>
    </div>`;
}

function renderDashSessions() {
  const list = document.getElementById('dash-sessions-list');
  const footer = document.getElementById('dash-sessions-footer');
  const recent = sessions.slice(0, 5);

  if (!recent.length) {
    list.innerHTML = '<div style="padding:32px 20px;text-align:center;color:#9ca3af;font-size:13px">No sessions yet. <a href="index.html" style="color:var(--admin-primary)">Start an audit</a>.</div>';
    footer.textContent = '';
    return;
  }

  list.innerHTML = recent.map(s => {
    const ctx = parseContext(s.context);
    const fw = ctx.frameworkName || 'Unknown';
    const reqCount = (ctx.selectedRequirements || []).length;
    return `
      <div class="dash-session-row" onclick="goToSession('${esc(s.id)}')">
        <div class="dash-session-info">
          <div class="dash-session-name">${esc(fw)}</div>
          <div class="dash-session-date">${fmtDate(s.created_at)}</div>
        </div>
        <div class="dash-session-stats">
          <div class="dash-session-stat"><div class="dash-session-stat-val">${reqCount}</div><div class="dash-session-stat-label">Reqs</div></div>
          <div class="dash-session-stat"><div class="dash-session-stat-val">${s.message_count || 0}</div><div class="dash-session-stat-label">Msgs</div></div>
        </div>
      </div>`;
  }).join('');

  footer.textContent = `${totalActiveText(sessions.length)} session${sessions.length !== 1 ? 's' : ''} total`;
}

function totalActiveText(n) { return n; }

function renderDashStudioSessions() {
  const el = document.getElementById('dash-studio-sessions');
  // Show a placeholder since controls studio sessions are client-side
  el.innerHTML = `
    <div style="padding:20px;text-align:center;font-size:12px;color:#9ca3af">
      <p>Controls studio sessions will appear here.</p>
      <button class="btn-admin-outline btn-admin-sm" onclick="navigateTo('controls-studio')" style="margin-top:8px">Open Studio</button>
    </div>`;
}

// ─── Audit Sessions Page ──────────────────────────────────────

async function loadSessions() {
  await fetchSessions();
  renderSessionsList();
}

function renderSessionsList(query) {
  const el = document.getElementById('sessions-list-full');
  let list = sessions;
  if (query) {
    list = sessions.filter(s => {
      const ctx = parseContext(s.context);
      const text = (ctx.frameworkName || '') + ' ' + (ctx.query || '');
      return text.toLowerCase().includes(query);
    });
  }

  if (!list.length) {
    el.innerHTML = '<div style="padding:32px 20px;text-align:center;color:#9ca3af;font-size:13px">No sessions found.</div>';
    return;
  }

  el.innerHTML = list.map(s => {
    const ctx = parseContext(s.context);
    const fw = ctx.frameworkName || 'Unknown';
    const reqCount = (ctx.selectedRequirements || []).length;
    const fileCount = (ctx.selectedFiles || []).length + (ctx.contextFiles || []).length;
    return `
      <div class="session-row" onclick="goToSession('${esc(s.id)}')">
        <div>
          <div class="session-row-name">${esc(fw)}</div>
          <div class="session-row-query">${esc((ctx.query || '').substring(0, 80))}</div>
        </div>
        <div class="session-row-stat">${reqCount}</div>
        <div class="session-row-stat">${fileCount}</div>
        <div class="session-row-stat">${s.message_count || 0}</div>
        <div class="session-row-date">${fmtDateShort(s.created_at)}</div>
        <div class="col-action">
          <button class="btn-admin-ghost btn-admin-sm" onclick="event.stopPropagation();deleteSession('${esc(s.id)}')" title="Delete">
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
  const s = sessions.find(x => x.id === id);
  if (s) {
    sessionStorage.setItem('chatSessionId', s.id);
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
    sessions = sessions.filter(s => s.id !== id);
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
  renderOrgStats();
  renderOrgContextsList();
}

function renderOrgStats() {
  const el = document.getElementById('org-stats');
  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-primary"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5V15C3 15.6 3.4 16 4 16H16C16.6 16 17 15.6 17 15V8C17 7.4 16.6 7 16 7H10.5L9 5H4C3.4 5 3 5.4 3 6Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
      <div class="stat-card-value">${orgContexts.length}</div>
      <div class="stat-card-label">Total Contexts</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-emerald"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M7 10L9 12L13 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div class="stat-card-value">${orgContexts.filter(c => c.isActive).length}</div>
      <div class="stat-card-label">Active Contexts</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon stat-bg-amber"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 4H12L16 8V16C16 16.6 15.6 17 15 17H4C3.4 17 3 16.6 3 16V5C3 4.4 3.4 4 4 4Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
      <div class="stat-card-value">${orgContexts.reduce((a, c) => a + (c.documents || []).length, 0)}</div>
      <div class="stat-card-label">Documents</div>
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
        <h3>No organization contexts</h3>
        <p>Organization contexts help the AI generate more relevant and industry-specific controls. Click "New Context" to create one.</p>
      </div>`;
    return;
  }

  if (!list.length) {
    el.innerHTML = '<div style="padding:32px 20px;text-align:center;color:#9ca3af;font-size:13px">No contexts match your search.</div>';
    return;
  }

  // Map filtered items back to their original index in orgContexts
  el.innerHTML = list.map(ctx => {
    const origIdx = orgContexts.indexOf(ctx);
    const tags = (ctx.obligatoryFrameworks || []).map(f => `<span class="badge badge-primary badge-round">${esc(f)}</span>`).join('');
    const sectorLabels = { banking: 'Banking & Financial Services', government: 'Government', healthcare: 'Healthcare', energy: 'Energy & Utilities', telecom: 'Telecommunications', education: 'Education', retail: 'Retail & E-Commerce', insurance: 'Insurance', technology: 'Technology', other: 'Other' };
    const sizeLabels = { small: 'Small', medium: 'Medium', large: 'Large', enterprise: 'Enterprise' };
    return `
      <div class="org-ctx-card">
        <div class="org-ctx-header">
          <div class="org-ctx-header-left">
            <div class="org-ctx-icon" style="background:rgba(0,119,204,0.1);color:var(--admin-primary)">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M3 5V15C3 15.6 3.4 16 4 16H16C16.6 16 17 15.6 17 15V8C17 7.4 16.6 7 16 7H10.5L9 5H4C3.4 5 3 5.4 3 6Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </div>
            <div class="org-ctx-names">
              <div class="org-ctx-name-row">
                <span class="org-ctx-name">${esc(ctx.nameEn || ctx.name)}</span>
                ${ctx.nameAr ? `<span class="org-ctx-name-ar">${esc(ctx.nameAr)}</span>` : ''}
              </div>
              <div class="org-ctx-tags">
                ${ctx.sector ? `<span class="badge badge-gray badge-round">${esc(sectorLabels[ctx.sector] || ctx.sector)}</span>` : ''}
                ${ctx.size ? `<span class="badge badge-gray badge-round">${esc(sizeLabels[ctx.size] || ctx.size)}</span>` : ''}
                ${tags}
              </div>
            </div>
          </div>
          <div class="org-ctx-right">
            <span class="badge badge-emerald">Active</span>
            <button class="btn-admin-ghost btn-admin-sm" onclick="editOrgContext(${origIdx})" title="Edit">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M10 2L12 4L5 11H3V9L10 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="btn-admin-ghost btn-admin-sm" onclick="deleteOrgContext(${origIdx})" title="Delete">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
      </div>`;
  }).join('');
}
window.toggleOrgContext = function(i) {};

// Org Context Modal
const orgModal = document.getElementById('org-modal-overlay');
const orgModalClose = document.getElementById('org-modal-close');
const orgModalCancel = document.getElementById('org-modal-cancel');
const orgModalSave = document.getElementById('org-modal-save');
const orgModalTitle = document.getElementById('org-modal-title');
let editingOrgIdx = null;

function openOrgModal() { orgModal.classList.add('active'); document.body.style.overflow = 'hidden'; }
function closeOrgModal() { orgModal.classList.remove('active'); document.body.style.overflow = ''; editingOrgIdx = null; clearOrgForm(); }
function clearOrgForm() {
  document.getElementById('org-name-en').value = '';
  document.getElementById('org-name-ar').value = '';
  document.getElementById('org-sector').value = '';
  document.getElementById('org-size').value = '';
  document.getElementById('org-frameworks').value = '';
  document.getElementById('org-notes').value = '';
}

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
  const size = document.getElementById('org-size').value;
  const frameworks = document.getElementById('org-frameworks').value.trim();
  const notes = document.getElementById('org-notes').value.trim();

  if (!nameEn) { toast('error', 'Validation', 'Name (English) is required.'); document.getElementById('org-name-en').focus(); return; }
  if (!sector) { toast('error', 'Validation', 'Sector is required.'); document.getElementById('org-sector').focus(); return; }

  const body = {
    nameEn,
    nameAr,
    sector,
    size,
    obligatoryFrameworks: frameworks ? frameworks.split(',').map(s => s.trim()).filter(Boolean) : [],
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
    console.error('Save org context error:', e);
    toast('error', 'Save Failed', e.message);
  } finally {
    orgModalSave.disabled = false;
  }
});

// Edit org context
function editOrgContext(idx) {
  const ctx = orgContexts[idx];
  if (!ctx) return;
  editingOrgIdx = idx;
  orgModalTitle.textContent = 'Edit Organization Context';
  orgModalSave.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7L6 10L11 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Save Changes';
  document.getElementById('org-name-en').value = ctx.nameEn || ctx.name || '';
  document.getElementById('org-name-ar').value = ctx.nameAr || '';
  document.getElementById('org-sector').value = ctx.sector || '';
  document.getElementById('org-size').value = ctx.size || '';
  document.getElementById('org-frameworks').value = (ctx.obligatoryFrameworks || []).join(', ');
  document.getElementById('org-notes').value = ctx.notes || '';
  openOrgModal();
  document.getElementById('org-name-en').focus();
}
window.editOrgContext = editOrgContext;

// Delete org context
async function deleteOrgContext(idx) {
  const ctx = orgContexts[idx];
  if (!ctx) return;
  if (!confirm('Delete "' + (ctx.nameEn || ctx.name) + '"?')) return;
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

// ─── Controls Studio ──────────────────────────────────────────

const CS_STEPS = [
  { label: 'Requirements', icon: '1' },
  { label: 'References', icon: '2' },
  { label: 'Org Context', icon: '3' },
  { label: 'Generate', icon: '4' },
  { label: 'Review', icon: '5' },
  { label: 'Export', icon: '6' },
];

// Get stored sessions from localStorage
function csGetSessions() {
  try { return JSON.parse(localStorage.getItem('cs_sessions') || '[]'); } catch { return []; }
}
function csSaveSessions(list) {
  localStorage.setItem('cs_sessions', JSON.stringify(list));
}

function loadControlsStudio() {
  if (csMode === 'sessions') csShowSessions();
}

function csShowSessions() {
  csMode = 'sessions';
  document.getElementById('cs-step-indicator').style.display = 'none';
  document.getElementById('cs-back-to-sessions').style.display = 'none';

  const csSessions = csGetSessions();
  const content = document.getElementById('cs-content');

  // Stats
  const totalSessions = csSessions.length;
  const totalControls = csSessions.reduce((a, s) => a + (s.controls || []).length, 0);
  const exported = csSessions.filter(s => s.status === 'exported').length;

  let h = `
    <div class="cs-sessions-stats">
      <div class="cs-sessions-stat">
        <div class="cs-sessions-stat-icon stat-bg-primary"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3H14M2 8H14M2 13H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
        <div class="cs-sessions-stat-val">${totalSessions}</div>
        <div class="cs-sessions-stat-label">Total Sessions</div>
      </div>
      <div class="cs-sessions-stat">
        <div class="cs-sessions-stat-icon stat-bg-emerald"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M5 8L7 10L11 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div class="cs-sessions-stat-val">${totalControls}</div>
        <div class="cs-sessions-stat-label">Controls Generated</div>
      </div>
      <div class="cs-sessions-stat">
        <div class="cs-sessions-stat-icon stat-bg-amber"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 5V12C2 12.6 2.4 13 3 13H13C13.6 13 14 12.6 14 12V7C14 6.4 13.6 6 13 6H8L6.5 4H3C2.4 4 2 4.4 2 5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div class="cs-sessions-stat-val">${exported}</div>
        <div class="cs-sessions-stat-label">Exported</div>
      </div>
      <div class="cs-sessions-stat">
        <div class="cs-sessions-stat-icon stat-bg-sky"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1V3M8 13V15M3 8H1M15 8H13M4 4L2.5 2.5M13.5 13.5L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/></svg></div>
        <div class="cs-sessions-stat-val">${totalSessions - exported}</div>
        <div class="cs-sessions-stat-label">In Progress</div>
      </div>
    </div>`;

  if (!csSessions.length) {
    h += `
      <div class="admin-card empty-state-box">
        <div class="empty-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="12" stroke="#cbd5e1" stroke-width="2"/><path d="M10 16L14 20L22 12" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <h3>No studio sessions yet</h3>
        <p>Start a new session to generate AI-suggested applied controls for your framework requirements.</p>
        <button class="btn-admin-primary" style="margin-top:16px" onclick="csNewSession()">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          New Session
        </button>
      </div>`;
  } else {
    h += '<div class="admin-card">';
    h += csSessions.map((s, i) => {
      const reqCount = (s.requirements || []).length;
      const ctrlCount = (s.controls || []).length;
      const statusBadge = s.status === 'exported'
        ? '<span class="badge badge-emerald">Exported</span>'
        : s.status === 'generated'
        ? '<span class="badge badge-sky">Generated</span>'
        : '<span class="badge badge-amber">Draft</span>';
      return `
        <div class="cs-session-row">
          <div class="cs-session-main">
            <div class="cs-session-name-row">
              <span class="cs-session-name">${esc(s.name || 'Unnamed Session')}</span>
              ${statusBadge}
            </div>
            <div class="cs-session-meta">
              <span>${fmtDate(s.created_at || s.createdAt)}</span>
              ${s.framework ? '<span>• ' + esc(s.framework) + '</span>' : ''}
            </div>
          </div>
          <div class="cs-session-stats-row">
            <div class="cs-session-stat-item"><div class="val">${reqCount}</div><div class="lbl">Reqs</div></div>
            <div class="cs-session-stat-item"><div class="val emerald">${ctrlCount}</div><div class="lbl">Controls</div></div>
          </div>
          <div class="cs-session-action">
            <button class="btn-admin-outline btn-admin-sm" onclick="csOpenSession(${i})">Open →</button>
          </div>
        </div>`;
    }).join('');
    h += '</div>';
    h += `<div style="margin-top:16px;text-align:center">
            <button class="btn-admin-primary" onclick="csNewSession()">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              New Session
            </button>
          </div>`;
  }

  content.innerHTML = h;
}
window.csShowSessions = csShowSessions;

function csNewSession() {
  csSessionData = {
    id: Date.now().toString(),
    name: 'Session ' + (csGetSessions().length + 1),
    created_at: new Date().toISOString(),
    step: 0,
    requirements: [],
    collections: [],
    orgContext: null,
    controls: [],
    status: 'draft',
  };
  csCurrentStep = 0;
  csMode = 'wizard';
  document.getElementById('cs-back-to-sessions').style.display = '';
  csRenderWizard();
}
window.csNewSession = csNewSession;

function csOpenSession(idx) {
  const list = csGetSessions();
  if (list[idx]) {
    csSessionData = list[idx];
    csCurrentStep = csSessionData.step || 0;
    csMode = 'wizard';
    document.getElementById('cs-back-to-sessions').style.display = '';
    csRenderWizard();
  }
}
window.csOpenSession = csOpenSession;

function csRenderWizard() {
  // Step indicator
  const indEl = document.getElementById('cs-step-indicator');
  indEl.style.display = '';
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

function csSaveStep() {
  // Save current session to localStorage
  const list = csGetSessions();
  const idx = list.findIndex(s => s.id === csSessionData.id);
  if (idx >= 0) list[idx] = csSessionData; else list.push(csSessionData);
  csSaveSessions(list);
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
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 15V5C2 4.4 2.4 4 3 4H15C15.6 4 16 4.4 16 5V15M5 8H13M5 11H10M9 4V2" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Step 3: Organization Context
        </div>
        <div class="cs-wizard-header-desc">Select an organizational context to tailor AI suggestions to a specific industry and entity.</div>
        <div class="cs-wizard-header-stat">
          <span class="big" id="cs-org-selected">${selected ? '1' : '0'}</span>
          <span class="label">${selected ? esc(selected.nameEn || selected.name || '') : 'no context selected (generic mode)'}</span>
        </div>
      </div>
      <div class="cs-wizard-body">
        <div id="cs-org-list" style="display:flex;flex-direction:column;gap:8px">
          <div class="studio-loading"><svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-opacity="0.2"/><path d="M12 2C17.5 2 22 6.5 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Loading contexts...</span></div>
        </div>
        <p style="font-size:11px;color:#9ca3af;margin-top:10px;text-align:center">
          Don't see your org? <button class="inline-link" onclick="navigateTo('org-contexts')">Add a new context</button>.
          Or skip to use generic mode.
        </p>
      </div>
      <div class="cs-wizard-footer">
        <button class="btn-admin-ghost" onclick="csSaveStep();csCurrentStep=1;csSessionData.step=1;csRenderWizard()">← Back</button>
        <button class="btn-admin-primary" onclick="csSaveStep();csCurrentStep=3;csSessionData.step=3;csRenderWizard()">
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
      listEl.innerHTML = '<div class="studio-empty-msg">No organization contexts created yet. The AI will generate industry-agnostic controls.</div>';
      return;
    }

    const sectorLabels = { banking: 'Banking & Financial Services', government: 'Government', healthcare: 'Healthcare', energy: 'Energy & Utilities', telecom: 'Telecommunications', education: 'Education', retail: 'Retail & E-Commerce', insurance: 'Insurance', technology: 'Technology', other: 'Other' };
    const sizeLabels = { small: 'Small', medium: 'Medium', large: 'Large', enterprise: 'Enterprise' };

    // Add a "None (generic)" option
    let html = `<div class="cs-org-option ${!selected ? 'selected' : ''}" onclick="csSelectOrg(null, this)">
      <div class="cs-org-radio"><span class="cs-org-radio-dot ${!selected ? 'active' : ''}"></span></div>
      <div class="cs-org-option-content">
        <div class="cs-org-option-name">No context (generic mode)</div>
        <div class="cs-org-option-desc">AI will generate industry-agnostic controls</div>
      </div>
    </div>`;

    contexts.forEach(ctx => {
      const isSelected = selected && String(selected.id) === String(ctx.id);
      const tags = (ctx.obligatoryFrameworks || []).map(f => `<span class="badge badge-primary badge-round" style="font-size:9px">${esc(f)}</span>`).join(' ');
      html += `<div class="cs-org-option ${isSelected ? 'selected' : ''}" onclick="csSelectOrg('${esc(String(ctx.id))}', this)">
        <div class="cs-org-radio"><span class="cs-org-radio-dot ${isSelected ? 'active' : ''}"></span></div>
        <div class="cs-org-option-content">
          <div class="cs-org-option-name">${esc(ctx.nameEn || ctx.name)}${ctx.nameAr ? ` <span style="color:#9ca3af;font-weight:400">${esc(ctx.nameAr)}</span>` : ''}</div>
          <div class="cs-org-option-desc">
            ${ctx.sector ? esc(sectorLabels[ctx.sector] || ctx.sector) : ''}
            ${ctx.size ? ' • ' + esc(sizeLabels[ctx.size] || ctx.size) : ''}
            ${tags ? ' ' + tags : ''}
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
    countEl.textContent = csSessionData.orgContext ? '1' : '0';
    const labelEl = countEl.nextElementSibling;
    if (labelEl) labelEl.textContent = csSessionData.orgContext ? (csSessionData.orgContext.nameEn || csSessionData.orgContext.name || '') : 'no context selected (generic mode)';
  }
}
window.csSelectOrg = csSelectOrg;

// Step 4: Generate
function csRenderStepGenerate(el) {
  const reqs = (csSessionData.requirements || []).length;
  const files = (csSessionData.selectedFiles || []).length + (csSessionData.sessionFiles || []).length;
  const cols = (csSessionData.collections || []).length;
  const ctx = csSessionData.orgContext ? 1 : 0;

  el.innerHTML = `
    <div class="cs-wizard-card">
      <div class="cs-wizard-header navy">
        <div class="cs-wizard-header-title">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2V4M9 14V16M4 9H2M16 9H14M5 5L3.5 3.5M14.5 14.5L13 13M5 13L3.5 14.5M14.5 3.5L13 5" stroke="white" stroke-width="1.5" stroke-linecap="round"/><circle cx="9" cy="9" r="3" stroke="white" stroke-width="1.5"/></svg>
          Generate Controls
        </div>
        <div class="cs-wizard-header-desc">AI will analyze requirements and suggest applied controls</div>
      </div>
      <div class="cs-wizard-body">
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
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4H10L12 6V12C12 12.6 11.6 13 11 13H2V4Z" stroke="#6b7280" stroke-width="1.2" stroke-linecap="round"/></svg>
              Org Context
            </div>
            <div class="cs-gen-box-val">${ctx ? esc(csSessionData.orgContext.nameEn || csSessionData.orgContext.name || '1') : 'None'}</div>
            <div class="cs-gen-box-sub">${ctx ? 'industry-specific' : 'generic mode'}</div>
          </div>
        </div>
        <div class="cs-gen-ready">
          <div class="cs-gen-ready-icon">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><path d="M14 4V7M14 21V24M7 14H4M24 14H21M8 8L5.5 5.5M22.5 22.5L20 20M8 20L5.5 22.5M22.5 5.5L20 8" stroke="var(--admin-primary)" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="14" r="4" stroke="var(--admin-primary)" stroke-width="2"/></svg>
          </div>
          <h3 style="font-size:14px;font-weight:600;color:#111827;margin:0 0 4px">Ready to Generate</h3>
          <p style="font-size:12px;color:#6b7280;max-width:380px;margin:0 auto">AI will analyze each requirement against your reference documents and suggest applied controls.</p>
        </div>
      </div>
      <div class="cs-wizard-footer">
        <button class="btn-admin-ghost" onclick="csCurrentStep=2;csSessionData.step=2;csRenderWizard()">← Back</button>
        <button class="btn-admin-primary" onclick="csStartGenerate()">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1V3M7 11V13M3 7H1M13 7H11M4 4L2.5 2.5M11.5 11.5L10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="7" cy="7" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg>
          Generate Controls
        </button>
      </div>
    </div>`;
}

function csStartGenerate() {
  // Simulate generation (would call AI API in a real implementation)
  toast('info', 'Generation', 'Control generation is a preview feature. No actual AI call made.');
  csCurrentStep = 4;
  csSessionData.step = 4;
  csSessionData.status = 'generated';
  csSessionData.controls = csSessionData.controls || [];
  // Save session
  const list = csGetSessions();
  const idx = list.findIndex(s => s.id === csSessionData.id);
  if (idx >= 0) list[idx] = csSessionData; else list.push(csSessionData);
  csSaveSessions(list);
  csRenderWizard();
}
window.csStartGenerate = csStartGenerate;

// Step 5: Review
function csRenderStepReview(el) {
  const controls = csSessionData.controls || [];
  el.innerHTML = `
    <div class="cs-wizard-card">
      <div class="cs-wizard-header navy">
        <div class="cs-wizard-header-title">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 5H15M3 9H15M3 13H9" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>
          Review Generated Controls
        </div>
        <div class="cs-wizard-header-desc">Review, select, and optionally edit AI-suggested controls before exporting</div>
        <div class="cs-wizard-header-stat">
          <span class="big">${controls.length}</span>
          <span class="label">controls generated</span>
        </div>
      </div>
      <div class="cs-wizard-body">
        ${controls.length ? controls.map((c, i) => `
          <div class="cs-ctrl-row">
            <div class="cs-ctrl-header">
              <input type="checkbox" checked>
              <div class="cs-ctrl-info">
                <div class="cs-ctrl-name">${esc(c.name || 'Control ' + (i+1))}</div>
                <div class="cs-ctrl-desc">${esc(c.description || '')}</div>
              </div>
              <div class="cs-ctrl-badges">
                <span class="badge badge-sky">${esc(c.framework || '')}</span>
              </div>
            </div>
          </div>`).join('') : `
          <div style="text-align:center;padding:32px;font-size:12px;color:#9ca3af">
            No controls generated yet. Go back and generate controls.
          </div>`}
      </div>
      <div class="cs-wizard-footer">
        <button class="btn-admin-ghost" onclick="csCurrentStep=3;csSessionData.step=3;csRenderWizard()">← Back</button>
        <button class="btn-admin-primary" onclick="csCurrentStep=5;csSessionData.step=5;csRenderWizard()">
          Next: Export →
        </button>
      </div>
    </div>`;
}

// Step 6: Export
function csRenderStepExport(el) {
  const controls = csSessionData.controls || [];
  el.innerHTML = `
    <div class="cs-wizard-card">
      <div class="cs-wizard-header emerald">
        <div class="cs-wizard-header-title">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M16 11V15C16 15.6 15.6 16 15 16H3C2.4 16 2 15.6 2 15V11" stroke="white" stroke-width="1.5" stroke-linecap="round"/><path d="M5 7L9 3L13 7M9 3V12" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Export Controls
        </div>
        <div class="cs-wizard-header-desc">Push selected controls to the Muraji platform</div>
      </div>
      <div class="cs-wizard-body">
        <div class="cs-export-summary">
          <div class="cs-export-summary-box">
            <div class="cs-export-summary-row"><span class="label">Session</span><span class="value">${esc(csSessionData.name)}</span></div>
            <div class="cs-export-summary-row"><span class="label">Controls to export</span><span class="value">${controls.length}</span></div>
            <div class="cs-export-summary-row"><span class="label">Requirements covered</span><span class="value">${(csSessionData.requirements || []).length}</span></div>
          </div>
          <div class="cs-export-warning">
            <strong>⚠️ This will create or update applied controls in the Muraji platform.</strong> Make sure you've reviewed all controls before exporting.
          </div>
          <div style="text-align:center;margin-top:20px">
            <button class="btn-admin-primary" onclick="csDoExport()">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 8V11C12 11.6 11.6 12 11 12H3C2.4 12 2 11.6 2 11V8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4 5L7 2L10 5M7 2V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Export to Muraji
            </button>
          </div>
        </div>
      </div>
      <div class="cs-wizard-footer">
        <button class="btn-admin-ghost" onclick="csCurrentStep=4;csSessionData.step=4;csRenderWizard()">← Back</button>
        <div></div>
      </div>
    </div>`;
}

function csDoExport() {
  toast('info', 'Export', 'Export feature is under development. Controls will be pushed to Muraji when ready.');
  csSessionData.status = 'exported';
  const list = csGetSessions();
  const idx = list.findIndex(s => s.id === csSessionData.id);
  if (idx >= 0) list[idx] = csSessionData; else list.push(csSessionData);
  csSaveSessions(list);
  csRenderWizard();
}
window.csDoExport = csDoExport;

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
    listEl.innerHTML = '<div class="studio-empty-msg">No collections yet. Create one or upload from <a href="index.html" style="color:var(--admin-primary)">Auditor</a>.</div>';
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

document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
});
