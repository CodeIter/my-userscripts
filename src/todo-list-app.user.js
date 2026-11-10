// ==UserScript==
// @name         TODO List App
// @namespace    https://docs.scriptcat.org/
// @version      1.5.1
// @description  Manage your todo list inside the browser
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================================
    // USER CONFIGURATION & CONSTANTS
    // Easily customize colors, dimensions, hotkeys, and defaults here.
    // =========================================================================
    const CONFIG = {
        // Menu item label shown in Userscript Manager menu
        MENU_TITLE: 'View Todo list',

        // Storage keys for persistent data
        STORAGE_KEY_TODOS: 'todo_app_script_items_v1',
        STORAGE_KEY_THEME: 'todo_app_script_theme_v1',

        // Keyboard Shortcut to toggle dialog (Alt + T by default)
        HOTKEY_ENABLED: true,
        HOTKEY_KEY: 't',      // Case-insensitive letter
        HOTKEY_ALT: true,     // Alt key required
        HOTKEY_CTRL: false,   // Ctrl/Cmd key required

        // UI Design Tokens & Styling Customizations
        UI: {
            WIDTH: '540px',
            MAX_HEIGHT: '90vh',
            BORDER_RADIUS: '16px',
            FONT_FAMILY: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            ACCENT_COLOR: '#6366f1',      // Primary Indigo
            ACCENT_HOVER: '#4f46e5',
            SUCCESS_COLOR: '#10b981',     // Emerald Green
            DANGER_COLOR: '#ef4444',      // Red
            WARNING_COLOR: '#f59e0b',     // Amber
        },

        // Default Priority Options
        PRIORITIES: [
            { id: 'low', label: 'Low', color: '#10b981' },
            { id: 'medium', label: 'Medium', color: '#f59e0b' },
            { id: 'high', label: 'High', color: '#ef4444' }
        ],

        // Default Category Tags
        CATEGORIES: ['General', 'Work', 'Personal', 'Shopping', 'Ideas']
    };

    // =========================================================================
    // STORAGE ABSTRACTION (GM API with LocalStorage Fallback)
    // =========================================================================
    const Storage = {
        get(key, defaultValue) {
            try {
                if (typeof GM_getValue === 'function') {
                    return GM_getValue(key, defaultValue);
                }
                const localVal = localStorage.getItem(key);
                return localVal ? JSON.parse(localVal) : defaultValue;
            } catch (err) {
                console.warn('[TodoApp] Error reading storage:', err);
                return defaultValue;
            }
        },
        set(key, value) {
            try {
                if (typeof GM_setValue === 'function') {
                    GM_setValue(key, value);
                } else {
                    localStorage.setItem(key, JSON.stringify(value));
                }
            } catch (err) {
                console.error('[TodoApp] Error saving storage:', err);
            }
        }
    };

    // =========================================================================
    // SHADOW DOM STYLESHEET (Isolated from host website CSS)
    // =========================================================================
    const SHADOW_STYLES = `
        :host {
            --bg-primary: #ffffff;
            --bg-secondary: #f8fafc;
            --bg-tertiary: #f1f5f9;
            --text-primary: #0f172a;
            --text-secondary: #64748b;
            --border-color: #e2e8f0;
            --accent: ${CONFIG.UI.ACCENT_COLOR};
            --accent-hover: ${CONFIG.UI.ACCENT_HOVER};
            --danger: ${CONFIG.UI.DANGER_COLOR};
            --success: ${CONFIG.UI.SUCCESS_COLOR};
            --warning: ${CONFIG.UI.WARNING_COLOR};
            --shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
        }

        :host([data-theme="dark"]) {
            --bg-primary: #0f172a;
            --bg-secondary: #1e293b;
            --bg-tertiary: #334155;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --border-color: #334155;
            --shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: ${CONFIG.UI.FONT_FAMILY};
        }

        .todo-modal-wrapper {
            background: var(--bg-primary);
            color: var(--text-primary);
            width: ${CONFIG.UI.WIDTH};
            max-width: 92vw;
            max-height: ${CONFIG.UI.MAX_HEIGHT};
            border-radius: ${CONFIG.UI.BORDER_RADIUS};
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: var(--shadow);
            border: 1px solid var(--border-color);
        }

        /* Header */
        .modal-header {
            padding: 18px 24px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .header-title {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 1.25rem;
            font-weight: 700;
            color: var(--text-primary);
        }

        .header-actions {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .icon-btn {
            background: transparent;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            padding: 6px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.1rem;
            transition: all 0.2s ease;
        }

        .icon-btn:hover {
            background: var(--bg-tertiary);
            color: var(--text-primary);
        }

        .close-btn:hover {
            background: #fee2e2;
            color: var(--danger);
        }

        :host([data-theme="dark"]) .close-btn:hover {
            background: #7f1d1d;
            color: #fca5a5;
        }

        /* Progress Bar */
        .progress-container {
            padding: 0 24px;
            background: var(--bg-secondary);
            padding-bottom: 12px;
        }

        .progress-info {
            display: flex;
            justify-content: space-between;
            font-size: 0.75rem;
            color: var(--text-secondary);
            margin-bottom: 6px;
            font-weight: 600;
        }

        .progress-bar-bg {
            height: 6px;
            background: var(--bg-tertiary);
            border-radius: 3px;
            overflow: hidden;
        }

        .progress-bar-fill {
            height: 100%;
            background: var(--accent);
            width: 0%;
            transition: width 0.3s ease;
        }

        /* Add Todo Form */
        .input-section {
            padding: 16px 24px;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .input-row {
            display: flex;
            gap: 8px;
        }

        .todo-input {
            flex: 1;
            padding: 10px 14px;
            border-radius: 8px;
            border: 1px solid var(--border-color);
            background: var(--bg-primary);
            color: var(--text-primary);
            font-size: 0.95rem;
            outline: none;
            transition: border-color 0.2s;
        }

        .todo-input:focus {
            border-color: var(--accent);
        }

        .btn-add {
            background: var(--accent);
            color: #ffffff;
            border: none;
            padding: 10px 18px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .btn-add:hover {
            background: var(--accent-hover);
        }

        .meta-row {
            display: flex;
            gap: 10px;
            align-items: center;
        }

        .select-meta {
            padding: 6px 10px;
            border-radius: 6px;
            border: 1px solid var(--border-color);
            background: var(--bg-secondary);
            color: var(--text-primary);
            font-size: 0.8rem;
            outline: none;
            cursor: pointer;
        }

        /* Search & Filter Toolbar */
        .toolbar {
            padding: 12px 24px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            justify-content: space-between;
            align-items: center;
        }

        .filters {
            display: flex;
            gap: 4px;
            background: var(--bg-tertiary);
            padding: 3px;
            border-radius: 8px;
        }

        .filter-btn {
            background: transparent;
            border: none;
            padding: 5px 12px;
            border-radius: 6px;
            font-size: 0.8rem;
            font-weight: 600;
            color: var(--text-secondary);
            cursor: pointer;
            transition: all 0.2s;
        }

        .filter-btn.active {
            background: var(--bg-primary);
            color: var(--text-primary);
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .search-input {
            padding: 6px 12px;
            border-radius: 6px;
            border: 1px solid var(--border-color);
            background: var(--bg-primary);
            color: var(--text-primary);
            font-size: 0.8rem;
            width: 140px;
            outline: none;
        }

        /* Todo List Container */
        .list-container {
            flex: 1;
            overflow-y: auto;
            padding: 12px 24px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-height: 200px;
            max-height: 380px;
        }

        .todo-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 14px;
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            transition: transform 0.15s ease, background 0.2s ease;
            gap: 12px;
        }

        .todo-item:hover {
            transform: translateY(-1px);
        }

        .todo-left {
            display: flex;
            align-items: center;
            gap: 12px;
            flex: 1;
            min-width: 0;
        }

        /* Custom Checkbox */
        .checkbox-custom {
            appearance: none;
            width: 20px;
            height: 20px;
            border: 2px solid var(--text-secondary);
            border-radius: 6px;
            outline: none;
            cursor: pointer;
            display: grid;
            place-content: center;
            transition: all 0.2s;
            flex-shrink: 0;
        }

        .checkbox-custom::before {
            content: "";
            width: 10px;
            height: 10px;
            transform: scale(0);
            transition: 120ms transform ease-in-out;
            box-shadow: inset 1em 1em var(--bg-primary);
            transform-origin: center;
            clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
        }

        .checkbox-custom:checked {
            background-color: var(--accent);
            border-color: var(--accent);
        }

        .checkbox-custom:checked::before {
            transform: scale(1);
        }

        .todo-content {
            display: flex;
            flex-direction: column;
            gap: 2px;
            flex: 1;
            min-width: 0;
        }

        .todo-text {
            font-size: 0.95rem;
            color: var(--text-primary);
            word-break: break-word;
            transition: color 0.2s, text-decoration 0.2s;
        }

        .todo-item.completed .todo-text {
            text-decoration: line-through;
            color: var(--text-secondary);
            opacity: 0.7;
        }

        .todo-badges {
            display: flex;
            gap: 6px;
            align-items: center;
        }

        .badge {
            font-size: 0.68rem;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .badge-category {
            background: var(--bg-tertiary);
            color: var(--text-secondary);
        }

        .todo-right {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .delete-btn {
            color: var(--text-secondary);
            opacity: 0.6;
        }

        .delete-btn:hover {
            color: var(--danger);
            opacity: 1;
            background: rgba(239, 68, 68, 0.1);
        }

        /* Empty State */
        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
            color: var(--text-secondary);
            text-align: center;
            gap: 10px;
        }

        .empty-icon {
            font-size: 2.5rem;
            opacity: 0.5;
        }

        /* Footer */
        .modal-footer {
            padding: 12px 24px;
            background: var(--bg-secondary);
            border-top: 1px solid var(--border-color);
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.78rem;
            color: var(--text-secondary);
            gap: 12px;
            flex-wrap: wrap;
        }

        .footer-left {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .btn-footer {
            background: var(--bg-tertiary);
            color: var(--text-primary);
            border: 1px solid var(--border-color);
            padding: 5px 10px;
            border-radius: 6px;
            font-size: 0.78rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .btn-footer:hover {
            background: var(--border-color);
            color: var(--text-primary);
        }

        .btn-clear {
            background: transparent;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            font-size: 0.78rem;
            font-weight: 600;
        }

        .btn-clear:hover {
            color: var(--danger);
            text-decoration: underline;
        }

        .import-toast {
            padding: 8px 12px;
            margin: 0 24px 8px 24px;
            border-radius: 6px;
            font-size: 0.8rem;
            display: none;
            align-items: center;
            justify-content: space-between;
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
        }

        .import-toast.show {
            display: flex;
        }

        /* Native Dialog Reset */
        dialog#todo-app-dialog {
            padding: 0;
            border: none;
            background: transparent;
            margin: auto;
            outline: none;
            box-shadow: none;
            overflow: visible;
        }

        dialog#todo-app-dialog::backdrop {
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(4px);
            animation: fadeIn 0.2s ease-out;
        }

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
    `;

    // =========================================================================
    // DOM & SHADOW ROOT CREATION
    // =========================================================================
    let hostEl = null;
    let shadowRoot = null;
    let dialogEl = null;

    // Helper function to build DOM elements safely without innerHTML / TrustedHTML restrictions
    function el(tag, props, ...children) {
        const element = document.createElement(tag);
        if (props) {
            for (const [key, val] of Object.entries(props)) {
                if (val === undefined || val === null) continue;
                if (key === 'className') {
                    element.className = val;
                } else if (key === 'style' && typeof val === 'object') {
                    Object.assign(element.style, val);
                } else if (key === 'checked' || key === 'selected' || key === 'autofocus') {
                    element[key] = Boolean(val);
                } else if (key in element && !key.includes('-')) {
                    element[key] = val;
                } else {
                    element.setAttribute(key, String(val));
                }
            }
        }
        children.flat(Infinity).forEach(child => {
            if (child === null || child === undefined || child === false) return;
            if (child instanceof Node) {
                element.appendChild(child);
            } else {
                element.appendChild(document.createTextNode(String(child)));
            }
        });
        return element;
    }

    // Lazily initialize Shadow DOM host on div element (dialog host)
    function initUI() {
        if (hostEl && shadowRoot && dialogEl) return;

        hostEl = document.getElementById('todo-app-host');
        if (!hostEl) {
            hostEl = document.createElement('div');
            hostEl.id = 'todo-app-host';
            (document.body || document.documentElement).appendChild(hostEl);
        }

        shadowRoot = hostEl.shadowRoot || hostEl.attachShadow({ mode: 'open' });

        dialogEl = shadowRoot.getElementById('todo-app-dialog');
        if (dialogEl) return;

        // Append CSS Style
        const styleEl = document.createElement('style');
        styleEl.textContent = SHADOW_STYLES;
        shadowRoot.appendChild(styleEl);

        // App Container created safely via standard DOM elements without innerHTML
        dialogEl = el('dialog', { id: 'todo-app-dialog' },
            el('div', { className: 'todo-modal-wrapper' },
                // Header
                el('div', { className: 'modal-header' },
                    el('div', { className: 'header-title' },
                        el('span', null, '📋'),
                        el('span', null, 'Todo List')
                    ),
                    el('div', { className: 'header-actions' },
                        el('button', { className: 'icon-btn', id: 'themeToggle', title: 'Toggle Light/Dark Theme' }, '🌙'),
                        el('button', { className: 'icon-btn close-btn', id: 'closeBtn', title: 'Close (Esc)' }, '✕')
                    )
                ),

                // Progress Bar
                el('div', { className: 'progress-container' },
                    el('div', { className: 'progress-info' },
                        el('span', { id: 'progressText' }, '0% Completed'),
                        el('span', { id: 'itemsLeftText' }, '0 items remaining')
                    ),
                    el('div', { className: 'progress-bar-bg' },
                        el('div', { className: 'progress-bar-fill', id: 'progressBar' })
                    )
                ),

                // New Task Input Form
                el('div', { className: 'input-section' },
                    el('div', { className: 'input-row' },
                        el('input', { type: 'text', id: 'todoInput', className: 'todo-input', placeholder: 'What needs to be done?', autofocus: true }),
                        el('button', { className: 'btn-add', id: 'addBtn' }, '+ Add')
                    ),
                    el('div', { className: 'meta-row' },
                        el('select', { id: 'prioritySelect', className: 'select-meta' },
                            el('option', { value: 'low' }, 'Priority: Low'),
                            el('option', { value: 'medium', selected: true }, 'Priority: Medium'),
                            el('option', { value: 'high' }, 'Priority: High')
                        ),
                        el('select', { id: 'categorySelect', className: 'select-meta' },
                            CONFIG.CATEGORIES.map(cat => el('option', { value: cat }, cat))
                        )
                    )
                ),

                // Toolbar & Search
                el('div', { className: 'toolbar' },
                    el('div', { className: 'filters' },
                        el('button', { className: 'filter-btn active', 'data-filter': 'all' }, 'All'),
                        el('button', { className: 'filter-btn', 'data-filter': 'active' }, 'Active'),
                        el('button', { className: 'filter-btn', 'data-filter': 'completed' }, 'Completed')
                    ),
                    el('input', { type: 'text', id: 'searchInput', className: 'search-input', placeholder: 'Search tasks...' })
                ),

                // Task List Container
                el('div', { className: 'list-container', id: 'todoList' }),

                // Hidden file input for Import JSON
                el('input', { type: 'file', id: 'importFileInput', accept: '.json', style: { display: 'none' } }),

                // Toast Notification for Import/Export Feedback
                el('div', { className: 'import-toast', id: 'importToast' },
                    el('span', { id: 'toastMsg' }),
                    el('button', { className: 'icon-btn', id: 'closeToastBtn', style: { padding: '2px 4px', fontSize: '0.8rem' }, title: 'Dismiss' }, '✕')
                ),

                // Footer
                el('div', { className: 'modal-footer' },
                    el('div', { className: 'footer-left' },
                        el('button', { className: 'btn-footer', id: 'importBtn', title: 'Import Todos from JSON file' }, '📥 Import JSON'),
                        el('button', { className: 'btn-footer', id: 'exportBtn', title: 'Export Todos to JSON file' }, '📤 Export JSON')
                    ),
                    el('button', { className: 'btn-clear', id: 'clearCompletedBtn' }, 'Clear Completed')
                )
            )
        );

        shadowRoot.appendChild(dialogEl);

        bindEvents();
    }

    // =========================================================================
    // STATE MANAGEMENT & RENDERING
    // =========================================================================
    const DEFAULT_TODOS = [
        { id: '1', text: 'Welcome to your Userscript Todo App!', completed: false, priority: 'medium', category: 'General', createdAt: Date.now() },
        { id: '2', text: 'Click checkbox to mark task completed', completed: true, priority: 'low', category: 'General', createdAt: Date.now() - 100000 }
    ];

    // Helper to fetch latest todos from storage
    function loadTodos() {
        return Storage.get(CONFIG.STORAGE_KEY_TODOS, DEFAULT_TODOS);
    }

    let todos = loadTodos();
    let currentFilter = 'all';
    let searchQuery = '';
    let currentTheme = Storage.get(CONFIG.STORAGE_KEY_THEME, 'dark');

    // Cross-tab synchronization via GM listener and localStorage event
    function setupStorageListener() {
        if (typeof GM_addValueChangeListener === 'function') {
            GM_addValueChangeListener(CONFIG.STORAGE_KEY_TODOS, (name, oldValue, newValue, remote) => {
                if (remote && Array.isArray(newValue)) {
                    todos = newValue;
                    render();
                }
            });
            GM_addValueChangeListener(CONFIG.STORAGE_KEY_THEME, (name, oldValue, newValue, remote) => {
                if (remote && newValue) {
                    currentTheme = newValue;
                    applyTheme(currentTheme);
                }
            });
        }

        // Fallback for localStorage standard event across windows
        window.addEventListener('storage', (e) => {
            if (e.key === CONFIG.STORAGE_KEY_TODOS && e.newValue) {
                try {
                    todos = JSON.parse(e.newValue);
                    render();
                } catch (err) {}
            } else if (e.key === CONFIG.STORAGE_KEY_THEME && e.newValue) {
                try {
                    currentTheme = JSON.parse(e.newValue);
                    applyTheme(currentTheme);
                } catch (err) {}
            }
        });
    }

    // Initialize cross-tab change listeners
    setupStorageListener();

    // Apply saved theme to Shadow Host
    function applyTheme(theme) {
        currentTheme = theme;
        if (shadowRoot && shadowRoot.host) {
            shadowRoot.host.setAttribute('data-theme', theme);
        }
        const themeBtn = shadowRoot ? shadowRoot.getElementById('themeToggle') : null;
        if (themeBtn) {
            themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
        }
        Storage.set(CONFIG.STORAGE_KEY_THEME, theme);
    }

    // Save Todos to Userscript Storage
    function saveTodos() {
        Storage.set(CONFIG.STORAGE_KEY_TODOS, todos);
        render();
    }

    // Export Todos to downloadable JSON file
    function exportTodosToJson() {
        todos = loadTodos();
        const jsonString = JSON.stringify(todos, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `todo-list-${dateStr}.json`;
        (document.body || document.documentElement).appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast(`Exported ${todos.length} task(s) to JSON.`);
    }

    // Import Todos from JSON file, skipping duplicate entries
    function importTodosFromJson(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target.result);
                const rawItems = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.todos) ? parsed.todos : null);

                if (!rawItems) {
                    showToast('Invalid JSON format. Expected an array of tasks.');
                    return;
                }

                todos = loadTodos();

                const existingIds = new Set(todos.map(t => String(t.id)));
                const existingTexts = new Set(todos.map(t => String(t.text || '').trim().toLowerCase()));

                let importedCount = 0;
                let duplicateCount = 0;

                const validCategories = CONFIG.CATEGORIES;
                const validPriorities = CONFIG.PRIORITIES.map(p => p.id);

                rawItems.forEach(item => {
                    if (!item || typeof item !== 'object') return;

                    const text = String(item.text || '').trim();
                    if (!text) return;

                    const normalizedText = text.toLowerCase();
                    const itemId = item.id ? String(item.id) : null;

                    // Duplicate detection by ID or matching task text
                    if ((itemId && existingIds.has(itemId)) || existingTexts.has(normalizedText)) {
                        duplicateCount++;
                        return;
                    }

                    const newTodo = {
                        id: itemId || (Date.now() + Math.random()).toString(),
                        text: text,
                        completed: Boolean(item.completed),
                        priority: validPriorities.includes(item.priority) ? item.priority : 'medium',
                        category: validCategories.includes(item.category) ? item.category : 'General',
                        createdAt: Number(item.createdAt) || Date.now()
                    };

                    todos.push(newTodo);
                    existingIds.add(newTodo.id);
                    existingTexts.add(normalizedText);
                    importedCount++;
                });

                if (importedCount > 0) {
                    saveTodos();
                }

                let msg = `Imported ${importedCount} task(s).`;
                if (duplicateCount > 0) {
                    msg += ` Skipped ${duplicateCount} duplicate(s).`;
                }
                showToast(msg);

            } catch (err) {
                console.error('[TodoApp] JSON import error:', err);
                showToast('Failed to parse JSON file.');
            }
        };
        reader.readAsText(file);
    }

    // Show inline notification toast inside Shadow DOM
    function showToast(msg) {
        if (!shadowRoot) return;
        const toast = shadowRoot.getElementById('importToast');
        const toastMsg = shadowRoot.getElementById('toastMsg');
        if (toast && toastMsg) {
            toastMsg.textContent = msg;
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
            }, 4000);
        }
    }

    // Render Todo items and progress
    function render() {
        if (!shadowRoot) return;
        const listContainer = shadowRoot.getElementById('todoList');
        const progressBar = shadowRoot.getElementById('progressBar');
        const progressText = shadowRoot.getElementById('progressText');
        const itemsLeftText = shadowRoot.getElementById('itemsLeftText');

        if (!listContainer || !progressBar) return;

        // Filter and Search logic
        const filteredTodos = todos.filter(todo => {
            const matchesFilter = 
                currentFilter === 'all' ? true :
                currentFilter === 'active' ? !todo.completed :
                todo.completed;

            const matchesSearch = todo.text.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesFilter && matchesSearch;
        });

        // Compute Statistics
        const total = todos.length;
        const completedCount = todos.filter(t => t.completed).length;
        const activeCount = total - completedCount;
        const percentage = total === 0 ? 0 : Math.round((completedCount / total) * 100);

        // Update progress bar UI
        progressBar.style.width = `${percentage}%`;
        progressText.textContent = `${percentage}% Completed (${completedCount}/${total})`;
        itemsLeftText.textContent = `${activeCount} item${activeCount === 1 ? '' : 's'} remaining`;

        // Empty state rendering
        if (filteredTodos.length === 0) {
            listContainer.replaceChildren(
                el('div', { className: 'empty-state' },
                    el('div', { className: 'empty-icon' }, searchQuery ? '🔍' : '🎉'),
                    el('div', null, searchQuery ? 'No matching tasks found' : 'All clear! No tasks here.')
                )
            );
            return;
        }

        // Render Todo items DOM elements without innerHTML
        const items = filteredTodos.map(todo => {
            const prioObj = CONFIG.PRIORITIES.find(p => p.id === todo.priority) || CONFIG.PRIORITIES[0];
            const checkboxProps = {
                type: 'checkbox',
                className: 'checkbox-custom',
                'data-action': 'toggle'
            };
            if (todo.completed) {
                checkboxProps.checked = true;
            }

            return el('div', { className: `todo-item ${todo.completed ? 'completed' : ''}`, 'data-id': todo.id },
                el('div', { className: 'todo-left' },
                    el('input', checkboxProps),
                    el('div', { className: 'todo-content' },
                        el('span', { className: 'todo-text' }, todo.text),
                        el('div', { className: 'todo-badges' },
                            el('span', { className: 'badge badge-category' }, todo.category),
                            el('span', { className: 'badge', style: { background: `${prioObj.color}22`, color: prioObj.color } }, prioObj.label)
                        )
                    )
                ),
                el('div', { className: 'todo-right' },
                    el('button', { className: 'icon-btn delete-btn', 'data-action': 'delete', title: 'Delete Task' }, '🗑️')
                )
            );
        });

        listContainer.replaceChildren(...items);
    }

    // Helper: Prevent XSS
    function escapeHtml(str) {
        return str.replace(/[&<>"']/g, function(m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
        });
    }

    // Add New Task (Loads latest state before pushing to prevent overwriting other tabs)
    function handleAddTodo() {
        if (!shadowRoot) return;
        const input = shadowRoot.getElementById('todoInput');
        const prioSelect = shadowRoot.getElementById('prioritySelect');
        const catSelect = shadowRoot.getElementById('categorySelect');

        const text = input.value.trim();
        if (!text) return;

        const newTodo = {
            id: Date.now().toString(),
            text: text,
            completed: false,
            priority: prioSelect.value,
            category: catSelect.value,
            createdAt: Date.now()
        };

        // Always fetch fresh state before mutating
        todos = loadTodos();
        todos.unshift(newTodo);
        input.value = '';
        saveTodos();
    }

    // =========================================================================
    // USER INTERACTIONS & EVENT LISTENERS
    // =========================================================================
    function bindEvents() {
        if (!shadowRoot || !dialogEl) return;

        // Shadow DOM Event Delegation for Todo Items (Toggle / Delete)
        shadowRoot.getElementById('todoList').addEventListener('click', (e) => {
            const target = e.target;
            const action = target.getAttribute('data-action');
            const todoItem = target.closest('.todo-item');

            if (!todoItem) return;
            const id = todoItem.getAttribute('data-id');

            if (action === 'toggle' || target.classList.contains('checkbox-custom')) {
                // Fetch fresh state before updating toggle status
                todos = loadTodos().map(t => t.id === id ? { ...t, completed: !t.completed } : t);
                saveTodos();
            } else if (action === 'delete') {
                // Fetch fresh state before deleting item
                todos = loadTodos().filter(t => t.id !== id);
                saveTodos();
            }
        });

        // Add Button Click
        shadowRoot.getElementById('addBtn').addEventListener('click', handleAddTodo);

        // Enter Key in Input Field
        shadowRoot.getElementById('todoInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleAddTodo();
            }
        });

        // Filter Buttons
        shadowRoot.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                shadowRoot.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                currentFilter = e.target.getAttribute('data-filter');
                render();
            });
        });

        // Search Input
        shadowRoot.getElementById('searchInput').addEventListener('input', (e) => {
            searchQuery = e.target.value;
            render();
        });

        // Import & Export JSON buttons
        const importBtn = shadowRoot.getElementById('importBtn');
        const exportBtn = shadowRoot.getElementById('exportBtn');
        const importFileInput = shadowRoot.getElementById('importFileInput');
        const closeToastBtn = shadowRoot.getElementById('closeToastBtn');

        if (importBtn && importFileInput) {
            importBtn.addEventListener('click', () => {
                importFileInput.click();
            });

            importFileInput.addEventListener('change', (e) => {
                const file = e.target.files?.[0];
                if (file) {
                    importTodosFromJson(file);
                    importFileInput.value = ''; // Reset file input
                }
            });
        }

        if (exportBtn) {
            exportBtn.addEventListener('click', exportTodosToJson);
        }

        if (closeToastBtn) {
            closeToastBtn.addEventListener('click', () => {
                shadowRoot.getElementById('importToast')?.classList.remove('show');
            });
        }

        // Clear Completed
        shadowRoot.getElementById('clearCompletedBtn').addEventListener('click', () => {
            // Fetch fresh state before clearing completed items
            todos = loadTodos().filter(t => !t.completed);
            saveTodos();
        });

        // Theme Toggle
        shadowRoot.getElementById('themeToggle').addEventListener('click', () => {
            applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
        });

        // Close Button
        shadowRoot.getElementById('closeBtn').addEventListener('click', closeModal);

        // Close on click outside (backdrop click)
        dialogEl.addEventListener('click', (e) => {
            const rect = dialogEl.getBoundingClientRect();
            const isInDialog = (
                rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
                rect.left <= e.clientX && e.clientX <= rect.left + rect.width
            );
            if (!isInDialog) {
                closeModal();
            }
        });
    }

    // Open/Close Dialog Handlers
    const openModal = () => {
        initUI();
        todos = loadTodos(); // Re-sync latest tasks when opening dialog
        applyTheme(currentTheme);
        render();
        if (dialogEl && typeof dialogEl.showModal === 'function') {
            if (!dialogEl.open) {
                dialogEl.showModal();
            }
        }
        setTimeout(() => {
            shadowRoot?.getElementById('todoInput')?.focus();
        }, 100);
    };

    const closeModal = () => {
        if (dialogEl && dialogEl.open) {
            dialogEl.close();
        }
    };

    // =========================================================================
    // USERSCRIPT MENU COMMAND & KEYBOARD SHORTCUTS
    // =========================================================================

    // Register Menu Command in Userscript Manager (Scriptcat, Tampermonkey, Violentmonkey, etc.)
    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand(CONFIG.MENU_TITLE, openModal);
    }

    // Global Keyboard Shortcut Listener
    if (CONFIG.HOTKEY_ENABLED) {
        window.addEventListener('keydown', (e) => {
            const matchesKey = e.key.toLowerCase() === CONFIG.HOTKEY_KEY.toLowerCase();
            const matchesAlt = CONFIG.HOTKEY_ALT ? e.altKey : true;
            const matchesCtrl = CONFIG.HOTKEY_CTRL ? (e.ctrlKey || e.metaKey) : true;

            if (matchesKey && matchesAlt && matchesCtrl) {
                // Prevent trigger when user is typing in form inputs on host page
                const activeTag = document.activeElement ? document.activeElement.tagName : '';
                if (['INPUT', 'TEXTAREA'].includes(activeTag) && document.activeElement !== hostEl) {
                    return;
                }
                e.preventDefault();
                if (dialogEl && dialogEl.open) {
                    closeModal();
                } else {
                    openModal();
                }
            }
        });
    }

})();