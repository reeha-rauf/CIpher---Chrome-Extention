// Load settings when page loads
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
});

let initialSettings = {}; // Track initial state

// Load saved settings
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get([
      'enabled', 'filters', 'useAI', 'autoScan', 'imageModeration'
    ]);
    
    // Load filter checkboxes
    const filters = result.filters || {
      email: true,
      phone: true,
      ssn: true,
      credit_card: true,
      address: true,
      password: true,
      api_key: true
    };
    
    document.querySelectorAll('[data-type]').forEach(checkbox => {
      const type = checkbox.dataset.type;
      if (type && filters.hasOwnProperty(type)) {
        checkbox.checked = !!filters[type];
      }
    });

  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Check if settings have changed
function hasChanges() {
  const currentFilters = {};
  document.querySelectorAll('[data-type]').forEach(checkbox => {
    const type = checkbox.dataset.type;
    if (type) currentFilters[type] = !!checkbox.checked;
  });
  
  const currentUseAI = document.getElementById('use-ai')?.checked ?? true;
  const currentAutoScan = document.getElementById('auto-scan')?.checked ?? true;
  const currentImageModeration = document.getElementById('image-moderation')?.checked ?? true;

  // Compare filters
  for (const key in initialSettings.filters) {
    if (initialSettings.filters[key] !== currentFilters[key]) return true;
  }

  // Compare advanced settings
  if (initialSettings.useAI !== currentUseAI) return true;
  if (initialSettings.autoScan !== currentAutoScan) return true;
  if (initialSettings.imageModeration !== currentImageModeration) return true;

  return false;
}

// Update save button state
function updateSaveButton() {
  const saveBtn = document.getElementById('save-btn');
  if (!saveBtn) return;

  if (hasChanges()) {
    saveBtn.classList.add('has-changes');
    saveBtn.textContent = 'Save Changes';
  } else {
    saveBtn.classList.remove('has-changes');
    saveBtn.textContent = 'Save Settings';
  }
}

// Save settings
async function saveSettings() {
  try {
    // Get all filter states
    const filters = {};
    document.querySelectorAll('[data-type]').forEach(checkbox => {
      const type = checkbox.dataset.type;
      if (type) filters[type] = !!checkbox.checked;
    });
    
    // Advanced settings
    const useAI = document.getElementById('use-ai')?.checked ?? true;
    const autoScan = document.getElementById('auto-scan')?.checked ?? true;
    const imageModeration = document.getElementById('image-moderation')?.checked ?? true;

    // Save to storage
    await chrome.storage.sync.set({
      filters,
      useAI,
      autoScan,
      imageModeration
    });
    
    // Update initial settings to current state
    initialSettings = {
      filters: {...filters},
      useAI,
      autoScan,
      imageModeration
    };

    // Update button state
    updateSaveButton();
    
    // Show success message
    showSuccessMessage();
    
    // Notify all tabs to reload settings
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'settings_updated' });
      } catch {
        // Tab might not have a content script (ignore)
      }
    }
    
  } catch (error) {
    console.error('Error saving settings:', error);
    alert('Failed to save settings. Please try again.');
  }
}

// Reset to default settings
async function resetSettings() {
  if (!confirm('Are you sure you want to reset all settings to defaults?')) return;
  
  try {
    const defaults = {
      enabled: true,
      filters: {
        email: true,
        phone: true,
        ssn: true,
        credit_card: true,
        address: true,
        password: true,
        api_key: true
      },
      useAI: true,
      autoScan: true,
      imageModeration: true
    };
    
    await chrome.storage.sync.set(defaults);
    // Reload the page to show default values
    window.location.reload();
    
  } catch (error) {
    console.error('Error resetting settings:', error);
    alert('Failed to reset settings. Please try again.');
  }
}

// Show success message
function showSuccessMessage() {
  const message = document.getElementById('success-message');
  if (message) {
    message.style.display = 'block';
    setTimeout(() => { message.style.display = 'none'; }, 3000);
  }
}

// Setup event listeners
function setupEventListeners() {
  // Save button
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) saveBtn.addEventListener('click', saveSettings);
  
  // Reset button
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', resetSettings);
  
  // Listen for changes on all checkboxes
  document.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', updateSaveButton);
  });
}