// ==UserScript==
// @name         Text Sticky Note
// @namespace    https://docs.scriptcat.org/
// @version      1.5.2
// @description  Quickly jot down a thought, write down and display temporary reminders, to-do lists, or important information directly on your web browser
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    // CONFIGURABLE CONSTANTS & DEFAULT VALUES
    const CONFIG = {
        STORAGE_KEY: 'sticky_notes_data_store',
        DEFAULT_WIDTH: '300px',
        DEFAULT_HEIGHT: '260px',
        DEFAULT_TITLE: 'Sticky Note',
        DEFAULT_COLOR: 'yellow',
        DEFAULT_TARGET_TYPE: 'hostname', // Options: 'all' (*), 'full', 'hostname', 'proto_hostname', etc.
        Z_INDEX_BASE: 999990,
    };

    // Color Palette Definitions (Windows Sticky Note Inspired)
    const COLOR_PALETTES = {
        yellow: { bg: '#fff7d1', header: '#feea98', text: '#222222', name: 'Yellow' },
        green:  { bg: '#e2f0d9', header: '#c5e0b4', text: '#222222', name: 'Green' },
        pink:   { bg: '#fce4d6', header: '#f8cbad', text: '#222222', name: 'Pink' },
        purple: { bg: '#e8daef', header: '#d7bde2', text: '#222222', name: 'Purple' },
        blue:   { bg: '#d9edf7', header: '#bfe2f3', text: '#222222', name: 'Blue' },
        charcoal:{ bg: '#333333', header: '#252525', text: '#ffffff', name: 'Charcoal' },
        white:  { bg: '#ffffff', header: '#f0f0f0', text: '#222222', name: 'White' }
    };

    // Storage Abstraction (Supports GM_* functions with LocalStorage Fallback)
    const Storage = {
        get: function(key, defaultValue) {
            try {
                if (typeof GM_getValue === 'function') {
                    return GM_getValue(key, defaultValue);
                }
                const local = localStorage.getItem(key);
                return local ? JSON.parse(local) : defaultValue;
            } catch (e) {
                console.error('StickyNotes: Error reading storage', e);
                return defaultValue;
            }
        },
        set: function(key, value) {
            try {
                if (typeof GM_setValue === 'function') {
                    GM_setValue(key, value);
                    return;
                }
                localStorage.setItem(key, JSON.stringify(value));
            } catch (e) {
                console.error('StickyNotes: Error saving storage', e);
            }
        }
    };

    /**
     * Checks if a target URL pattern matches the current page URL.
     */
    function matchesTargetUrl(targetRule, currentUrlStr = window.location.href) {
        if (!targetRule || targetRule.trim() === '*') return true;

        const rule = targetRule.trim();
        let curr;
        try {
            curr = new URL(currentUrlStr);
        } catch (e) {
            return false;
        }

        const currFull = curr.href;
        const currNoHash = curr.origin + curr.pathname + curr.search;
        const currHost = curr.host;
        const currHostname = curr.hostname;
        const currHostPath = currHost + curr.pathname;
        const currHostnamePath = currHostname + curr.pathname;
        const currProtoHost = curr.protocol + '//' + curr.host;
        const currProtoHostname = curr.protocol + '//' + curr.hostname;
        const currProtoHostPath = currProtoHost + curr.pathname;
        const currProtoHostnamePath = currProtoHostname + curr.pathname;
        const currHostPathQuery = currHostPath + curr.search;
        const currHostnamePathQuery = currHostnamePath + curr.search;

        const options = [
            currFull,
            currNoHash,
            currHost,
            currHostname,
            currHostPath,
            currHostnamePath,
            currProtoHost,
            currProtoHostname,
            currProtoHostPath,
            currProtoHostnamePath,
            currHostPathQuery,
            currHostnamePathQuery
        ];

        const stripTrailingSlash = str => str.replace(/\/+$/, '');

        return options.some(opt => opt === rule || stripTrailingSlash(opt) === stripTrailingSlash(rule));
    }

    /**
     * Generates a default target URL rule string based on current page URL.
     */
    function getDefaultTargetRule(type) {
        const curr = new URL(window.location.href);
        switch (type) {
            case 'all': return '*';
            case 'full': return window.location.href;
            case 'proto_hostname': return curr.protocol + '//' + curr.hostname;
            case 'hostname_path': return curr.hostname + curr.pathname;
            case 'hostname':
            default:
                return curr.hostname;
        }
    }

    // Create Shadow Root to isolate Sticky Note CSS from Webpage CSS
    let shadowContainer = document.createElement('div');
    shadowContainer.id = 'gm-sticky-notes-container';
    let shadowRoot = shadowContainer.attachShadow({ mode: 'open' });

    const styles = `
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        
        .sticky-note {
            position: fixed;
            display: flex;
            flex-direction: column;
            box-shadow: 0 10px 25px rgba(0,0,0,0.18), 0 3px 6px rgba(0,0,0,0.12);
            border-radius: 6px;
            min-width: 180px;
            min-height: 100px;
            transition: box-shadow 0.2s ease;
            user-select: none;
        }
        
        .sticky-note:focus-within {
            box-shadow: 0 14px 30px rgba(0,0,0,0.25), 0 5px 10px rgba(0,0,0,0.18);
        }

        .note-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            height: 36px;
            padding: 0 8px;
            cursor: move;
            border-bottom: 1px solid rgba(0,0,0,0.06);
            border-radius: 6px 6px 0 0;
            flex-shrink: 0;
        }

        .note-title-input {
            border: none;
            background: transparent;
            font-weight: 600;
            font-size: 13px;
            color: inherit;
            flex: 1 1 auto;
            min-width: 0;
            margin-right: 6px;
            outline: none;
            text-overflow: ellipsis;
            white-space: nowrap;
            overflow: hidden;
        }

        .note-actions {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
        }

        .icon-btn {
            background: transparent;
            border: none;
            color: inherit;
            opacity: 0.7;
            cursor: pointer;
            width: 26px;
            height: 26px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 15px;
            transition: background 0.15s, opacity 0.15s;
        }

        .icon-btn:hover {
            opacity: 1;
            background: rgba(0,0,0,0.08);
        }

        .close-btn:hover {
            background: #e81123 !important;
            color: #ffffff !important;
        }

        .dropdown-menu {
            position: absolute;
            top: 36px;
            right: 6px;
            background: #ffffff;
            color: #333333;
            border-radius: 6px;
            box-shadow: 0 6px 20px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.15);
            padding: 10px;
            z-index: 100;
            width: 220px;
            max-width: calc(100vw - 20px);
            display: none;
            flex-direction: column;
            gap: 10px;
            font-size: 12px;
        }

        .dropdown-menu.active {
            display: flex;
        }

        .menu-label {
            font-weight: 600;
            margin-bottom: 4px;
            color: #666;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .color-options {
            display: flex;
            gap: 6px;
            justify-content: space-between;
        }

        .color-swatch {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            cursor: pointer;
            border: 2px solid transparent;
            transition: transform 0.1s, border-color 0.15s;
        }

        .color-swatch:hover {
            transform: scale(1.15);
        }

        .color-swatch.active {
            border-color: #333333;
        }

        .target-input {
            width: 100%;
            padding: 5px 8px;
            border: 1px solid #ccc;
            border-radius: 4px;
            font-size: 12px;
            outline: none;
        }

        .target-input:focus {
            border-color: #0078d4;
        }

        .btn-group {
            display: flex;
            gap: 6px;
            margin-top: 4px;
        }

        .menu-btn {
            flex: 1;
            padding: 6px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
            font-size: 12px;
            transition: background 0.15s;
        }

        .btn-save { background: #0078d4; color: #fff; }
        .btn-save:hover { background: #005a9e; }
        .btn-delete { background: #de350b; color: #fff; }
        .btn-delete:hover { background: #bf2600; }
        .btn-secondary { background: #6b778c; color: #fff; }
        .btn-secondary:hover { background: #505f79; }
        .btn-outline { background: transparent; border: 1px solid #ccc; color: #333; }
        .btn-outline:hover { background: #f4f5f7; }
        .btn-full { width: 100%; margin-top: 2px; }

        .note-body {
            flex: 1;
            padding: 8px;
            display: flex;
            border-radius: 0 0 6px 6px;
            overflow: hidden;
            min-height: 0;
        }

        .note-textarea {
            width: 100%;
            height: 100%;
            border: none;
            background: transparent;
            resize: none;
            outline: none;
            font-size: 14px;
            line-height: 1.4;
            color: inherit;
            font-family: inherit;
        }

        .resize-handle {
            position: absolute;
            right: 0;
            bottom: 0;
            width: 14px;
            height: 14px;
            cursor: nwse-resize;
            user-select: none;
            z-index: 10;
            opacity: 0.4;
            transition: opacity 0.15s;
        }

        .resize-handle:hover {
            opacity: 0.9;
        }

        .resize-handle::after {
            content: '';
            position: absolute;
            right: 3px;
            bottom: 3px;
            width: 6px;
            height: 6px;
            border-right: 2px solid currentColor;
            border-bottom: 2px solid currentColor;
        }
    `;

    // Apply Constructible Stylesheets to comply with strict CSP ('default-src 'self'')
    try {
        if (typeof CSSStyleSheet !== 'undefined' && shadowRoot.adoptedStyleSheets) {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(styles);
            shadowRoot.adoptedStyleSheets = [sheet];
        } else {
            const styleEl = document.createElement('style');
            styleEl.textContent = styles;
            shadowRoot.appendChild(styleEl);
        }
    } catch (err) {
        const styleEl = document.createElement('style');
        styleEl.textContent = styles;
        shadowRoot.appendChild(styleEl);
    }

    class StickyNote {
        constructor(data) {
            this.isDestroyed = false;
            this.data = {
                id: data.id || 'note_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                target: data.target || getDefaultTargetRule(CONFIG.DEFAULT_TARGET_TYPE),
                position_x: data.position_x || '100px',
                position_y: data.position_y || '100px',
                width: data.width || CONFIG.DEFAULT_WIDTH,
                height: data.height || CONFIG.DEFAULT_HEIGHT,
                color: data.color || CONFIG.DEFAULT_COLOR,
                title: data.title || CONFIG.DEFAULT_TITLE,
                text: data.text || ''
            };

            this.createDOM();
            this.applyTheme(this.data.color);
            this.bindEvents();
        }

        createDOM() {
            this.element = document.createElement('div');
            this.element.className = 'sticky-note';
            this.element.setAttribute('data-note-id', this.data.id);
            this.element.style.left = this.data.position_x;
            this.element.style.top = this.data.position_y;
            this.element.style.width = this.data.width;
            this.element.style.height = this.data.height;
            this.element.style.zIndex = CONFIG.Z_INDEX_BASE;

            // Header Structure
            this.header = document.createElement('div');
            this.header.className = 'note-header';

            this.titleInput = document.createElement('input');
            this.titleInput.className = 'note-title-input';
            this.titleInput.type = 'text';
            this.titleInput.value = this.data.title;

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'note-actions';

            this.menuBtn = document.createElement('button');
            this.menuBtn.className = 'icon-btn';
            this.menuBtn.textContent = '⋮'; // Three dots symbol
            this.menuBtn.title = 'Options';

            this.closeBtn = document.createElement('button');
            this.closeBtn.className = 'icon-btn close-btn';
            this.closeBtn.textContent = '✕'; // Close symbol
            this.closeBtn.title = 'Delete Note';
            this.closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.destroy();
            });

            actionsDiv.appendChild(this.menuBtn);
            actionsDiv.appendChild(this.closeBtn);
            this.header.appendChild(this.titleInput);
            this.header.appendChild(actionsDiv);

            // Options Menu Structure
            this.dropdown = document.createElement('div');
            this.dropdown.className = 'dropdown-menu';

            // Palette Swatches
            const colorLabel = document.createElement('div');
            colorLabel.className = 'menu-label';
            colorLabel.textContent = 'Note Color';

            const colorOptions = document.createElement('div');
            colorOptions.className = 'color-options';

            Object.keys(COLOR_PALETTES).forEach(colorKey => {
                const swatch = document.createElement('div');
                swatch.className = `color-swatch ${colorKey === this.data.color ? 'active' : ''}`;
                swatch.style.backgroundColor = COLOR_PALETTES[colorKey].bg;
                swatch.title = COLOR_PALETTES[colorKey].name;
                swatch.addEventListener('click', () => {
                    colorOptions.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
                    swatch.classList.add('active');
                    this.applyTheme(colorKey);
                    this.save();
                });
                colorOptions.appendChild(swatch);
            });

            // Target URL Settings
            const targetLabel = document.createElement('div');
            targetLabel.className = 'menu-label';
            targetLabel.textContent = 'Target URL Match';

            this.targetInput = document.createElement('input');
            this.targetInput.className = 'target-input';
            this.targetInput.type = 'text';
            this.targetInput.value = this.data.target;

            // Action Buttons inside dropdown
            const btnGroup = document.createElement('div');
            btnGroup.className = 'btn-group';

            const saveBtn = document.createElement('button');
            saveBtn.className = 'menu-btn btn-save';
            saveBtn.textContent = 'Save';
            saveBtn.addEventListener('click', () => {
                this.data.target = this.targetInput.value;
                this.save();
                this.dropdown.classList.remove('active');
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'menu-btn btn-delete';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.destroy();
            });

            btnGroup.appendChild(saveBtn);
            btnGroup.appendChild(deleteBtn);

            // File Content Section
            const contentLabel = document.createElement('div');
            contentLabel.className = 'menu-label';
            contentLabel.style.marginTop = '6px';
            contentLabel.textContent = 'Note Content';

            const loadTextBtn = document.createElement('button');
            loadTextBtn.className = 'menu-btn btn-outline btn-full';
            loadTextBtn.textContent = 'Load from Text File';

            const textFileInput = document.createElement('input');
            textFileInput.type = 'file';
            textFileInput.accept = '.txt,.text,.md,.log,.json,*/*';
            textFileInput.style.display = 'none';

            loadTextBtn.addEventListener('click', () => {
                textFileInput.click();
            });

            textFileInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (evt) => {
                    const content = evt.target.result;
                    this.textarea.value = content;
                    this.data.text = content;
                    this.save();
                    const originalText = loadTextBtn.textContent;
                    loadTextBtn.textContent = 'Text Loaded!';
                    setTimeout(() => { loadTextBtn.textContent = originalText; }, 2000);
                };
                reader.readAsText(file);
                textFileInput.value = '';
            });

            // Backup & Storage Section
            const storageLabel = document.createElement('div');
            storageLabel.className = 'menu-label';
            storageLabel.style.marginTop = '6px';
            storageLabel.textContent = 'Backup & Storage';

            const backupGroup = document.createElement('div');
            backupGroup.className = 'btn-group';

            const exportBtn = document.createElement('button');
            exportBtn.className = 'menu-btn btn-secondary';
            exportBtn.textContent = 'Export JSON';
            exportBtn.addEventListener('click', () => {
                exportAllNotes();
                const orig = exportBtn.textContent;
                exportBtn.textContent = 'Exported!';
                setTimeout(() => { exportBtn.textContent = orig; }, 2000);
            });

            const importBtn = document.createElement('button');
            importBtn.className = 'menu-btn btn-secondary';
            importBtn.textContent = 'Import JSON';

            const jsonFileInput = document.createElement('input');
            jsonFileInput.type = 'file';
            jsonFileInput.accept = '.json';
            jsonFileInput.style.display = 'none';

            importBtn.addEventListener('click', () => {
                jsonFileInput.click();
            });

            jsonFileInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (evt) => {
                    try {
                        const imported = JSON.parse(evt.target.result);
                        const count = importNotesJSON(imported);
                        const orig = importBtn.textContent;
                        importBtn.textContent = `Imported (${count})`;
                        setTimeout(() => { importBtn.textContent = orig; }, 2000);
                    } catch (err) {
                        console.error('StickyNotes: Invalid JSON file', err);
                    }
                };
                reader.readAsText(file);
                jsonFileInput.value = '';
            });

            backupGroup.appendChild(exportBtn);
            backupGroup.appendChild(importBtn);

            this.dropdown.appendChild(colorLabel);
            this.dropdown.appendChild(colorOptions);
            this.dropdown.appendChild(targetLabel);
            this.dropdown.appendChild(this.targetInput);
            this.dropdown.appendChild(btnGroup);
            this.dropdown.appendChild(contentLabel);
            this.dropdown.appendChild(loadTextBtn);
            this.dropdown.appendChild(textFileInput);
            this.dropdown.appendChild(storageLabel);
            this.dropdown.appendChild(backupGroup);
            this.dropdown.appendChild(jsonFileInput);

            // Body Area
            const body = document.createElement('div');
            body.className = 'note-body';

            this.textarea = document.createElement('textarea');
            this.textarea.className = 'note-textarea';
            this.textarea.placeholder = 'Take a note...';
            this.textarea.value = this.data.text;

            body.appendChild(this.textarea);

            // Custom Corner Resize Handle
            this.resizeHandle = document.createElement('div');
            this.resizeHandle.className = 'resize-handle';
            this.resizeHandle.title = 'Resize Note';

            this.element.appendChild(this.header);
            this.element.appendChild(this.dropdown);
            this.element.appendChild(body);
            this.element.appendChild(this.resizeHandle);

            shadowRoot.appendChild(this.element);
        }

        applyTheme(colorKey) {
            const palette = COLOR_PALETTES[colorKey] || COLOR_PALETTES.yellow;
            this.data.color = colorKey;
            this.element.style.backgroundColor = palette.bg;
            this.header.style.backgroundColor = palette.header;
            this.element.style.color = palette.text;
        }

        bindEvents() {
            // Drag and drop mechanics
            let isDragging = false;
            let startX, startY, initialLeft, initialTop;

            this.header.addEventListener('mousedown', (e) => {
                if (e.target === this.titleInput || e.target.classList.contains('icon-btn')) return;
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                initialLeft = this.element.offsetLeft;
                initialTop = this.element.offsetTop;

                // Bring note to front
                shadowRoot.querySelectorAll('.sticky-note').forEach(el => el.style.zIndex = CONFIG.Z_INDEX_BASE);
                this.element.style.zIndex = CONFIG.Z_INDEX_BASE + 10;

                const onMouseMove = (moveEvent) => {
                    if (!isDragging) return;
                    const deltaX = moveEvent.clientX - startX;
                    const deltaY = moveEvent.clientY - startY;
                    this.element.style.left = `${initialLeft + deltaX}px`;
                    this.element.style.top = `${initialTop + deltaY}px`;
                };

                const onMouseUp = () => {
                    if (isDragging) {
                        isDragging = false;
                        this.data.position_x = this.element.style.left;
                        this.data.position_y = this.element.style.top;
                        this.save();
                    }
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);
                };

                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            });

            // Drag-to-Resize Mechanics
            let isResizing = false;
            let startRWidth, startRHeight, startRX, startRY;

            this.resizeHandle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                isResizing = true;
                startRX = e.clientX;
                startRY = e.clientY;
                startRWidth = parseInt(document.defaultView.getComputedStyle(this.element).width, 10);
                startRHeight = parseInt(document.defaultView.getComputedStyle(this.element).height, 10);

                const onMouseMove = (moveEvent) => {
                    if (!isResizing) return;
                    const newWidth = Math.max(180, startRWidth + (moveEvent.clientX - startRX));
                    const newHeight = Math.max(100, startRHeight + (moveEvent.clientY - startRY));
                    this.element.style.width = `${newWidth}px`;
                    this.element.style.height = `${newHeight}px`;
                };

                const onMouseUp = () => {
                    if (isResizing) {
                        isResizing = false;
                        this.data.width = this.element.style.width;
                        this.data.height = this.element.style.height;
                        this.save();
                    }
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);
                };

                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            });

            // Stop click propagation inside dropdown menu
            this.dropdown.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // Menu toggle
            this.menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.dropdown.classList.toggle('active');
            });

            // Title change save
            this.titleInput.addEventListener('blur', () => {
                this.data.title = this.titleInput.value;
                this.save();
            });

            // Text change save (Auto save on blur)
            this.textarea.addEventListener('blur', () => {
                this.data.text = this.textarea.value;
                this.save();
            });

            // Close menu when clicking outside note
            window.addEventListener('click', (e) => {
                if (this.isDestroyed) return;
                const path = e.composedPath ? e.composedPath() : [];
                if (!path.includes(this.element)) {
                    this.dropdown.classList.remove('active');
                }
            });
        }

        save() {
            if (this.isDestroyed) return;

            this.data.title = this.titleInput.value;
            this.data.text = this.textarea.value;
            this.data.target = this.targetInput.value;

            const allNotes = Storage.get(CONFIG.STORAGE_KEY, []);
            const index = allNotes.findIndex(n => n.id === this.data.id);
            if (index !== -1) {
                allNotes[index] = this.data;
            } else {
                allNotes.push(this.data);
            }
            Storage.set(CONFIG.STORAGE_KEY, allNotes);
        }

        destroy() {
            if (this.isDestroyed) return;
            this.isDestroyed = true;

            const allNotes = Storage.get(CONFIG.STORAGE_KEY, []);
            const updatedNotes = allNotes.filter(n => n.id !== this.data.id);
            Storage.set(CONFIG.STORAGE_KEY, updatedNotes);
            if (this.element && this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
        }
    }

    // Creates and adds a new Sticky Note
    function createNewNote() {
        const newNoteData = {
            id: 'note_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            target: getDefaultTargetRule(CONFIG.DEFAULT_TARGET_TYPE),
            position_x: `${120 + (Math.random() * 40)}px`,
            position_y: `${120 + (Math.random() * 40)}px`,
            width: CONFIG.DEFAULT_WIDTH,
            height: CONFIG.DEFAULT_HEIGHT,
            color: CONFIG.DEFAULT_COLOR,
            title: CONFIG.DEFAULT_TITLE,
            text: ''
        };

        const note = new StickyNote(newNoteData);
        note.save();
    }

    // Load and Display Notes for current URL
    function loadSavedNotes() {
        const savedNotes = Storage.get(CONFIG.STORAGE_KEY, []);
        savedNotes.forEach(noteData => {
            if (matchesTargetUrl(noteData.target)) {
                const existsInDom = shadowRoot.querySelector(`[data-note-id="${noteData.id}"]`);
                if (!existsInDom) {
                    new StickyNote(noteData);
                }
            }
        });
    }

    // Helper function to export all saved notes to a JSON file
    function exportAllNotes() {
        const allNotes = Storage.get(CONFIG.STORAGE_KEY, []);
        const jsonString = JSON.stringify(allNotes, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sticky_notes_backup_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Helper function to import notes from JSON, skipping duplicate IDs
    function importNotesJSON(importedData) {
        let notesArray = [];
        if (Array.isArray(importedData)) {
            notesArray = importedData;
        } else if (importedData && Array.isArray(importedData.notes)) {
            notesArray = importedData.notes;
        } else if (importedData && typeof importedData === 'object' && importedData.id) {
            notesArray = [importedData];
        }

        if (!notesArray.length) return 0;

        const currentNotes = Storage.get(CONFIG.STORAGE_KEY, []);
        const existingIds = new Set(currentNotes.map(n => n.id));

        let addedCount = 0;
        notesArray.forEach(noteData => {
            if (noteData && noteData.id && !existingIds.has(noteData.id)) {
                currentNotes.push(noteData);
                existingIds.add(noteData.id);
                addedCount++;
            }
        });

        if (addedCount > 0) {
            Storage.set(CONFIG.STORAGE_KEY, currentNotes);
            loadSavedNotes();
        }

        return addedCount;
    }

    // Initialize Script
    function init() {
        if (document.body) {
            document.body.appendChild(shadowContainer);
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                document.body.appendChild(shadowContainer);
            });
        }

        // Register GM Menu Command
        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('Add Text Sticky Note', createNewNote);
        }

        // Render matching saved notes
        loadSavedNotes();
    }

    init();
})();