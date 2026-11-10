// ==UserScript==
// @name         Wayback Machine
// @namespace    https://docs.scriptcat.org/
// @version      1.1.1
// @description  Open current page in Wayback Machine
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=archive.org
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    GM_registerMenuCommand('Open in Wayback Machine', function() {
        const currentUrl = window.location.href;
        const waybookUrl = 'https://web.archive.org/web/*/' + currentUrl;
        window.open(waybookUrl, '_blank');
        //window.location.href = waybookUrl;
    });
})();
