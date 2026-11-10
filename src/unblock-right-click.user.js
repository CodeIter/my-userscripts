// ==UserScript==
// @name         Unblock Right-Click
// @namespace    https://docs.scriptcat.org/
// @version      1.1.1
// @description  Re-enable right-click, text selection, and keyboard shortcuts
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=duck.ai
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
  'use strict';

  // Re-enable right-click context menu
  document.addEventListener('contextmenu', function(e) {
    e.stopImmediatePropagation();
    return true;
  }, true);

  // Re-enable text selection
  document.addEventListener('selectstart', function(e) {
    e.stopImmediatePropagation();
    return true;
  }, true);

  document.addEventListener('mousedown', function(e) {
    e.stopImmediatePropagation();
    return true;
  }, true);

  // Remove user-select CSS restrictions
  const style = document.createElement('style');
  style.textContent = `
    * {
      user-select: auto !important;
      -webkit-user-select: auto !important;
      -moz-user-select: auto !important;
      -ms-user-select: auto !important;
    }
  `;
  document.head.appendChild(style);

  // Re-enable common keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    const isCtrlC = (e.ctrlKey || e.metaKey) && e.key === 'c';
    const isCtrlX = (e.ctrlKey || e.metaKey) && e.key === 'x';
    const isCtrlA = (e.ctrlKey || e.metaKey) && e.key === 'a';
    
    if (isCtrlC || isCtrlX || isCtrlA) {
      e.stopImmediatePropagation();
      return true;
    }
  }, true);

})();
