const API_URL = 'https://muraji-api.wathbahs.com/api/libraries';
const ANALYZE_API_URL = '/api/analyze';

// DOM Elements
const frameworkSearch = document.getElementById('framework-search');
const clearSearchBtn = document.getElementById('clear-search');
const multiselectOptions = document.getElementById('multiselect-options');
const selectedTags = document.getElementById('selected-tags');
const tagsPlaceholder = document.getElementById('tags-placeholder');
const selectionCount = document.getElementById('selection-count');
const visibleCount = document.getElementById('visible-count');
const btnSelectAll = document.getElementById('btn-select-all');
const btnClearAll = document.getElementById('btn-clear-all');
const notesTextarea = document.getElementById('notes-textarea');
const charCount = document.getElementById('char-count');
const selectedInfo = document.getElementById('selected-info');
const infoCount = document.getElementById('info-count');
const infoContent = document.getElementById('info-content');
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

// Store fetched data and current selections (array for multi-select)
let librariesData = [];
let currentSelections = []; // Changed to array for multi-select
let currentAnalysisData = null; // Will store { [refId]: analysisData }
let allOptions = []; // Flat list of all option items for searching

// Check if buttons should be enabled
function updateButtons() {
  const hasSelections = currentSelections.length > 0;
  btnAnalyze.disabled = !hasSelections;
  btnSubmit.disabled = !hasSelections;
}

// Alias for backward compatibility
const updateAnalyzeButton = updateButtons;

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
      renderMultiSelect(librariesData);
    } else {
      throw new Error('Invalid API response format');
    }
  } catch (error) {
    console.error('Error fetching libraries:', error);
    showMultiSelectError('Failed to load frameworks. Please try again later.');
  }
}

// Render multi-select options
function renderMultiSelect(libraries) {
  allOptions = [];
  
  let html = '';
  
  libraries.forEach((library, libraryIndex) => {
    const framework = library.content?.framework;
    
    if (framework && framework.requirement_nodes) {
      const frameworkName = framework.name || library.name;
      const nodes = framework.requirement_nodes.filter(node => node.description);
      
      // Groups are collapsed by default
      const groupId = `group-${libraryIndex}`;
      html += `
        <div class="option-group collapsed" data-framework="${escapeHtml(frameworkName)}" data-group-id="${groupId}">
          <div class="option-group-header">
            <div class="option-group-toggle" onclick="toggleGroup(this.closest('.option-group-header'))">
              <svg class="chevron-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>${escapeHtml(frameworkName)}</span>
            </div>
            <div class="option-group-actions">
              <span class="option-group-count">${nodes.length} requirements</span>
              <button type="button" class="btn-group-select" onclick="event.stopPropagation(); selectAllInGroup('${groupId}')" title="Select all in this framework">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/>
                  <path d="M4 7L6 9L10 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Select All
              </button>
            </div>
          </div>
          <div class="option-group-items">
      `;
      
      nodes.forEach(node => {
        const optionData = {
          libraryId: library.id,
          frameworkUrn: framework.urn,
          frameworkName: frameworkName,
          nodeUrn: node.urn,
          refId: node.ref_id,
          name: node.name,
          description: node.description,
          depth: node.depth,
          assessable: node.assessable
        };
        
        allOptions.push(optionData);
        
        // Use base64 encoding to safely store JSON in data attribute (handles quotes and special chars)
        const dataAttr = btoa(unescape(encodeURIComponent(JSON.stringify(optionData))));
        const isSelected = currentSelections.some(s => s.nodeUrn === node.urn);
        const depthIndicator = getDepthIndicator(node.depth);
        
        html += `
          <div class="option-item${isSelected ? ' selected' : ''}" 
               data-option="${dataAttr}"
               data-group-id="${groupId}"
               data-search="${escapeHtml((node.ref_id + ' ' + node.description + ' ' + frameworkName).toLowerCase())}">
            <div class="option-checkbox">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6L5 9L10 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="option-content">
              ${node.ref_id ? `<span class="option-ref-id">${escapeHtml(node.ref_id)}</span>` : ''}
              <div class="option-description">
                <span class="option-depth-indicator">${depthIndicator}</span>
                ${escapeHtml(node.description)}
              </div>
            </div>
          </div>
        `;
      });
      
      html += '</div></div>';
    }
  });
  
  multiselectOptions.innerHTML = html;
  updateVisibleCount();
  
  // Attach click handlers
  document.querySelectorAll('.option-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleOption(item);
    });
  });
}

// Toggle group collapse/expand
function toggleGroup(header) {
  const group = header.closest('.option-group');
  group.classList.toggle('collapsed');
}

// Select all items in a specific group
function selectAllInGroup(groupId) {
  const group = document.querySelector(`.option-group[data-group-id="${groupId}"]`);
  if (!group) return;
  
  // Expand the group if collapsed
  group.classList.remove('collapsed');
  
  const items = group.querySelectorAll('.option-item:not([style*="display: none"])');
  let addedCount = 0;
  
  items.forEach(item => {
    const optionData = decodeOptionData(item.dataset.option);
    const exists = currentSelections.some(s => s.nodeUrn === optionData.nodeUrn);
    if (!exists) {
      currentSelections.push(optionData);
      item.classList.add('selected');
      addedCount++;
    }
  });
  
  updateSelectionUI();
  
  if (addedCount > 0) {
    showToast('success', 'Selected', `Added ${addedCount} requirements from this framework.`);
  } else {
    showToast('info', 'Already Selected', 'All requirements in this framework are already selected.');
  }
}

