// ==UserScript==
// @name         Automatic Task Executor
// @namespace    https://docs.scriptcat.org/
// @version      2.5.2
// @description  Let your web browser execute tasks automatically.
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @noframes
// ==/UserScript==

(function() {
'use strict';

/* STREAMING_CHUNK:Configuring userscript options and defaults... */

// Default configuration and constants
const CONFIG = {
    STORAGE_KEY: 'ate_tasks_list_v1',
    SYNC_CHANNEL_NAME: 'ate_tasks_sync_channel',
    DEFAULT_DELAY_MS: 1000,
    POLL_INTERVAL_MS: 200,
    DEBUG_MODE: true
};

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
        console.warn('[Task Executor] Failed to adopt stylesheet:', err);
    }
}

// Logging helper
const log = {
    info: (...args) => CONFIG.DEBUG_MODE && console.log('[Task Executor]', ...args),
    warn: (...args) => console.warn('[Task Executor]', ...args),
    error: (...args) => console.error('[Task Executor]', ...args)
};

/* STREAMING_CHUNK:Defining storage manager and initial state... */

// Storage wrapper supporting GM functions with fallback to localStorage
const Storage = {
    get: function(key, defaultValue) {
        try {
            if (typeof GM_getValue === 'function') {
                return JSON.parse(GM_getValue(key, JSON.stringify(defaultValue)));
            }
            const localData = localStorage.getItem(key);
            return localData ? JSON.parse(localData) : defaultValue;
        } catch (err) {
            log.error('Storage read error:', err);
            return defaultValue;
        }
    },
    set: function(key, value) {
        try {
            const strValue = JSON.stringify(value);
            if (typeof GM_setValue === 'function') {
                GM_setValue(key, strValue);
            } else {
                localStorage.setItem(key, strValue);
            }
            // Broadcast sync event to other tabs
            broadcastTaskUpdate(value);
        } catch (err) {
            log.error('Storage write error:', err);
        }
    }
};

// Initialize BroadcastChannel for same-origin messaging
const syncChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CONFIG.SYNC_CHANNEL_NAME) : null;

/**
 * Broadcasts updated task list to other active tabs/windows
 */
function broadcastTaskUpdate(tasks) {
    if (syncChannel) {
        try {
            syncChannel.postMessage({ type: 'TASKS_UPDATED', tasks });
        } catch (err) {
            log.error('BroadcastChannel post error:', err);
        }
    }
}

/**
 * Initializes listeners for cross-tab storage changes
 */
function initTaskSync() {
    const handleRemoteTasksUpdate = (newTasks) => {
        log.info('Synchronized updated tasks from another tab/window');
        currentTasks = newTasks;

        // If manager modal is open inside shadow DOM, re-render task list dynamically
        const modal = getShadowElement('ate-modal-root');
        if (modal && modal.style.display !== 'none') {
            if (activeTaskIndex >= currentTasks.length) {
                activeTaskIndex = Math.max(0, currentTasks.length - 1);
            }
            renderTaskList();
            loadActiveTaskIntoEditor();
        }
    };

    // 1. BroadcastChannel Listener (Same-origin active tabs)
    if (syncChannel) {
        syncChannel.onmessage = (event) => {
            if (event.data && event.data.type === 'TASKS_UPDATED' && Array.isArray(event.data.tasks)) {
                handleRemoteTasksUpdate(event.data.tasks);
            }
        };
    }

    // 2. Standard localStorage Listener Fallback
    window.addEventListener('storage', (event) => {
        if (event.key === CONFIG.STORAGE_KEY && event.newValue) {
            try {
                const parsed = JSON.parse(event.newValue);
                if (Array.isArray(parsed)) {
                    handleRemoteTasksUpdate(parsed);
                }
            } catch (e) {
                log.error('Storage event sync error:', e);
            }
        }
    });

    // 3. GM_addValueChangeListener (Userscript manager cross-domain storage sync)
    if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(CONFIG.STORAGE_KEY, (name, oldValue, newValue, remote) => {
            if (remote && newValue) {
                try {
                    const parsed = typeof newValue === 'string' ? JSON.parse(newValue) : newValue;
                    if (Array.isArray(parsed)) {
                        handleRemoteTasksUpdate(parsed);
                    }
                } catch (e) {
                    log.error('GM listener sync error:', e);
                }
            }
        });
    }
}

/* STREAMING_CHUNK:Defining target matching and URL helper functions... */

