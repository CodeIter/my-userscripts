// ==UserScript==
// @name         Block setInterval
// @namespace    https://docs.scriptcat.org/
// @version      1.1.1
// @description  Blocks the setInterval function
// @author       CodeIter
// @match        https://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=duck.ai
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // Check if unsafeWindow exists (ScriptCat/Tampermonkey specific)
    const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // Store the original setInterval if you ever need to call it later (optional)
    const originalsetInterval = targetWindow.setInterval;

    // Override setInterval with a blocking function
    targetWindow.setInterval = function() {
        // Option 1: Silently ignore (do nothing)
        // console.warn('setInterval blocked by Userscript');
        
        // Option 2: Throw an error to stop execution
        // throw new Error('setInterval has been blocked by the userscript.');

        // Option 3: Log and return 0 (prevents the timer ID from being valid)
        console.warn('ScriptCat: setInterval blocked');
        return 0;
    };

})();
