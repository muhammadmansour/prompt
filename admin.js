/* ============================
   WathbaGRC Admin Panel JS
   ============================ */

const API = {
  sessions: '/api/chat/sessions',
  collections: '/api/collections',
  localPrompts: '/api/local-prompts',
  prompts: 'https://muraji-api.wathbahs.com/api/prompts',
  libraries: 'https://muraji-api.wathbahs.com/api/libraries',
};

// ─── State ────────────────────────────────────────────────────
let sessions = [];
let collections = [];
let collectionFiles = {};  // storeId -> files[]
let orgContexts = [];      // placeholder for org contexts data
let csMode = 'sessions';   // 'sessions' | 'wizard'
let csCurrentStep = 0;
let csSessionData = null;

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

function renderOrgContextsList() {
  const el = document.getElementById('org-contexts-list');

  if (!orgContexts.length) {
    el.innerHTML = `
      <div class="admin-card empty-state-box">
        <div class="empty-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M4 8V24C4 25.1 4.9 26 6 26H26C27.1 26 28 25.1 28 24V12C28 10.9 27.1 10 26 10H17L14.5 7H6C4.9 7 4 7.9 4 9Z" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/></svg></div>
        <h3>No organization contexts</h3>
        <p>Organization contexts help the AI generate more relevant and industry-specific controls. This feature is under development.</p>
        <span class="coming-soon-badge">Coming Soon</span>
      </div>`;
    return;
  }

  el.innerHTML = orgContexts.map((ctx, i) => {
    const tags = (ctx.obligatoryFrameworks || []).map(f => `<span class="badge badge-primary badge-round">${esc(f)}</span>`).join('');
    return `
      <div class="org-ctx-card">
        <div class="org-ctx-header" onclick="toggleOrgContext(${i})">
          <div class="org-ctx-header-left">
            <div class="org-ctx-icon" style="background:${ctx.isActive ? 'rgba(0,119,204,0.1)' : '#f3f4f6'};color:${ctx.isActive ? 'var(--admin-primary)' : '#9ca3af'}">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M3 5V15C3 15.6 3.4 16 4 16H16C16.6 16 17 15.6 17 15V8C17 7.4 16.6 7 16 7H10.5L9 5H4C3.4 5 3 5.4 3 6Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </div>
            <div class="org-ctx-names">
              <div class="org-ctx-name-row">
                <span class="org-ctx-name">${esc(ctx.nameEn || ctx.name)}</span>
                ${ctx.nameAr ? `<span class="org-ctx-name-ar">${esc(ctx.nameAr)}</span>` : ''}
              </div>
              <div class="org-ctx-tags">${tags}</div>
            </div>
          </div>
          <div class="org-ctx-right">
            <span class="badge ${ctx.isActive ? 'badge-emerald' : 'badge-gray'}">${ctx.isActive ? 'Active' : 'Inactive'}</span>
          </div>
        </div>
      </div>`;
  }).join('');
}
window.toggleOrgContext = function(i) {};