/**
 * Checks if the given target string matches the current page URL.
 * Supports:
 * - full url: https://example.com/path?query
 * - hostname: example.com
 * - hostname/path: example.com/path
 * - hostname/path?query: example.com/path?query
 * - proto://hostname
 * - glob wildcards using *
 */
function matchesTarget(targetPattern, currentUrlStr = window.location.href) {
    if (!targetPattern || typeof targetPattern !== 'string') return false;

    const cleanPattern = targetPattern.trim();
    if (!cleanPattern) return false;

    const currentUrl = new URL(currentUrlStr);
    const hostAndPath = currentUrl.host + currentUrl.pathname + currentUrl.search;

    // Convert wildcard pattern into regex pattern
    const wildcardToRegex = (pat) => {
        const escaped = pat.replace(/([.+?^${}()|[\]\\])/g, '\\$1');
        return new RegExp('^' + escaped.replace(/\*/g, '.*') + '$', 'i');
    };

    // 1. Full URL pattern with protocol (e.g., http://*, https://domain.com/path)
    if (cleanPattern.includes('://')) {
        return wildcardToRegex(cleanPattern).test(currentUrlStr);
    }

    // 2. Pattern starts with domain or host/path (e.g., google.com, example.com/login)
    if (cleanPattern.includes('/')) {
        return wildcardToRegex(cleanPattern).test(hostAndPath) || 
               wildcardToRegex(cleanPattern).test(currentUrl.host + currentUrl.pathname);
    }

    // 3. Pure hostname comparison (e.g., example.com or *.example.com)
    return wildcardToRegex(cleanPattern).test(currentUrl.hostname) ||
           wildcardToRegex(cleanPattern).test(currentUrl.host);
}

/* STREAMING_CHUNK:Implementing command string tokenizer and parser... */

/**
 * Tokenizes a command line respecting quoted strings ("..." or '...')
 */
function tokenizeLine(line) {
    const tokens = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    // Strip line comments starting with # (when not inside quotes)
    let cleanLine = line.trim();
    
    for (let i = 0; i < cleanLine.length; i++) {
        const char = cleanLine[i];

        if (char === '#' && !inQuote) {
            // Ignore rest of the line as comment
            break;
        }

        if ((char === '"' || char === "'") && !inQuote) {
            inQuote = true;
            quoteChar = char;
        } else if (char === quoteChar && inQuote) {
            inQuote = false;
            quoteChar = '';
        } else if (/\s/.test(char) && !inQuote) {
            if (current.length > 0) {
                tokens.push(current);
                current = '';
            }
        } else {
            current += char;
        }
    }

    if (current.length > 0) {
        tokens.push(current);
    }

    return tokens;
}

/**
 * Parses a single script line into execution command object
 * For/mat: <command> [delay_ms] [args...]
 */
function parseCommandLine(line) {
    const tokens = tokenizeLine(line);
    if (tokens.length === 0) return null;

    const cmdName = tokens[0].toLowerCase();
    let argStartIndex = 1;

    const args = tokens.slice(argStartIndex);

    return {
        raw: line,
        command: cmdName,
        args: args
    };
}

/* STREAMING_CHUNK:Registering extensible task commands registry... */

/**
 * DOM Helper to wait for an element to appear (waits infinitely)
 */
function waitForElement(selector) {
    return new Promise((resolve) => {
        const existing = document.querySelector(selector);
        if (existing) return resolve(existing);

        const interval = setInterval(() => {
            const el = document.querySelector(selector);
            if (el) {
                clearInterval(interval);
                resolve(el);
            }
        }, CONFIG.POLL_INTERVAL_MS);
    });
}

/**
 * DOM Helper to wait for multiple elements to appear (waits infinitely)
 */
function waitForElements(selectors) {
    return new Promise((resolve) => {
        // Check if all elements already exist
        const existing = selectors.map(selector => document.querySelector(selector));
        if (existing.every(el => el)) return resolve(existing);

        const interval = setInterval(() => {
            const elements = selectors.map(selector => document.querySelector(selector));
            
            // If all elements found, resolve with array
            if (elements.every(el => el)) {
                clearInterval(interval);
                resolve(elements);
            }
        }, CONFIG.POLL_INTERVAL_MS);
    });
}

/**
 * DOM Helper to wait for all elements matching selectors to appear (waits infinitely)
 */
function waitForAllElements(selectors) {
    return new Promise((resolve) => {
        // Check if all selectors have at least one element
        const existing = selectors.map(selector => Array.from(document.querySelectorAll(selector)));
        if (existing.every(arr => arr.length > 0)) return resolve(existing);

        const interval = setInterval(() => {
            const elements = selectors.map(selector => Array.from(document.querySelectorAll(selector)));
            
            // If all selectors have at least one element, resolve with array of element arrays
            if (elements.every(arr => arr.length > 0)) {
                clearInterval(interval);
                resolve(elements);
            }
        }, CONFIG.POLL_INTERVAL_MS);
    });
}

