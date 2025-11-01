// This message shows in the console when the extension wakes up
console.log('Background service worker loaded');

// This runs when you first install the extension or update it
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Extension installed/updated:', details.reason);
  
  // These are the "rules" we want to use when the extension starts
  const defaultSettings = {
    enabled: true,  // Turn on the extension by default
    filters: {
      email: true,        // Blur email addresses
      phone: true,        // Blur phone numbers
      ssn: true,          // Blur social security numbers
      credit_card: true,  // Blur credit card numbers
      address: true,      // Blur home addresses
      password: true,     // Blur passwords
      api_key: true       // Blur secret API keys
    },
    // Blur bad images and special "lens mode"
    imageModeration: true,   // Blur inappropriate images
    lensModeEnabled: false   // Special viewing mode (off by default)
  };
  
  // Put these settings in Chrome's storage box so we remember them
  await chrome.storage.sync.set(defaultSettings);
  console.log('Default settings initialized');
});

// KEYBOARD SHORTCUT LISTENER
chrome.commands.onCommand.addListener(async (command) => {
  // Check if they pressed the "turn blurring on/off" shortcut
  if (command === 'toggle-masking') {
    // Is blurring currently ON or OFF?
    const result = await chrome.storage.sync.get(['enabled']);
    // If it was ON, turn it OFF. If it was OFF, turn it ON.
    const newState = !(result.enabled !== false);
    
    // Save the new ON/OFF state
    await chrome.storage.sync.set({ enabled: newState });
    
    // Send a message to all open web pages
    const tabs = await chrome.tabs.query({});  // Get all open tabs
    for (const tab of tabs) {  // Go through each tab one by one
      try {
        // Send a message saying blurring is now ON/OFF
        await chrome.tabs.sendMessage(tab.id, {
          type: 'toggle',
          enabled: newState
        });
      } catch (error) {
        // Some tabs can't receive messages, skip them
        console.log(`Could not send message to tab ${tab.id}`);
      }
    }
    
    console.log('Masking toggled:', newState);
  }
});

// Listen for messages from content scripts (the pages) and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  // MESSAGE TYPE 1: Private info found.
  if (request.type === 'pii_detected') {
    console.log(`PII detected:`, request.count);
    
    // Show how many things we blurred
    if (sender.tab?.id) {
      chrome.action.setBadgeText({
        tabId: sender.tab.id,
        text: request.count > 0 ? String(request.count) : ''  // Show number or nothing
      });
      // Color the badge green to show it's working
      chrome.action.setBadgeBackgroundColor({
        tabId: sender.tab.id,
        color: '#4CAF50'  // Green color
      });
    }
    sendResponse({ received: true }); 
    return true;
  }

  // MESSAGE TYPE 2: the privacy score for each page
  if (request.type === 'set_privacy_score' && sender.tab?.id) {
    const score = Number(request.score ?? 100);  // Get the score (default 100)
    
    // Put the score on the icon (but only if less than 100)
    chrome.action.setBadgeText({
      tabId: sender.tab.id,
      text: isFinite(score) && score < 100 ? String(Math.max(0, Math.round(score))) : ''
    });
    
    // Green = good, Yellow = okay, Red = bad
    chrome.action.setBadgeBackgroundColor({
      tabId: sender.tab.id,
      color: score >= 80 ? '#22c55e'    // Green: 80-100
           : score >= 50 ? '#eab308'    // Yellow: 50-79
           : '#ef4444'                  // Red: 0-49
    });
    sendResponse({ ok: true });
    return true;
  }

  // MESSAGE TYPE 4: Current settings?
  if (request.type === 'get_settings') {
    chrome.storage.sync.get(null).then(v => sendResponse({ ok: true, settings: v }));
    return true;
  }
  
  // MESSAGE TYPE 5: Save new settings!
  if (request.type === 'set_settings' && request.settings && typeof request.settings === 'object') {
    chrome.storage.sync.set(request.settings).then(() => sendResponse({ ok: true }));
    return true;
  }

  return true;  // Keep the mailbox open for async replies
});

// Background worker is ready and listening
console.log('Background service worker initialized');