// Make functions globally available
window.toggleGroup = toggleGroup;
window.selectAllInGroup = selectAllInGroup;

// Decode option data from base64
function decodeOptionData(encoded) {
  return JSON.parse(decodeURIComponent(escape(atob(encoded))));
}

// Toggle option selection
function toggleOption(item) {
  const optionData = decodeOptionData(item.dataset.option);
  const index = currentSelections.findIndex(s => s.nodeUrn === optionData.nodeUrn);
  
  if (index === -1) {
    // Add to selection
    currentSelections.push(optionData);
    item.classList.add('selected');
  } else {
    // Remove from selection
    currentSelections.splice(index, 1);
    item.classList.remove('selected');
  }
  
  updateSelectionUI();
}

// Select by nodeUrn (for removing from tags/info)
function removeSelection(nodeUrn) {
  const index = currentSelections.findIndex(s => s.nodeUrn === nodeUrn);
  if (index !== -1) {
    currentSelections.splice(index, 1);
    
    // Update option item UI - find by iterating since data is encoded
    document.querySelectorAll('.option-item').forEach(item => {
      try {
        const data = decodeOptionData(item.dataset.option);
        if (data.nodeUrn === nodeUrn) {
          item.classList.remove('selected');
        }
      } catch (e) {}
    });
    
    updateSelectionUI();
  }
}

// Update all selection-related UI
function updateSelectionUI() {
  renderSelectedTags();
  renderSelectedInfo();
  updateButtons();
  selectionCount.textContent = currentSelections.length;
  
  // Update summary counts in the dashboard
  const summaryReqCount = document.getElementById('summary-req-count');
  if (summaryReqCount) summaryReqCount.textContent = currentSelections.length;
}

// Render selected tags
function renderSelectedTags() {
  if (currentSelections.length === 0) {
    selectedTags.innerHTML = '<span class="placeholder-text" id="tags-placeholder">No requirements selected</span>';
    return;
  }
  
  let html = '';
  currentSelections.forEach(selection => {
    const label = selection.refId || truncateText(selection.description, 30);
    html += `
      <span class="tag" data-urn="${escapeHtml(selection.nodeUrn)}">
        <span class="tag-text" title="${escapeHtml(selection.description)}">${escapeHtml(label)}</span>
        <button type="button" class="tag-remove" onclick="removeSelection('${escapeHtml(selection.nodeUrn)}')" aria-label="Remove">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </span>
    `;
  });
  selectedTags.innerHTML = html;
}

// Render selected info panel
function renderSelectedInfo() {
  if (currentSelections.length === 0) {
    selectedInfo.style.display = 'none';
    return;
  }
  
  selectedInfo.style.display = 'block';
  infoCount.textContent = currentSelections.length;
  
  let html = '';
  currentSelections.forEach((selection, index) => {
    html += `
      <div class="info-item">
        <div class="info-item-number">${index + 1}</div>
        <div class="info-item-content">
          <div class="info-item-framework">${escapeHtml(selection.frameworkName)}</div>
          ${selection.refId ? `<span class="info-item-ref">${escapeHtml(selection.refId)}</span>` : ''}
          <div class="info-item-desc">${escapeHtml(truncateText(selection.description, 150))}</div>
        </div>
        <button type="button" class="info-item-remove" onclick="removeSelection('${escapeHtml(selection.nodeUrn)}')" aria-label="Remove">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    `;
  });
  infoContent.innerHTML = html;
}

// Search/filter functionality
frameworkSearch.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  clearSearchBtn.classList.toggle('hidden', query.length === 0);
  filterOptions(query);
});

clearSearchBtn.addEventListener('click', () => {
  frameworkSearch.value = '';
  clearSearchBtn.classList.add('hidden');
  filterOptions('');
  frameworkSearch.focus();
});