/**
 * COMMAND REGISTRY
 * Easily extensible map of command handlers.
 * Each handler receives (args, rawLine)
 */
const COMMAND_REGISTRY = {
    /**
     * delay <delay:default=1000ms>
     */
    delay: async (args) => {
        let delay=CONFIG.DEFAULT_DELAY_MS;
        let delayStr=String(delay);
        if(args.length>0){
            delayStr=args[0];
        }
        const delayMatch = delayStr.match(/^(\d+)(ms)?$/i);
        if (delayMatch) {
            delay = parseInt(delayMatch[1], 10);
        }
        log.info(`Executing delay command for ${delay} ms`);
        await sleep(delay);
        return true;
    },

    /**
     * Waits for one selector
     * waitfor <selector>
     */
    waitfor: async (args) => {
        const [selector] = args;
        if (!selector) throw new Error('Missing CSS selector to wait');
        log.info(`waiting for element: ${selector}`);
        await waitForElement(selector);
        log.info(`element exist: ${selector}`);
        return true;
    },

    /**
     * Waits for all matching elements from multiple selectors
     * waitforall <selector1> <selector2>...
     */
    waitforall: async (args) => {
        if (args.length === 0) throw new Error('Missing CSS selectors to wait');
        log.info(`waiting for all matching elements: ${args.join(', ')}`);
        await waitForAllElements(args);
        log.info(`all elements exist: ${args.join(', ')}`);
        return true;
    },

    /**
     * Waits for one element from each selector
     * waitforthese <selector1> <selector2>...
     */
    waitforthese: async (args) => {
        if (args.length === 0) throw new Error('Missing CSS selectors to wait');
        log.info(`waiting for elements: ${args.join(', ')}`);
        await waitForElements(args);
        log.info(`all elements exist: ${args.join(', ')}`);
        return true;
    },

    /**
     * click <css_selector>
     */
    click: async (args) => {
        const [selector] = args;
        if (!selector) throw new Error('Missing CSS selector for click');
        const el = document.querySelector(selector);
        if (!el) throw new Error(`Element not found: ${selector}`);
        
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.click();
        log.info(`Clicked element: ${selector}`);
        return true;
    },

    /**
     * clicks <css_selector>
     */
    clicks: async (args) => {
        const [selector] = args;
        if (!selector) throw new Error('Missing CSS selector for clicks');
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) throw new Error(`No elements found to click: ${selector}`);
        
        elements.forEach((el) => {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.click();
        });
        log.info(`Clicked ${elements.length} element(s) matching: ${selector}`);
        return true;
    },

    /**
     * remove <css_selector>
     */
    remove: async (args) => {
        const [selector] = args;
        if (!selector) throw new Error('Missing CSS selector for remove');
        
        const el = document.querySelector(selector);
        if (!el) throw new Error(`Element not found to remove: ${selector}`);
        
        el.remove();
        log.info(`Removed element: ${selector}`);
        return true;
    },

    /**
     * removes <css_selector>
     */
    removes: async (args) => {
        const [selector] = args;
        if (!selector) throw new Error('Missing CSS selector for removes');
        
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) throw new Error(`No elements found to remove: ${selector}`);
        
        elements.forEach(el => el.remove());
        log.info(`Removed ${elements.length} element(s) matching: ${selector}`);
        return true;
    },

    /**
     * input <css_selector> "Text to input"
     */
    input: async (args) => {
        const [selector, text = ''] = args;
        if (!selector) throw new Error('Missing CSS selector for input');
        const el = document.querySelector(selector);
        if (!el) throw new Error(`Input element not found: ${selector}`);

        el.focus();
        el.value = text;
        // Dispatch standard input events for reactive frameworks (React, Vue, Angular)
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        log.info(`Updated input value for ${selector}`);
        return true;
    },

    /**
     * inputs <css_selector> "Text to input"
     */
    inputs: async (args) => {
        const [selector, text = ''] = args;
        if (!selector) throw new Error('Missing CSS selector for inputs');
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) throw new Error(`No input elements found: ${selector}`);

        elements.forEach(el => {
            el.focus();
            el.value = text;
            // Dispatch standard input events for reactive frameworks (React, Vue, Angular)
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.blur();
        });
        log.info(`Updated ${elements.length} input element(s) matching ${selector}`);
        return true;
    },

    /**
     * check <css_selector> on|off
     */
    check: async (args) => {
        const [selector, state = 'on'] = args;
        if (!selector) throw new Error('Missing CSS selector for check');
        const el = document.querySelector(selector);
        if (!el) throw new Error(`Checkbox/Radio element not found: ${selector}`);

        const shouldCheck = state.toLowerCase() === 'on' || state.toLowerCase() === 'true' || state === '1';
        if (el.checked !== shouldCheck) {
            el.click();
        }
        log.info(`Set checkbox ${selector} state to: ${shouldCheck}`);
        return true;
    },

    /**
     * checks <css_selector> on|off
     */
    checks: async (args) => {
        const [selector, state = 'on'] = args;
        if (!selector) throw new Error('Missing CSS selector for checks');
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) throw new Error(`No checkbox/radio elements found: ${selector}`);

        const shouldCheck = state.toLowerCase() === 'on' || state.toLowerCase() === 'true' || state === '1';
        elements.forEach(el => {
            if (el.checked !== shouldCheck) {
                el.click();
            }
        });
        log.info(`Set ${elements.length} checkbox/radio element(s) matching ${selector} state to: ${shouldCheck}`);
        return true;
    },

    /**
     * textcontent <css_selector> "Text data"
     */
    textcontent: async (args) => {
        const [selector, text = ''] = args;
        if (!selector) throw new Error('Missing CSS selector for textcontent');
        const el = document.querySelector(selector);
        if (!el) throw new Error(`Element not found: ${selector}`);

        el.textContent = text;
        log.info(`Set textContent for ${selector}"`);
        return true;
    },

    /**
     * textcontents <css_selector> "Text data"
     */
    textcontents: async (args) => {
        const [selector, text = ''] = args;
        if (!selector) throw new Error('Missing CSS selector for textcontents');
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) throw new Error(`No elements found: ${selector}`);

        elements.forEach(el => {
            el.textContent = text;
        });
        log.info(`Set textContent for ${elements.length} element(s) matching ${selector}"`);
        return true;
    },

    /**
     * innertext <css_selector> "Text data"
     */
    innertext: async (args) => {
        const [selector, text = ''] = args;
        if (!selector) throw new Error('Missing CSS selector for innertext');
        const el = document.querySelector(selector);
        if (!el) throw new Error(`Element not found: ${selector}`);

        el.innerText = text;
        log.info(`Set innerText for ${selector}`);
        return true;
    },

    /**
     * innertexts <css_selector> "Text data"
     */
    innertexts: async (args) => {
        const [selector, text = ''] = args;
        if (!selector) throw new Error('Missing CSS selector for innertexts');
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) throw new Error(`No elements found: ${selector}`);

        elements.forEach(el => {
            el.innerText = text;
        });
        log.info(`Set innerText for ${elements.length} element(s) matching ${selector}`);
        return true;
    },

    /**
     * innerhtml <css_selector> "Html data"
     */
    innerhtml: async (args) => {
        const [selector, htmlData = ''] = args;
        if (!selector) throw new Error('Missing CSS selector for innerhtml');
        const el = document.querySelector(selector);
        if (!el) throw new Error(`Element not found: ${selector}`);

        safeSetInnerHTML(el, htmlData);
        log.info(`Set innerHTML for ${selector}`);
        return true;
    },

    /**
     * innerhtmls <css_selector> "Html data"
     */
    innerhtmls: async (args) => {
        const [selector, htmlData = ''] = args;
        if (!selector) throw new Error('Missing CSS selector for innerhtmls');
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) throw new Error(`No elements found: ${selector}`);

        elements.forEach(el => {
            safeSetInnerHTML(el, htmlData);
        });
        log.info(`Set innerHTML for ${elements.length} element(s) matching ${selector}`);
        return true;
    },

    /**
     * replace "search" "replacement"
     */
    replace: async (args) => {
        const [search, replacement = ''] = args;
        if (!search) throw new Error('Missing search string for replace');
        
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        let node;
        let count = 0;
        
        while ((node = walker.nextNode())) {
            const originalText = node.textContent;
            const newText = originalText.replaceAll(search, replacement);
            if (newText !== originalText) {
                node.textContent = newText;
                count++;
            }
        }
        
        log.info(`Replaced "${search}" with "${replacement}" in ${count} text node(s)`);
        return true;
    },

    /**
     * regex "search" "replacement"
     */
    regex: async (args) => {
        const [pattern, replacement = ''] = args;
        if (!pattern) throw new Error('Missing regex pattern for regex');
        
        try {
            const regex = new RegExp(pattern, 'g');
            
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            let node;
            let count = 0;
            
            while ((node = walker.nextNode())) {
                const originalText = node.textContent;
                const newText = originalText.replace(regex, replacement);
                if (newText !== originalText) {
                    node.textContent = newText;
                    count++;
                }
            }
            
            log.info(`Replaced pattern /${pattern}/g with "${replacement}" in ${count} text node(s)`);
            return true;
        } catch (err) {
            throw new Error(`Invalid regex pattern: ${pattern} - ${err.message}`);
        }
    }

};

