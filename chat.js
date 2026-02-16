// ==========================================
// Chat Page — Audit Session
// ==========================================

const CHAT_API_URL = '/api/chat';
const SESSION_API_URL = '/api/chat/sessions';
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const toastContainer = document.getElementById('toast-container');

// Session context loaded from sessionStorage
let sessionContext = {
  sessionId: null,
  requirements: [],
  fileResources: [],
  collections: [],
  query: ''
};

// ==========================================
// Initialization
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  // Check if URL has a session ID to resume
  const urlParams = new URLSearchParams(window.location.search);
  const existingSessionId = urlParams.get('session');

  if (existingSessionId) {
    // Resume existing session — load history from server
    resumeSession(existingSessionId);
  } else {
    // New session — load context from sessionStorage and create
    loadSessionContext();
    renderContextBar();
    initSession();
  }
});

function loadSessionContext() {
  try {
    const raw = sessionStorage.getItem('auditSession');
    if (raw) {
      const parsed = JSON.parse(raw);
      sessionContext = {
        sessionId: null, // Will be assigned by the server
        requirements: parsed.requirements || [],
        fileResources: parsed.fileResources || [],
        collections: parsed.collections || [],
        query: parsed.query || ''
      };
    }
  } catch (e) {
    console.warn('Could not load session context:', e);
  }
}

function renderContextBar() {
  // Requirements count
  const reqCount = document.getElementById('ctx-req-count');
  if (reqCount) {
    reqCount.textContent = `${sessionContext.requirements.length} selected`;
  }

  // Files count
  const filesCount = document.getElementById('ctx-files-count');
  if (filesCount) {
    const nFiles = sessionContext.fileResources.length;
    const nCollections = sessionContext.collections.length;
    filesCount.textContent = `${nFiles} files in ${nCollections} collections`;
  }

  // Query summary
  const querySummary = document.getElementById('ctx-query-summary');
  if (querySummary) {
    if (sessionContext.query) {
      querySummary.textContent = sessionContext.query.length > 50
        ? sessionContext.query.substring(0, 50) + '...'
        : sessionContext.query;
    } else {
      querySummary.textContent = 'No query';
    }
  }

  // Show detail card with query if present
  const detailCard = document.getElementById('ctx-detail-card');
  const detailContent = document.getElementById('ctx-detail-content');
  if (detailCard && detailContent && sessionContext.query) {
    detailCard.style.display = '';
    detailContent.innerHTML = `
      <div class="context-detail-label">Initial Query:</div>
      <div class="context-detail-text">${escapeHtml(sessionContext.query)}</div>
    `;
  }
}

// ==========================================
// Messages
// ==========================================

function addMessage(role, text) {
  const msgEl = document.createElement('div');
  msgEl.className = `chat-msg chat-msg-${role}`;

  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (role === 'user') {
    msgEl.innerHTML = `
      <div class="chat-bubble chat-bubble-user">
        <div class="chat-bubble-text">${escapeHtml(text)}</div>
        <div class="chat-bubble-time">${time}</div>
      </div>
    `;
  } else {
    const msgId = 'ai-msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    msgEl.innerHTML = `
      <div class="chat-bubble chat-bubble-ai">
        <div class="chat-bubble-text">${renderMarkdown(text)}</div>
        <div class="chat-bubble-footer">
          <span class="chat-bubble-time">${time}</span>
          <button class="btn-copy-response" onclick="copyResponse(this)" title="Copy response" data-raw-text="${encodeURIComponent(text)}">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
              <path d="M3 11V3C3 2.45 3.45 2 4 2H12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
            <span class="copy-label">Copy</span>
          </button>
        </div>
      </div>
    `;
  }

  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addTypingIndicator() {
  const el = document.createElement('div');
  el.className = 'chat-msg chat-msg-ai';
  el.id = 'typing-indicator';
  el.innerHTML = `
    <div class="chat-bubble chat-bubble-ai typing">
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

// ==========================================
// Send Message
// ==========================================

async function sendMessage(text) {
  if (!text || !text.trim()) return;
  text = text.trim();

  // Show user message
  addMessage('user', text);

  // Clear input
  chatInput.value = '';
  chatInput.style.height = 'auto';
  chatSendBtn.disabled = true;

  // Show typing indicator
  addTypingIndicator();

  try {
    const res = await fetch(CHAT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionContext.sessionId,
        message: text
      })
    });

    const data = await res.json();
    removeTypingIndicator();

    if (data.success && data.reply) {
      addMessage('ai', data.reply);
    } else {
      throw new Error(data.error || 'No reply from AI');
    }
  } catch (error) {
    removeTypingIndicator();
    addMessage('ai', `⚠️ Error: ${error.message}`);
    showToast('error', 'Error', error.message);
  }
}