function filterOptions(query) {
  const groups = document.querySelectorAll('.option-group');
  
  groups.forEach(group => {
    const items = group.querySelectorAll('.option-item');
    let visibleInGroup = 0;
    
    items.forEach(item => {
      const searchText = item.dataset.search || '';
      const matches = query === '' || searchText.includes(query);
      item.style.display = matches ? '' : 'none';
      if (matches) visibleInGroup++;
    });
    
    // Hide group if no items match
    group.style.display = visibleInGroup > 0 ? '' : 'none';
    
    // Auto-expand groups when searching, collapse when search is cleared
    if (query !== '' && visibleInGroup > 0) {
      group.classList.remove('collapsed');
    } else if (query === '') {
      group.classList.add('collapsed');
    }
  });
  
  updateVisibleCount();
  
  // Show no results message if needed
  const visibleGroups = document.querySelectorAll('.option-group:not([style*="display: none"])').length;
  const noResultsEl = document.querySelector('.no-results');
  
  if (visibleGroups === 0 && query !== '') {
    if (!noResultsEl) {
      const noResults = document.createElement('div');
      noResults.className = 'no-results';
      noResults.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="14" cy="14" r="9" stroke="currentColor" stroke-width="2"/>
          <path d="M21 21L28 28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <p>No requirements match "${escapeHtml(query)}"</p>
      `;
      multiselectOptions.appendChild(noResults);
    }
  } else if (noResultsEl) {
    noResultsEl.remove();
  }
}

function updateVisibleCount() {
  const visible = document.querySelectorAll('.option-item[style=""]').length || 
                  document.querySelectorAll('.option-item:not([style*="display: none"])').length;
  visibleCount.textContent = visible;
}

// Select all visible
btnSelectAll.addEventListener('click', () => {
  document.querySelectorAll('.option-item:not([style*="display: none"])').forEach(item => {
    const optionData = decodeOptionData(item.dataset.option);
    const exists = currentSelections.some(s => s.nodeUrn === optionData.nodeUrn);
    if (!exists) {
      currentSelections.push(optionData);
      item.classList.add('selected');
    }
  });
  updateSelectionUI();
});

// Clear all
btnClearAll.addEventListener('click', () => {
  currentSelections = [];
  document.querySelectorAll('.option-item.selected').forEach(item => {
    item.classList.remove('selected');
  });
  updateSelectionUI();
});

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

// Show error in multi-select
function showMultiSelectError(message) {
  multiselectOptions.innerHTML = `
    <div class="no-results" style="color: var(--color-error);">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="2"/>
        <path d="M16 10V18M16 22V22.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <p>${message}</p>
    </div>
  `;
}

// Handle textarea input for character count
function handleTextareaInput(e) {
  charCount.textContent = e.target.value.length;
}

// Analyze with Gemini API - now handles multiple requirements
async function analyzeRequirement() {
  const userPrompt = notesTextarea.value.trim();
  
  if (currentSelections.length === 0) {
    return;
  }
  
  // Show loading state
  btnAnalyze.classList.add('loading');
  btnAnalyze.querySelector('.btn-text').classList.add('hidden');
  btnAnalyze.querySelector('.btn-icon').classList.add('hidden');
  btnAnalyze.querySelector('.btn-loading').classList.remove('hidden');
  btnAnalyze.disabled = true;
  
  try {
    // Send all requirements at once for batch analysis
    const requestBody = {
      requirements: currentSelections,
      prompt: userPrompt
    };
    
    console.log('Sending analysis request:', JSON.stringify(requestBody, null, 2));
    console.log('Number of requirements:', currentSelections.length);
    
    const response = await fetch(ANALYZE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to analyze requirements');
    }
    
    if (data.success && data.data) {
      showModal(data.data);
    } else {
      throw new Error('Invalid response from server');
    }
  } catch (error) {
    console.error('Analysis error:', error);
    showModalError(error.message);
  } finally {
    btnAnalyze.classList.remove('loading');
    btnAnalyze.querySelector('.btn-text').classList.remove('hidden');
    btnAnalyze.querySelector('.btn-icon').classList.remove('hidden');
    btnAnalyze.querySelector('.btn-loading').classList.add('hidden');
    updateAnalyzeButton();
  }
}

// Show modal with results - now handles multiple requirements
function showModal(data) {
  // data is now { results: [{ requirement, analysis }], ... }
  let parsedData = data;
  
  // Store for confirm action
  currentAnalysisData = parsedData;
  
  // Show footer for analysis results
  modalFooter.style.display = 'flex';
  
  renderModalContent();
  openModal();
}

// Render modal content for multiple requirements
function renderModalContent() {
  const results = currentAnalysisData.results || [];
  
  if (results.length === 0) {
    modalBody.innerHTML = '<p style="text-align: center; color: var(--color-text-muted);">No analysis results</p>';
    return;
  }
  
  let html = '';
  
  results.forEach((result, resultIndex) => {
    const requirement = result.requirement;
    const analysis = result.analysis || {};
    const evidenceItems = analysis.typical_evidence || [];
    const questionItems = analysis.questions || [];
    const suggestionItems = analysis.suggestions || [];
    
    html += `
      <div class="requirement-result-group" data-result-index="${resultIndex}">
        <div class="requirement-result-header">
          <div class="requirement-result-number">${resultIndex + 1}</div>
          <div class="requirement-result-info">
            <div class="requirement-result-framework">${escapeHtml(requirement.frameworkName)}</div>
            <div class="requirement-result-ref">${escapeHtml(requirement.refId || '')}</div>
            <div class="requirement-result-desc">${escapeHtml(truncateText(requirement.description, 100))}</div>
          </div>
        </div>
        
        <div class="result-section" data-section="typical_evidence" data-result-index="${resultIndex}">
          <div class="result-header">
            <h3 class="result-title">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M9 3H4C3.4 3 3 3.4 3 4V16C3 16.6 3.4 17 4 17H16C16.6 17 17 16.6 17 16V11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <path d="M17 3L10 10M17 3V7M17 3H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Typical Evidence
              <span class="result-count">${evidenceItems.length} items</span>
            </h3>
            <button class="btn-add" onclick="addItem(${resultIndex}, 'typical_evidence')" title="Add evidence">
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
                  <button class="btn-icon-action" onclick="editItem(${resultIndex}, 'typical_evidence', ${index})" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 2L12 4L5 11H3V9L10 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                  <button class="btn-icon-action delete" onclick="deleteItem(${resultIndex}, 'typical_evidence', ${index})" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                </div>
              </li>
            `).join('')}
          </ul>
        </div>
        
        <div class="result-section" data-section="questions" data-result-index="${resultIndex}">
          <div class="result-header">
            <h3 class="result-title">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/>
                <path d="M7 8C7 6.5 8.5 5 10 5C11.5 5 13 6.5 13 8C13 9.5 11.5 10.5 10 10.5V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <circle cx="10" cy="15" r="0.5" fill="currentColor" stroke="currentColor"/>
              </svg>
              Assessment Questions
              <span class="result-count">${questionItems.length} items</span>
            </h3>
            <button class="btn-add" onclick="addItem(${resultIndex}, 'questions')" title="Add question">
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
                  <button class="btn-icon-action" onclick="editItem(${resultIndex}, 'questions', ${index})" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 2L12 4L5 11H3V9L10 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                  <button class="btn-icon-action delete" onclick="deleteItem(${resultIndex}, 'questions', ${index})" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                </div>
              </li>
            `).join('')}
          </ul>
        </div>
        
        <div class="result-section" data-section="suggestions" data-result-index="${resultIndex}">
          <div class="result-header">
            <h3 class="result-title">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 2V4M10 16V18M4 10H2M18 10H16M5.05 5.05L3.63 3.63M16.37 16.37L14.95 14.95M5.05 14.95L3.63 16.37M16.37 3.63L14.95 5.05" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <circle cx="10" cy="10" r="4" stroke="currentColor" stroke-width="1.5"/>
              </svg>
              Recommendations
              <span class="result-count">${suggestionItems.length} items</span>
            </h3>
            <button class="btn-add" onclick="addItem(${resultIndex}, 'suggestions')" title="Add suggestion">
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
                  <button class="btn-icon-action" onclick="editItem(${resultIndex}, 'suggestions', ${index})" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 2L12 4L5 11H3V9L10 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                  <button class="btn-icon-action delete" onclick="deleteItem(${resultIndex}, 'suggestions', ${index})" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                </div>
              </li>
            `).join('')}
          </ul>
        </div>
      </div>
    `;
  });
  
  modalBody.innerHTML = html;
}

