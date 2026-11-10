// ==UserScript==
// @name         Broken link detector
// @namespace    https://docs.scriptcat.org/
// @version      1.1.2
// @description  Detect broken/live link on the web
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    /**
     * Top-level configuration object for tweaking script behavior,
     * styling, timeouts, and link filtering rules.
     */
    const CONFIG = {
        // Visual Styling Config
        EMOJI_SIZE: '18px',               // Configurable font size for the emoji indicators
        LIVE_EMOJI: '🔗',                 // Emoji displayed when a link is live
        BROKEN_EMOJI: '⛓️‍💥❌',             // Emoji displayed when a link is broken
        LIVE_TITLE: 'Live link',           // Tooltip title for live links
        BROKEN_TITLE: 'Broken link',       // Tooltip title for broken links
        
        // Request & Performance Config
        CHECK_TIMEOUT_MS: 5000,           // Request timeout in milliseconds
        CONCURRENCY_LIMIT: 5,             // Max simultaneous background requests
        
        // Ignore Rules
        IGNORE_SCHEMES: ['javascript:', 'mailto:', 'tel:', 'data:', 'vbscript:'], // Non-HTTP schemes to skip
        IGNORE_HASH_ONLY: true,           // Skip anchor links that only point to '#...'
        
        // Mutation Observer
        ENABLE_DYNAMIC_CHECK: true        // Continuously check newly added dynamic elements (SPAs)
    };

    /**
     * Set of processed links to prevent redundant network checks
     * @type {Set<string>}
     */
    const processedLinksCache = new Map();

    /**
     * Safely constructs an emoji DOM container element without using innerHTML.
     * 
     * @param {boolean} isLive - True if the link is live, false if broken.
     * @returns {HTMLSpanElement} - Formatted span containing the status emoji.
     */
    function createStatusBadge(isLive) {
        // Create span container
        const span = document.createElement('span');
        span.className = 'bld-status-badge';
        
        // Set accessibility and mouseover title attributes
        span.setAttribute('title', isLive ? CONFIG.LIVE_TITLE : CONFIG.BROKEN_TITLE);
        
        // Inline styles for display and configuration
        span.style.fontSize = CONFIG.EMOJI_SIZE;
        span.style.marginLeft = '4px';
        span.style.display = 'inline-block';
        span.style.lineHeight = '1';
        span.style.verticalAlign = 'middle';
        span.style.userSelect = 'none';
        
        // Use document.createTextNode to avoid any innerHTML usage
        const emojiTextNode = document.createTextNode(isLive ? CONFIG.LIVE_EMOJI : CONFIG.BROKEN_EMOJI);
        span.appendChild(emojiTextNode);
        
        return span;
    }

    /**
     * Validates whether a URL is valid and eligible for network checks.
     * 
     * @param {string} href - Raw href attribute value.
     * @returns {boolean} - True if eligible for testing.
     */
    function isCheckableUrl(href) {
        if (!href || href.trim() === '') return false;
        
        const lowerHref = href.trim().toLowerCase();
        
        // Skip ignored protocols/schemes
        for (const scheme of CONFIG.IGNORE_SCHEMES) {
            if (lowerHref.startsWith(scheme)) return false;
        }
        
        // Skip purely hash-based links on current page if configured
        if (CONFIG.IGNORE_HASH_ONLY && href.startsWith('#')) {
            return false;
        }

        return true;
    }

    /**
     * Tests whether a link is live or broken using network fetch.
     * Falls back gracefully if HEAD is rejected by the target server.
     * 
     * @param {string} url - Resolved target URL to test.
     * @returns {Promise<boolean>} - Resolves true if live, false if broken.
     */
    async function checkLinkStatus(url) {
        // Return cached result if this exact URL was already verified
        if (processedLinksCache.has(url)) {
            return processedLinksCache.get(url);
        }

        // Helper wrapper around GM_xmlhttpRequest to bypass CSP/CORS constraints
        const requestWithTimeout = (method) => {
            return new Promise((resolve) => {
                let isFinished = false;

                const timer = setTimeout(() => {
                    if (!isFinished) {
                        isFinished = true;
                        resolve(false);
                    }
                }, CONFIG.CHECK_TIMEOUT_MS);

                GM_xmlhttpRequest({
                    method: method,
                    url: url,
                    timeout: CONFIG.CHECK_TIMEOUT_MS,
                    onload: (response) => {
                        if (isFinished) return;
                        clearTimeout(timer);
                        isFinished = true;
                        
                        // Status codes 200 through 399 indicate a live, accessible resource
                        if (response.status >= 200 && response.status < 400) {
                            resolve(true);
                        } else {
                            resolve(false);
                        }
                    },
                    onerror: () => {
                        if (isFinished) return;
                        clearTimeout(timer);
                        isFinished = true;
                        resolve(false);
                    },
                    ontimeout: () => {
                        if (isFinished) return;
                        clearTimeout(timer);
                        isFinished = true;
                        resolve(false);
                    }
                });
            });
        };

        // Attempt lightweight HEAD request first
        let isLive = await requestWithTimeout('HEAD');

        // Fallback to GET request if HEAD fails (some servers return 405 Method Not Allowed for HEAD)
        if (!isLive) {
            isLive = await requestWithTimeout('GET');
        }

        // Cache the result for future identical links
        processedLinksCache.set(url, isLive);
        return isLive;
    }

    /**
     * Queue and active counter to throttle network traffic
     */
    const queue = [];
    let activeWorkers = 0;

    /**
     * Processes task queue sequentially up to CONCURRENCY_LIMIT.
     */
    function processQueue() {
        while (activeWorkers < CONFIG.CONCURRENCY_LIMIT && queue.length > 0) {
            const task = queue.shift();
            activeWorkers++;

            task().finally(() => {
                activeWorkers--;
                processQueue();
            });
        }
    }

    /**
     * Enqueues an anchor element for link status checking.
     * 
     * @param {HTMLAnchorElement} anchorElement 
     */
    function enqueueAnchorCheck(anchorElement) {
        // Avoid duplicate evaluation on the same DOM element
        if (anchorElement.dataset.bldProcessed === 'true') return;
        
        const rawHref = anchorElement.getAttribute('href');
        if (!isCheckableUrl(rawHref)) return;

        // Mark as queued/processed on the DOM node
        anchorElement.dataset.bldProcessed = 'true';

        queue.push(async () => {
            try {
                const absoluteUrl = anchorElement.href;
                const isLive = await checkLinkStatus(absoluteUrl);
                
                // Build badge element using standard DOM methods
                const badgeElement = createStatusBadge(isLive);
                
                // Append directly to the anchor node without innerHTML
                anchorElement.appendChild(badgeElement);
            } catch (err) {
                console.error('[BrokenLinkDetector] Error checking anchor:', anchorElement, err);
            }
        });

        processQueue();
    }

    /**
     * Scans the document for all unverified anchor tags.
     * 
     * @param {ParentNode} rootNode - Root element to query anchors from.
     */
    function scanAndVerifyLinks(rootNode = document) {
        const anchors = rootNode.querySelectorAll('a[href]');
        for (let i = 0; i < anchors.length; i++) {
            enqueueAnchorCheck(anchors[i]);
        }
    }

    /**
     * Initializes MutationObserver to catch dynamically added links (Single Page Apps).
     */
    function observeDynamicContent() {
        if (!CONFIG.ENABLE_DYNAMIC_CHECK || !document.body) return;

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.tagName === 'A' && node.hasAttribute('href')) {
                            enqueueAnchorCheck(node);
                        } else {
                            scanAndVerifyLinks(node);
                        }
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Application entrypoint
     */
    function init() {
        // Execute initial scan
        scanAndVerifyLinks(document);

        // Enable observer for client-rendered dynamic links
        observeDynamicContent();
    }

    // Start script when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();