/* STREAMING_CHUNK:Creating execution engine and task runner... */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes a single task's list of script commands line-by-line
 */
async function executeTaskScript(task) {
    log.info(`Starting execution of target: ${task.target}`);
    if (!Array.isArray(task.script)) return;

    for (let i = 0; i < task.script.length; i++) {
        const rawLine = task.script[i];
        const parsed = parseCommandLine(rawLine);

        if (!parsed) continue; // Empty or comment line

        const handler = COMMAND_REGISTRY[parsed.command];
        if (!handler) {
            log.warn(`Unknown command: "${parsed.command}" at line ${i + 1}`);
            continue;
        }

        try {
            await handler(parsed.args, rawLine);
        } catch (err) {
            log.error(`Error executing line ${i + 1} (${rawLine}):`, err.message);
        }
    }
    log.info(`Finished execution of target: ${task.target}`);
}

/**
 * Finds and executes all tasks matching current page
 */
async function runMatchingTasks() {
    const tasks = Storage.get(CONFIG.STORAGE_KEY, getSampleTasks());
    const matchingTasks = tasks.filter(t => matchesTarget(t.target));

    if (matchingTasks.length === 0) {
        log.info('No matching automatic tasks for current page.');
        return;
    }

    log.info(`Found ${matchingTasks.length} task(s) matching current page.`);
    for (const task of matchingTasks) {
        executeTaskScript(task); // Run tasks in parallel
    }
}