// Add new item (updated for multi-requirement structure)
function addItem(resultIndex, section) {
  let newItem;
  
  if (section === 'typical_evidence') {
    newItem = { title: 'New Evidence', description: 'Description of the evidence' };
  } else if (section === 'questions') {
    newItem = { question: 'New question?', purpose: 'Purpose of this question' };
  } else if (section === 'suggestions') {
    newItem = { title: 'New Suggestion', description: 'Description of the suggestion' };
  }
  
  const analysis = currentAnalysisData.results[resultIndex].analysis;
  if (!analysis[section]) {
    analysis[section] = [];
  }
  
  analysis[section].push(newItem);
  renderModalContent();
  
  // Immediately edit the new item
  editItem(resultIndex, section, analysis[section].length - 1);
}

// Delete item (updated for multi-requirement structure)
function deleteItem(resultIndex, section, index) {
  if (confirm('Are you sure you want to delete this item?')) {
    currentAnalysisData.results[resultIndex].analysis[section].splice(index, 1);
    renderModalContent();
    showToast('info', 'Item Deleted', 'The item has been removed.');
  }
}

// Edit item (updated for multi-requirement structure)
function editItem(resultIndex, section, index) {
  const item = currentAnalysisData.results[resultIndex].analysis[section][index];
  const listItem = document.querySelector(`[data-result-index="${resultIndex}"][data-section="${section}"] .result-list-item[data-index="${index}"]`);
  
  if (!listItem || !item) return;
  
  let editHtml;
  
  if (section === 'typical_evidence' || section === 'suggestions') {
    editHtml = `
      <div class="edit-form">
        <input type="text" class="edit-input" id="edit-title-${resultIndex}-${index}" value="${escapeHtml(item.title || '')}" placeholder="Title">
        <textarea class="edit-textarea" id="edit-desc-${resultIndex}-${index}" placeholder="Description">${escapeHtml(item.description || '')}</textarea>
        <div class="edit-actions">
          <button class="btn-edit-cancel" onclick="renderModalContent()">Cancel</button>
          <button class="btn-edit-save" onclick="saveItem(${resultIndex}, '${section}', ${index})">Save</button>
        </div>
      </div>
    `;
  } else if (section === 'questions') {
    editHtml = `
      <div class="edit-form">
        <input type="text" class="edit-input" id="edit-question-${resultIndex}-${index}" value="${escapeHtml(item.question || '')}" placeholder="Question">
        <textarea class="edit-textarea" id="edit-purpose-${resultIndex}-${index}" placeholder="Purpose">${escapeHtml(item.purpose || '')}</textarea>
        <div class="edit-actions">
          <button class="btn-edit-cancel" onclick="renderModalContent()">Cancel</button>
          <button class="btn-edit-save" onclick="saveItem(${resultIndex}, '${section}', ${index})">Save</button>
        </div>
      </div>
    `;
  }
  
  listItem.innerHTML = editHtml;
  listItem.classList.add('editing');
  
  const firstInput = listItem.querySelector('input');
  if (firstInput) firstInput.focus();
}

