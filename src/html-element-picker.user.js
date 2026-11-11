// ==UserScript==
// @name         HTML Element Picker
// @namespace    https://docs.scriptcat.org/
// @version      1.2.2
// @description  Pick HTML element and display its CSS selector in a clean Shadow DOM modal
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @grant        GM_registerMenuCommand
// @grant        GM.registerMenuCommand
// @grant        GM_setClipboard
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // CONFIGURATION & CONSTANTS
    // Easily adjust visual appearance, picker behavior, and selector priority
    // =========================================================================
    const CONFIG = {
        // --- Overlay & Tooltip Preferences ---
        OVERLAY_BORDER_COLOR: '#3b82f6',         // Highlighting outline color (Blue)
        OVERLAY_BG_COLOR: 'rgba(59, 130, 246, 0.15)', // Semi-transparent highlight fill
        OVERLAY_BORDER_WIDTH: 2,                 // Outline thickness in pixels
        TOOLTIP_BG: '#0f172a',                   // Tooltip badge background color
        TOOLTIP_TEXT_COLOR: '#f8fafc',           // Tooltip badge text color
        
        // --- CSS Selector Generation Strategy ---
        PREFER_ID: true,                         // Prioritize unique element ID when valid
        PREFER_DATA_ATTRS: true,                 // Prioritize attributes like data-testid, data-qa
        DATA_ATTRIBUTES: [                       // Ranked priority list for target data attributes
            'data-testid',
            'data-test-id',
            'data-qa',
            'data-cy',
            'data-id',
            'data-component',
            'data-role',
            'role'
        ],
        MAX_CLASS_NAMES: 3,                      // Maximum classes to combine per element
        IGNORE_DYNAMIC_IDS: true,                // Skip IDs that look randomly generated (e.g., numbers, hashes)
        
        // --- Hotkey & Trigger Settings ---
        ENABLE_HOTKEY: true,                     // Enable keyboard shortcut to trigger picker
        HOTKEY: {
            ctrlKey: true,
            shiftKey: true,
            altKey: false,
            key: 'X'                             // Trigger key (Ctrl + Shift + X)
        },

        // --- Shadow DOM Modal Aesthetics ---
        MODAL_THEME: {
            primaryColor: '#3b82f6',
            primaryHover: '#2563eb',
            bgColor: '#0f172a',
            surfaceColor: '#1e293b',
            textColor: '#f8fafc',
            subtextColor: '#94a3b8',
            borderColor: '#334155',
            codeBg: '#020617',
            accentColor: '#10b981'
        }
    };

    // =========================================================================
    // GLOBAL STATE & CORE UTILITIES
    // =========================================================================
    let isPicking = false;
    let hoveredElement = null;
    let highlightOverlay = null;
    let tooltipBadge = null;
    let shadowHost = null;
    let shadowRoot = null;

    function adoptStyleSheet(target, cssText) {
        if (!cssText || !target || typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in target)) {
            return;
        }

        try {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(cssText);
            const existingSheets = Array.from(target.adoptedStyleSheets || []);
            if (!existingSheets.some(existingSheet => existingSheet.cssText === sheet.cssText)) {
                target.adoptedStyleSheets = [...existingSheets, sheet];
            }
        } catch (err) {
            console.warn('[HTML Element Picker] Failed to adopt stylesheet:', err);
        }
    }

    /**
     * Safely escapes string components for standard CSS query selectors
     * @param {string} str 
     * @returns {string}
     */
    function safeCssEscape(str) {
        if (!str) return '';
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
            return CSS.escape(str);
        }
        return str.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
    }

    /**
     * Checks whether an ID appears to be dynamically generated (e.g., Ember, Angular, React hashes)
     * @param {string} id 
     * @returns {boolean}
     */
    function isDynamicId(id) {
        if (!CONFIG.IGNORE_DYNAMIC_IDS) return false;
        // Patterns matching common auto-generated IDs
        const dynamicPatterns = [
            /^\d+$/,                           // Numeric only (e.g. id="12345")
            /^ember\d+$/i,                     // Ember generated
            /^react-body-/,                    // React internal
            /^aria-\d+$/i,                     // Aria auto ids
            /^[a-f0-9]{8}-[a-f0-9]{4}/i,       // UUID pattern
            /[0-9a-f]{10,}/i,                  // Long hex strings
            /^:[r|a-z0-9]+:$/i                 // React 18 style IDs like :r0:
        ];
        return dynamicPatterns.some(pattern => pattern.test(id));
    }

    // =========================================================================
    // CSS SELECTOR GENERATOR ENGINE
    // =========================================================================

    /**
     * Finds the primary unique selector for an element
     * @param {Element} el 
     * @returns {string}
     */
    function generateOptimalSelector(el) {
        if (!(el instanceof Element)) return '';
        if (el === document.body) return 'body';
        if (el === document.documentElement) return 'html';

        // 1. Check for Unique ID
        if (CONFIG.PREFER_ID && el.id && !isDynamicId(el.id)) {
            const escapedId = `#${safeCssEscape(el.id)}`;
            try {
                if (document.querySelectorAll(escapedId).length === 1) {
                    return escapedId;
                }
            } catch (e) { /* Ignore invalid selectors */ }
        }

        // 2. Check for Preferred Data Attributes
        if (CONFIG.PREFER_DATA_ATTRS) {
            for (const attr of CONFIG.DATA_ATTRIBUTES) {
                if (el.hasAttribute(attr)) {
                    const val = el.getAttribute(attr);
                    const attrSelector = val ? `[${attr}="${CSS.escape(val)}"]` : `[${attr}]`;
                    try {
                        if (document.querySelectorAll(attrSelector).length === 1) {
                            return attrSelector;
                        }
                    } catch (e) { /* Fallback */ }
                }
            }
        }

        // 3. Build Unique Path Walking Up DOM Tree
        const path = [];
        let current = el;

        while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
            let selector = current.tagName.toLowerCase();

            // Try ID
            if (current.id && !isDynamicId(current.id)) {
                selector = `#${safeCssEscape(current.id)}`;
                path.unshift(selector);
                const fullPath = path.join(' > ');
                if (isUniqueSelector(fullPath, el)) return fullPath;
                current = current.parentElement;
                continue;
            }

            // Try Data Attributes
            let dataAttrFound = false;
            if (CONFIG.PREFER_DATA_ATTRS) {
                for (const attr of CONFIG.DATA_ATTRIBUTES) {
                    if (current.hasAttribute(attr)) {
                        const val = current.getAttribute(attr);
                        selector += val ? `[${attr}="${CSS.escape(val)}"]` : `[${attr}]`;
                        dataAttrFound = true;
                        break;
                    }
                }
            }

            // Try Classes if no data attribute used
            if (!dataAttrFound && current.classList && current.classList.length > 0) {
                const validClasses = Array.from(current.classList)
                    .filter(c => !c.startsWith('js-') && !c.includes(':')) // Filter common noise
                    .slice(0, CONFIG.MAX_CLASS_NAMES)
                    .map(c => `.${safeCssEscape(c)}`);
                
                if (validClasses.length > 0) {
                    selector += validClasses.join('');
                }
            }

            // Validate path uniqueness so far
            path.unshift(selector);
            const candidatePath = path.join(' > ');
            if (isUniqueSelector(candidatePath, el)) {
                return candidatePath;
            }

            // If not unique, add nth-of-type selector index
            if (!isUniqueInParent(current, selector)) {
                const index = getNthOfTypeIndex(current);
                path[0] = `${selector}:nth-of-type(${index})`;
                const indexedPath = path.join(' > ');
                if (isUniqueSelector(indexedPath, el)) {
                    return indexedPath;
                }
            }

            current = current.parentElement;
        }

        return path.join(' > ');
    }

    /**
     * Generates a complete full hierarchy DOM path
     */
    function generateFullPath(el) {
        const stack = [];
        let current = el;
        while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
            let nodeName = current.tagName.toLowerCase();
            if (current.id) {
                nodeName += `#${safeCssEscape(current.id)}`;
            } else {
                const index = getNthChildIndex(current);
                nodeName += `:nth-child(${index})`;
            }
            stack.unshift(nodeName);
            current = current.parentElement;
        }
        return stack.join(' > ');
    }

    /**
     * Checks if selector targets strictly the target element and only 1 match exists
     */
    function isUniqueSelector(selector, targetElement) {
        try {
            const matches = document.querySelectorAll(selector);
            return matches.length === 1 && matches[0] === targetElement;
        } catch (e) {
            return false;
        }
    }

    /**
     * Verifies uniqueness within immediate parent scope
     */
    function isUniqueInParent(el, selector) {
        if (!el.parentElement) return true;
        try {
            const matches = el.parentElement.querySelectorAll(`:scope > ${selector}`);
            return matches.length === 1;
        } catch (e) {
            return false;
        }
    }

    /**
     * Calculates 1-based nth-of-type index
     */
    function getNthOfTypeIndex(el) {
        let count = 1;
        let sibling = el.previousElementSibling;
        while (sibling) {
            if (sibling.tagName === el.tagName) count++;
            sibling = sibling.previousElementSibling;
        }
        return count;
    }

    /**
     * Calculates 1-based nth-child index
     */
    function getNthChildIndex(el) {
        let count = 1;
        let sibling = el.previousElementSibling;
        while (sibling) {
            count++;
            sibling = sibling.previousElementSibling;
        }
        return count;
    }

    // =========================================================================
    // OVERLAY HIGHLIGHT & TOOLTIP DISPLAY
    // =========================================================================

    /**
     * Prepares highlighting overlay and hover info elements
     */
    function createOverlayElements() {
        if (highlightOverlay && tooltipBadge) return;

        // Visual Outline Highlight Frame
        highlightOverlay = document.createElement('div');
        highlightOverlay.id = 'html-picker-overlay';
        Object.assign(highlightOverlay.style, {
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: '2147483640',
            border: `${CONFIG.OVERLAY_BORDER_WIDTH}px dashed ${CONFIG.OVERLAY_BORDER_COLOR}`,
            backgroundColor: CONFIG.OVERLAY_BG_COLOR,
            transition: 'all 0.05s ease-out',
            borderRadius: '3px',
            boxSizing: 'border-box',
            display: 'none'
        });

        // Hover Tag Info Badge
        tooltipBadge = document.createElement('div');
        tooltipBadge.id = 'html-picker-tooltip';
        Object.assign(tooltipBadge.style, {
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: '2147483641',
            backgroundColor: CONFIG.TOOLTIP_BG,
            color: CONFIG.TOOLTIP_TEXT_COLOR,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '12px',
            fontWeight: '600',
            padding: '4px 8px',
            borderRadius: '4px',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.3)',
            whiteSpace: 'nowrap',
            display: 'none'
        });

        document.documentElement.appendChild(highlightOverlay);
        document.documentElement.appendChild(tooltipBadge);
    }

    /**
     * Repositions highlight outline and badge over target element
     */
    function updateOverlayPosition(el) {
        if (!el || !highlightOverlay || !tooltipBadge) return;

        const rect = el.getBoundingClientRect();
        
        // Update overlay dimensions
        Object.assign(highlightOverlay.style, {
            top: `${rect.top}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            display: 'block'
        });

        // Construct quick summary label
        let tagSummary = el.tagName.toLowerCase();
        if (el.id) tagSummary += `#${el.id}`;
        else if (el.classList.length > 0) tagSummary += `.${Array.from(el.classList).slice(0, 2).join('.')}`;
        
        const dimensions = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
        tooltipBadge.textContent = `<${tagSummary}> (${dimensions})`;

        // Position badge above or below target depending on viewport space
        let tooltipTop = rect.top - 30;
        if (tooltipTop < 5) tooltipTop = rect.bottom + 8;

        let tooltipLeft = Math.max(5, rect.left);
        if (tooltipLeft + 200 > window.innerWidth) {
            tooltipLeft = window.innerWidth - 210;
        }

        Object.assign(tooltipBadge.style, {
            top: `${tooltipTop}px`,
            left: `${tooltipLeft}px`,
            display: 'block'
        });
    }

    /**
     * Hides hover elements
     */
    function hideOverlay() {
        if (highlightOverlay) highlightOverlay.style.display = 'none';
        if (tooltipBadge) tooltipBadge.style.display = 'none';
    }

    // =========================================================================
    // PICKER EVENT LISTENERS & MODE CONTROLLER
    // =========================================================================

    function startPicking() {
        if (isPicking) return;
        isPicking = true;
        createOverlayElements();

        // Mouse & Keyboard Capture Handlers
        document.addEventListener('mouseover', handleMouseOver, true);
        document.addEventListener('mouseout', handleMouseOut, true);
        document.addEventListener('click', handleClick, true);
        document.addEventListener('keydown', handleKeyDown, true);

        // Change cursor feedback
        document.body.style.cursor = 'crosshair';
    }

    function stopPicking() {
        if (!isPicking) return;
        isPicking = false;
        hideOverlay();

        document.removeEventListener('mouseover', handleMouseOver, true);
        document.removeEventListener('mouseout', handleMouseOut, true);
        document.removeEventListener('click', handleClick, true);
        document.removeEventListener('keydown', handleKeyDown, true);

        document.body.style.cursor = '';
    }

    function handleMouseOver(e) {
        if (!isPicking) return;
        // Skip picking our own modal container if present
        if (shadowHost && shadowHost.contains(e.target)) return;
        
        e.stopPropagation();
        hoveredElement = e.target;
        updateOverlayPosition(hoveredElement);
    }

    function handleMouseOut(e) {
        if (!isPicking) return;
        e.stopPropagation();
    }

    function handleClick(e) {
        if (!isPicking) return;
        
        // Ignore clicks inside shadow modal host
        if (shadowHost && shadowHost.contains(e.target)) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const selectedEl = e.target;
        stopPicking();

        // Display results inside Shadow DOM modal
        showSelectorModal(selectedEl);
    }

    function handleKeyDown(e) {
        if (!isPicking) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            stopPicking();
        }
    }

    // =========================================================================
    // SHADOW DOM MODAL DIALOG GENERATOR
    // Prevents host page CSS from corrupting or overriding modal styling
    // =========================================================================

    /**
     * Creates an SVG target icon safely without using innerHTML
     */
    function createSvgIcon() {
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', '18');
        svg.setAttribute('height', '18');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');

        const circle = document.createElementNS(svgNS, 'circle');
        circle.setAttribute('cx', '12');
        circle.setAttribute('cy', '12');
        circle.setAttribute('r', '10');

        const coords = [
            ['22', '12', '18', '12'],
            ['6', '12', '2', '12'],
            ['12', '6', '12', '2'],
            ['12', '22', '12', '18']
        ];

        svg.appendChild(circle);
        coords.forEach(([x1, y1, x2, y2]) => {
            const line = document.createElementNS(svgNS, 'line');
            line.setAttribute('x1', x1);
            line.setAttribute('y1', y1);
            line.setAttribute('x2', x2);
            line.setAttribute('y2', y2);
            svg.appendChild(line);
        });

        return svg;
    }

    function showSelectorModal(element) {
        // Destroy old host instance if exists
        if (shadowHost) {
            shadowHost.remove();
            shadowHost = null;
            shadowRoot = null;
        }

        // Calculate Selectors
        const optimalSelector = generateOptimalSelector(element);
        const fullPath = generateFullPath(element);

        // Create Shadow Host Container
        shadowHost = document.createElement('div');
        shadowHost.id = 'html-picker-shadow-host';
        Object.assign(shadowHost.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100vw',
            height: '100vh',
            zIndex: '2147483647',
            pointerEvents: 'auto'
        });

        shadowRoot = shadowHost.attachShadow({ mode: 'open' });

        const styleCss = `
            :host {
                all: initial;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            }
            .modal-backdrop {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(2, 6, 23, 0.7);
                backdrop-filter: blur(4px);
                display: flex;
                align-items: center;
                justify-content: center;
                animation: fadeIn 0.15s ease-out;
            }
            .modal-box {
                background-color: ${CONFIG.MODAL_THEME.bgColor};
                border: 1px solid ${CONFIG.MODAL_THEME.borderColor};
                border-radius: 12px;
                width: 90%;
                max-width: 620px;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
                overflow: hidden;
                display: flex;
                flex-direction: column;
                color: ${CONFIG.MODAL_THEME.textColor};
                animation: slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .modal-header {
                padding: 16px 20px;
                background: ${CONFIG.MODAL_THEME.surfaceColor};
                border-bottom: 1px solid ${CONFIG.MODAL_THEME.borderColor};
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .modal-title {
                margin: 0;
                font-size: 16px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
                color: ${CONFIG.MODAL_THEME.textColor};
            }
            .close-btn {
                background: transparent;
                border: none;
                color: ${CONFIG.MODAL_THEME.subtextColor};
                font-size: 20px;
                cursor: pointer;
                padding: 4px 8px;
                border-radius: 6px;
                transition: all 0.15s ease;
            }
            .close-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                color: ${CONFIG.MODAL_THEME.textColor};
            }
            .modal-body {
                padding: 20px;
                display: flex;
                flex-direction: column;
                gap: 16px;
            }
            .element-info-badge {
                font-size: 12px;
                color: ${CONFIG.MODAL_THEME.subtextColor};
                background: ${CONFIG.MODAL_THEME.surfaceColor};
                padding: 8px 12px;
                border-radius: 6px;
                border: 1px solid ${CONFIG.MODAL_THEME.borderColor};
                word-break: break-all;
            }
            .field-group {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .field-label {
                font-size: 13px;
                font-weight: 600;
                color: ${CONFIG.MODAL_THEME.subtextColor};
            }
            .selector-input-container {
                display: flex;
                gap: 8px;
            }
            .selector-input {
                flex: 1;
                background: ${CONFIG.MODAL_THEME.codeBg};
                border: 1px solid ${CONFIG.MODAL_THEME.borderColor};
                color: ${CONFIG.MODAL_THEME.textColor};
                padding: 10px 14px;
                border-radius: 6px;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-size: 13px;
                outline: none;
            }
            .selector-input:focus {
                border-color: ${CONFIG.MODAL_THEME.primaryColor};
            }
            .btn {
                background: ${CONFIG.MODAL_THEME.primaryColor};
                color: #ffffff;
                border: none;
                padding: 10px 16px;
                border-radius: 6px;
                font-weight: 600;
                font-size: 13px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                white-space: nowrap;
                transition: background 0.15s ease;
            }
            .btn:hover {
                background: ${CONFIG.MODAL_THEME.primaryHover};
            }
            .btn-secondary {
                background: ${CONFIG.MODAL_THEME.surfaceColor};
                color: ${CONFIG.MODAL_THEME.textColor};
                border: 1px solid ${CONFIG.MODAL_THEME.borderColor};
            }
            .btn-secondary:hover {
                background: rgba(255, 255, 255, 0.05);
            }
            .btn-success {
                background: ${CONFIG.MODAL_THEME.accentColor} !important;
            }
            .modal-footer {
                padding: 12px 20px;
                background: ${CONFIG.MODAL_THEME.surfaceColor};
                border-top: 1px solid ${CONFIG.MODAL_THEME.borderColor};
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            }
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes slideUp {
                from { transform: translateY(12px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
        `;

        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';

        const modalBox = document.createElement('div');
        modalBox.className = 'modal-box';
        modalBox.setAttribute('role', 'dialog');
        modalBox.setAttribute('aria-modal', 'true');

        // Header
        const modalHeader = document.createElement('div');
        modalHeader.className = 'modal-header';

        const modalTitle = document.createElement('h3');
        modalTitle.className = 'modal-title';
        modalTitle.appendChild(createSvgIcon());
        modalTitle.appendChild(document.createTextNode(' HTML Element CSS Selector'));

        const closeX = document.createElement('button');
        closeX.className = 'close-btn';
        closeX.id = 'close-x';
        closeX.title = 'Close';
        closeX.textContent = '×';

        modalHeader.appendChild(modalTitle);
        modalHeader.appendChild(closeX);

        // Body
        const modalBody = document.createElement('div');
        modalBody.className = 'modal-body';

        // Element Info Badge
        const infoBadge = document.createElement('div');
        infoBadge.className = 'element-info-badge';
        infoBadge.appendChild(document.createTextNode('Selected: '));
        const tagStrong = document.createElement('strong');
        tagStrong.textContent = `<${element.tagName.toLowerCase()}>`;
        infoBadge.appendChild(tagStrong);

        if (element.id) {
            infoBadge.appendChild(document.createTextNode(` • id="${element.id}"`));
        }
        if (element.className && typeof element.className === 'string' && element.className.trim()) {
            infoBadge.appendChild(document.createTextNode(` • class="${element.className}"`));
        }

        // Field Group 1: Optimal Selector
        const group1 = document.createElement('div');
        group1.className = 'field-group';

        const label1 = document.createElement('label');
        label1.className = 'field-label';
        label1.textContent = 'Optimal Selector (Recommended)';

        const container1 = document.createElement('div');
        container1.className = 'selector-input-container';

        const optimalInput = document.createElement('input');
        optimalInput.type = 'text';
        optimalInput.className = 'selector-input';
        optimalInput.id = 'optimal-selector';
        optimalInput.value = optimalSelector;
        optimalInput.readOnly = true;

        const copyOptimalBtn = document.createElement('button');
        copyOptimalBtn.className = 'btn';
        copyOptimalBtn.id = 'copy-optimal-btn';
        copyOptimalBtn.textContent = 'Copy CSS Selector';

        container1.appendChild(optimalInput);
        container1.appendChild(copyOptimalBtn);
        group1.appendChild(label1);
        group1.appendChild(container1);

        // Field Group 2: Full DOM Path
        const group2 = document.createElement('div');
        group2.className = 'field-group';

        const label2 = document.createElement('label');
        label2.className = 'field-label';
        label2.textContent = 'Full DOM Path';

        const container2 = document.createElement('div');
        container2.className = 'selector-input-container';

        const fullInput = document.createElement('input');
        fullInput.type = 'text';
        fullInput.className = 'selector-input';
        fullInput.id = 'full-path-selector';
        fullInput.value = fullPath;
        fullInput.readOnly = true;

        const copyFullBtn = document.createElement('button');
        copyFullBtn.className = 'btn btn-secondary';
        copyFullBtn.id = 'copy-full-btn';
        copyFullBtn.textContent = 'Copy Path';

        container2.appendChild(fullInput);
        container2.appendChild(copyFullBtn);
        group2.appendChild(label2);
        group2.appendChild(container2);

        modalBody.appendChild(infoBadge);
        modalBody.appendChild(group1);
        modalBody.appendChild(group2);

        // Footer
        const modalFooter = document.createElement('div');
        modalFooter.className = 'modal-footer';

        const repickBtn = document.createElement('button');
        repickBtn.className = 'btn btn-secondary';
        repickBtn.id = 'repick-btn';
        repickBtn.textContent = 'Pick Another Element';

        const closeModalBtn = document.createElement('button');
        closeModalBtn.className = 'btn btn-secondary';
        closeModalBtn.id = 'close-modal-btn';
        closeModalBtn.textContent = 'Close';

        modalFooter.appendChild(repickBtn);
        modalFooter.appendChild(closeModalBtn);

        // Assemble Modal Structure
        modalBox.appendChild(modalHeader);
        modalBox.appendChild(modalBody);
        modalBox.appendChild(modalFooter);
        backdrop.appendChild(modalBox);

        adoptStyleSheet(shadowRoot, styleCss);
        shadowRoot.appendChild(backdrop);
        document.body.appendChild(shadowHost);

        function closeModal() {
            if (shadowHost) {
                shadowHost.remove();
                shadowHost = null;
                shadowRoot = null;
            }
        }

        closeX.addEventListener('click', closeModal);
        closeModalBtn.addEventListener('click', closeModal);

        repickBtn.addEventListener('click', () => {
            closeModal();
            startPicking();
        });

        // Copy Handler with API Fallbacks & Feedback
        async function copyToClipboard(text, buttonEl) {
            let success = false;
            
            // Try GM_setClipboard if granted
            if (typeof GM_setClipboard === 'function') {
                try {
                    GM_setClipboard(text);
                    success = true;
                } catch (e) { /* Fallback */ }
            }

            // Fallback to Clipboard API
            if (!success && navigator.clipboard && window.isSecureContext) {
                try {
                    await navigator.clipboard.writeText(text);
                    success = true;
                } catch (e) { /* Fallback */ }
            }

            // Fallback to execCommand selection
            if (!success) {
                try {
                    const tempInput = document.createElement('textarea');
                    tempInput.value = text;
                    document.body.appendChild(tempInput);
                    tempInput.select();
                    document.execCommand('copy');
                    document.body.removeChild(tempInput);
                    success = true;
                } catch (e) { /* Failed */ }
            }

            if (success) {
                const originalText = buttonEl.textContent;
                buttonEl.textContent = 'Copied!';
                buttonEl.classList.add('btn-success');
                setTimeout(() => {
                    buttonEl.textContent = originalText;
                    buttonEl.classList.remove('btn-success');
                }, 1800);
            }
        }

        copyOptimalBtn.addEventListener('click', () => copyToClipboard(optimalSelector, copyOptimalBtn));
        copyFullBtn.addEventListener('click', () => copyToClipboard(fullPath, copyFullBtn));

        // Auto-select text on input focus
        optimalInput.addEventListener('click', () => optimalInput.select());
        fullInput.addEventListener('click', () => fullInput.select());

        // Esc key closes modal
        const handleModalEsc = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                window.removeEventListener('keydown', handleModalEsc);
            }
        };
        window.addEventListener('keydown', handleModalEsc);
    }

    // =========================================================================
    // GM MENU COMMANDS & HOTKEY SHORTCUTS
    // =========================================================================

    /**
     * Register ScriptCat / Tampermonkey / Violentmonkey Menu Command
     */
    function registerMenuCommands() {
        const commandName = 'Pick HTML Element';
        
        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand(commandName, startPicking);
        } else if (typeof GM !== 'undefined' && typeof GM.registerMenuCommand === 'function') {
            GM.registerMenuCommand(commandName, startPicking);
        }
    }

    /**
     * Optional Global Shortcut Listener (Ctrl + Shift + X)
     */
    function setupGlobalHotkey() {
        if (!CONFIG.ENABLE_HOTKEY) return;

        window.addEventListener('keydown', (e) => {
            const h = CONFIG.HOTKEY;
            if (
                e.ctrlKey === h.ctrlKey &&
                e.shiftKey === h.shiftKey &&
                e.altKey === h.altKey &&
                e.key.toUpperCase() === h.key.toUpperCase()
            ) {
                e.preventDefault();
                if (isPicking) {
                    stopPicking();
                } else {
                    startPicking();
                }
            }
        });
    }

    // Initialization
    registerMenuCommands();
    setupGlobalHotkey();

})();