// ==========================================
// Resume Existing Session
// ==========================================

async function resumeSession(sessionId) {
  sessionContext.sessionId = sessionId;
  console.log('Resuming session:', sessionId);

  try {
    const res = await fetch(`${SESSION_API_URL}/${sessionId}`);
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Session not found');
    }

    // Render all history messages
    if (data.history && data.history.length > 0) {
      data.history.forEach(msg => {
        addMessage(msg.role, msg.text);
      });
    } else {
      addMessage('ai', 'Session loaded but no messages found. You can continue the conversation below.');
    }

    // Update context bar with basic info
    renderContextBar();
    console.log(`Session ${sessionId} resumed with ${data.history?.length || 0} messages`);
  } catch (e) {
    console.error('Failed to resume session:', e);
    addMessage('ai', `⚠️ Could not load session: ${e.message}\n\nThis session may have expired. Please start a new audit from the homepage.`);
  }
}

// ==========================================
// Session Creation & Initial Message
// ==========================================

async function initSession() {
  // Step 1: Create a new chat session on the server (gets UUID + Gemini cache)
  try {
    const createRes = await fetch(SESSION_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          requirements: sessionContext.requirements,
          fileResources: sessionContext.fileResources,
          query: sessionContext.query
        }
      })
    });

    const createData = await createRes.json();

    if (createData.success && createData.sessionId) {
      sessionContext.sessionId = createData.sessionId;
      console.log('Chat session created:', sessionContext.sessionId, 'cache:', createData.cachedContent || 'none');

      // Push UUID into URL so it's shareable / bookmarkable
      const newUrl = `${window.location.pathname}?session=${sessionContext.sessionId}`;
      window.history.replaceState({ sessionId: sessionContext.sessionId }, '', newUrl);
    } else {
      throw new Error(createData.error || 'Failed to create session');
    }
  } catch (e) {
    console.error('Session creation failed:', e);
    addMessage('ai', `⚠️ Could not create audit session: ${e.message}`);
    return;
  }

  // Step 2: Send the first message
  const reqCount = sessionContext.requirements.length;
  const fileCount = sessionContext.fileResources.length;
  const collCount = sessionContext.collections.length;

  if (sessionContext.query || reqCount > 0) {
    let initialMessage = '';

    if (sessionContext.query) {
      initialMessage = sessionContext.query;
    }

    // Auto-generate a message if no query was typed
    const contextParts = [];
    if (reqCount > 0) contextParts.push(`${reqCount} framework requirements`);
    if (fileCount > 0) contextParts.push(`${fileCount} reference files`);
    if (collCount > 0) contextParts.push(`${collCount} document collections`);

    if (!initialMessage && contextParts.length > 0) {
      initialMessage = `Analyze the selected ${contextParts.join(', ')} and provide your initial audit assessment.`;
    }

    // Show user message
    addMessage('user', sessionContext.query || initialMessage);
    addTypingIndicator();

    // Send to Gemini via the chat session
    try {
      const res = await fetch(CHAT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionContext.sessionId,
          message: initialMessage
        })
      });

      const data = await res.json();
      removeTypingIndicator();

      if (data.success && data.reply) {
        addMessage('ai', data.reply);
      } else {
        throw new Error(data.error || 'No reply');
      }
    } catch (err) {
      removeTypingIndicator();
      addMessage('ai', `⚠️ Error: ${err.message}`);
    }
  } else {
    const welcome = `Welcome to the audit session. No requirements were selected.\n\nPlease go back and select framework requirements to begin your analysis.`;
    addMessage('ai', welcome);
  }
}