// Save edited item (updated for multi-requirement structure)
function saveItem(resultIndex, section, index) {
  if (section === 'typical_evidence' || section === 'suggestions') {
    const title = document.getElementById(`edit-title-${resultIndex}-${index}`).value.trim();
    const description = document.getElementById(`edit-desc-${resultIndex}-${index}`).value.trim();
    
    if (!title) {
      showToast('error', 'Error', 'Title is required');
      return;
    }
    
    currentAnalysisData.results[resultIndex].analysis[section][index] = { title, description };
  } else if (section === 'questions') {
    const question = document.getElementById(`edit-question-${resultIndex}-${index}`).value.trim();
    const purpose = document.getElementById(`edit-purpose-${resultIndex}-${index}`).value.trim();
    
    if (!question) {
      showToast('error', 'Error', 'Question is required');
      return;
    }
    
    currentAnalysisData.results[resultIndex].analysis[section][index] = { question, purpose };
  }
  
  renderModalContent();
  showToast('success', 'Saved', 'Item has been updated.');
}

// Show modal with error
function showModalError(message) {
  modalFooter.style.display = 'none';
  currentAnalysisData = null;
  
  const html = `
    <div class="modal-error">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
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
  if (!text) return '';
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
  if (currentSelections.length === 0) {
    return;
  }
  
  const userPrompt = notesTextarea.value.trim();
  
  btnSubmit.classList.add('loading');
  btnSubmit.querySelector('.btn-text').classList.add('hidden');
  btnSubmit.querySelector('.btn-icon').classList.add('hidden');
  btnSubmit.querySelector('.btn-loading').classList.remove('hidden');
  btnSubmit.disabled = true;
  
  try {
    const submissionData = {
      requirements: currentSelections,
      prompt: userPrompt,
      timestamp: new Date().toISOString()
    };
    
    console.log('Form submitted:', submissionData);
    
    await new Promise(resolve => setTimeout(resolve, 800));
    
    showSubmitSuccess(submissionData);
    
  } catch (error) {
    console.error('Submit error:', error);
    showModalError(error.message);
  } finally {
    btnSubmit.classList.remove('loading');
    btnSubmit.querySelector('.btn-text').classList.remove('hidden');
    btnSubmit.querySelector('.btn-icon').classList.remove('hidden');
    btnSubmit.querySelector('.btn-loading').classList.add('hidden');
    updateButtons();
  }
}

// Show success modal after submission
function showSubmitSuccess(data) {
  modalFooter.style.display = 'none';
  currentAnalysisData = null;
  
  const requirementsList = data.requirements.map((r, i) => `
    <div class="summary-row">
      <span class="summary-label">${i + 1}. ${escapeHtml(r.refId || 'Req')}</span>
      <span class="summary-value">${escapeHtml(truncateText(r.description, 60))}</span>
    </div>
  `).join('');
  
  const html = `
    <div class="submit-success">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="2"/>
        <path d="M20 32L28 40L44 24" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <h3>Successfully Submitted!</h3>
      <p>${data.requirements.length} requirement(s) have been recorded.</p>
      
      <div class="submit-summary">
        ${requirementsList}
        ${data.prompt ? `
        <div class="summary-row">
          <span class="summary-label">Notes:</span>
          <span class="summary-value">${escapeHtml(truncateText(data.prompt, 100))}</span>
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
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        ${icons[type] || icons.info}
      </svg>
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
  
  toast.querySelector('.toast-close').addEventListener('click', () => {
    removeToast(toast);
  });
  
  if (duration > 0) {
    setTimeout(() => removeToast(toast), duration);
  }
  
  return toast;
}

function removeToast(toast) {
  toast.classList.add('toast-exit');
  setTimeout(() => toast.remove(), 300);
}

// Format analysis data for API - now handles multiple requirements
function formatAnalysisForAPI(analysisData) {
  const results = analysisData.results || [];
  
  const updates = results.map(result => {
    const selection = result.requirement;
    const analysis = result.analysis;
    const code = selection.refId;
    
    // Format typical evidence as clean bullet points
    let typicalRequirements = '';
    const evidenceItems = analysis.typical_evidence || [];
    
    if (evidenceItems.length > 0) {
      typicalRequirements = evidenceItems
        .filter(item => item.title && item.title !== 'AI Response')
        .map(item => {
          const title = item.title || '';
          const desc = item.description || '';
          return `- ${title}${desc ? ': ' + desc : ''}`;
        })
        .join('\n');
    }
    
    // Format questions with proper URN-based structure for UI rendering
    const questions = {};
    let questionItems = analysis.questions || [];
    
    if (!Array.isArray(questionItems)) {
      questionItems = Object.values(questionItems);
    }
    
    const nodeUrn = selection.nodeUrn || '';
    questionItems.forEach((item, index) => {
      if (!item) return;
      const questionText = item.question || item.text || item.q || '';
      if (questionText) {
        const qNum = index + 1;
        const questionUrn = `${nodeUrn}:question:${qNum}`;
        questions[questionUrn] = {
          type: 'unique_choice',
          text: questionText,
          choices: [
            { urn: `${questionUrn}:choice:1`, value: 'Yes' },
            { urn: `${questionUrn}:choice:2`, value: 'No' },
            { urn: `${questionUrn}:choice:3`, value: 'Partial' }
          ]
        };
      }
    });
    
    return {
      code,
      typical_requirements: typicalRequirements,
      questions
    };
  });
  
  return { updates };
}

// Confirm analysis and save to API - now handles multiple requirements
async function confirmAnalysis() {
  if (!currentAnalysisData || !currentAnalysisData.results || currentAnalysisData.results.length === 0) {
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
    // Group updates by library ID
    const updatesByLibrary = {};
    
    currentAnalysisData.results.forEach(result => {
      const libraryId = result.requirement.libraryId;
      if (!updatesByLibrary[libraryId]) {
        updatesByLibrary[libraryId] = [];
      }
      
      const selection = result.requirement;
      const analysis = result.analysis;
      const code = selection.refId;
      
      // Format typical evidence
      let typicalRequirements = '';
      const evidenceItems = analysis.typical_evidence || [];
      
      if (evidenceItems.length > 0) {
        typicalRequirements = evidenceItems
          .filter(item => item.title && item.title !== 'AI Response')
          .map(item => `- ${item.title}${item.description ? ': ' + item.description : ''}`)
          .join('\n');
      }
      
      // Format questions with proper URN-based structure for UI rendering
      const questions = {};
      let questionItems = analysis.questions || [];
      
      if (!Array.isArray(questionItems)) {
        questionItems = Object.values(questionItems);
      }
      
      const nodeUrn = selection.nodeUrn || '';
      questionItems.forEach((item, index) => {
        if (!item) return;
        const questionText = item.question || item.text || item.q || '';
        if (questionText) {
          const qNum = index + 1;
          const questionUrn = `${nodeUrn}:question:${qNum}`;
          questions[questionUrn] = {
            type: 'unique_choice',
            text: questionText,
            choices: [
              { urn: `${questionUrn}:choice:1`, value: 'Yes' },
              { urn: `${questionUrn}:choice:2`, value: 'No' },
              { urn: `${questionUrn}:choice:3`, value: 'Partial' }
            ]
          };
        }
      });
      
      updatesByLibrary[libraryId].push({
        code,
        typical_requirements: typicalRequirements,
        questions
      });
    });
    
    // Send updates to each library
    const results = await Promise.all(
      Object.entries(updatesByLibrary).map(async ([libraryId, updates]) => {
        const apiUrl = `https://muraji-api.wathbahs.com/api/libraries/${libraryId}/controls`;
        const body = { updates };
        
        console.log('Sending to API:', apiUrl, body);
        
        const response = await fetch(apiUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.message || data.error || `HTTP ${response.status}`);
        }
        
        return { libraryId, success: true, data };
      })
    );
    
    // Success
    closeModal();
    const totalUpdates = Object.values(updatesByLibrary).reduce((sum, arr) => sum + arr.length, 0);
    showToast('success', 'Saved Successfully', `${totalUpdates} requirement(s) have been saved.`);
    
  } catch (error) {
    console.error('Confirm error:', error);
    showToast('error', 'Save Failed', error.message);
  } finally {
    modalConfirm.classList.remove('loading');
    modalConfirm.querySelector('.btn-text').classList.remove('hidden');
    modalConfirm.querySelector('.btn-icon').classList.remove('hidden');
    modalConfirm.querySelector('.btn-loading').classList.add('hidden');
    modalConfirm.disabled = false;
    modalCancel.disabled = false;
  }
}

