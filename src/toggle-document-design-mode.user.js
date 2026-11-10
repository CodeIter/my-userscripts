// ==UserScript==
// @name         Toggle document.designMode
// @namespace    https://docs.scriptcat.org/
// @version      1.1.1
// @description  Toggle document.designMode to on/off
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=duck.ai
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    function toggleDesignMode() {
        if (document.designMode === 'on') {
            document.designMode = 'off';
            console.log('✓ designMode: OFF');
        } else {
            document.designMode = 'on';
            console.log('✓ designMode: ON');
        }
    }

    GM_registerMenuCommand('Toggle document.designMode', toggleDesignMode);
})();
