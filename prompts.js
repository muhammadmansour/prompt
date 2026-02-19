const PROMPTS_API = 'https://muraji-api.wathbahs.com/api/prompts';

// DOM Elements
const promptsList = document.getElementById('prompts-list');
const promptsSearch = document.getElementById('prompts-search');
const btnCreatePrompt = document.getElementById('btn-create-prompt');
const btnClearCache = document.getElementById('btn-clear-cache');
const modalOverlay = document.getElementById('prompt-modal-overlay');
const modal = document.getElementById('prompt-modal');
const modalTitle = document.getElementById('prompt-modal-title');
const modalClose = document.getElementById('prompt-modal-close');
const modalCancel = document.getElementById('prompt-modal-cancel');
const modalSave = document.getElementById('prompt-modal-save');
const inputName = document.getElementById('prompt-name');
const inputSystemInstruction = document.getElementById('prompt-system-instruction');
const inputEvalInstructions = document.getElementById('prompt-eval-instructions');
const inputOutputFormat = document.getElementById('prompt-output-format');
const toastContainer = document.getElementById('toast-container');

let allPrompts = [];
let editingPromptId = null; // null = creating new

// ─── Fetch & Render ────────────────────────────────────────────

async function fetchPrompts() {
  try {
    const res = await fetch(PROMPTS_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allPrompts = Array.isArray(data) ? data : (data.data || data.prompts || []);
    renderPrompts(allPrompts);
  } catch (err) {
    console.error('Failed to fetch prompts:', err);
    promptsList.innerHTML = `
      <div class="prompts-empty">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2" stroke-opacity="0.3"/>
          <path d="M24 16V24M24 32V32.01" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <p class="empty-title">Failed to load prompts</p>
        <p class="empty-subtitle">${escapeHtml(err.message)}</p>
        <button class="btn-retry" onclick="fetchPrompts()">Retry</button>
      </div>
    `;
  }
}

function getPromptPreview(prompt) {
  // Build a preview from system_instruction (primary content)
  const si = prompt.system_instruction || '';
  if (si) return si.substring(0, 200);
  // Fallback to content or evaluation_instructions
  return (prompt.content || prompt.evaluation_instructions || '').substring(0, 200);
}

function renderPrompts(prompts) {
  if (prompts.length === 0) {
    promptsList.innerHTML = `
      <div class="prompts-empty">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <path d="M8 12H40L48 20V52C48 53.1 47.1 54 46 54H8C6.9 54 6 53.1 6 52V14C6 12.9 6.9 12 8 12Z" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M40 12V20H48" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M16 32H38M16 38H30" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <p class="empty-title">No prompts yet</p>
        <p class="empty-subtitle">Create your first prompt template to get started</p>
      </div>
    `;
    return;
  }

  let html = '';
  prompts.forEach(prompt => {
    const id = prompt._id || prompt.id;
    const name = prompt.name || 'Untitled';
    const version = prompt.version || 1;
    const createdAt = prompt.created_at || prompt.createdAt;
    const updatedAt = prompt.updated_at || prompt.updatedAt;
    const preview = getPromptPreview(prompt);
    const fullText = prompt.system_instruction || prompt.content || prompt.evaluation_instructions || '';

    html += `
      <div class="prompt-card" data-id="${escapeHtml(id)}">
        <div class="prompt-card-header">
          <div class="prompt-card-info">
            <h3 class="prompt-card-name">${escapeHtml(name)}</h3>
          </div>
          <div class="prompt-card-meta">
            <span class="prompt-version-badge">v${version}</span>
          </div>
        </div>
        ${preview ? `
        <div class="prompt-card-preview">
          <pre>${escapeHtml(preview)}${fullText.length > 200 ? '…' : ''}</pre>
        </div>
        ` : ''}
        <div class="prompt-card-footer">
          <div class="prompt-card-dates">
            ${updatedAt ? `<span class="prompt-date">Updated ${formatDate(updatedAt)}</span>` : ''}
            ${createdAt ? `<span class="prompt-date">Created ${formatDate(createdAt)}</span>` : ''}
          </div>
          <div class="prompt-card-actions">
            <button class="btn-prompt-action btn-prompt-edit" onclick="editPrompt('${escapeHtml(id)}')" title="Edit">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M10 2L12 4L5 11H3V9L10 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Edit
            </button>
            <button class="btn-prompt-action btn-prompt-delete" onclick="deletePrompt('${escapeHtml(id)}', '${escapeHtml(name).replace(/'/g, "\\'")}')" title="Delete">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Delete
            </button>
          </div>
        </div>
      </div>
    `;
  });

  promptsList.innerHTML = html;
}

// ─── Search ────────────────────────────────────────────────────

promptsSearch.addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  if (!q) {
    renderPrompts(allPrompts);
    return;
  }
  const filtered = allPrompts.filter(p =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.system_instruction || '').toLowerCase().includes(q) ||
    (p.evaluation_instructions || '').toLowerCase().includes(q)
  );
  renderPrompts(filtered);
});

// ─── Modal ─────────────────────────────────────────────────────