// ==========================================
// Collections Management (File Search Stores)
// ==========================================

let collectionsData = []; // Array of file search stores with their files

// Fetch all collections from the API
async function fetchCollections() {
  try {
    const res = await fetch('/api/collections');
    const data = await res.json();
    
    if (data.success && data.data) {
      collectionsData = data.data.fileSearchStores || [];
      
      // Fetch files for each collection in parallel
      await Promise.all(collectionsData.map(async (store) => {
        try {
          const storeId = store.name.split('/').pop();
          const filesRes = await fetch(`/api/collections/${storeId}/files`);
          const filesData = await filesRes.json();
          store.files = filesData.success ? (filesData.data?.documents || filesData.data?.fileSearchDocuments || []) : [];
        } catch (e) {
          console.warn(`Could not fetch files for ${store.name}:`, e.message);
          store.files = [];
        }
      }));
      
      renderCollections();
      updateCollectionSummary();
    }
  } catch (error) {
    console.error('Failed to fetch collections:', error);
  }
}

// Show the inline input row for creating a new collection
function showNewCollectionInput() {
  const btn = document.getElementById('btn-new-collection');
  const row = document.getElementById('new-collection-row');
  const input = document.getElementById('new-collection-input');
  if (!btn || !row || !input) return;

  btn.classList.add('hidden');
  row.classList.remove('hidden');
  input.value = '';
  input.focus();
}

