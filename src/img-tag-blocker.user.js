// ==UserScript==
// @name         Img tag blocker
// @namespace    https://docs.scriptcat.org/
// @version      1.5.1
// @description  Block img on configured hostname
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=duck.ai
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'imgBlockerBlocklist';
    const PLACEHOLDER_URL = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="240"%3E%3Crect fill="%23ddd" width="320" height="240"/%3E%3Ctext x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23999" font-size="16"%3EImage Blocked%3C/text%3E%3C/svg%3E';

    // Get blocklist from storage
    function getBlocklist() {
        const blocklist = GM_getValue(STORAGE_KEY, '[]');
        return JSON.parse(blocklist);
    }

    // Save blocklist to storage
    function saveBlocklist(blocklist) {
        GM_setValue(STORAGE_KEY, JSON.stringify(blocklist));
    }

    // Check if hostname is blocked
    function isHostnameBlocked(hostname) {
        return getBlocklist().includes(hostname);
    }

    // Toggle hostname block status
    function toggleHostname() {
        const hostname = window.location.hostname;
        const blocklist = getBlocklist();
        const isBlocked = blocklist.includes(hostname);

        if (isBlocked) {
            // Remove from blocklist
            blocklist.splice(blocklist.indexOf(hostname), 1);
            saveBlocklist(blocklist);
            alert(`✓ Removed "${hostname}" from image blocker`);
        } else {
            // Add to blocklist
            blocklist.push(hostname);
            saveBlocklist(blocklist);
            alert(`✓ Added "${hostname}" to image blocker`);
        }
        location.reload();
    }

    // Block images on current page
    function blockImages() {
        const hostname = window.location.hostname;
        const blocklist = getBlocklist();
        
        if (!blocklist.includes(hostname)) {
            return;
        }

        // Process existing images
        const replaceImage = (img) => {
            if (img.src && !img.hasAttribute('data-originalsrc')) {
                img.setAttribute('data-originalsrc', img.src);
                img.src = PLACEHOLDER_URL;
            }
        };

        document.querySelectorAll('img').forEach(replaceImage);

        // Process dynamically added images
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // Element node
                        if (node.tagName === 'IMG') {
                            replaceImage(node);
                        }
                        // Check descendants
                        node.querySelectorAll?.('img').forEach(replaceImage);
                    }
                });
            });
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    const hostname = window.location.hostname;
    const isBlocked = isHostnameBlocked(hostname);
    const menuLabel = isBlocked 
        ? `✗ Remove ${hostname} from blocklist` 
        : `✓ Add ${hostname} to blocklist`;

    // Register menu command
    GM_registerMenuCommand(menuLabel, toggleHostname);

    // Block images on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', blockImages);
    } else {
        blockImages();
    }
})();