/* STREAMING_CHUNK:Defining sample default tasks... */
function getSampleTasks() {
    return [
        {
            "target": "example.com",
            "script": [
                "# Sample task for example.com",
                "delay 10000",
                "click a"
            ]
        },
        {
            "target": "example.com",
            "script": [
                "delay 2000",
                "innertext p 'Automatic Task Executor Loaded!'"
            ]
        },
        {
            "target": "www.iana.org/help/example-domains",
            "script": [
                "delay 2000",
                "innertext h1 'Example Domains | Automatic Task Executor Loaded!'"
            ]
        }
    ];
}

/* STREAMING_CHUNK:Injecting custom CSS styles for the modal UI... */
const MODAL_STYLES = `
    .ate-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(15, 23, 42, 0.75);
        backdrop-filter: blur(8px);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #f8fafc;
    }

    .ate-modal-container {
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 12px;
        width: 900px;
        max-width: 92vw;
        height: 650px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        overflow: hidden;
    }

    .ate-modal-header {
        padding: 16px 24px;
        background: #0f172a;
        border-bottom: 1px solid #334155;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .ate-modal-title {
        font-size: 1.25rem;
        font-weight: 600;
        color: #38bdf8;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .ate-close-btn {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 24px;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 6px;
        transition: all 0.2s;
    }

    .ate-close-btn:hover {
        color: #f1f5f9;
        background: #334155;
    }

    .ate-modal-body {
        display: flex;
        flex: 1;
        overflow: hidden;
    }

    .ate-sidebar {
        width: 260px;
        background: #0f172a;
        border-right: 1px solid #334155;
        display: flex;
        flex-direction: column;
        padding: 12px;
    }

    .ate-task-list {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 8px;
    }

    .ate-task-item {
        padding: 10px 12px;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .ate-task-item:hover {
        border-color: #38bdf8;
        background: #334155;
    }

    .ate-task-item.active {
        border-color: #38bdf8;
        background: #0284c7;
        color: #ffffff;
    }

    .ate-task-name {
        font-size: 0.9rem;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 170px;
    }

    .ate-editor-area {
        flex: 1;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        background: #1e293b;
        overflow-y: auto;
    }

    .ate-form-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .ate-label {
        font-size: 0.85rem;
        font-weight: 600;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .ate-input {
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 6px;
        padding: 10px 14px;
        color: #f8fafc;
        font-size: 0.95rem;
        outline: none;
        transition: border-color 0.2s;
    }

    .ate-input:focus {
        border-color: #38bdf8;
    }

    .ate-textarea {
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 6px;
        padding: 12px 14px;
        color: #38bdf8;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.9rem;
        line-height: 1.5;
        resize: vertical;
        min-height: 240px;
        outline: none;
        flex: 1;
    }

    .ate-textarea:focus {
        border-color: #38bdf8;
    }

    .ate-btn-group {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        margin-top: 8px;
    }

    .ate-btn {
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: all 0.2s;
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }

    .ate-btn-primary {
        background: #0284c7;
        color: white;
    }

    .ate-btn-primary:hover {
        background: #0369a1;
    }

    .ate-btn-danger {
        background: #ef4444;
        color: white;
    }

    .ate-btn-danger:hover {
        background: #dc2626;
    }

    .ate-btn-secondary {
        background: #334155;
        color: #f8fafc;
    }

    .ate-btn-secondary:hover {
        background: #475569;
    }

    .ate-cheatsheet {
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 6px;
        padding: 10px 14px;
        font-size: 0.8rem;
        color: #94a3b8;
        line-height: 1.4;
    }

    .ate-cheatsheet code {
        color: #f43f5e;
        background: #1e293b;
        padding: 2px 4px;
        margin-left: 20px;
        border-radius: 4px;
    }
`;