function openModal() {
  modalOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function clearForm() {
  inputName.value = '';
  inputSystemInstruction.value = '';
  inputEvalInstructions.value = '';
  inputOutputFormat.value = '';
}

function closeModal() {
  modalOverlay.classList.remove('active');
  document.body.style.overflow = '';
  editingPromptId = null;
  clearForm();
}

btnCreatePrompt.addEventListener('click', () => {
  editingPromptId = null;
  modalTitle.textContent = 'New Prompt';
  clearForm();
  openModal();
  inputName.focus();
});

modalClose.addEventListener('click', closeModal);
modalCancel.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOverlay.classList.contains('active')) {
    closeModal();
  }
});

// ─── Edit ──────────────────────────────────────────────────────

async function editPrompt(id) {
  editingPromptId = id;
  modalTitle.textContent = 'Edit Prompt';

  // Pre-fill from cached list data
  const cached = allPrompts.find(p => (p._id || p.id) === id);
  inputName.value = cached?.name || '';
  inputSystemInstruction.value = cached?.system_instruction || '';
  inputEvalInstructions.value = cached?.evaluation_instructions || '';
  inputOutputFormat.value = cached?.output_format || '';
  openModal();

  // Fetch full prompt from GET /api/prompts/:id
  try {
    const res = await fetch(`${PROMPTS_API}/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const prompt = data.data || data.prompt || data;
    inputName.value = prompt.name || '';
    inputSystemInstruction.value = prompt.system_instruction || '';
    inputEvalInstructions.value = prompt.evaluation_instructions || '';
    inputOutputFormat.value = prompt.output_format || '';
  } catch (err) {
    console.error('Failed to fetch prompt details:', err);
    showToast('error', 'Error', 'Could not load prompt content: ' + err.message);
  }
  inputName.focus();
}
window.editPrompt = editPrompt;

// ─── Save (Create / Update) ───────────────────────────────────

modalSave.addEventListener('click', async () => {
  const name = inputName.value.trim();
  const system_instruction = inputSystemInstruction.value.trim();
  const evaluation_instructions = inputEvalInstructions.value.trim();
  const output_format = inputOutputFormat.value.trim();

  if (!name) {
    showToast('error', 'Validation', 'Prompt name is required.');
    inputName.focus();
    return;
  }
  if (!system_instruction) {
    showToast('error', 'Validation', 'System instruction is required.');
    inputSystemInstruction.focus();
    return;
  }

  const body = { name, system_instruction, evaluation_instructions, output_format };
  const saveBtnText = modalSave.querySelector('.btn-text');
  const saveBtnLoading = modalSave.querySelector('.btn-loading');

  try {
    modalSave.disabled = true;
    if (saveBtnText) saveBtnText.classList.add('hidden');
    if (saveBtnLoading) saveBtnLoading.classList.remove('hidden');

    let res;
    if (editingPromptId) {
      res = await fetch(`${PROMPTS_API}/${editingPromptId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } else {
      res = await fetch(PROMPTS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.error || `HTTP ${res.status}`);
    }

    closeModal();
    showToast('success', editingPromptId ? 'Updated' : 'Created', `Prompt "${name}" has been ${editingPromptId ? 'updated' : 'created'}.`);
    await fetchPrompts();
  } catch (err) {
    console.error('Save prompt error:', err);
    showToast('error', 'Save Failed', err.message);
  } finally {
    modalSave.disabled = false;
    if (saveBtnText) saveBtnText.classList.remove('hidden');
    if (saveBtnLoading) saveBtnLoading.classList.add('hidden');
  }
});

// ─── Delete ────────────────────────────────────────────────────

async function deletePrompt(id, name) {
  if (!confirm(`Delete prompt "${name}"? This cannot be undone.`)) return;

  try {
    const res = await fetch(`${PROMPTS_API}/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.error || `HTTP ${res.status}`);
    }
    showToast('success', 'Deleted', `Prompt "${name}" has been deleted.`);
    await fetchPrompts();
  } catch (err) {
    console.error('Delete prompt error:', err);
    showToast('error', 'Delete Failed', err.message);
  }
}
window.deletePrompt = deletePrompt;

// ─── Clear Cache ───────────────────────────────────────────────

btnClearCache.addEventListener('click', async () => {
  try {
    const res = await fetch(`${PROMPTS_API}/cache/clear`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast('success', 'Cache Cleared', 'Prompt cache has been cleared successfully.');
    await fetchPrompts();
  } catch (err) {
    console.error('Clear cache error:', err);
    showToast('error', 'Failed', err.message);
  }
});

// ─── Helpers ───────────────────────────────────────────────────

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function showToast(type, title, message, duration = 5000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '<path d="M9 12L11 14L15 10M21 12C21 16.97 16.97 21 12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    error: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 8V12M12 16V16.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    info: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 16V12M12 8V8.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  };

  toast.innerHTML = `
    <div class="toast-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">${icons[type] || icons.info}</svg>
    </div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close" aria-label="Close">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  });

  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    }
  }, duration);
}

// ─── Init ──────────────────────────────────────────────────────

fetchPrompts();