// ==========================================
// Input Handling
// ==========================================

chatInput.addEventListener('input', () => {
  // Auto-resize
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
  // Enable/disable send button
  chatSendBtn.disabled = !chatInput.value.trim();
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (chatInput.value.trim()) {
      sendMessage(chatInput.value);
    }
  }
});

chatSendBtn.addEventListener('click', () => {
  if (chatInput.value.trim()) {
    sendMessage(chatInput.value);
  }
});

// ==========================================
// Utilities
// ==========================================

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderMarkdown(text) {
  if (!text) return '';

  // Work with raw text, escape HTML first
  let html = escapeHtml(text);

  // Code blocks ```lang\n...\n``` → <pre><code>
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre class="md-code-block"><code>${code.trim()}</code></pre>`;
  });

  // Inline code `code`
  html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');

  // Headers ### → <h4>, ## → <h3> (avoid h1/h2 being too large inside chat)
  html = html.replace(/^#### (.+)$/gm, '<h5 class="md-h4">$1</h5>');
  html = html.replace(/^### (.+)$/gm, '<h4 class="md-h3">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="md-h2">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h3 class="md-h1">$1</h3>');

  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic *text* (but not inside words like file*name)
  html = html.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<em>$1</em>');

  // Horizontal rule ---
  html = html.replace(/^---$/gm, '<hr class="md-hr">');

  // Numbered lists: lines starting with 1. 2. etc.
  html = html.replace(/^(\d+)\. (.+)$/gm, '<li class="md-ol-item" value="$1">$2</li>');
  // Wrap consecutive <li class="md-ol-item"> in <ol>
  html = html.replace(/((?:<li class="md-ol-item"[^>]*>.*<\/li>\n?)+)/g, '<ol class="md-ol">$1</ol>');

  // Bullet points: - or • or *
  html = html.replace(/^[-•] (.+)$/gm, '<li class="md-ul-item">$1</li>');
  html = html.replace(/^\* (.+)$/gm, '<li class="md-ul-item">$1</li>');
  // Wrap consecutive <li class="md-ul-item"> in <ul>
  html = html.replace(/((?:<li class="md-ul-item">.*<\/li>\n?)+)/g, '<ul class="md-ul">$1</ul>');

  // Line breaks (but not inside pre/ol/ul)
  html = html.replace(/\n/g, '<br>');

  // Clean up <br> around block elements
  html = html.replace(/<br>(<(?:ul|ol|pre|h[3-5]|hr))/g, '$1');
  html = html.replace(/(<\/(?:ul|ol|pre|h[3-5]|hr)>)<br>/g, '$1');
  html = html.replace(/<(?:ul|ol) class="md-(?:ul|ol)"><br>/g, (m) => m.replace('<br>', ''));
  html = html.replace(/<br><\/(?:ul|ol)>/g, (m) => m.replace('<br>', ''));

  return html;
}

function copyResponse(btn) {
  const rawText = decodeURIComponent(btn.getAttribute('data-raw-text') || '');
  if (!rawText) return;

  navigator.clipboard.writeText(rawText).then(() => {
    const label = btn.querySelector('.copy-label');
    const origText = label.textContent;
    label.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      label.textContent = origText;
      btn.classList.remove('copied');
    }, 2000);
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = rawText;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    const label = btn.querySelector('.copy-label');
    label.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      label.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 2000);
  });
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

  toastContainer.appendChild(toast);
  toast.querySelector('.toast-close').addEventListener('click', () => removeToast(toast));
  if (duration > 0) setTimeout(() => removeToast(toast), duration);
  return toast;
}

function removeToast(toast) {
  toast.classList.add('toast-exit');
  setTimeout(() => toast.remove(), 300);
}
