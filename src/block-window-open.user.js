// ==UserScript==
// @name         Block window.open
// @namespace    https://docs.scriptcat.org/
// @version      2.1.1
// @description  Blocks all window.open() calls with allowlist management
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=duck.ai
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-start
// ==/UserScript==

(function() {
  'use strict';

  const ALLOWLIST_KEY = 'windowOpenAllowlist';
  const DEFAULT_ALLOWLIST = [];
  
  // Menu command ID storage
  let allowlistMenuId = null;
  
  // Load allowlist from storage
  let allowlist = GM_getValue(ALLOWLIST_KEY, DEFAULT_ALLOWLIST);
  
  // Function to save allowlist to storage
  function saveAllowlist() {
    GM_setValue(ALLOWLIST_KEY, allowlist);
  }
  
  // Function to check if current host is in allowlist
  function isAllowlisted() {
    const currentHost = window.location.hostname;
    return allowlist.some(domain => currentHost.includes(domain));
  }
  
  // Function to toggle current hostname in allowlist
  function toggleCurrentHostnameAllowlist() {
    const currentHost = window.location.hostname;
    const index = allowlist.findIndex(domain => currentHost.includes(domain));
    
    if (index > -1) {
      allowlist.splice(index, 1);
      alert(`✓ ${currentHost} removed from allowlist\n\nAllowlist: ${allowlist.join(', ') || '(empty)'}`);
    } else {
      allowlist.push(currentHost);
      alert(`✓ ${currentHost} added to allowlist\n\nAllowlist: ${allowlist.join(', ')}`);
    }
    
    saveAllowlist();
    updateMenuCommands();
  }
  
  // Function to update menu commands dynamically
  function updateMenuCommands() {
    const currentHost = window.location.hostname;
    const isCurrentAllowlisted = isAllowlisted();
    
    // Unregister old menu command
    if (allowlistMenuId !== null) {
      GM_unregisterMenuCommand(allowlistMenuId);
    }
    
    const allowlistLabel = isCurrentAllowlisted 
      ? `✗ Remove ${currentHost} from allowlist` 
      : `✓ Add ${currentHost} to allowlist`;
    
    // Register new menu command and store its ID
    allowlistMenuId = GM_registerMenuCommand(allowlistLabel, toggleCurrentHostnameAllowlist);
  }
  
  // Register initial menu command
  updateMenuCommands();
  
  // Override window.open using unsafeWindow
  const originalOpen = unsafeWindow.open;
  
  unsafeWindow.open = function(url, target, features) {
    console.log('[Block window.open] Intercepted:', url);
    
    const currentHost = window.location.hostname;
    const isCurrentAllowlisted = isAllowlisted();
    
    // Check allowlist
    if (isCurrentAllowlisted) {
      console.log('[Block window.open] ✓ Allowed (allowlisted):', url);
      return originalOpen(url, target, features);
    }
    
    // Not in allowlist - ask for confirmation
    const str = 'Hostname: ' + currentHost + '\n\nURL: ' + url + '\nTarget: ' + target + '\nFeatures: ' + features;
    const result = confirm(str + '\n\nAllow this popup?');
    
    if (result) {
      console.log('[Block window.open] ✓ User allowed:', url);
      const newWindow = originalOpen(url, target, features);
      if (newWindow) {
        newWindow.focus();
      }
      return newWindow;
    }

    console.warn('[Block window.open] ✗ Blocked:', url);
    return null;
  };

})();
