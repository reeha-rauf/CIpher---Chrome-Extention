// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const CONSTANTS = {
  REFRESH_INTERVAL: 5000,
  STATUS_UPDATE_DELAY: 500,
  RESCAN_DELAY: 1000,
  ERROR_DISPLAY_DURATION: 5000,
  
  RESTRICTED_URL_PREFIXES: [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:'
  ],
  
  DEFAULT_FILTERS: {
    email: true,
    phone: true,
    ssn: true,
    credit_card: true,
    address: true,
    password: true,
    api_key: true
  },
  
  PII_ICONS: {
    email: '@',
    phone: '#',
    ssn: 'ID',
    credit_card: '$',
    address: 'PIN',
    password: '***',
    api_key: 'KEY'
  },
  
  SCORE_THRESHOLDS: {
    SAFE: { min: 80, bgColor: '#2c5aa0', color: '#2c5aa0', textColor: '#ffffff', label: 'SAFE' },
    MODERATE: { min: 50, bgColor: '#1e3a5f', color: '#1e3a5f', textColor: '#ffffff', label: 'MODERATE' },
    HIGH_RISK: { min: 0, bgColor: '#4A4B2F', color: '#4A4B2F', textColor: '#D4DF9E', label: 'HIGH RISK' }
  }
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let refreshInterval = null;
const elementCache = new Map();

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Cached DOM element retrieval
 * @param {string} id - Element ID
 * @returns {HTMLElement|null}
 */
function getElement(id) {
  if (!elementCache.has(id)) {
    elementCache.set(id, document.getElementById(id));
  }
  return elementCache.get(id);
}

/**
 * Toggle element class
 * @param {HTMLElement} element - Target element
 * @param {string} className - Class to toggle
 * @param {boolean} condition - Add if true, remove if false
 */
function toggleClass(element, className, condition) {
  if (!element) return;
  element.classList.toggle(className, condition);
}

/**
 * Check if URL is restricted
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function isRestrictedUrl(url) {
  return url && CONSTANTS.RESTRICTED_URL_PREFIXES.some(prefix => url.startsWith(prefix));
}

/**
 * Get active tab safely
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ? tab : null;
  } catch (error) {
    console.error('Error getting active tab:', error);
    return null;
  }
}

/**
 * Send message to tab with error handling
 * @param {number} tabId - Tab ID
 * @param {object} message - Message to send
 * @returns {Promise<any>}
 */
async function sendMessageToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.debug('Content script not available:', error.message);
    return null;
  }
}

/**
 * Get score configuration based on score value
 * @param {number} score - Privacy score
 * @returns {object}
 */
function getScoreConfig(score) {
  if (score >= CONSTANTS.SCORE_THRESHOLDS.SAFE.min) {
    return CONSTANTS.SCORE_THRESHOLDS.SAFE;
  } else if (score >= CONSTANTS.SCORE_THRESHOLDS.MODERATE.min) {
    return CONSTANTS.SCORE_THRESHOLDS.MODERATE;
  }
  return CONSTANTS.SCORE_THRESHOLDS.HIGH_RISK;
}

/**
 * Pluralize text based on count
 * @param {number} count - Count value
 * @param {string} singular - Singular form
 * @param {string} plural - Plural form
 * @returns {string}
 */
function pluralize(count, singular, plural) {
  return count === 1 ? singular : plural;
}

/**
 * Sanitize HTML content
 * @param {string} html - HTML string
 * @returns {string}
 */
function sanitizeHtml(html) {
  const div = document.createElement('div');
  div.textContent = html;
  return div.innerHTML;
}

// ============================================================================
// STORAGE OPERATIONS
// ============================================================================

/**
 * Load saved settings from storage
 * @returns {Promise<void>}
 */
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get(['enabled', 'filters']);
    
    // Update main toggle state
    const mainToggle = getElement('main-toggle');
    const enabled = result.enabled !== false; // Default to true
    toggleClass(mainToggle, 'active', enabled);
    
    // Update filter toggle states
    const filters = result.filters || CONSTANTS.DEFAULT_FILTERS;
    document.querySelectorAll('.filter-toggle').forEach(toggle => {
      const type = toggle.dataset.type;
      if (type && Object.prototype.hasOwnProperty.call(filters, type)) {
        toggleClass(toggle, 'active', filters[type]);
      }
    });
  } catch (error) {
    console.error('Error loading settings:', error);
    showError('Failed to load settings');
  }
}

/**
 * Save settings to storage
 * @param {object} settings - Settings to save
 * @returns {Promise<void>}
 */
async function saveSettings(settings) {
  try {
    await chrome.storage.sync.set(settings);
  } catch (error) {
    console.error('Error saving settings:', error);
    throw error;
  }
}

// ============================================================================
// UI UPDATE FUNCTIONS
// ============================================================================

/**
 * Update status display element
 * @param {string} text - Status text
 * @param {string} className - Status class
 */