let activeTaskIndex = 0;
let currentTasks = [];
let shadowHost = null;
let shadowRoot = null;

/**
 * Gets an element by ID inside the UI Shadow Root
 */
function getShadowElement(id) {
    return shadowRoot ? shadowRoot.getElementById(id) : null;
}

/**
 * Safely updates element content without triggering TrustedHTML / CSP sink violations
 */
function safeSetInnerHTML(element, htmlStr) {
    element.replaceChildren();
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlStr, 'text/html');
        while (doc.body.firstChild) {
            element.appendChild(doc.body.firstChild);
        }
    } catch (err) {
        log.error('safeSetInnerHTML failed, falling back to textContent:', err);
        element.textContent = htmlStr;
    }
}

/**
 * Programmatic DOM builder to bypass TrustedType restrictions
 */
function createElement(tag, props = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'style' && typeof value === 'object') {
            Object.assign(element.style, value);
        } else if (key.startsWith('on') && typeof value === 'function') {
            element.addEventListener(key.substring(2).toLowerCase(), value);
        } else if (key === 'className') {
            element.className = value;
        } else if (key === 'textContent') {
            element.textContent = value;
        } else {
            element.setAttribute(key, value);
        }
    }
    for (const child of children) {
        if (child === null || child === undefined) continue;
        if (typeof child === 'string' || typeof child === 'number') {
            element.appendChild(document.createTextNode(String(child)));
        } else if (child instanceof Node) {
            element.appendChild(child);
        } else if (Array.isArray(child)) {
            child.forEach(c => {
                if (c instanceof Node) element.appendChild(c);
                else if (typeof c === 'string' || typeof c === 'number') {
                    element.appendChild(document.createTextNode(String(c)));
                }
            });
        }
    }
    return element;
}

function buildCheatsheetElement() {
    const cheatsheet = createElement('div', { className: 'ate-cheatsheet' },
        createElement('strong', { style: { color: 'white' } }, 'Commands:'),
        createElement('br')
    );

    const commands = [
        { code: 'delay <delay_ms>', title: 'wait for timeout' },
        { code: 'click <selector>', title: 'click on an HTML element' },
        { code: 'clicks <selector>', title: 'click on all selected HTML elements' },
        { code: 'input <selector> "text"', title: 'change value of an HTML input element' },
        { code: 'inputs <selector> "text"', title: 'change value of all selected HTML input element' },
        { code: 'remove <selector>', title: 'remove HTML elements from page' },
        { code: 'removes <selector>', title: 'remove all selected HTML elements from page' },
        { code: 'check <selector> on|off', title: 'check/uncheck value of a checkbox/radiobox HTML element' },
        { code: 'checks <selector> on|off', title: 'check/uncheck value of all selected checkbox/radiobox HTML element' },
        { code: 'innerhtml <selector> "html"', title: 'change value of innerHtml property of an HTML element' },
        { code: 'innerhtmls <selector> "html"', title: 'change value of all selected HTML element' },
        { code: 'innertext <selector> "text"', title: 'change value of innerText property of an HTML element' },
        { code: 'innertexts <selector> "text"', title: 'change value of innerText property of all selected HTML element' },
        { code: 'textcontent <selector> "text"', title: 'Change the textContent property of an HTML element' },
        { code: 'textcontents <selector> "text"', title: 'Change the textContent property of all selected HTML element' },
        { code: 'waitfor <selector>', title: 'Waits for one HTML element to exist' },
        { code: 'waitforall <selector1> <selector2>...', title: 'Waits for all matching HTML elements from multiple selectors to exist' },
        { code: 'waitforthese <selector1> <selector2>...', title: 'Waits for one HTML element from each selector to exist' },
        { code: 'replace <search> <replacement>', title: 'search and replace text in the page' },
        { code: 'regex <regex> <replacement>', title: 'regex search and replace text in the page' }
    ];

    commands.forEach(cmd => {
        cheatsheet.appendChild(createElement('code', { title: cmd.title }, cmd.code));
        cheatsheet.appendChild(createElement('br'));
    });

    return cheatsheet;
}