// Hide the inline input row and show the button again
function hideNewCollectionInput() {
  const btn = document.getElementById('btn-new-collection');
  const row = document.getElementById('new-collection-row');
  if (!btn || !row) return;

  row.classList.add('hidden');
  btn.classList.remove('hidden');
}

// Create a new collection (file search store) from the inline input
async function createCollection() {
  const input = document.getElementById('new-collection-input');
  const addBtn = document.getElementById('btn-collection-add');
  const name = input?.value?.trim();
  if (!name) {
    input?.focus();
    return;
  }

  try {
    // Disable controls while creating
    if (input) input.disabled = true;
    if (addBtn) addBtn.disabled = true;

    const loadingToast = showToast('info', 'Creating...', `Setting up "${name}"...`, 0);

    const res = await fetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: name })
    });
    const data = await res.json();

    if (loadingToast) removeToast(loadingToast);

    if (data.success) {
      showToast('success', 'Collection Created', `"${name}" is ready for files.`);
      hideNewCollectionInput();
      await fetchCollections();
    } else {
      throw new Error(data.error || 'Unknown error');
    }
  } catch (error) {
    showToast('error', 'Create Failed', error.message);
  } finally {
    if (input) input.disabled = false;
    if (addBtn) addBtn.disabled = false;
  }
}

// Delete a collection
async function deleteCollection(storeId, displayName) {
  if (!confirm(`Delete collection "${displayName}"?\nThis will remove the collection and all files in it.`)) return;
  
  try {
    const res = await fetch(`/api/collections/${storeId}`, { method: 'DELETE' });
    const data = await res.json();
    
    if (data.success) {
      showToast('success', 'Deleted', `Collection "${displayName}" has been removed.`);
      await fetchCollections();
    } else {
      throw new Error(data.error || 'Unknown error');
    }
  } catch (error) {
    showToast('error', 'Delete Failed', error.message);
  }
}

