const API_URL = 'https://muraji-api.wathbahs.com/api/libraries';
const ANALYZE_API_URL = '/api/analyze';

// DOM Elements
const apiKeyInput = document.getElementById('api-key-input');
const toggleApiKey = document.getElementById('toggle-api-key');
const frameworkSelect = document.getElementById('framework-select');
const notesTextarea = document.getElementById('notes-textarea');
const charCount = document.getElementById('char-count');
const selectedInfo = document.getElementById('selected-info');
const infoFramework = document.getElementById('info-framework');
const infoRefId = document.getElementById('info-ref-id');
const infoRequirement = document.getElementById('info-requirement');
const btnAnalyze = document.getElementById('btn-analyze');
const btnSubmit = document.getElementById('btn-submit');
const modalOverlay = document.getElementById('modal-overlay');
const modal = document.getElementById('modal');
const modalClose = document.getElementById('modal-close');
const modalBody = document.getElementById('modal-body');
const modalFooter = document.getElementById('modal-footer');
const modalCancel = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');
const toastContainer = document.getElementById('toast-container');

// Store fetched data and current selection
let librariesData = [];
let currentSelection = null;
let currentAnalysisData = null;
let currentLibraryId = null;

// Toggle API key visibility
toggleApiKey.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  toggleApiKey.querySelector('.icon-eye').classList.toggle('hidden', !isPassword);
  toggleApiKey.querySelector('.icon-eye-off').classList.toggle('hidden', isPassword);
});

// Check if buttons should be enabled
function updateButtons() {
  // API key is optional since it can be configured server-side
  const hasSelection = currentSelection !== null;
  btnAnalyze.disabled = !hasSelection;
  btnSubmit.disabled = !hasSelection;
  
  // Update API status indicator
  const apiStatus = document.getElementById('api-status');
  if (apiStatus) {
    if (apiKeyInput.value.trim().length > 0) {
      apiStatus.textContent = 'Using custom key';
      apiStatus.classList.add('custom');
    } else {
      apiStatus.textContent = 'Using server key';
      apiStatus.classList.remove('custom');
    }
  }
}

// Alias for backward compatibility
const updateAnalyzeButton = updateButtons;

apiKeyInput.addEventListener('input', updateAnalyzeButton);

// Fetch libraries from API
async function fetchLibraries() {
  try {
    const response = await fetch(API_URL);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.success && data.data) {
      librariesData = data.data;
      populateSelect(librariesData);
    } else {
      throw new Error('Invalid API response format');
    }
  } catch (error) {
    console.error('Error fetching libraries:', error);
    showError('Failed to load frameworks. Please try again later.');
  }
}

// Populate select with framework data
function populateSelect(libraries) {
  frameworkSelect.innerHTML = '';
  
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Select a framework requirement...';
  frameworkSelect.appendChild(defaultOption);
  
  libraries.forEach(library => {
    const framework = library.content?.framework;
    
    if (framework && framework.requirement_nodes) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = `${framework.name || library.name}`;
      
      // Add framework description as disabled option (header)
      if (framework.description) {
        const descOption = document.createElement('option');
        descOption.disabled = true;
        descOption.textContent = `📋 ${truncateText(framework.description, 80)}`;
        descOption.className = 'framework-description';
        optgroup.appendChild(descOption);
      }
      
      // Add requirement nodes
      framework.requirement_nodes.forEach(node => {
        if (node.description) {
          const option = document.createElement('option');
          option.value = JSON.stringify({
            frameworkUrn: framework.urn,
            frameworkName: framework.name,
            nodeUrn: node.urn,
            refId: node.ref_id,
            name: node.name,
            description: node.description,
            depth: node.depth,
            assessable: node.assessable
          });
          
          const indent = '  '.repeat((node.depth || 1) - 1);
          const depthIndicator = getDepthIndicator(node.depth);
          const refIdDisplay = node.ref_id ? `[${node.ref_id}]` : '';
          
          option.textContent = `${indent}${depthIndicator} ${refIdDisplay} ${truncateText(node.description, 70)}`;
          
          optgroup.appendChild(option);
        }
      });
      
      frameworkSelect.appendChild(optgroup);
    }
  });
  
  frameworkSelect.disabled = false;
}