/**
 * Builds and opens the Task Management Modal UI inside Shadow DOM
 */
function openManagerModal() {
    // Create Shadow DOM host if not already initialized
    if (!shadowHost) {
        shadowHost = document.createElement('div');
        shadowHost.id = 'ate-modal-host';
        shadowRoot = shadowHost.attachShadow({ mode: 'open' });

        adoptStyleSheet(shadowRoot, MODAL_STYLES);

        (document.body || document.documentElement).appendChild(shadowHost);
    }

    // Check if modal container already exists inside shadow root
    let existingModal = getShadowElement('ate-modal-root');
    if (existingModal) {
        existingModal.style.display = 'flex';
        renderTaskList();
        return;
    }

    currentTasks = Storage.get(CONFIG.STORAGE_KEY, getSampleTasks());
    if (activeTaskIndex >= currentTasks.length) activeTaskIndex = 0;

    const modalOverlay = createElement('div', { id: 'ate-modal-root', className: 'ate-modal-overlay' },
        createElement('div', { className: 'ate-modal-container' },
            createElement('div', { className: 'ate-modal-header' },
                createElement('div', { className: 'ate-modal-title' },
                    createElement('span', {}, '⚡'),
                    ' Automatic Task Manager'
                ),
                createElement('button', { className: 'ate-close-btn', id: 'ate-close-btn' }, '×')
            ),
            createElement('div', { className: 'ate-modal-body' },
                createElement('div', { className: 'ate-sidebar' },
                    createElement('button', { className: 'ate-btn ate-btn-primary', id: 'ate-add-task-btn', style: { width: '100%' } }, '+ New Task'),
                    createElement('div', { className: 'ate-task-list', id: 'ate-task-list' })
                ),
                createElement('div', { className: 'ate-editor-area' },
                    createElement('div', { className: 'ate-form-group' },
                        createElement('label', { className: 'ate-label' }, 'Target URL / Host pattern'),
                        createElement('input', { type: 'text', id: 'ate-target-input', className: 'ate-input', placeholder: 'e.g. example.com or https://site.com/page' })
                    ),
                    createElement('div', { className: 'ate-form-group', style: { flex: '1', display: 'flex', flexDirection: 'column' } },
                        createElement('label', { className: 'ate-label' }, 'Script Commands (Line by Line)'),
                        createElement('textarea', { id: 'ate-script-input', className: 'ate-textarea', placeholder: 'delay 1000\nclick #submit-btn\ninput #email "user@example.com"' })
                    ),
                    buildCheatsheetElement(),
                    createElement('div', { className: 'ate-btn-group' },
                        createElement('button', { className: 'ate-btn ate-btn-danger', id: 'ate-delete-task-btn' }, 'Delete Task'),
                        createElement('button', { className: 'ate-btn ate-btn-secondary', id: 'ate-import-btn' }, 'Import JSON'),
                        createElement('button', { className: 'ate-btn ate-btn-secondary', id: 'ate-export-btn' }, 'Export JSON'),
                        createElement('button', { className: 'ate-btn ate-btn-primary', id: 'ate-save-task-btn' }, 'Save All Tasks'),
                        createElement('input', { type: 'file', id: 'ate-import-file-input', accept: '.json,application/json', style: { display: 'none' } })
                    )
                )
            )
        )
    );

    shadowRoot.appendChild(modalOverlay);

    // Attach DOM listeners inside shadow root
    getShadowElement('ate-close-btn').onclick = closeModal;
    modalOverlay.onclick = (e) => {
        if (e.target === modalOverlay) closeModal();
    };

    getShadowElement('ate-add-task-btn').onclick = () => {
        currentTasks.push({
            target: 'new-target.com',
            script: ['# New target task script', 'delay 1000']
        });
        activeTaskIndex = currentTasks.length - 1;
        renderTaskList();
        loadActiveTaskIntoEditor();
    };

    getShadowElement('ate-delete-task-btn').onclick = () => {
        if (currentTasks.length === 0) return;
        currentTasks.splice(activeTaskIndex, 1);
        if (activeTaskIndex >= currentTasks.length) {
            activeTaskIndex = Math.max(0, currentTasks.length - 1);
        }
        renderTaskList();
        loadActiveTaskIntoEditor();
    };

    getShadowElement('ate-save-task-btn').onclick = () => {
        saveCurrentEditorState();
        Storage.set(CONFIG.STORAGE_KEY, currentTasks);
        alert('Tasks saved successfully!');
        closeModal();
    };

    getShadowElement('ate-export-btn').onclick = () => {
        saveCurrentEditorState();
        const blob = new Blob([JSON.stringify(currentTasks, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'automatic-tasks.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    const importFileInput = getShadowElement('ate-import-file-input');
    getShadowElement('ate-import-btn').onclick = () => {
        if (importFileInput) {
            importFileInput.value = '';
            importFileInput.click();
        }
    };

    if (importFileInput) {
        importFileInput.onchange = (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const importedData = JSON.parse(event.target.result);
                    if (!Array.isArray(importedData)) {
                        log.error('Import error: JSON file must contain an array of task objects.');
                        return;
                    }

                    // Validate & normalize imported task objects
                    const validTasks = importedData.filter(item => item && typeof item === 'object').map(item => ({
                        target: typeof item.target === 'string' ? item.target : 'example.com',
                        script: Array.isArray(item.script) ? item.script : (typeof item.script === 'string' ? item.script.split('\n') : [])
                    }));

                    saveCurrentEditorState();
                    currentTasks = validTasks;
                    activeTaskIndex = 0;
                    renderTaskList();
                    loadActiveTaskIntoEditor();
                    log.info(`Successfully imported ${validTasks.length} task(s). Click 'Save All Tasks' to persist.`);
                } catch (err) {
                    log.error('Failed to parse JSON file:', err);
                }
            };
            reader.readAsText(file);
        };
    }

    renderTaskList();
    loadActiveTaskIntoEditor();
}

function closeModal() {
    const modal = getShadowElement('ate-modal-root');
    if (modal) {
        modal.style.display = 'none';
    }
}

function saveCurrentEditorState() {
    if (currentTasks.length === 0 || activeTaskIndex < 0 || activeTaskIndex >= currentTasks.length) return;

    const targetInput = getShadowElement('ate-target-input');
    const scriptInput = getShadowElement('ate-script-input');

    if (targetInput && scriptInput) {
        currentTasks[activeTaskIndex].target = targetInput.value.trim();
        currentTasks[activeTaskIndex].script = scriptInput.value.split('\n');
    }
}

function renderTaskList() {
    const listContainer = getShadowElement('ate-task-list');
    if (!listContainer) return;

    listContainer.replaceChildren();
    currentTasks.forEach((task, idx) => {
        const item = createElement('div', {
            className: `ate-task-item ${idx === activeTaskIndex ? 'active' : ''}`,
            onclick: () => {
                saveCurrentEditorState();
                activeTaskIndex = idx;
                renderTaskList();
                loadActiveTaskIntoEditor();
            }
        }, createElement('span', { className: 'ate-task-name' }, task.target || 'Untitled'));

        listContainer.appendChild(item);
    });
}

function loadActiveTaskIntoEditor() {
    const targetInput = getShadowElement('ate-target-input');
    const scriptInput = getShadowElement('ate-script-input');

    if (currentTasks.length === 0 || !currentTasks[activeTaskIndex]) {
        if (targetInput) targetInput.value = '';
        if (scriptInput) scriptInput.value = '';
        return;
    }

    const task = currentTasks[activeTaskIndex];
    if (targetInput) targetInput.value = task.target || '';
    if (scriptInput) scriptInput.value = Array.isArray(task.script) ? task.script.join('\n') : '';
}

function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (m) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[m]));
}

/* STREAMING_CHUNK:Initializing menu commands and auto-execution... */

// Register Menu Command in tampermonkey / violentmonkey / scriptcat context
if (typeof GM_registerMenuCommand !== 'undefined') {
    GM_registerMenuCommand('Manage Automatic Tasks', openManagerModal);
}

window.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyA') {
        openManagerModal();
    }
});

// Initialize real-time cross-tab synchronization
initTaskSync();

// Run matching tasks once DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runMatchingTasks);
} else {
    runMatchingTasks();
}

})();