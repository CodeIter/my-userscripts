// ==UserScript==
// @name         Block console.clear()
// @namespace    https://docs.scriptcat.org/
// @version      1.1.1
// @description  Blocks console.clear() calls to prevent clearing the console
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=duck.ai
// @run-at       document-start
// ==/UserScript==

(function() {
  'use strict';

  // Override console.clear using unsafeWindow
  const originalClear = unsafeWindow.console.clear;
  
  unsafeWindow.console.clear = function() {
    console.warn('[Block console.clear] Use console.clear() to clear - it has been disabled');
    return undefined;
  };

})();