// Get visual indicator for depth level
function getDepthIndicator(depth) {
  switch(depth) {
    case 1: return '●';
    case 2: return '○';
    case 3: return '◦';
    default: return '·';
  }
}

// Truncate text with ellipsis
function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

// Show error message
function showError(message) {
  frameworkSelect.innerHTML = '';
  
  const errorOption = document.createElement('option');
  errorOption.value = '';
  errorOption.textContent = `⚠️ ${message}`;
  frameworkSelect.appendChild(errorOption);
  frameworkSelect.disabled = true;
  
  const formGroup = frameworkSelect.closest('.form-group');
  
  const existingError = formGroup.querySelector('.error-message');
  if (existingError) {
    existingError.remove();
  }
  
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/>
      <path d="M8 4.5V9M8 11V11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    <span>${message}</span>
  `;
  formGroup.appendChild(errorDiv);
}

// Handle select change
function handleSelectChange(e) {
  const value = e.target.value;
  
  if (!value) {
    selectedInfo.style.display = 'none';
    currentSelection = null;
    updateAnalyzeButton();
    return;
  }
  
  try {
    currentSelection = JSON.parse(value);
    
    infoFramework.textContent = currentSelection.frameworkName || '-';
    infoRefId.textContent = currentSelection.refId || '-';
    infoRequirement.textContent = currentSelection.description || '-';
    
    selectedInfo.style.display = 'block';
    updateAnalyzeButton();
    
    if (window.innerWidth <= 640) {
      selectedInfo.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } catch (error) {
    console.error('Error parsing selection:', error);
    selectedInfo.style.display = 'none';
    currentSelection = null;
    updateAnalyzeButton();
  }
}

// Handle textarea input for character count
function handleTextareaInput(e) {
  charCount.textContent = e.target.value.length;
}

// Analyze with Gemini API
async function analyzeRequirement() {
  const apiKey = apiKeyInput.value.trim();
  const userPrompt = notesTextarea.value.trim();
  
  // Only require selection - API key is optional (uses server-side key if not provided)
  if (!currentSelection) {
    return;
  }
  
  // Show loading state
  btnAnalyze.classList.add('loading');
  btnAnalyze.querySelector('.btn-text').classList.add('hidden');
  btnAnalyze.querySelector('.btn-icon').classList.add('hidden');
  btnAnalyze.querySelector('.btn-loading').classList.remove('hidden');
  btnAnalyze.disabled = true;
  
  try {
    const headers = {
      'Content-Type': 'application/json'
    };
    
    // Only add API key header if user provided one (otherwise use server-side key)
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    
    const response = await fetch(ANALYZE_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requirement: currentSelection,
        prompt: userPrompt
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to analyze requirement');
    }
    
    if (data.success && data.data) {
      // Find the library ID from currentSelection
      const library = librariesData.find(lib => 
        lib.content?.framework?.urn === currentSelection.frameworkUrn
      );
      showModal(data.data, library?.id);
    } else {
      throw new Error('Invalid response from server');
    }
  } catch (error) {
    console.error('Analysis error:', error);
    showModalError(error.message);
  } finally {
    // Reset button state
    btnAnalyze.classList.remove('loading');
    btnAnalyze.querySelector('.btn-text').classList.remove('hidden');
    btnAnalyze.querySelector('.btn-icon').classList.remove('hidden');
    btnAnalyze.querySelector('.btn-loading').classList.add('hidden');
    updateAnalyzeButton();
  }
}

// Show modal with results
function showModal(data, libraryId = null) {
  // Handle case where data might be a string or improperly formatted
  let parsedData = data;
  if (typeof data === 'string') {
    try {
      // Try to extract JSON from the string
      const jsonMatch = data.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('Failed to parse data:', e);
      parsedData = { typical_evidence: [{ title: 'Response', description: data }], questions: [], suggestions: [] };
    }
  }

  // Store for confirm action - deep copy to preserve data
  currentAnalysisData = JSON.parse(JSON.stringify(parsedData));
  currentLibraryId = libraryId;

  // Show footer only for analysis results (not for errors or submit success)
  modalFooter.style.display = 'flex';

  renderModalContent();
  openModal();
}

// Render modal content (can be called to refresh after edits)
function renderModalContent() {
  const evidenceItems = currentAnalysisData.typical_evidence || [];
  const questionItems = currentAnalysisData.questions || [];
  const suggestionItems = currentAnalysisData.suggestions || [];

  const html = `
    <div class="result-section" data-section="typical_evidence">
      <div class="result-header">
        <h3 class="result-title">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 3H4C3.4 3 3 3.4 3 4V16C3 16.6 3.4 17 4 17H16C16.6 17 17 16.6 17 16V11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M17 3L10 10M17 3V7M17 3H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Typical Evidence
          <span class="result-count">${evidenceItems.length} items</span>
        </h3>
        <button class="btn-add" onclick="addItem('typical_evidence')" title="Add evidence">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Add
        </button>
      </div>
      <ul class="result-list">
        ${evidenceItems.map((item, index) => `
          <li class="result-list-item" data-index="${index}">
            <div class="result-bullet">${index + 1}</div>
            <div class="result-content">
              <div class="result-item-title">${escapeHtml(item.title || 'Evidence')}</div>
              <div class="result-item-desc">${escapeHtml(item.description || '')}</div>
            </div>
            <div class="item-actions">
              <button class="btn-icon-action" onclick="editItem('typical_evidence', ${index})" title="Edit">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 2L12 4L5 11H3V9L10 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button class="btn-icon-action delete" onclick="deleteItem('typical_evidence', ${index})" title="Delete">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          </li>
        `).join('')}
      </ul>
    </div>
    
    <div class="result-section" data-section="questions">
      <div class="result-header">
        <h3 class="result-title">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/>
            <path d="M7 8C7 6.5 8.5 5 10 5C11.5 5 13 6.5 13 8C13 9.5 11.5 10.5 10 10.5V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="10" cy="15" r="0.5" fill="currentColor" stroke="currentColor"/>
          </svg>
          Assessment Questions
          <span class="result-count">${questionItems.length} items</span>
        </h3>
        <button class="btn-add" onclick="addItem('questions')" title="Add question">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Add
        </button>
      </div>
      <ul class="result-list">
        ${questionItems.map((item, index) => `
          <li class="result-list-item question" data-index="${index}">
            <div class="result-bullet">?</div>
            <div class="result-content">
              <div class="result-item-title">${escapeHtml(item.question || '')}</div>
              <div class="result-item-desc">
                <span class="purpose-label">Purpose:</span> ${escapeHtml(item.purpose || '')}
              </div>
            </div>
            <div class="item-actions">
              <button class="btn-icon-action" onclick="editItem('questions', ${index})" title="Edit">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 2L12 4L5 11H3V9L10 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button class="btn-icon-action delete" onclick="deleteItem('questions', ${index})" title="Delete">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          </li>
        `).join('')}
      </ul>
    </div>
    
    <div class="result-section" data-section="suggestions">
      <div class="result-header">
        <h3 class="result-title">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 2V4M10 16V18M4 10H2M18 10H16M5.05 5.05L3.63 3.63M16.37 16.37L14.95 14.95M5.05 14.95L3.63 16.37M16.37 3.63L14.95 5.05" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="10" cy="10" r="4" stroke="currentColor" stroke-width="1.5"/>
          </svg>
          Recommendations
          <span class="result-count">${suggestionItems.length} items</span>
        </h3>
        <button class="btn-add" onclick="addItem('suggestions')" title="Add suggestion">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Add
        </button>
      </div>
      <ul class="result-list">
        ${suggestionItems.map((item, index) => `
          <li class="result-list-item suggestion" data-index="${index}">
            <div class="result-bullet">✓</div>
            <div class="result-content">
              <div class="result-item-title">${escapeHtml(item.title || 'Suggestion')}</div>
              <div class="result-item-desc">${escapeHtml(item.description || '')}</div>
            </div>
            <div class="item-actions">
              <button class="btn-icon-action" onclick="editItem('suggestions', ${index})" title="Edit">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 2L12 4L5 11H3V9L10 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button class="btn-icon-action delete" onclick="deleteItem('suggestions', ${index})" title="Delete">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          </li>
        `).join('')}
      </ul>
    </div>
  `;
  
  modalBody.innerHTML = html;
}

// Add new item
function addItem(section) {
  let newItem;
  
  if (section === 'typical_evidence') {
    newItem = { title: 'New Evidence', description: 'Description of the evidence' };
  } else if (section === 'questions') {
    newItem = { question: 'New question?', purpose: 'Purpose of this question' };
  } else if (section === 'suggestions') {
    newItem = { title: 'New Suggestion', description: 'Description of the suggestion' };
  }
  
  if (!currentAnalysisData[section]) {
    currentAnalysisData[section] = [];
  }
  
  currentAnalysisData[section].push(newItem);
  renderModalContent();
  
  // Immediately edit the new item
  editItem(section, currentAnalysisData[section].length - 1);
}

// Delete item
function deleteItem(section, index) {
  if (confirm('Are you sure you want to delete this item?')) {
    currentAnalysisData[section].splice(index, 1);
    renderModalContent();
    showToast('info', 'Item Deleted', 'The item has been removed.');
  }
}

// Edit item
function editItem(section, index) {
  const item = currentAnalysisData[section][index];
  const listItem = document.querySelector(`[data-section="${section}"] .result-list-item[data-index="${index}"]`);
  
  if (!listItem || !item) return;
  
  let editHtml;
  
  if (section === 'typical_evidence' || section === 'suggestions') {
    editHtml = `
      <div class="edit-form">
        <input type="text" class="edit-input" id="edit-title-${index}" value="${escapeHtml(item.title || '')}" placeholder="Title">
        <textarea class="edit-textarea" id="edit-desc-${index}" placeholder="Description">${escapeHtml(item.description || '')}</textarea>
        <div class="edit-actions">
          <button class="btn-edit-cancel" onclick="renderModalContent()">Cancel</button>
          <button class="btn-edit-save" onclick="saveItem('${section}', ${index})">Save</button>
        </div>
      </div>
    `;
  } else if (section === 'questions') {
    editHtml = `
      <div class="edit-form">
        <input type="text" class="edit-input" id="edit-question-${index}" value="${escapeHtml(item.question || '')}" placeholder="Question">
        <textarea class="edit-textarea" id="edit-purpose-${index}" placeholder="Purpose">${escapeHtml(item.purpose || '')}</textarea>
        <div class="edit-actions">
          <button class="btn-edit-cancel" onclick="renderModalContent()">Cancel</button>
          <button class="btn-edit-save" onclick="saveItem('${section}', ${index})">Save</button>
        </div>
      </div>
    `;
  }
  
  listItem.innerHTML = editHtml;
  listItem.classList.add('editing');
  
  // Focus on first input
  const firstInput = listItem.querySelector('input');
  if (firstInput) firstInput.focus();
}

// Save edited item
function saveItem(section, index) {
  if (section === 'typical_evidence' || section === 'suggestions') {
    const title = document.getElementById(`edit-title-${index}`).value.trim();
    const description = document.getElementById(`edit-desc-${index}`).value.trim();
    
    if (!title) {
      showToast('error', 'Error', 'Title is required');
      return;
    }
    
    currentAnalysisData[section][index] = { title, description };
  } else if (section === 'questions') {
    const question = document.getElementById(`edit-question-${index}`).value.trim();
    const purpose = document.getElementById(`edit-purpose-${index}`).value.trim();
    
    if (!question) {
      showToast('error', 'Error', 'Question is required');
      return;
    }
    
    currentAnalysisData[section][index] = { question, purpose };
  }
  
  renderModalContent();
  showToast('success', 'Saved', 'Item has been updated.');
}

// Show modal with error
function showModalError(message) {
  // Hide footer for error modal
  modalFooter.style.display = 'none';
  currentAnalysisData = null;
  
  const html = `
    <div class="modal-error">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2"/>
        <path d="M24 14V28M24 32V34" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <h3>Analysis Failed</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
  
  modalBody.innerHTML = html;
  openModal();
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Open modal
function openModal() {
  modalOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

// Close modal
function closeModal() {
  modalOverlay.classList.remove('active');
  document.body.style.overflow = '';
}

// Submit form
async function submitForm() {
  if (!currentSelection) {
    return;
  }
  
  const userPrompt = notesTextarea.value.trim();
  
  // Show loading state
  btnSubmit.classList.add('loading');
  btnSubmit.querySelector('.btn-text').classList.add('hidden');
  btnSubmit.querySelector('.btn-icon').classList.add('hidden');
  btnSubmit.querySelector('.btn-loading').classList.remove('hidden');
  btnSubmit.disabled = true;
  
  try {
    // Prepare submission data
    const submissionData = {
      requirement: currentSelection,
      prompt: userPrompt,
      timestamp: new Date().toISOString()
    };
    
    // Log to console for now (you can replace this with actual API call)
    console.log('Form submitted:', submissionData);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Show success modal
    showSubmitSuccess(submissionData);
    
  } catch (error) {
    console.error('Submit error:', error);
    showModalError(error.message);
  } finally {
    // Reset button state
    btnSubmit.classList.remove('loading');
    btnSubmit.querySelector('.btn-text').classList.remove('hidden');
    btnSubmit.querySelector('.btn-icon').classList.remove('hidden');
    btnSubmit.querySelector('.btn-loading').classList.add('hidden');
    updateButtons();
  }
}

// Show success modal after submission
function showSubmitSuccess(data) {
  // Hide footer for success modal
  modalFooter.style.display = 'none';
  currentAnalysisData = null;
  
  const html = `
    <div class="submit-success">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="2"/>
        <path d="M20 32L28 40L44 24" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <h3>Successfully Submitted!</h3>
      <p>Your requirement assessment has been recorded.</p>
      
      <div class="submit-summary">
        <div class="summary-row">
          <span class="summary-label">Framework:</span>
          <span class="summary-value">${escapeHtml(data.requirement.frameworkName)}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Requirement:</span>
          <span class="summary-value">${escapeHtml(data.requirement.refId)}</span>
        </div>
        ${data.prompt ? `
        <div class="summary-row">
          <span class="summary-label">Notes:</span>
          <span class="summary-value">${escapeHtml(data.prompt.substring(0, 100))}${data.prompt.length > 100 ? '...' : ''}</span>
        </div>
        ` : ''}
      </div>
    </div>
  `;
  
  modalBody.innerHTML = html;
  openModal();
}

// Toast notification
function showToast(type, title, message, duration = 5000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = {
    success: '<path d="M9 12L11 14L15 10M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    error: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 8V12M12 16V16.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    info: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 16V12M12 8V8.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  };
  
  toast.innerHTML = `
    <div class="toast-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        ${icons[type] || icons.info}
      </svg>
    </div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close" aria-label="Close">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  `;
  
  toastContainer.appendChild(toast);
  
  // Close button handler
  toast.querySelector('.toast-close').addEventListener('click', () => {
    removeToast(toast);
  });
  
  // Auto remove
  if (duration > 0) {
    setTimeout(() => removeToast(toast), duration);
  }
  
  return toast;
}

function removeToast(toast) {
  toast.classList.add('toast-exit');
  setTimeout(() => toast.remove(), 300);
}

// Format analysis data for API
function formatAnalysisForAPI(analysisData, selection) {
  const code = selection.refId;
  
  console.log('formatAnalysisForAPI called with:');
  console.log('- analysisData:', JSON.stringify(analysisData, null, 2));
  console.log('- selection:', selection);
  
  // Format typical evidence as clean bullet points
  let typicalRequirements = '';
  const evidenceItems = analysisData.typical_evidence || [];
  
  console.log('Evidence items count:', evidenceItems.length);
  
  if (evidenceItems.length > 0) {
    typicalRequirements = evidenceItems
      .filter(item => item.title && item.title !== 'AI Response') // Filter out fallback items
      .map(item => {
        const title = item.title || '';
        const desc = item.description || '';
        return `- ${title}${desc ? ': ' + desc : ''}`;
      })
      .join('\n');
  }
  
  // Format questions with proper structure
  const questions = {};
  let questionItems = analysisData.questions;
  
  console.log('Raw analysisData.questions:', analysisData.questions);
  console.log('Type of questions:', typeof analysisData.questions);
  console.log('Is Array:', Array.isArray(analysisData.questions));
  
  // Ensure questionItems is an array
  if (!Array.isArray(questionItems)) {
    console.warn('questions is not an array, converting...');
    if (questionItems && typeof questionItems === 'object') {
      // If it's an object, try to extract values
      questionItems = Object.values(questionItems);
    } else {
      questionItems = [];
    }
  }
  
  console.log('Question items count:', questionItems.length);
  console.log('Question items:', JSON.stringify(questionItems, null, 2));
  
  questionItems.forEach((item, index) => {
    console.log(`Processing question ${index}:`, item);
    if (!item) {
      console.warn(`Question ${index} is null/undefined`);
      return;
    }
    // Handle multiple possible formats
    const questionText = item.question || item.text || item.q || '';
    console.log(`Question text for ${index}:`, questionText);
    if (questionText) {
      questions[`q${index + 1}`] = {
        text: questionText,
        type: 'unique_choice',
        options: ['yes', 'no', 'partial']
      };
    }
  });
  
  console.log('Final formatted questions:', questions);
  console.log('Final formatted data:', { code, typicalRequirements: typicalRequirements.substring(0, 100) + '...', questions });
  
  return {
    updates: [
      {
        code,
        typical_requirements: typicalRequirements,
        questions
      }
    ]
  };
}

// Confirm analysis and save to API
async function confirmAnalysis() {
  console.log('Confirm clicked');
  console.log('currentAnalysisData:', currentAnalysisData);
  console.log('currentAnalysisData.questions:', currentAnalysisData?.questions);
  console.log('currentLibraryId:', currentLibraryId);
  console.log('currentSelection:', currentSelection);
  
  if (!currentAnalysisData || !currentLibraryId || !currentSelection) {
    showToast('error', 'Error', 'No analysis data to save');
    return;
  }
  
  // Show loading state
  modalConfirm.classList.add('loading');
  modalConfirm.querySelector('.btn-text').classList.add('hidden');
  modalConfirm.querySelector('.btn-icon').classList.add('hidden');
  modalConfirm.querySelector('.btn-loading').classList.remove('hidden');
  modalConfirm.disabled = true;
  modalCancel.disabled = true;
  
  try {
    const apiUrl = `https://muraji-api.wathbahs.com/api/libraries/${currentLibraryId}/controls`;
    const body = formatAnalysisForAPI(currentAnalysisData, currentSelection);
    
    console.log('Sending to API:', apiUrl, body);
    
    const response = await fetch(apiUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }
    
    // Success
    closeModal();
    showToast('success', 'Saved Successfully', data.message || 'Analysis has been saved to the library.');
    
  } catch (error) {
    console.error('Confirm error:', error);
    showToast('error', 'Save Failed', error.message);
  } finally {
    // Reset button state
    modalConfirm.classList.remove('loading');
    modalConfirm.querySelector('.btn-text').classList.remove('hidden');
    modalConfirm.querySelector('.btn-icon').classList.remove('hidden');
    modalConfirm.querySelector('.btn-loading').classList.add('hidden');
    modalConfirm.disabled = false;
    modalCancel.disabled = false;
  }
}

// Event listeners
frameworkSelect.addEventListener('change', handleSelectChange);
notesTextarea.addEventListener('input', handleTextareaInput);
btnAnalyze.addEventListener('click', analyzeRequirement);
btnSubmit.addEventListener('click', submitForm);
modalClose.addEventListener('click', closeModal);
modalCancel.addEventListener('click', closeModal);
modalConfirm.addEventListener('click', confirmAnalysis);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) {
    closeModal();
  }
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOverlay.classList.contains('active')) {
    closeModal();
  }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  fetchLibraries();
  updateAnalyzeButton();
});

// Fetch immediately if DOM already loaded
if (document.readyState !== 'loading') {
  fetchLibraries();
}
