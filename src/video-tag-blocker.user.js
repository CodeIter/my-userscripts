// ==UserScript==
// @name         Video tag blocker
// @namespace    https://docs.scriptcat.org/
// @version      1.1.1
// @description  Block video on configured hostname
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=duck.ai
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'videoBlockerBlocklist';

    // Get blocklist from storage
    function getBlocklist() {
        try {
            const blocklist = GM_getValue(STORAGE_KEY, '[]');
            return JSON.parse(blocklist);
        } catch (e) {
            console.error('Error parsing blocklist:', e);
            return [];
        }
    }

    // Save blocklist to storage
    function saveBlocklist(blocklist) {
        try {
            GM_setValue(STORAGE_KEY, JSON.stringify(blocklist));
        } catch (e) {
            console.error('Error saving blocklist:', e);
        }
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
            alert(`✓ Removed "${hostname}" from video blocker`);
        } else {
            // Add to blocklist
            blocklist.push(hostname);
            saveBlocklist(blocklist);
            alert(`✓ Added "${hostname}" to video blocker`);
        }
        location.reload();
    }

    // Block videos on current page
    function blockVideos() {
        const hostname = window.location.hostname;
        const blocklist = getBlocklist();

        if (!blocklist.includes(hostname)) {
            return;
        }

        // Process existing videos
        const blockVideo = (video) => {
            // Mark as blocked
            video.setAttribute('data-videoBlocked', 'true');
            
            // Remove src attribute from video tag
            if (video.src) {
                video.setAttribute('data-originalsrc', video.src);
                video.removeAttribute('src');
            }

            // Remove src from all source child elements
            video.querySelectorAll('source').forEach(source => {
                if (source.src) {
                    source.setAttribute('data-originalsrc', source.src);
                    source.removeAttribute('src');
                }
            });

            // Hide the video element
            video.style.display = 'none';

            // Add a blocked notice
            const notice = document.createElement('div');
            notice.setAttribute('data-videoblocker-notice', 'true');
            notice.style.cssText = `
                background-color: #f0f0f0;
                border: 2px solid #999;
                border-radius: 4px;
                padding: 40px;
                text-align: center;
                color: #666;
                font-size: 14px;
                font-family: Arial, sans-serif;
                cursor: pointer;
                min-height: 240px;
                display: flex;
                align-items: center;
                justify-content: center;
            `;
            notice.innerHTML = '🚫 Video Blocked';
            notice.addEventListener('click', () => {
                // Click to temporarily show video
                if (video.style.display === 'none') {
                    video.style.display = '';
                    notice.style.display = 'none';
                }
            });

            video.parentNode.insertBefore(notice, video);
        };

        document.querySelectorAll('video').forEach(blockVideo);

        // Process dynamically added videos
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // Element node
                        if (node.tagName === 'VIDEO') {
                            blockVideo(node);
                        }
                        // Check descendants
                        node.querySelectorAll?.('video').forEach(blockVideo);
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

    // Block videos on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', blockVideos);
    } else {
        blockVideos();
    }
})();