// Upload a file to a collection
async function uploadFileToCollection(storeId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.json,.html,.xml,.md,.pptx,.rtf,.zip';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Gemini limit: 100MB per document
    if (file.size > 100 * 1024 * 1024) {
      showToast('error', 'File Too Large', 'Maximum file size is 100MB.');
      return;
    }
    
    const loadingToast = showToast('info', 'Uploading...', `Uploading "${file.name}"... This may take a moment while indexing.`, 0);
    
    try {
      // Read file as base64
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
      });
      
      const res = await fetch(`/api/collections/${storeId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          data: base64Data
        })
      });
      
      const data = await res.json();
      
      if (loadingToast) removeToast(loadingToast);
      
      if (data.success) {
        showToast('success', 'File Uploaded', `"${file.name}" has been uploaded and indexed.`);
        await fetchCollections();
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (error) {
      if (loadingToast) removeToast(loadingToast);
      showToast('error', 'Upload Failed', error.message);
    }
  };
  
  input.click();
}

// Render collections as accordion list (matching framework list style)
function renderCollections() {
  const listEl = document.getElementById('collections-list');
  const emptyEl = document.getElementById('collections-empty-state');
  
  if (!listEl) return;
  
  if (collectionsData.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  
  if (emptyEl) emptyEl.style.display = 'none';
  
  let html = '';
  collectionsData.forEach((store, index) => {
    const storeId = store.name.split('/').pop();
    const displayName = store.displayName || `Collection ${index + 1}`;
    const files = store.files || [];
    const fileCount = files.length;
    
    html += `
      <div class="collection-group collapsed" data-store-id="${storeId}">
        <div class="collection-group-header">
          <div class="collection-toggle" onclick="toggleCollectionGroup(this)">
            <svg class="chevron-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="collection-name">${escapeHtml(displayName)}</span>
          </div>
          <div class="collection-actions">
            <span class="collection-count">${fileCount}</span>
            <button type="button" class="btn-collection-upload" onclick="event.stopPropagation(); uploadFileToCollection('${escapeHtml(storeId)}')" title="Upload file">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M12 9V11.5C12 12.1 11.6 12.5 11 12.5H3C2.4 12.5 2 12.1 2 11.5V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M9.5 4.5L7 2L4.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M7 2V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              Upload
            </button>
            <button type="button" class="btn-collection-delete" onclick="event.stopPropagation(); deleteCollection('${escapeHtml(storeId)}', '${escapeHtml(displayName).replace(/'/g, "\\'")}')" title="Delete collection">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 4H11M5 4V3C5 2.4 5.4 2 6 2H8C8.6 2 9 2.4 9 3V4M6 7V10M8 7V10M4 4L5 12H9L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="collection-items">
          ${files.length === 0 ? `
            <div class="collection-empty">
              <span>No files yet — click Upload to add documents.</span>
            </div>
          ` : files.map((file, fIdx) => {
            const fName = file.displayName || file.name || `File ${fIdx + 1}`;
            const fState = file.state || 'ACTIVE';
            return `
              <div class="collection-file-item">
                <svg class="file-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 2H9L13 6V14C13 14.6 12.6 15 12 15H3C2.4 15 2 14.6 2 14V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M9 2V6H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span class="file-name">${escapeHtml(fName)}</span>
                <span class="file-status ${fState === 'ACTIVE' ? 'active' : 'processing'}">${fState === 'ACTIVE' ? 'Indexed' : 'Processing'}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  });
  
  listEl.innerHTML = html;
}

// Toggle collection group expand/collapse
function toggleCollectionGroup(toggleEl) {
  const group = toggleEl.closest('.collection-group');
  if (group) group.classList.toggle('collapsed');
}

// Update collection-related summary counts
function updateCollectionSummary() {
  const totalFiles = collectionsData.reduce((sum, store) => sum + (store.files?.length || 0), 0);
  const totalCollections = collectionsData.length;
  
  const filesCountEl = document.getElementById('files-count');
  const collectionsCountEl = document.getElementById('collections-count');
  const summaryCollectionsEl = document.getElementById('summary-collections-count');
  const summaryFilesEl = document.getElementById('summary-files-count');
  
  if (filesCountEl) filesCountEl.textContent = totalFiles;
  if (collectionsCountEl) collectionsCountEl.textContent = totalCollections;
  if (summaryCollectionsEl) summaryCollectionsEl.textContent = totalCollections;
  if (summaryFilesEl) summaryFilesEl.textContent = totalFiles;
}

// ==========================================
// Event Listeners
// ==========================================

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

// Collection buttons
document.getElementById('btn-new-collection')?.addEventListener('click', createCollection);

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOverlay.classList.contains('active')) {
    closeModal();
  }
});


// ==========================================
// Previous Sessions
// ==========================================

async function fetchPreviousSessions() {
  try {
    const res = await fetch('/api/chat/sessions');
    const data = await res.json();
    if (data.success && data.sessions && data.sessions.length > 0) {
      renderPreviousSessions(data.sessions);
    }
  } catch (e) {
    console.warn('Could not load previous sessions:', e.message);
  }
}

function renderPreviousSessions(sessions) {
  const section = document.getElementById('prev-sessions-section');
  const list = document.getElementById('prev-sessions-list');
  if (!section || !list) return;

  list.innerHTML = '';

  sessions.forEach(function(s) {
    var date = new Date(s.createdAt);
    var dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    var reqItems = (s.requirements || []).slice(0, 3).map(function(r) {
      return '<div class="session-req-item"><span class="session-ref-id">' + (r.refId || '') + '</span><span class="session-req-desc">' + (r.description || '') + '</span></div>';
    }).join('');

    var moreCount = (s.requirements || []).length - 3;
    var moreReqs = moreCount > 0
      ? '<div class="session-req-item"><span class="session-req-desc" style="color:var(--color-text-hint)">+' + moreCount + ' more</span></div>'
      : '';

    var queryPreview = s.query
      ? '<div class="session-query-preview">' + s.query.substring(0, 80) + (s.query.length > 80 ? '...' : '') + '</div>'
      : '';

    var card = document.createElement('div');
    card.className = 'session-card';
    card.onclick = function() { window.location.href = '/chat.html?session=' + s.sessionId; };
    card.innerHTML =
      '<div class="session-card-header">' +
        '<div class="session-card-title">' + (s.requirements && s.requirements[0] ? (s.requirements[0].frameworkName || 'Audit Session') : 'Audit Session') + '</div>' +
        '<div class="session-card-date">' + dateStr + '</div>' +
      '</div>' +
      '<div class="session-card-stats">' +
        '<div class="session-stat"><div class="session-stat-num">' + (s.requirementsCount || 0) + '</div><div class="session-stat-label">Requirements</div></div>' +
        '<div class="session-stat"><div class="session-stat-num">' + (s.filesCount || 0) + '</div><div class="session-stat-label">Files</div></div>' +
        '<div class="session-stat"><div class="session-stat-num">' + (s.messageCount || 0) + '</div><div class="session-stat-label">Messages</div></div>' +
      '</div>' +
      queryPreview +
      '<div class="session-card-reqs">' + reqItems + moreReqs + '</div>';
    list.appendChild(card);
  });

  section.style.display = '';
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  fetchLibraries();
  fetchCollections();
  fetchPreviousSessions();
  updateButtons();
});

// Fetch immediately if DOM already loaded
if (document.readyState !== 'loading') {
  fetchLibraries();
  fetchCollections();
  fetchPreviousSessions();
}

// Make functions globally available for onclick handlers
window.removeSelection = removeSelection;
window.addItem = addItem;
window.editItem = editItem;
window.deleteItem = deleteItem;
window.saveItem = saveItem;
window.renderModalContent = renderModalContent;
window.toggleCollectionGroup = toggleCollectionGroup;
window.uploadFileToCollection = uploadFileToCollection;
window.deleteCollection = deleteCollection;