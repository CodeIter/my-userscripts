// ==UserScript==
// @name         HTML Element Blocker
// @namespace    https://docs.scriptcat.org/
// @version      1.5.1
// @description  Manually Block Html elements that pass your ads blocker
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================================
    // CONFIGURATION & CONSTANTS
    // Easily configure script behavior and styling variables here.
    // =========================================================================
    const CONFIG = {
        STORAGE_KEY: 'element_blocker_blocklist_v1', // Key used in GM settings
        REMOVE_MODE: 'both',                        // 'style' (hide with CSS), 'dom' (remove nodes), or 'both'
        STYLE_ELEMENT_ID: 'html-element-blocker-style',
        SHADOW_CONTAINER_ID: 'html-element-blocker-modal-root',
        PICKER_OVERLAY_ID: 'html-element-blocker-picker-overlay',
        HIGHLIGHT_BORDER_COLOR: '#f43f5e',
        HIGHLIGHT_BG_COLOR: 'rgba(244, 63, 94, 0.15)',
        DEBOUNCE_DELAY_MS: 150,
        DEFAULT_BLOCKLIST: {
            // Preset rules format: "hostname": ["selector1", "selector2"]
            // "example.com": [".ad-banner", "#popup-modal"]
        }
    };

    // =========================================================================
    // STORAGE ADAPTER & CROSS-TAB SYNCHRONIZATION
    // Provides fallback support for GM API and native localStorage + events
    // =========================================================================
    const StorageAdapter = {
        getValue: function(key, defaultValue) {
            try {
                if (typeof GM_getValue === 'function') {
                    const val = GM_getValue(key, null);
                    return val !== null ? JSON.parse(val) : defaultValue;
                } else if (window.localStorage) {
                    const val = localStorage.getItem(key);
                    return val ? JSON.parse(val) : defaultValue;
                }
            } catch (e) {
                console.error('[Element Blocker] Storage read error:', e);
            }
            return defaultValue;
        },

        setValue: function(key, value) {
            try {
                const serialized = JSON.stringify(value);
                if (typeof GM_setValue === 'function') {
                    GM_setValue(key, serialized);
                } else if (window.localStorage) {
                    localStorage.setItem(key, serialized);
                }
                // Dispatch window event for local tab fallback sync
                window.dispatchEvent(new CustomEvent('eb_storage_update', { detail: { key, value } }));
            } catch (e) {
                console.error('[Element Blocker] Storage write error:', e);
            }
        },

        onChangeListener: function(callback) {
            // Use GM_addValueChangeListener if available
            if (typeof GM_addValueChangeListener === 'function') {
                GM_addValueChangeListener(CONFIG.STORAGE_KEY, (name, oldValue, newValue, remote) => {
                    try {
                        const parsed = newValue ? JSON.parse(newValue) : {};
                        callback(parsed, remote);
                    } catch (e) {
                        console.error('[Element Blocker] Sync parse error:', e);
                    }
                });
            }

            // Storage event fallback for cross-tab sync when GM listener is unavailable
            window.addEventListener('storage', (e) => {
                if (e.key === CONFIG.STORAGE_KEY && e.newValue) {
                    try {
                        callback(JSON.parse(e.newValue), true);
                    } catch (err) {}
                }
            });

            // Local window event listener
            window.addEventListener('eb_storage_update', (e) => {
                if (e.detail && e.detail.key === CONFIG.STORAGE_KEY) {
                    callback(e.detail.value, false);
                }
            });
        }
    };

    // =========================================================================
    // STATE MANAGEMENT
    // =========================================================================
    let blocklist = StorageAdapter.getValue(CONFIG.STORAGE_KEY, CONFIG.DEFAULT_BLOCKLIST);

    /**
     * Retrieves array of selectors for a specific hostname.
     */
    function getSelectorsForHostname(host) {
        const currentHost = host || window.location.hostname;
        let selectors = [];

        // Exact match
        if (blocklist[currentHost] && Array.isArray(blocklist[currentHost])) {
            selectors = selectors.concat(blocklist[currentHost]);
        }

        // Wildcard or domain wildcard match (e.g. *.example.com or global '*')
        Object.keys(blocklist).forEach(domain => {
            if (domain === '*') {
                selectors = selectors.concat(blocklist[domain]);
            } else if (domain.startsWith('*.') && currentHost.endsWith(domain.slice(2))) {
                selectors = selectors.concat(blocklist[domain]);
            }
        });

        // Remove duplicates
        return [...new Set(selectors)].filter(s => s && s.trim().length > 0);
    }

    /**
     * Adds a new CSS selector rule for a given hostname.
     */
    function addRule(hostname, selector) {
        const host = (hostname || window.location.hostname).trim().toLowerCase();
        const sel = selector.trim();

        if (!host || !sel) return false;

        if (!blocklist[host]) {
            blocklist[host] = [];
        }

        if (!blocklist[host].includes(sel)) {
            blocklist[host].push(sel);
            StorageAdapter.setValue(CONFIG.STORAGE_KEY, blocklist);
            return true;
        }
        return false;
    }

    /**
     * Removes a rule for a given hostname and selector.
     */
    function removeRule(hostname, selector) {
        const host = hostname.trim().toLowerCase();
        if (blocklist[host]) {
            blocklist[host] = blocklist[host].filter(s => s !== selector);
            if (blocklist[host].length === 0) {
                delete blocklist[host];
            }
            StorageAdapter.setValue(CONFIG.STORAGE_KEY, blocklist);
            return true;
        }
        return false;
    }

    /**
     * Exports the current blocklist object to a JSON file download.
     */
    function exportBlocklistJSON() {
        try {
            const dataStr = JSON.stringify(blocklist, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `element-blocker-rules-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('[Element Blocker] Export error:', err);
        }
    }

    /**
     * Reads a JSON file and imports blocklist rules, skipping existing duplicate entries.
     */
    function importBlocklistJSON(file, callback) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                if (importedData && typeof importedData === 'object' && !Array.isArray(importedData)) {
                    Object.keys(importedData).forEach(host => {
                        const selectors = importedData[host];
                        if (Array.isArray(selectors)) {
                            selectors.forEach(sel => {
                                if (typeof sel === 'string' && sel.trim().length > 0) {
                                    addRule(host, sel);
                                }
                            });
                        }
                    });
                    executeBlocking();
                    if (callback) callback();
                }
            } catch (err) {
                console.error('[Element Blocker] Import JSON parse error:', err);
            }
        };
        reader.readAsText(file);
    }

    // =========================================================================
    // BLOCKING ENGINE (CSS Injection + DOM Removal)
    // =========================================================================
    let styleTag = null;
    let globalStyleSheet = null;
    let mutationObserver = null;

    /**
     * Injects custom CSS rules using Constructible Stylesheets to comply with strict CSP (style-src / default-src).
     */
    function applyCSSRules() {
        const selectors = getSelectorsForHostname(window.location.hostname);
        const cssString = selectors.length === 0 ? '' : 
            selectors.map(s => `${s}`).join(',\n') + 
            ` {\n  display: none !important;\n  visibility: hidden !important;\n  opacity: 0 !important;\n  pointer-events: none !important;\n}`;

        if (typeof CSSStyleSheet === 'function' && document.adoptedStyleSheets) {
            if (!globalStyleSheet) {
                globalStyleSheet = new CSSStyleSheet();
                document.adoptedStyleSheets = [...document.adoptedStyleSheets, globalStyleSheet];
            }
            try {
                globalStyleSheet.replaceSync(cssString);
            } catch (err) {
                console.error('[Element Blocker] Stylesheet replaceSync error:', err);
            }
        } else {
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = CONFIG.STYLE_ELEMENT_ID;
                (document.head || document.documentElement).appendChild(styleTag);
            }
            styleTag.textContent = cssString;
        }
    }

    /**
     * Removes elements directly from the DOM tree if configured.
     */
    function removeDOMNodes() {
        if (CONFIG.REMOVE_MODE === 'style') return;

        const selectors = getSelectorsForHostname(window.location.hostname);
        selectors.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    // Prevent removing userscript modal components
                    if (!el.closest(`#${CONFIG.SHADOW_CONTAINER_ID}`) && !el.closest(`#${CONFIG.PICKER_OVERLAY_ID}`)) {
                        el.remove();
                    }
                });
            } catch (err) {
                // Ignore invalid CSS selector query errors
            }
        });
    }

    /**
     * Executes blocking logic and sets up observer for dynamic SPA nodes.
     */
    function executeBlocking() {
        applyCSSRules();
        removeDOMNodes();
    }

    /**
     * Initializes MutationObserver to watch for newly added elements in real-time.
     */
    function setupMutationObserver() {
        if (mutationObserver) return;

        let debounceTimer;
        mutationObserver = new MutationObserver((mutations) => {
            let shouldProcess = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    shouldProcess = true;
                    break;
                }
            }
            if (shouldProcess) {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    removeDOMNodes();
                }, CONFIG.DEBOUNCE_DELAY_MS);
            }
        });

        mutationObserver.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true
        });
    }

    // =========================================================================
    // CSS SELECTOR GENERATOR
    // Generates precise, unique CSS selector for any clicked HTML element
    // =========================================================================
    function generateCSSSelector(el) {
        if (!(el instanceof Element)) return '';

        // 1. Check ID
        if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
            return `#${CSS.escape(el.id)}`;
        }

        // 2. Check unique classes
        if (el.classList && el.classList.length > 0) {
            const classes = Array.from(el.classList)
                .filter(c => !c.startsWith('eb-') && c.length < 50) // Filter framework noise
                .map(c => `.${CSS.escape(c)}`)
                .join('');
            
            if (classes && document.querySelectorAll(classes).length === 1) {
                return classes;
            }
        }

        // 3. Build path selector
        const path = [];
        let current = el;

        while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName !== 'BODY' && current.tagName !== 'HTML') {
            let selector = current.tagName.toLowerCase();

            if (current.id) {
                selector += `#${CSS.escape(current.id)}`;
                path.unshift(selector);
                break; // ID provides unique root anchor
            } else {
                let parent = current.parentElement;
                if (parent) {
                    let siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
                    if (siblings.length > 1) {
                        let index = siblings.indexOf(current) + 1;
                        selector += `:nth-of-type(${index})`;
                    }
                }
            }

            path.unshift(selector);
            current = current.parentElement;
        }

        return path.join(' > ');
    }

    // =========================================================================
    // VISUAL ELEMENT PICKER
    // Allows user to click any element on page to pick and block it
    // =========================================================================
    let isPickerActive = false;
    let hoverOverlay = null;

    function activateElementPicker() {
        if (isPickerActive) return;
        isPickerActive = true;

        // Create highlight overlay element
        hoverOverlay = document.createElement('div');
        hoverOverlay.id = CONFIG.PICKER_OVERLAY_ID;
        Object.assign(hoverOverlay.style, {
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: '2147483646',
            border: `2px dashed ${CONFIG.HIGHLIGHT_BORDER_COLOR}`,
            backgroundColor: CONFIG.HIGHLIGHT_BG_COLOR,
            transition: 'all 0.05s ease-out',
            boxSizing: 'border-box',
            display: 'none'
        });

        // Floating badge for selector preview
        const badge = document.createElement('div');
        badge.id = 'eb-picker-badge';
        Object.assign(badge.style, {
            position: 'absolute',
            top: '-26px',
            left: '0',
            backgroundColor: '#0f172a',
            color: '#f8fafc',
            fontSize: '11px',
            fontFamily: 'monospace',
            padding: '2px 8px',
            borderRadius: '4px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            whiteSpace: 'nowrap',
            maxWidth: '300px',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
        });
        hoverOverlay.appendChild(badge);
        document.body.appendChild(hoverOverlay);

        function onMouseMove(e) {
            if (!isPickerActive) return;
            const target = e.target;
            if (!target || target === hoverOverlay || target.closest(`#${CONFIG.SHADOW_CONTAINER_ID}`)) return;

            const rect = target.getBoundingClientRect();
            hoverOverlay.style.width = `${rect.width}px`;
            hoverOverlay.style.height = `${rect.height}px`;
            hoverOverlay.style.top = `${rect.top}px`;
            hoverOverlay.style.left = `${rect.left}px`;
            hoverOverlay.style.display = 'block';

            const generatedSelector = generateCSSSelector(target);
            const matchesCount = document.querySelectorAll(generatedSelector).length;
            badge.textContent = `${generatedSelector} (${matchesCount} match${matchesCount > 1 ? 'es' : ''})`;
        }

        function onClick(e) {
            if (!isPickerActive) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const target = e.target;
            deactivateElementPicker();

            if (target && !target.closest(`#${CONFIG.SHADOW_CONTAINER_ID}`)) {
                const selector = generateCSSSelector(target);
                openBlockConfirmationModal(selector);
            }
        }

        function onKeyDown(e) {
            if (e.key === 'Escape' && isPickerActive) {
                deactivateElementPicker();
            }
        }

        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKeyDown, true);

        // Save reference for cleanup
        hoverOverlay._cleanup = () => {
            document.removeEventListener('mousemove', onMouseMove, true);
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKeyDown, true);
            if (hoverOverlay && hoverOverlay.parentNode) {
                hoverOverlay.parentNode.removeChild(hoverOverlay);
            }
            hoverOverlay = null;
        };
    }

    function deactivateElementPicker() {
        isPickerActive = false;
        if (hoverOverlay && hoverOverlay._cleanup) {
            hoverOverlay._cleanup();
        }
    }

    // =========================================================================
    // UI MODAL DIALOG MANAGER (Shadow DOM)
    // Encapsulates CSS to avoid breaking target site's styles
    // =========================================================================
    let shadowHost = null;
    let shadowRoot = null;
    let shadowStyleSheet = null;

    function initShadowDOM() {
        if (shadowHost) return;

        shadowHost = document.createElement('div');
        shadowHost.id = CONFIG.SHADOW_CONTAINER_ID;
        Object.assign(shadowHost.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '0',
            height: '0',
            zIndex: '2147483647'
        });

        document.body.appendChild(shadowHost);
        shadowRoot = shadowHost.attachShadow({ mode: 'open' });

        const cssText = `
            :host {
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                color-scheme: dark;
            }
            .eb-backdrop {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(15, 23, 42, 0.75);
                backdrop-filter: blur(4px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 2147483647;
                animation: fadeIn 0.15s ease-out;
            }
            .eb-modal {
                background: #0f172a;
                color: #f8fafc;
                border: 1px solid #334155;
                border-radius: 12px;
                width: 680px;
                max-width: 92vw;
                max-height: 85vh;
                display: flex;
                flex-direction: column;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
                overflow: hidden;
            }
            .eb-header {
                padding: 16px 20px;
                background: #1e293b;
                border-bottom: 1px solid #334155;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .eb-title {
                font-size: 1.1rem;
                font-weight: 600;
                color: #f8fafc;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .eb-close-btn {
                background: transparent;
                border: none;
                color: #94a3b8;
                font-size: 20px;
                cursor: pointer;
                border-radius: 6px;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.15s;
            }
            .eb-close-btn:hover {
                background: #334155;
                color: #ffffff;
            }
            .eb-body {
                padding: 20px;
                overflow-y: auto;
                flex: 1;
            }
            .eb-footer {
                padding: 14px 20px;
                background: #1e293b;
                border-top: 1px solid #334155;
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            }
            .eb-btn {
                padding: 8px 16px;
                border-radius: 6px;
                font-size: 0.875rem;
                font-weight: 500;
                cursor: pointer;
                border: none;
                transition: all 0.15s;
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }
            .eb-btn-primary {
                background: #2563eb;
                color: #ffffff;
            }
            .eb-btn-primary:hover {
                background: #1d4ed8;
            }
            .eb-btn-secondary {
                background: #334155;
                color: #cbd5e1;
            }
            .eb-btn-secondary:hover {
                background: #475569;
                color: #ffffff;
            }
            .eb-btn-danger {
                background: #dc2626;
                color: #ffffff;
            }
            .eb-btn-danger:hover {
                background: #b91c1c;
            }
            .eb-btn-sm {
                padding: 4px 8px;
                font-size: 0.75rem;
            }
            .eb-form-group {
                margin-bottom: 16px;
            }
            .eb-label {
                display: block;
                font-size: 0.825rem;
                color: #94a3b8;
                margin-bottom: 6px;
                font-weight: 500;
            }
            .eb-input {
                width: 100%;
                box-sizing: border-box;
                padding: 9px 12px;
                background: #020617;
                border: 1px solid #334155;
                border-radius: 6px;
                color: #f8fafc;
                font-size: 0.875rem;
                font-family: monospace;
                outline: none;
            }
            .eb-input:focus {
                border-color: #3b82f6;
                box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
            }
            .eb-table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 10px;
            }
            .eb-table th {
                text-align: left;
                padding: 10px;
                background: #1e293b;
                color: #94a3b8;
                font-size: 0.75rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                border-bottom: 1px solid #334155;
            }
            .eb-table td {
                padding: 10px;
                border-bottom: 1px solid #1e293b;
                font-size: 0.85rem;
                vertical-align: middle;
            }
            .eb-badge {
                background: #1e293b;
                color: #38bdf8;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 0.75rem;
                font-family: monospace;
            }
            .eb-empty {
                text-align: center;
                padding: 30px;
                color: #64748b;
                font-size: 0.9rem;
            }
            .eb-add-box {
                background: #1e293b;
                padding: 14px;
                border-radius: 8px;
                border: 1px solid #334155;
                margin-bottom: 20px;
            }
            @keyframes fadeIn {
                from { opacity: 0; transform: scale(0.98); }
                to { opacity: 1; transform: scale(1); }
            }
        `;

        if (typeof CSSStyleSheet === 'function' && shadowRoot.adoptedStyleSheets) {
            shadowStyleSheet = new CSSStyleSheet();
            shadowStyleSheet.replaceSync(cssText);
            shadowRoot.adoptedStyleSheets = [shadowStyleSheet];
        } else {
            const style = document.createElement('style');
            style.textContent = cssText;
            shadowRoot.appendChild(style);
        }
    }

    // =========================================================================
    // DOM HELPER FOR TRUSTEDHTML & CSP COMPLIANCE
    // Programmatically constructs DOM elements without using innerHTML
    // =========================================================================
    function h(tag, props = {}, ...children) {
        const el = document.createElement(tag);
        if (props) {
            for (const [key, value] of Object.entries(props)) {
                if (key === 'style' && typeof value === 'object') {
                    Object.assign(el.style, value);
                } else if (key === 'style' && typeof value === 'string') {
                    el.style.cssText = value;
                } else if (key === 'className') {
                    el.className = value;
                } else if (key.startsWith('on') && typeof value === 'function') {
                    el.addEventListener(key.slice(2).toLowerCase(), value);
                } else if (key === 'dataset' && typeof value === 'object') {
                    Object.assign(el.dataset, value);
                } else {
                    el.setAttribute(key, value);
                }
            }
        }
        children.flat(Infinity).forEach(child => {
            if (child === null || child === undefined || child === false) return;
            if (typeof child === 'string' || typeof child === 'number') {
                el.appendChild(document.createTextNode(String(child)));
            } else if (child instanceof Node) {
                el.appendChild(child);
            }
        });
        return el;
    }

    // =========================================================================
    // QUICK BLOCK CONFIRMATION MODAL
    // Opens when user picks an element via visual picker
    // =========================================================================
    function openBlockConfirmationModal(initialSelector = '') {
        initShadowDOM();

        // Count current matching elements
        let matchCount = 0;
        try {
            matchCount = initialSelector ? document.querySelectorAll(initialSelector).length : 0;
        } catch(e) {}

        const hostnameInput = h('input', { type: 'text', className: 'eb-input', id: 'eb-hostname', value: window.location.hostname });
        const selectorInput = h('input', { type: 'text', className: 'eb-input', id: 'eb-selector', value: initialSelector });
        const matchBadge = h('span', { className: 'eb-badge', id: 'eb-match-count' }, `${matchCount} element(s)`);

        // Live match updating on selector change
        selectorInput.addEventListener('input', () => {
            try {
                const count = document.querySelectorAll(selectorInput.value.trim()).length;
                matchBadge.textContent = `${count} element(s)`;
            } catch (err) {
                matchBadge.textContent = 'Invalid CSS Selector';
            }
        });

        let container;
        const closeModal = () => container && container.remove();

        const closeBtn = h('button', { className: 'eb-close-btn', id: 'eb-close', onClick: closeModal }, '×');
        const cancelBtn = h('button', { className: 'eb-btn eb-btn-secondary', id: 'eb-cancel', onClick: closeModal }, 'Cancel');
        const confirmBtn = h('button', { 
            className: 'eb-btn eb-btn-primary', 
            id: 'eb-confirm',
            onClick: () => {
                const host = hostnameInput.value.trim();
                const sel = selectorInput.value.trim();

                if (host && sel) {
                    addRule(host, sel);
                    executeBlocking();
                    closeModal();
                }
            }
        }, 'Block Elements');

        const modal = h('div', { className: 'eb-modal', style: { width: '480px' } },
            h('div', { className: 'eb-header' },
                h('div', { className: 'eb-title' }, '🛡️ Block Selected Element'),
                closeBtn
            ),
            h('div', { className: 'eb-body' },
                h('div', { className: 'eb-form-group' },
                    h('label', { className: 'eb-label' }, 'Target Hostname'),
                    hostnameInput
                ),
                h('div', { className: 'eb-form-group' },
                    h('label', { className: 'eb-label' }, 'CSS Selector'),
                    selectorInput
                ),
                h('div', { style: 'font-size: 0.8rem; color: #94a3b8; display: flex; align-items: center; justify-content: space-between;' },
                    h('span', {}, 'Matches on current page:'),
                    matchBadge
                )
            ),
            h('div', { className: 'eb-footer' },
                cancelBtn,
                confirmBtn
            )
        );

        container = h('div', { 
            className: 'eb-backdrop', 
            onClick: (e) => { if (e.target === container) closeModal(); } 
        }, modal);

        shadowRoot.appendChild(container);
    }

    // =========================================================================
    // MANAGE BLOCKLIST MODAL DIALOG
    // Complete dashboard to add/remove/edit rules for all hostnames
    // =========================================================================
    function openManageBlocklistModal() {
        initShadowDOM();

        const container = h('div', { className: 'eb-backdrop' });

        function renderModalContent() {
            while (container.firstChild) {
                container.removeChild(container.firstChild);
            }

            const currentHost = window.location.hostname;
            const allHosts = Object.keys(blocklist);

            let rulesContainer;

            if (allHosts.length === 0) {
                rulesContainer = h('div', { className: 'eb-empty' }, 'No blocklist rules configured yet.');
            } else {
                const tableBody = h('tbody');

                allHosts.forEach(host => {
                    const selectors = blocklist[host] || [];
                    selectors.forEach(sel => {
                        let matchBadge;
                        if (host === currentHost || host === '*') {
                            try {
                                const count = document.querySelectorAll(sel).length;
                                matchBadge = h('span', { className: 'eb-badge', style: `color: ${count > 0 ? '#4ade80' : '#94a3b8'}` }, `${count} found`);
                            } catch (e) {
                                matchBadge = h('span', { className: 'eb-badge', style: 'color: #f87171' }, 'Error');
                            }
                        } else {
                            matchBadge = h('span', { className: 'eb-badge', style: 'color: #64748b' }, 'Other site');
                        }

                        const deleteBtn = h('button', {
                            className: 'eb-btn eb-btn-danger eb-btn-sm',
                            onClick: () => {
                                if (host && sel) {
                                    removeRule(host, sel);
                                    executeBlocking();
                                    renderModalContent();
                                }
                            }
                        }, 'Delete');

                        const row = h('tr', {},
                            h('td', {}, h('strong', { style: 'color: #cbd5e1;' }, host)),
                            h('td', {}, h('code', { style: 'color: #38bdf8; word-break: break-all;' }, sel)),
                            h('td', {}, matchBadge),
                            h('td', { style: 'text-align: right;' }, deleteBtn)
                        );

                        tableBody.appendChild(row);
                    });
                });

                rulesContainer = h('table', { className: 'eb-table' },
                    h('thead', {},
                        h('tr', {},
                            h('th', {}, 'Hostname'),
                            h('th', {}, 'CSS Selector'),
                            h('th', {}, 'Status'),
                            h('th', { style: 'text-align: right;' }, 'Action')
                        )
                    ),
                    tableBody
                );
            }

            const closeModal = () => container.remove();

            const hostInput = h('input', {
                type: 'text',
                className: 'eb-input',
                id: 'eb-new-host',
                placeholder: `Hostname (e.g. ${currentHost})`,
                value: currentHost,
                style: 'flex: 1; min-width: 180px;'
            });

            const selInput = h('input', {
                type: 'text',
                className: 'eb-input',
                id: 'eb-new-selector',
                placeholder: 'CSS Selector (e.g. .ad-banner)',
                style: 'flex: 2; min-width: 220px;'
            });

            const addBtn = h('button', {
                className: 'eb-btn eb-btn-primary',
                onClick: () => {
                    const host = hostInput.value.trim();
                    const sel = selInput.value.trim();
                    if (host && sel) {
                        addRule(host, sel);
                        executeBlocking();
                        renderModalContent();
                    }
                }
            }, 'Add Rule');

            const fileInput = h('input', {
                type: 'file',
                accept: '.json',
                style: 'display: none;',
                onChange: (e) => {
                    const file = e.target.files && e.target.files[0];
                    if (file) {
                        importBlocklistJSON(file, () => {
                            renderModalContent();
                        });
                    }
                }
            });

            const importBtn = h('button', {
                className: 'eb-btn eb-btn-secondary eb-btn-sm',
                onClick: () => fileInput.click()
            }, '📥 Import JSON');

            const exportBtn = h('button', {
                className: 'eb-btn eb-btn-secondary eb-btn-sm',
                onClick: () => exportBlocklistJSON()
            }, '📤 Export JSON');

            const pickBtn = h('button', {
                className: 'eb-btn eb-btn-secondary eb-btn-sm',
                onClick: () => {
                    closeModal();
                    activateElementPicker();
                }
            }, '🎯 Select Element');

            const modal = h('div', { className: 'eb-modal' },
                h('div', { className: 'eb-header' },
                    h('div', { className: 'eb-title' }, '⚙️ Manage HTML Element Blocklist'),
                    h('button', { className: 'eb-close-btn', onClick: closeModal }, '×')
                ),
                h('div', { className: 'eb-body' },
                    h('div', { className: 'eb-add-box' },
                        h('div', { style: 'font-weight: 600; font-size: 0.9rem; margin-bottom: 10px; color: #f8fafc;' }, 'Add New Blocklist Rule'),
                        h('div', { style: 'display: flex; gap: 10px; flex-wrap: wrap;' },
                            hostInput,
                            selInput,
                            addBtn
                        )
                    ),
                    h('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;' },
                        h('span', { style: 'font-size: 0.875rem; font-weight: 600; color: #94a3b8;' }, 'Active Blocking Rules'),
                        h('div', { style: 'display: flex; gap: 6px; flex-wrap: wrap;' },
                            importBtn,
                            exportBtn,
                            pickBtn,
                            fileInput
                        )
                    ),
                    h('div', { id: 'eb-rules-list-container' }, rulesContainer)
                ),
                h('div', { className: 'eb-footer' },
                    h('button', { className: 'eb-btn eb-btn-secondary', onClick: closeModal }, 'Close')
                )
            );

            container.appendChild(modal);
        }

        renderModalContent();
        shadowRoot.appendChild(container);

        container.addEventListener('click', (e) => {
            if (e.target === container) container.remove();
        });
    }

    // =========================================================================
    // USERSCRIPT MENU COMMANDS REGISTRATION
    // =========================================================================
    function registerMenuCommands() {
        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('🎯 Block Elements', () => {
                activateElementPicker();
            });

            GM_registerMenuCommand('⚙️ Manage Blocklist', () => {
                openManageBlocklistModal();
            });
        }
    }

    // =========================================================================
    // SCRIPT INITIALIZATION & SYNCHRONIZATION
    // =========================================================================
    function init() {
        // Register menu commands
        registerMenuCommands();

        // Apply rules on initial script execution
        executeBlocking();
        setupMutationObserver();

        // Re-apply when DOM is fully loaded
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', executeBlocking);
        }

        // Listen for cross-tab or storage changes
        StorageAdapter.onChangeListener((newBlocklist) => {
            blocklist = newBlocklist || {};
            executeBlocking();
        });
    }

    // Execute application logic
    init();

})();