function updateStatusDisplay(text, className) {
  const statusElement = getElement('status');
  if (statusElement) {
    statusElement.textContent = text;
    statusElement.className = `status ${className}`;
  }
}

/**
 * Update status from tab response
 * @param {object|null} response - Response from content script
 */
function updateStatusFromResponse(response) {
  if (!response) {
    updateStatusDisplay('UNAVAILABLE', 'disabled');
    updatePIICount(0);
    updatePrivacyScore(100, {});
    return;
  }
  
  updatePIICount(response.maskedCount || 0);
  updatePrivacyScore(response.privacyScore || 100, response.piiCounts || {});
  
  if (response.initialized && response.enabled) {
    updateStatusDisplay('ACTIVE', 'active');
  } else if (response.initialized && !response.enabled) {
    updateStatusDisplay('DISABLED', 'disabled');
  } else {
    updateStatusDisplay('LOADING', 'initializing');
  }
}

/**
 * Update status display (main function)
 * @returns {Promise<void>}
 */
async function updateStatus() {
  try {
    const tab = await getActiveTab();
    
    if (!tab) {
      showError('No active tab found');
      return;
    }
    
    // Handle restricted URLs
    if (isRestrictedUrl(tab.url)) {
      updateStatusDisplay('RESTRICTED', 'disabled');
      updatePIICount(0);
      updatePrivacyScore(100, {});
      return;
    }
    
    // Query content script for status
    const response = await sendMessageToTab(tab.id, { type: 'get_status' });
    updateStatusFromResponse(response);
    
  } catch (error) {
    console.error('Error updating status:', error);
  }
}

/**
 * Update PII count display
 * @param {number} count - Number of PII items detected
 */
function updatePIICount(count) {
  const countElement = getElement('pii-count');
  if (!countElement) return;
  
  const threatText = pluralize(count, '1 threat detected', `${count} threats detected`);
  countElement.textContent = count === 0 ? 'No threats detected' : threatText;
}

/**
 * Update privacy score display
 * @param {number} score - Privacy score (0-100)
 * @param {object} piiCounts - Breakdown of PII types
 */
function updatePrivacyScore(score, piiCounts) {
  const scoreCircle = getElement('score-circle');
  const scoreLabel = getElement('score-label');
  
  if (!scoreCircle || !scoreLabel) return;
  
  // Update score number
  const numberElement = scoreCircle.querySelector('.score-number');
  if (numberElement) {
    numberElement.textContent = score;
  }
  
  // Apply score-based styling
  const config = getScoreConfig(score);
  scoreCircle.style.background = config.bgColor;
  scoreCircle.style.borderColor = config.bgColor;
  
  // Update text colors
  const maxElement = scoreCircle.querySelector('.score-max');
  if (numberElement) numberElement.style.color = config.textColor;
  if (maxElement) maxElement.style.color = config.textColor;
  
  scoreLabel.style.color = config.color;
  scoreLabel.textContent = config.label;
  
  // Update PII breakdown pills
  updatePIIPills(piiCounts);
}

/**
 * Update PII breakdown pills
 * @param {object} piiCounts - PII type counts
 */
function updatePIIPills(piiCounts) {
  const piiPills = getElement('pii-pills');
  if (!piiPills || !piiCounts) return;
  
  const counts = Object.entries(piiCounts).filter(([, count]) => count > 0);
  
  if (counts.length === 0) {
    piiPills.style.display = 'none';
    return;
  }
  
  piiPills.style.display = 'flex';
  piiPills.innerHTML = counts
    .map(([type, count]) => createPIIPill(type, count))
    .join('');
}

/**
 * Create PII pill HTML
 * @param {string} type - PII type
 * @param {number} count - Count
 * @returns {string}
 */
function createPIIPill(type, count) {
  const icon = CONSTANTS.PII_ICONS[type] || '•';
  const label = type.replace(/_/g, ' ');
  
  return `
    <div class="pii-pill">
      <span style="font-weight: 700; color: #3b82f6;">${sanitizeHtml(icon)}</span>
      <span class="pii-pill-count">${sanitizeHtml(String(count))}</span>
      <span>${sanitizeHtml(label)}</span>
    </div>
  `;
}

/**
 * Show error message
 * @param {string} message - Error message
 */