// Org search
const orgSearch = document.getElementById('org-search');
if (orgSearch) {
  orgSearch.addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    // For now just re-render since data is empty/placeholder
    renderOrgContextsList();
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

// Step 1: Requirements
function csRenderStepRequirements(el) {
  const reqs = csSessionData.requirements || [];
  el.innerHTML = `
    <div class="cs-wizard-card">
      <div class="cs-wizard-header navy">
        <div class="cs-wizard-header-title">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="white" stroke-width="1.5"/><path d="M6 9L8 11L12 7" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Select Framework Requirements
        </div>
        <div class="cs-wizard-header-desc">Choose which framework requirements to generate controls for</div>
        <div class="cs-wizard-header-stat">
          <span class="big">${reqs.length}</span>
          <span class="label">requirements selected</span>
        </div>
      </div>
      <div class="cs-wizard-body">
        <p style="font-size:12px;color:#6b7280;text-align:center;padding:20px">
          Requirements are loaded from the Auditor page framework library. Select requirements on the <a href="index.html" style="color:var(--admin-primary)">main Auditor page</a> and they will be available here.
        </p>
      </div>
      <div class="cs-wizard-footer">
        <div></div>
        <button class="btn-admin-primary" onclick="csCurrentStep=1;csSessionData.step=1;csRenderWizard()">
          Next: References →
        </button>
      </div>
    </div>`;
}

// Step 2: References
function csRenderStepReferences(el) {
  const cols = csSessionData.collections || [];
  el.innerHTML = `
    <div class="cs-wizard-card">
      <div class="cs-wizard-header emerald">
        <div class="cs-wizard-header-title">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M16 11V15C16 15.6 15.6 16 15 16H3C2.4 16 2 15.6 2 15V11" stroke="white" stroke-width="1.5" stroke-linecap="round"/><path d="M12 6L9 3L6 6M9 3V11" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Select Reference Collections
        </div>
        <div class="cs-wizard-header-desc">Choose file collections that contain framework documents</div>
        <div class="cs-wizard-header-stat">
          <span class="big">${cols.length}</span>
          <span class="label">collections selected</span>
        </div>
      </div>
      <div class="cs-wizard-body">
        <div id="cs-ref-collections" style="display:flex;flex-direction:column;gap:8px"></div>
      </div>
      <div class="cs-wizard-footer">
        <button class="btn-admin-ghost" onclick="csCurrentStep=0;csSessionData.step=0;csRenderWizard()">← Back</button>
        <button class="btn-admin-primary" onclick="csCurrentStep=2;csSessionData.step=2;csRenderWizard()">
          Next: Org Context →
        </button>
      </div>
    </div>`;

  // Load collections
  (async () => {
    await fetchCollections();
    const refEl = document.getElementById('cs-ref-collections');
    if (!collections.length) {
      refEl.innerHTML = '<p style="text-align:center;font-size:12px;color:#9ca3af;padding:16px">No collections available. Create collections from the <a href="index.html" style="color:var(--admin-primary)">Auditor page</a>.</p>';
      return;
    }
    refEl.innerHTML = collections.map(c => {
      const name = c.displayName || c.name || 'Untitled';
      const id = (c.name || '').replace('fileSearchStores/', '');
      const selected = (csSessionData.collections || []).includes(id);
      return `
        <div class="cs-col-row ${selected ? 'selected' : ''}" onclick="csToggleCollection('${esc(id)}',this)">
          <div class="cs-col-left">
            <input type="checkbox" ${selected ? 'checked' : ''} onclick="event.stopPropagation()">
            <span style="font-size:12px;color:#374151">${esc(name)}</span>
          </div>
        </div>`;
    }).join('');
  })();
}

function csToggleCollection(id, row) {
  const idx = (csSessionData.collections || []).indexOf(id);
  if (idx >= 0) {
    csSessionData.collections.splice(idx, 1);
    row.classList.remove('selected');
    row.querySelector('input').checked = false;
  } else {
    if (!csSessionData.collections) csSessionData.collections = [];
    csSessionData.collections.push(id);
    row.classList.add('selected');
    row.querySelector('input').checked = true;
  }
  // Update header stat
  const stat = document.querySelector('.cs-wizard-header-stat .big');
  if (stat) stat.textContent = csSessionData.collections.length;
}
window.csToggleCollection = csToggleCollection;

// Step 3: Org Context
function csRenderStepOrgContext(el) {
  el.innerHTML = `
    <div class="cs-wizard-card">
      <div class="cs-wizard-header sky">
        <div class="cs-wizard-header-title">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 15V5C2 4.4 2.4 4 3 4H15C15.6 4 16 4.4 16 5V15M5 8H13M5 11H10M9 4V2" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Organization Context
        </div>
        <div class="cs-wizard-header-desc">Select an organizational context to tailor AI suggestions</div>
      </div>
      <div class="cs-wizard-body">
        <div style="text-align:center;padding:24px">
          <p style="font-size:12px;color:#6b7280">No organization contexts available yet. The AI will generate industry-agnostic controls.</p>
          <p style="font-size:11px;color:#9ca3af;margin-top:8px">You can add contexts from the <button class="inline-link" onclick="navigateTo('org-contexts')">Org Contexts</button> page.</p>
        </div>
      </div>
      <div class="cs-wizard-footer">
        <button class="btn-admin-ghost" onclick="csCurrentStep=1;csSessionData.step=1;csRenderWizard()">← Back</button>
        <button class="btn-admin-primary" onclick="csCurrentStep=3;csSessionData.step=3;csRenderWizard()">
          Next: Generate →
        </button>
      </div>
    </div>`;
}

// Step 4: Generate
function csRenderStepGenerate(el) {
  const reqs = (csSessionData.requirements || []).length;
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
              Collections
            </div>
            <div class="cs-gen-box-val">${cols}</div>
            <div class="cs-gen-box-sub">reference document sets</div>
          </div>
          <div class="cs-gen-box">
            <div class="cs-gen-box-header">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4H10L12 6V12C12 12.6 11.6 13 11 13H2V4Z" stroke="#6b7280" stroke-width="1.2" stroke-linecap="round"/></svg>
              Org Context
            </div>
            <div class="cs-gen-box-val">${ctx}</div>
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

// ─── Init ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
});
