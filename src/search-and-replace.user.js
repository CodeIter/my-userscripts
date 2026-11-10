// ==UserScript==
// @name         Search and Replace
// @namespace    https://docs.scriptcat.org/
// @version      1.4.2
// @description  Search and replace text content on the web page with automation and persistent rules
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    /**
     * CONFIGURATION CONSTANTS
     */
    const CONFIG = {
        IGNORED_TAGS: new Set([
            'SCRIPT',
            'STYLE',
            'NOSCRIPT',
            'TEXTAREA',
            'INPUT',
            'OPTION',
            'CANVAS',
            'SVG',
            'CODE',
            'PRE'
        ]),
        IGNORE_EDITABLE_ELEMENTS: true,
        DEFAULT_CASE_SENSITIVE: false,
        DEFAULT_REGEX_FLAGS: 'g',
        TOAST_DURATION_MS: 3500,
        UI_Z_INDEX: 2147483647,
        STORAGE_KEY: 'sr_saved_searches_v1',
        DEFAULT_SEARCH_STARTUP: 1500
    };

    function createTextWalker(root) {
        return document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function (node) {
                    if (!node.nodeValue || !node.nodeValue.trim()) {
                        return NodeFilter.FILTER_SKIP;
                    }
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;

                    if (CONFIG.IGNORED_TAGS.has(parent.tagName.toUpperCase())) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    if (CONFIG.IGNORE_EDITABLE_ELEMENTS) {
                        if (parent.isContentEditable || parent.closest('[contenteditable="true"]')) {
                            return NodeFilter.FILTER_REJECT;
                        }
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );
    }

    function escapeRegExp(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function executeReplacement(regex, replacement) {
        const walker = createTextWalker(document.body || document.documentElement);
        let nodesModified = 0;
        let totalReplacements = 0;
        const nodesToProcess = [];
        let currentNode;

        while ((currentNode = walker.nextNode())) {
            if (regex.test(currentNode.nodeValue)) {
                nodesToProcess.push(currentNode);
            }
            regex.lastIndex = 0;
        }

        nodesToProcess.forEach(node => {
            const originalText = node.nodeValue;
            const matches = originalText.match(regex);
            if (matches) {
                totalReplacements += matches.length;
                nodesModified++;
                node.nodeValue = originalText.replace(regex, replacement);
            }
        });

        return { nodesModified, totalReplacements };
    }

    function getShadowRoot() {
        let host = document.getElementById('sr-userscript-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'sr-userscript-host';

            const shadowRoot = host.attachShadow({ mode: 'open' });
            
            // Use Constructable Stylesheet to comply with strict style-src CSP
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(`
                :host {
                    all: initial;
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 0;
                    height: 0;
                    z-index: 2147483647;
                    border: none;
                    margin: 0;
                    padding: 0;
                }
                * { box-sizing: border-box; }
                input, select, button { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
                
                /* Toast */
                .sr-toast {
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    background-color: #16a34a;
                    color: #ffffff;
                    padding: 12px 20px;
                    border-radius: 8px;
                    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
                    font-size: 14px;
                    font-weight: 500;
                    z-index: 2147483647;
                    transition: opacity 0.3s ease, transform 0.3s ease;
                    opacity: 0;
                    transform: translateY(10px);
                    pointer-events: none;
                }
                .sr-toast.error { background-color: #dc2626; }
                .sr-toast.visible { opacity: 1; transform: translateY(0); }

                /* Overlay */
                .sr-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    background-color: rgba(0, 0, 0, 0.5);
                    backdrop-filter: blur(3px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 2147483647;
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                }
                .sr-overlay.submodal {
                    background-color: rgba(0, 0, 0, 0.6);
                    z-index: 2147483648;
                }

                /* Modals */
                .sr-modal {
                    background-color: #ffffff;
                    color: #1f2937;
                    width: 440px;
                    max-width: 90vw;
                    border-radius: 12px;
                    padding: 24px;
                    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                }
                .sr-modal.manage {
                    width: 600px;
                    max-width: 95vw;
                    max-height: 85vh;
                    display: flex;
                    flex-direction: column;
                }
                .sr-modal.edit { width: 420px; }

                .sr-h3 { margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #111827; }
                .sr-h3.sub { font-size: 16px; }

                /* Form Controls */
                .sr-form-group { margin-bottom: 14px; }
                .sr-form-group.sm { margin-bottom: 12px; }
                .sr-label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: #374151; }
                .sr-label.sm { font-size: 12px; margin-bottom: 4px; }
                .sr-label.sub { color: #4b5563; }
                .sr-input, .sr-select {
                    width: 100%;
                    padding: 8px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    outline: none;
                    background: #ffffff;
                    color: #1f2937;
                }
                .sr-input.sm { padding: 6px 10px; font-size: 13px; }

                /* Checkbox groups */
                .sr-checkbox-group { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
                .sr-checkbox-group.edit { margin-bottom: 20px; }
                .sr-checkbox { width: 16px; height: 16px; cursor: pointer; }
                .sr-checkbox-label { font-size: 13px; color: #374151; cursor: pointer; user-select: none; }
                .sr-checkbox-label.bold { font-weight: 500; color: #111827; }

                /* Startup Box */
                .sr-startup-box {
                    background: #f9fafb;
                    padding: 12px;
                    border-radius: 8px;
                    border: 1px solid #e5e7eb;
                    margin-bottom: 20px;
                }
                .sr-target-container { display: none; margin-top: 8px; }

                /* Buttons */
                .sr-btn-group { display: flex; justify-content: flex-end; gap: 10px; }
                .sr-btn {
                    padding: 8px 16px;
                    border: 1px solid #d1d5db;
                    background: #ffffff;
                    color: #374151;
                    border-radius: 6px;
                    font-weight: 500;
                    cursor: pointer;
                    font-size: 14px;
                }
                .sr-btn.primary { border: none; background: #2563eb; color: #ffffff; }
                .sr-btn.sm { padding: 8px 14px; font-size: 13px; }
                
                /* Manage Saved Rules UI */
                .sr-modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
                .sr-close-top { border: none; background: transparent; font-size: 20px; cursor: pointer; color: #6b7280; line-height: 1; }
                .sr-list-container { flex: 1; overflow-y: auto; max-height: 55vh; padding-right: 4px; margin-bottom: 16px; }
                .sr-empty-msg { padding: 32px; text-align: center; color: #6b7280; font-size: 14px; }
                .sr-rules-wrapper { display: flex; flex-direction: column; gap: 12px; }
                .sr-rule-item { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; background: #f9fafb; display: flex; flex-direction: column; gap: 6px; }
                .sr-rule-header { display: flex; justify-content: space-between; align-items: center; }
                .sr-badge { font-size: 12px; font-weight: 600; background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; }
                .sr-rule-actions { display: flex; gap: 6px; }
                .sr-action-btn { padding: 4px 10px; border: 1px solid #d1d5db; background: #ffffff; color: #374151; border-radius: 4px; font-size: 12px; cursor: pointer; font-weight: 500; }
                .sr-action-btn.delete { border-color: #f87171; background: #fee2e2; color: #b91c1c; }
                .sr-rule-target { font-size: 13px; color: #374151; }
                .sr-code-tag { background: #e5e7eb; padding: 2px 4px; border-radius: 4px; font-family: monospace; }
                .sr-rule-pat-rep { font-size: 13px; color: #374151; display: flex; gap: 16px; }
                .sr-val-pat { color: #2563eb; font-family: monospace; }
                .sr-val-rep { color: #16a34a; font-family: monospace; }
                .sr-modal-footer { display: flex; justify-content: space-between; align-items: center; }
                .sr-left-btns { display: flex; gap: 8px; }
            `);

            shadowRoot.adoptedStyleSheets = [sheet];
            (document.body || document.documentElement).appendChild(host);
            return shadowRoot;
        }
        return host.shadowRoot;
    }

    function showToast(message, isError = false) {
        const shadow = getShadowRoot();
        const existingToast = shadow.querySelector('#sr-userscript-toast');
        if (existingToast) existingToast.remove();

        const toast = document.createElement('div');
        toast.id = 'sr-userscript-toast';
        toast.className = `sr-toast ${isError ? 'error' : ''}`;
        toast.textContent = message;

        shadow.appendChild(toast);
        requestAnimationFrame(() => {
            toast.classList.add('visible');
        });

        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 300);
        }, CONFIG.TOAST_DURATION_MS);
    }

    function matchUrlPattern(pattern, currentUrlStr) {
        if (!pattern || pattern.trim() === '*') return true;
        pattern = pattern.trim();
        
        try {
            const currentUrl = new URL(currentUrlStr);
            
            // Handle wildcards or simple domains
            if (pattern === currentUrl.origin || pattern === currentUrl.hostname) {
                return true;
            }

            // Normalize pattern for comparison
            let fullPattern = pattern;
            if (!fullPattern.includes('://')) {
                fullPattern = 'http://' + fullPattern; // temporary for parsing
            }
            const patternUrl = new URL(fullPattern);

            // Check protocol if specified in pattern
            if (pattern.includes('://') && currentUrl.protocol !== patternUrl.protocol) {
                return false;
            }

            // Check hostname
            if (currentUrl.hostname !== patternUrl.hostname) {
                return false;
            }

            // Check pathname if pattern specifies path
            if (patternUrl.pathname && patternUrl.pathname !== '/') {
                if (!currentUrl.pathname.startsWith(patternUrl.pathname)) {
                    return false;
                }
            }

            // Check search/query parameters if pattern specifies query
            if (patternUrl.search) {
                if (currentUrl.search !== patternUrl.search) {
                    return false;
                }
            }

            return true;
        } catch (e) {
            // Fallback to substring or regex matching if URL parsing fails
            if (pattern.startsWith('/') && pattern.endsWith('/')) {
                try {
                    const re = new RegExp(pattern.slice(1, -1));
                    return re.test(currentUrlStr);
                } catch (err) {
                    return false;
                }
            }
            return currentUrlStr.includes(pattern);
        }
    }

    function getSavedSearches() {
        try {
            return GM_getValue(CONFIG.STORAGE_KEY, []);
        } catch (e) {
            console.error('[Search & Replace] Failed to read saved searches:', e);
            return [];
        }
    }

    function saveSearchRule(rule) {
        try {
            const searches = getSavedSearches();
            searches.push(rule);
            GM_setValue(CONFIG.STORAGE_KEY, searches);
        } catch (e) {
            console.error('[Search & Replace] Failed to save search rule:', e);
        }
    }

    function updateSavedSearchRule(index, rule) {
        try {
            const searches = getSavedSearches();
            if (index >= 0 && index < searches.length) {
                searches[index] = rule;
                GM_setValue(CONFIG.STORAGE_KEY, searches);
            }
        } catch (e) {
            console.error('[Search & Replace] Failed to update search rule:', e);
        }
    }

    function deleteSavedSearchRule(index) {
        try {
            const searches = getSavedSearches();
            if (index >= 0 && index < searches.length) {
                searches.splice(index, 1);
                GM_setValue(CONFIG.STORAGE_KEY, searches);
            }
        } catch (e) {
            console.error('[Search & Replace] Failed to delete search rule:', e);
        }
    }

    function exportSavedSearches() {
        const searches = getSavedSearches();
        if (searches.length === 0) {
            showToast('No saved search rules to export.', true);
            return;
        }
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(searches, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute('href', dataStr);
        downloadAnchor.setAttribute('download', `search_replace_rules_${new Date().toISOString().slice(0, 10)}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast(`Exported ${searches.length} search rule(s).`);
    }

    function isSameRule(r1, r2) {
        return (r1.target || '*') === (r2.target || '*') &&
            (r1.type || 'text') === (r2.type || 'text') &&
            (r1.pattern || '') === (r2.pattern || '') &&
            (r1.replacement || '') === (r2.replacement || '') &&
            Boolean(r1.caseSensitive) === Boolean(r2.caseSensitive);
    }

    function importSavedSearches(onSuccess) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const imported = JSON.parse(event.target.result);
                    if (!Array.isArray(imported)) {
                        throw new Error('JSON format must be an array of rules.');
                    }
                    const validRules = imported.filter(item => 
                        item && typeof item === 'object' && 
                        typeof item.pattern === 'string' &&
                        typeof item.target === 'string'
                    );
                    if (validRules.length === 0) {
                        showToast('No valid search rules found in JSON file.', true);
                        return;
                    }

                    const current = getSavedSearches();
                    const newUniqueRules = [];
                    let duplicateCount = 0;

                    validRules.forEach(incomingRule => {
                        const normalizedRule = {
                            target: incomingRule.target || '*',
                            type: incomingRule.type || 'text',
                            pattern: incomingRule.pattern,
                            replacement: incomingRule.replacement || '',
                            caseSensitive: incomingRule.type === 'text' ? Boolean(incomingRule.caseSensitive) : false
                        };

                        const isDuplicateInCurrent = current.some(existing => isSameRule(existing, normalizedRule));
                        const isDuplicateInNew = newUniqueRules.some(existing => isSameRule(existing, normalizedRule));

                        if (isDuplicateInCurrent || isDuplicateInNew) {
                            duplicateCount++;
                        } else {
                            newUniqueRules.push(normalizedRule);
                        }
                    });

                    if (newUniqueRules.length === 0) {
                        showToast(`No new rules imported. ${duplicateCount} duplicate(s) excluded.`, true);
                        return;
                    }

                    const updated = [...current, ...newUniqueRules];
                    GM_setValue(CONFIG.STORAGE_KEY, updated);

                    const toastMsg = duplicateCount > 0 
                        ? `Imported ${newUniqueRules.length} rule(s) (${duplicateCount} duplicate(s) excluded).`
                        : `Successfully imported ${newUniqueRules.length} rule(s).`;

                    showToast(toastMsg);
                    if (onSuccess) onSuccess();
                } catch (err) {
                    showToast(`Failed to import JSON: ${err.message}`, true);
                }
            };
            reader.readAsText(file);
        });
        fileInput.click();
    }

    function createSearchModal({ title, isRegexMode, onSubmit }) {
        const shadow = getShadowRoot();
        const existingModal = shadow.querySelector('#sr-userscript-modal-overlay');
        if (existingModal) existingModal.remove();

        const currentHref = window.location.href;

        const overlay = document.createElement('div');
        overlay.id = 'sr-userscript-modal-overlay';
        overlay.className = 'sr-overlay';

        const modal = document.createElement('div');
        modal.className = 'sr-modal';

        // Title Header
        const h3 = document.createElement('h3');
        h3.className = 'sr-h3';
        h3.textContent = title;
        modal.appendChild(h3);

        // Search Input Group
        const searchGroup = document.createElement('div');
        searchGroup.className = 'sr-form-group';

        const searchLabel = document.createElement('label');
        searchLabel.className = 'sr-label';
        searchLabel.textContent = isRegexMode ? 'Regex Pattern (e.g., "foo" or "/foo/gi"):' : 'Find Text:';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.id = 'sr-search-input';
        searchInput.className = 'sr-input';
        searchInput.placeholder = isRegexMode ? 'e.g. \\bword\\b' : 'Enter target text...';

        searchGroup.appendChild(searchLabel);
        searchGroup.appendChild(searchInput);
        modal.appendChild(searchGroup);

        // Replace Input Group
        const replaceGroup = document.createElement('div');
        replaceGroup.className = 'sr-form-group';

        const replaceLabel = document.createElement('label');
        replaceLabel.className = 'sr-label';
        replaceLabel.textContent = 'Replacement Text:';

        const replaceInput = document.createElement('input');
        replaceInput.type = 'text';
        replaceInput.id = 'sr-replace-input';
        replaceInput.className = 'sr-input';
        replaceInput.placeholder = 'Enter replacement text...';

        replaceGroup.appendChild(replaceLabel);
        replaceGroup.appendChild(replaceInput);
        modal.appendChild(replaceGroup);

        // Match Case Checkbox (Text mode only)
        let caseCheckbox = null;
        if (!isRegexMode) {
            const caseGroup = document.createElement('div');
            caseGroup.className = 'sr-checkbox-group';

            caseCheckbox = document.createElement('input');
            caseCheckbox.type = 'checkbox';
            caseCheckbox.id = 'sr-case-checkbox';
            caseCheckbox.className = 'sr-checkbox';
            caseCheckbox.checked = CONFIG.DEFAULT_CASE_SENSITIVE;

            const caseLabel = document.createElement('label');
            caseLabel.htmlFor = 'sr-case-checkbox';
            caseLabel.className = 'sr-checkbox-label';
            caseLabel.textContent = 'Match Case';

            caseGroup.appendChild(caseCheckbox);
            caseGroup.appendChild(caseLabel);
            modal.appendChild(caseGroup);
        }

        const startupBox = document.createElement('div');
        startupBox.className = 'sr-startup-box';

        const startupRow = document.createElement('div');
        startupRow.className = 'sr-checkbox-group';

        const startupCheckbox = document.createElement('input');
        startupCheckbox.type = 'checkbox';
        startupCheckbox.id = 'sr-startup-checkbox';
        startupCheckbox.className = 'sr-checkbox';

        const startupLabel = document.createElement('label');
        startupLabel.htmlFor = 'sr-startup-checkbox';
        startupLabel.className = 'sr-checkbox-label bold';
        startupLabel.textContent = 'Automatically search and replace on startup';

        startupRow.appendChild(startupCheckbox);
        startupRow.appendChild(startupLabel);
        startupBox.appendChild(startupRow);

        const targetContainer = document.createElement('div');
        targetContainer.id = 'sr-target-container';
        targetContainer.className = 'sr-target-container';

        const targetLabel = document.createElement('label');
        targetLabel.className = 'sr-label sm sub';
        targetLabel.textContent = 'Target URL Pattern:';

        const targetInput = document.createElement('input');
        targetInput.type = 'text';
        targetInput.id = 'sr-target-input';
        targetInput.className = 'sr-input sm';
        targetInput.value = currentHref;

        targetContainer.appendChild(targetLabel);
        targetContainer.appendChild(targetInput);
        startupBox.appendChild(targetContainer);
        modal.appendChild(startupBox);

        // Action Buttons
        const btnGroup = document.createElement('div');
        btnGroup.className = 'sr-btn-group';

        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'sr-cancel-btn';
        cancelBtn.className = 'sr-btn';
        cancelBtn.textContent = 'Cancel';

        const submitBtn = document.createElement('button');
        submitBtn.id = 'sr-submit-btn';
        submitBtn.className = 'sr-btn primary';
        submitBtn.textContent = 'Replace All';

        btnGroup.appendChild(cancelBtn);
        btnGroup.appendChild(submitBtn);
        modal.appendChild(btnGroup);

        overlay.appendChild(modal);
        shadow.appendChild(overlay);

        startupCheckbox.addEventListener('change', () => {
            targetContainer.style.display = startupCheckbox.checked ? 'block' : 'none';
        });

        setTimeout(() => searchInput.focus(), 50);

        const closeModal = () => overlay.remove();

        cancelBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });

        const handleKeyDown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitBtn.click();
            } else if (e.key === 'Escape') {
                closeModal();
            }
        };

        searchInput.addEventListener('keydown', handleKeyDown);
        replaceInput.addEventListener('keydown', handleKeyDown);
        targetInput.addEventListener('keydown', handleKeyDown);

        submitBtn.addEventListener('click', () => {
            const searchValue = searchInput.value;
            const replaceValue = replaceInput.value;
            const isCaseSensitive = caseCheckbox ? caseCheckbox.checked : false;
            const saveOnStartup = startupCheckbox.checked;
            const targetUrl = targetInput.value.trim() || currentHref;

            if (!searchValue) {
                showToast('Please enter a search string or pattern.', true);
                return;
            }

            if (saveOnStartup) {
                saveSearchRule({
                    target: targetUrl,
                    type: isRegexMode ? 'regex' : 'text',
                    pattern: searchValue,
                    replacement: replaceValue,
                    caseSensitive: isCaseSensitive
                });
            }

            closeModal();
            onSubmit({ searchValue, replaceValue, isCaseSensitive });
        });
    }

    function openManageSearchesModal() {
        const shadow = getShadowRoot();
        const existingModal = shadow.querySelector('#sr-userscript-modal-overlay');
        if (existingModal) existingModal.remove();

        const overlay = document.createElement('div');
        overlay.id = 'sr-userscript-modal-overlay';
        overlay.className = 'sr-overlay';

        const modal = document.createElement('div');
        modal.className = 'sr-modal manage';

        const renderListContent = () => {
            const searches = getSavedSearches();
            const listContainer = modal.querySelector('#sr-rules-list-container');
            
            while (listContainer.firstChild) {
                listContainer.removeChild(listContainer.firstChild);
            }
            
            if (searches.length === 0) {
                const emptyMsg = document.createElement('div');
                emptyMsg.className = 'sr-empty-msg';
                emptyMsg.textContent = 'No saved startup searches found. Check "Automatically search and replace on startup" when performing a search to save rules.';
                listContainer.appendChild(emptyMsg);
                return;
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'sr-rules-wrapper';

            searches.forEach((rule, idx) => {
                const item = document.createElement('div');
                item.className = 'sr-rule-item';

                // Header row (Badge + Actions)
                const headerRow = document.createElement('div');
                headerRow.className = 'sr-rule-header';

                const typeBadge = document.createElement('span');
                typeBadge.className = 'sr-badge';
                typeBadge.textContent = rule.type;

                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'sr-rule-actions';

                const editBtn = document.createElement('button');
                editBtn.className = 'sr-action-btn';
                editBtn.textContent = 'Edit';
                editBtn.addEventListener('click', () => {
                    openEditRuleModal(idx, renderListContent);
                });

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'sr-action-btn delete';
                deleteBtn.textContent = 'Delete';
                deleteBtn.addEventListener('click', () => {
                    deleteSavedSearchRule(idx);
                    renderListContent();
                    showToast('Saved rule deleted.');
                });

                actionsDiv.appendChild(editBtn);
                actionsDiv.appendChild(deleteBtn);
                headerRow.appendChild(typeBadge);
                headerRow.appendChild(actionsDiv);
                item.appendChild(headerRow);

                // Target row
                const targetDiv = document.createElement('div');
                targetDiv.className = 'sr-rule-target';
                
                const targetStrong = document.createElement('strong');
                targetStrong.textContent = 'Target: ';
                
                const targetCode = document.createElement('code');
                targetCode.className = 'sr-code-tag';
                targetCode.textContent = rule.target || '*';

                targetDiv.appendChild(targetStrong);
                targetDiv.appendChild(targetCode);
                item.appendChild(targetDiv);

                // Pattern & Replacement row
                const patRepDiv = document.createElement('div');
                patRepDiv.className = 'sr-rule-pat-rep';

                const patSpan = document.createElement('span');
                const patStrong = document.createElement('strong');
                patStrong.textContent = 'Pattern: ';
                const patVal = document.createElement('span');
                patVal.className = 'sr-val-pat';
                patVal.textContent = rule.pattern;
                patSpan.appendChild(patStrong);
                patSpan.appendChild(patVal);

                const repSpan = document.createElement('span');
                const repStrong = document.createElement('strong');
                repStrong.textContent = 'Replace: ';
                const repVal = document.createElement('span');
                repVal.className = 'sr-val-rep';
                repVal.textContent = rule.replacement;
                repSpan.appendChild(repStrong);
                repSpan.appendChild(repVal);

                patRepDiv.appendChild(patSpan);
                patRepDiv.appendChild(repSpan);
                item.appendChild(patRepDiv);

                wrapper.appendChild(item);
            });

            listContainer.appendChild(wrapper);
        };

        const header = document.createElement('div');
        header.className = 'sr-modal-header';

        const titleEl = document.createElement('h3');
        titleEl.className = 'sr-h3';
        titleEl.textContent = 'Manage Saved Searches';

        const closeTopBtn = document.createElement('button');
        closeTopBtn.id = 'sr-close-top-btn';
        closeTopBtn.className = 'sr-close-top';
        closeTopBtn.textContent = '\u00D7';

        header.appendChild(titleEl);
        header.appendChild(closeTopBtn);
        modal.appendChild(header);

        const listContainer = document.createElement('div');
        listContainer.id = 'sr-rules-list-container';
        listContainer.className = 'sr-list-container';
        modal.appendChild(listContainer);

        const footer = document.createElement('div');
        footer.className = 'sr-modal-footer';

        const leftBtns = document.createElement('div');
        leftBtns.className = 'sr-left-btns';

        const importBtn = document.createElement('button');
        importBtn.id = 'sr-import-json-btn';
        importBtn.className = 'sr-btn sm';
        importBtn.textContent = 'Import JSON';

        const exportBtn = document.createElement('button');
        exportBtn.id = 'sr-export-json-btn';
        exportBtn.className = 'sr-btn sm';
        exportBtn.textContent = 'Export JSON';

        leftBtns.appendChild(importBtn);
        leftBtns.appendChild(exportBtn);

        const closeModalBtn = document.createElement('button');
        closeModalBtn.id = 'sr-close-modal-btn';
        closeModalBtn.className = 'sr-btn';
        closeModalBtn.textContent = 'Close';

        footer.appendChild(leftBtns);
        footer.appendChild(closeModalBtn);
        modal.appendChild(footer);

        overlay.appendChild(modal);
        shadow.appendChild(overlay);

        const closeModal = () => overlay.remove();
        closeTopBtn.addEventListener('click', closeModal);
        closeModalBtn.addEventListener('click', closeModal);
        exportBtn.addEventListener('click', exportSavedSearches);
        importBtn.addEventListener('click', () => importSavedSearches(renderListContent));

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });

        renderListContent();
    }

    function openEditRuleModal(index, onSavedCallback) {
        const shadow = getShadowRoot();
        const searches = getSavedSearches();
        const rule = searches[index];
        if (!rule) return;

        const overlay = document.createElement('div');
        overlay.className = 'sr-overlay submodal';

        const modal = document.createElement('div');
        modal.className = 'sr-modal edit';

        const h3 = document.createElement('h3');
        h3.className = 'sr-h3 sub';
        h3.textContent = 'Edit Saved Search Rule';
        modal.appendChild(h3);

        // Type Select
        const typeGroup = document.createElement('div');
        typeGroup.className = 'sr-form-group sm';

        const typeLabel = document.createElement('label');
        typeLabel.className = 'sr-label sm';
        typeLabel.textContent = 'Type:';

        const editTypeSelect = document.createElement('select');
        editTypeSelect.id = 'sr-edit-type';
        editTypeSelect.className = 'sr-select';

        const optText = document.createElement('option');
        optText.value = 'text';
        optText.textContent = 'Text';
        optText.selected = rule.type === 'text';

        const optRegex = document.createElement('option');
        optRegex.value = 'regex';
        optRegex.textContent = 'Regex';
        optRegex.selected = rule.type === 'regex';

        editTypeSelect.appendChild(optText);
        editTypeSelect.appendChild(optRegex);
        typeGroup.appendChild(typeLabel);
        typeGroup.appendChild(editTypeSelect);
        modal.appendChild(typeGroup);

        // Target URL Pattern Input
        const targetGroup = document.createElement('div');
        targetGroup.className = 'sr-form-group sm';

        const targetLabel = document.createElement('label');
        targetLabel.className = 'sr-label sm';
        targetLabel.textContent = 'Target URL Pattern:';

        const targetInput = document.createElement('input');
        targetInput.type = 'text';
        targetInput.id = 'sr-edit-target';
        targetInput.className = 'sr-input';
        targetInput.value = rule.target || '*';

        targetGroup.appendChild(targetLabel);
        targetGroup.appendChild(targetInput);
        modal.appendChild(targetGroup);

        // Pattern Input
        const patternGroup = document.createElement('div');
        patternGroup.className = 'sr-form-group sm';

        const patternLabel = document.createElement('label');
        patternLabel.className = 'sr-label sm';
        patternLabel.textContent = 'Pattern:';

        const patternInput = document.createElement('input');
        patternInput.type = 'text';
        patternInput.id = 'sr-edit-pattern';
        patternInput.className = 'sr-input';
        patternInput.value = rule.pattern || '';

        patternGroup.appendChild(patternLabel);
        patternGroup.appendChild(patternInput);
        modal.appendChild(patternGroup);

        // Replacement Input
        const replacementGroup = document.createElement('div');
        replacementGroup.className = 'sr-form-group sm';

        const replacementLabel = document.createElement('label');
        replacementLabel.className = 'sr-label sm';
        replacementLabel.textContent = 'Replacement:';

        const replacementInput = document.createElement('input');
        replacementInput.type = 'text';
        replacementInput.id = 'sr-edit-replacement';
        replacementInput.className = 'sr-input';
        replacementInput.value = rule.replacement || '';

        replacementGroup.appendChild(replacementLabel);
        replacementGroup.appendChild(replacementInput);
        modal.appendChild(replacementGroup);

        // Match Case Checkbox Container
        const editCaseContainer = document.createElement('div');
        editCaseContainer.id = 'sr-edit-case-container';
        editCaseContainer.className = 'sr-checkbox-group edit';
        editCaseContainer.style.display = rule.type === 'text' ? 'flex' : 'none';

        const caseCheckbox = document.createElement('input');
        caseCheckbox.type = 'checkbox';
        caseCheckbox.id = 'sr-edit-case';
        caseCheckbox.className = 'sr-checkbox';
        caseCheckbox.checked = Boolean(rule.caseSensitive);

        const caseLabel = document.createElement('label');
        caseLabel.htmlFor = 'sr-edit-case';
        caseLabel.className = 'sr-checkbox-label';
        caseLabel.textContent = 'Match Case';

        editCaseContainer.appendChild(caseCheckbox);
        editCaseContainer.appendChild(caseLabel);
        modal.appendChild(editCaseContainer);

        // Action Buttons
        const btnGroup = document.createElement('div');
        btnGroup.className = 'sr-btn-group';

        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'sr-edit-cancel';
        cancelBtn.className = 'sr-btn';
        cancelBtn.textContent = 'Cancel';

        const saveBtn = document.createElement('button');
        saveBtn.id = 'sr-edit-save';
        saveBtn.className = 'sr-btn primary';
        saveBtn.textContent = 'Save Changes';

        btnGroup.appendChild(cancelBtn);
        btnGroup.appendChild(saveBtn);
        modal.appendChild(btnGroup);

        overlay.appendChild(modal);
        shadow.appendChild(overlay);

        editTypeSelect.addEventListener('change', () => {
            editCaseContainer.style.display = editTypeSelect.value === 'text' ? 'flex' : 'none';
        });

        const closeSubModal = () => overlay.remove();

        cancelBtn.addEventListener('click', closeSubModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeSubModal();
        });

        saveBtn.addEventListener('click', () => {
            const updatedType = editTypeSelect.value;
            const updatedTarget = targetInput.value.trim();
            const updatedPattern = patternInput.value;
            const updatedReplacement = replacementInput.value;
            const updatedCaseSensitive = caseCheckbox.checked;

            if (!updatedPattern) {
                showToast('Pattern cannot be empty.', true);
                return;
            }

            updateSavedSearchRule(index, {
                target: updatedTarget || '*',
                type: updatedType,
                pattern: updatedPattern,
                replacement: updatedReplacement,
                caseSensitive: updatedType === 'text' ? updatedCaseSensitive : false
            });

            closeSubModal();
            onSavedCallback();
            showToast('Search rule updated successfully.');
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function escapeAttr(str) {
        if (!str) return '';
        return str.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function handleTextSearchReplace() {
        createSearchModal({
            title: 'Text Search and Replace',
            isRegexMode: false,
            onSubmit: ({ searchValue, replaceValue, isCaseSensitive }) => {
                try {
                    const flags = isCaseSensitive ? 'g' : 'gi';
                    const regex = new RegExp(escapeRegExp(searchValue), flags);
                    const result = executeReplacement(regex, replaceValue);

                    if (result.totalReplacements > 0) {
                        showToast(`Replaced ${result.totalReplacements} occurrence(s) across ${result.nodesModified} text node(s).`);
                    } else {
                        showToast(`No occurrences of "${searchValue}" were found.`, true);
                    }
                } catch (err) {
                    showToast(`Error performing replacement: ${err.message}`, true);
                }
            }
        });
    }

    function handleRegexSearchReplace() {
        createSearchModal({
            title: 'Regex Search and Replace',
            isRegexMode: true,
            onSubmit: ({ searchValue, replaceValue }) => {
                try {
                    let regex;
                    const match = searchValue.match(/^\/(.+)\/([gimsuy]*)$/);

                    if (match) {
                        const flags = match[2].includes('g') ? match[2] : match[2] + 'g';
                        regex = new RegExp(match[1], flags);
                    } else {
                        regex = new RegExp(searchValue, CONFIG.DEFAULT_REGEX_FLAGS);
                    }

                    const result = executeReplacement(regex, replaceValue);

                    if (result.totalReplacements > 0) {
                        showToast(`Replaced ${result.totalReplacements} match(es) across ${result.nodesModified} text node(s).`);
                    } else {
                        showToast(`No matches found for regex pattern: ${searchValue}`, true);
                    }
                } catch (err) {
                    showToast(`Invalid Regex Pattern: ${err.message}`, true);
                }
            }
        });
    }

    function runStartupAutomations() {
        const searches = getSavedSearches();
        if (!searches || searches.length === 0) return;

        const currentHref = window.location.href;
        let executedCount = 0;

        searches.forEach(rule => {
            if (matchUrlPattern(rule.target, currentHref)) {
                try {
                    let regex;
                    if (rule.type === 'regex') {
                        const match = rule.pattern.match(/^\/(.+)\/([gimsuy]*)$/);
                        if (match) {
                            const flags = match[2].includes('g') ? match[2] : match[2] + 'g';
                            regex = new RegExp(match[1], flags);
                        } else {
                            regex = new RegExp(rule.pattern, CONFIG.DEFAULT_REGEX_FLAGS);
                        }
                    } else {
                        const flags = rule.caseSensitive ? 'g' : 'gi';
                        regex = new RegExp(escapeRegExp(rule.pattern), flags);
                    }

                    const result = executeReplacement(regex, rule.replacement || '');
                    if (result.totalReplacements > 0) {
                        executedCount++;
                    }
                } catch (err) {
                    console.error('[Search & Replace] Error executing startup rule:', err);
                }
            }
        });

        if (executedCount > 0) {
            showToast(`Auto-applied ${executedCount} saved search rule(s) on startup.`);
        }
    }

    if (typeof GM_registerMenuCommand !== 'undefined') {
        GM_registerMenuCommand('Text Search and Replace', handleTextSearchReplace);
        GM_registerMenuCommand('Regex Search and Replace', handleRegexSearchReplace);
        GM_registerMenuCommand('Manage saved search', openManageSearchesModal);
    } else {
        console.warn('[Search & Replace Userscript] GM_registerMenuCommand is not available.');
    }

    function delayedStartup() {
        setTimeout(runStartupAutomations, CONFIG.DEFAULT_SEARCH_STARTUP);
    }

    // Trigger startup automation when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', delayedStartup);
    } else {
        delayedStartup();
    }

})();