function showError(message) {
  const errorElement = getElement('error-message');
  if (!errorElement) return;
  
  errorElement.textContent = message;
  errorElement.style.display = 'block';
  
  setTimeout(() => {
    errorElement.style.display = 'none';
  }, CONSTANTS.ERROR_DISPLAY_DURATION);
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle main toggle click
 * @param {HTMLElement} toggle - Toggle element
 * @returns {Promise<void>}
 */
async function handleMainToggle(toggle) {
  const newState = !toggle.classList.contains('active');
  toggleClass(toggle, 'active', newState);
  
  try {
    await saveSettings({ enabled: newState });
    
    const tab = await getActiveTab();
    if (tab) {
      await sendMessageToTab(tab.id, {
        type: 'toggle',
        enabled: newState
      });
      
      setTimeout(updateStatus, CONSTANTS.STATUS_UPDATE_DELAY);
    }
  } catch (error) {
    console.error('Error toggling extension:', error);
    toggleClass(toggle, 'active', !newState); // Revert on error
    showError('Failed to toggle extension');
  }
}

/**
 * Handle filter toggle click
 * @param {HTMLElement} toggle - Toggle element
 * @returns {Promise<void>}
 */
async function handleFilterToggle(toggle) {
  const type = toggle.dataset.type;
  if (!type) return;
  
  const newState = !toggle.classList.contains('active');
  toggleClass(toggle, 'active', newState);
  
  try {
    const result = await chrome.storage.sync.get(['filters']);
    const filters = result.filters || {};
    filters[type] = newState;
    
    await saveSettings({ filters });
    
    const tab = await getActiveTab();
    if (tab) {
      await sendMessageToTab(tab.id, {
        type: 'filter_change',
        piiType: type,
        enabled: newState
      });
      
      await sendMessageToTab(tab.id, { type: 'rescan' });
    }
  } catch (error) {
    console.error('Error updating filter:', error);
    toggleClass(toggle, 'active', !newState); // Revert on error
    showError('Failed to update filter');
  }
}

/**
 * Handle rescan button click
 * @param {HTMLElement} button - Rescan button
 * @returns {Promise<void>}
 */
async function handleRescan(button) {
  const originalHTML = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span>⏳</span><span>Scanning...</span>';
  
  try {
    const tab = await getActiveTab();
    if (tab) {
      await sendMessageToTab(tab.id, { type: 'rescan' });
      
      setTimeout(async () => {
        await updateStatus();
        button.disabled = false;
        button.innerHTML = originalHTML;
      }, CONSTANTS.RESCAN_DELAY);
    } else {
      button.disabled = false;
      button.innerHTML = originalHTML;
    }
  } catch (error) {
    console.error('Error rescanning:', error);
    button.disabled = false;
    button.innerHTML = originalHTML;
    showError('Failed to rescan page');
  }
}

// ============================================================================
// EVENT LISTENER SETUP
// ============================================================================

/**
 * Setup all event listeners
 */
function setupEventListeners() {
  // Main toggle
  const mainToggle = getElement('main-toggle');
  if (mainToggle) {
    mainToggle.addEventListener('click', () => handleMainToggle(mainToggle));
  }
  
  // Filter toggles
  document.querySelectorAll('.filter-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => handleFilterToggle(toggle));
  });
  
  // Rescan button
  const rescanButton = getElement('rescan-btn');
  if (rescanButton) {
    rescanButton.addEventListener('click', () => handleRescan(rescanButton));
  }
  
  // Settings button
  const settingsButton = getElement('settings-btn');
  if (settingsButton) {
    settingsButton.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }
  
  // Refresh status button
  const refreshButton = getElement('refresh-status-btn');
  if (refreshButton) {
    refreshButton.addEventListener('click', (e) => {
      e.preventDefault();
      updateStatus();
    });
  }
}

/**
 * Handle messages from content script
 * @param {object} request - Message request
 * @param {object} sender - Message sender
 * @param {function} sendResponse - Response callback
 */
function handleMessage(request, sender, sendResponse) {
  if (request.type === 'pii_count') {
    updatePIICount(request.count);
    if (request.privacyScore !== undefined) {
      updatePrivacyScore(request.privacyScore, request.piiCounts || {});
    }
  } else if (request.type === 'status_update') {
    updateStatus();
  }
  
  sendResponse({ received: true });
}

// ============================================================================
// LIFECYCLE MANAGEMENT
// ============================================================================

/**
 * Start periodic status refresh
 */
function startRefreshInterval() {
  // Clear any existing interval
  stopRefreshInterval();
  
  refreshInterval = setInterval(updateStatus, CONSTANTS.REFRESH_INTERVAL);
}

/**
 * Stop periodic status refresh
 */
function stopRefreshInterval() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

/**
 * Initialize popup
 * @returns {Promise<void>}
 */
async function initializePopup() {
  try {
    await loadSettings();
    await updateStatus();
    setupEventListeners();
    startRefreshInterval();
  } catch (error) {
    console.error('Error initializing popup:', error);
    showError('Failed to initialize extension');
  }
}

/**
 * Cleanup on popup close
 */
function cleanup() {
  stopRefreshInterval();
  elementCache.clear();
}

// ============================================================================
// INITIALIZATION
// ============================================================================

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initializePopup);

// Cleanup on unload
window.addEventListener('unload', cleanup);

// Listen for messages from content script
chrome.runtime.onMessage.addListener(handleMessage);
