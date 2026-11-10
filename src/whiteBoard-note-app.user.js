// ==UserScript==
// @name         WhiteBoard Note App
// @namespace    https://docs.scriptcat.org/
// @version      1.5.3
// @description  Whiteboard in your browser with drawing, shapes, text, zoom, and GM storage inside a Shadow DOM modal.
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

    const VERSION="1.5.1";

    /**
     * CONFIGURATION CONSTANTS
     * Customize default parameters, colors, dimensions, and hotkeys.
     */
    const CONFIG = {
        // Storage keys for GM_setValue / GM_getValue
        STORAGE_KEY_DATA: 'whiteboard_app_shapes_v1',
        STORAGE_KEY_SETTINGS: 'whiteboard_app_settings_v1',
        
        // Modal Dimensions & Layout
        MODAL_WIDTH: '92vw',
        MODAL_HEIGHT: '88vh',
        
        // Default Drawing Settings
        DEFAULT_TOOL: 'freehand', // Options: 'freehand', 'line', 'rectangle', 'circle', 'arrow', 'text', 'eraser'
        DEFAULT_THEME: 'light',   // Default theme: 'light' or 'dark'
        DEFAULT_COLOR: '#0284c7',  // Accent hex color
        DEFAULT_FILL: 'transparent',
        DEFAULT_STROKE_WIDTH: 3,   // Line thickness in px
        DEFAULT_BG_COLOR_LIGHT: '#ffffff', // Canvas light background color
        DEFAULT_BG_COLOR_DARK: '#0f172a',  // Canvas dark background color
        
        // Preset Color Swatches
        COLOR_SWATCHES: [
            '#0f172a', '#64748b', '#cbd5e1', '#ef4444', 
            '#f97316', '#eab308', '#22c55e', '#0284c7', 
            '#6366f1', '#a855f7', '#ec4899', '#f8fafc'
        ],
        
        // Keyboard Shortcuts
        HOTKEY_TOGGLE: 'KeyW', // Alt + Shift + W
        
        // Performance & Canvas Setup
        MAX_UNDO_STEPS: 50,
        AUTO_SAVE_INTERVAL_MS: 800,
        GRID_SIZE: 30, // Dot grid spacing in pixels
        MIN_ZOOM: 0.2,
        MAX_ZOOM: 5.0
    };

    /**
     * APPLICATION STATE
     */
    const state = {
        isOpen: false,
        theme: CONFIG.DEFAULT_THEME,
        activeTool: CONFIG.DEFAULT_TOOL,
        strokeColor: CONFIG.DEFAULT_COLOR,
        fillColor: CONFIG.DEFAULT_FILL,
        strokeWidth: CONFIG.DEFAULT_STROKE_WIDTH,
        bgColor: CONFIG.DEFAULT_BG_COLOR_LIGHT,
        isFilled: false,
        shapes: [],
        undoStack: [],
        redoStack: [],
        isDrawing: false,
        isPanning: false,
        panStart: { x: 0, y: 0 },
        currentShape: null,
        zoom: 1.0,
        pan: { x: 0, y: 0 },
        showGrid: true,
        saveStatusTimer: null,
        activeTextInput: null
    };

    /**
     * DOM BUILDER & SVG ICON HELPER (Trusted Types Safe)
     */
    function el(tag, props = {}, ...children) {
        const elem = document.createElement(tag);
        for (const [key, val] of Object.entries(props)) {
            if (key.startsWith('on') && typeof val === 'function') {
                elem.addEventListener(key.slice(2).toLowerCase(), val);
            } else if (key === 'className' || key === 'class') {
                elem.className = val;
            } else if (key === 'style' && typeof val === 'object') {
                Object.assign(elem.style, val);
            } else if (key === 'textContent') {
                elem.textContent = val;
            } else if (val !== false && val !== null && val !== undefined) {
                elem.setAttribute(key, val);
            }
        }
        children.flat().forEach(child => {
            if (child instanceof Node) {
                elem.appendChild(child);
            } else if (child !== null && child !== undefined && child !== false) {
                elem.appendChild(document.createTextNode(String(child)));
            }
        });
        return elem;
    }

    function createSVG(viewBox, elements, extraAttrs = {}) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', extraAttrs.width || '18');
        svg.setAttribute('height', extraAttrs.height || '18');
        svg.setAttribute('viewBox', viewBox);
        svg.setAttribute('fill', extraAttrs.fill || 'none');
        svg.setAttribute('stroke', extraAttrs.stroke || 'currentColor');
        svg.setAttribute('stroke-width', extraAttrs['stroke-width'] || '2');
        if (extraAttrs['stroke-linecap']) svg.setAttribute('stroke-linecap', extraAttrs['stroke-linecap']);
        if (extraAttrs['stroke-linejoin']) svg.setAttribute('stroke-linejoin', extraAttrs['stroke-linejoin']);

        elements.forEach(([tag, attrs]) => {
            const child = document.createElementNS('http://www.w3.org/2000/svg', tag);
            Object.entries(attrs).forEach(([k, v]) => child.setAttribute(k, v));
            svg.appendChild(child);
        });
        return svg;
    }

    const ICON_DEFINITIONS = {
        freehand: ['0 0 24 24', [['path', {d: 'M12 19l7-7 3 3-7 7-3-3z'}], ['path', {d: 'M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z'}], ['path', {d: 'M2 2l7.5 7.5'}]], {'stroke-linecap': 'round', 'stroke-linejoin': 'round'}],
        line: ['0 0 24 24', [['line', {x1: '5', y1: '19', x2: '19', y2: '5'}]], {'stroke-linecap': 'round'}],
        rectangle: ['0 0 24 24', [['rect', {x: '3', y: '3', width: '18', height: '18', rx: '2'}]], {'stroke-linecap': 'round'}],
        circle: ['0 0 24 24', [['circle', {cx: '12', cy: '12', r: '9'}]], {'stroke-linecap': 'round'}],
        arrow: ['0 0 24 24', [['line', {x1: '5', y1: '12', x2: '19', y2: '12'}], ['polyline', {points: '12 5 19 12 12 19'}]], {'stroke-linecap': 'round', 'stroke-linejoin': 'round'}],
        text: ['0 0 24 24', [['polyline', {points: '4 7 4 4 20 4 20 7'}], ['line', {x1: '12', y1: '4', x2: '12', y2: '20'}]], {'stroke-linecap': 'round'}],
        eraser: ['0 0 24 24', [['path', {d: 'M20 20H7L3 16C2 15 2 13 3 12L13 2C14 1 16 1 17 2L21 6C22 7 22 9 21 10L11 20'}], ['line', {x1: '18', y1: '9', x2: '10', y2: '17'}]], {'stroke-linecap': 'round', 'stroke-linejoin': 'round'}],
        undo: ['0 0 24 24', [['path', {d: 'M3 7v6h6'}], ['path', {d: 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'}]], {'stroke-linecap': 'round', 'stroke-linejoin': 'round'}],
        redo: ['0 0 24 24', [['path', {d: 'M21 7v6h-6'}], ['path', {d: 'M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7'}]], {'stroke-linecap': 'round', 'stroke-linejoin': 'round'}],
        grid: ['0 0 24 24', [['rect', {x: '3', y: '3', width: '18', height: '18', rx: '2'}], ['path', {d: 'M3 9h18M3 15h18M9 3v18M15 3v18'}]], {'stroke-linecap': 'round'}],
        trash: ['0 0 24 24', [['polyline', {points: '3 6 5 6 21 6'}], ['path', {d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'}]], {'stroke-linecap': 'round', 'stroke-linejoin': 'round'}],
        download: ['0 0 24 24', [['path', {d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'}], ['polyline', {points: '7 10 12 15 17 10'}], ['line', {x1: '12', y1: '15', x2: '12', y2: '3'}]], {'stroke-linecap': 'round', 'stroke-linejoin': 'round'}],
        close: ['0 0 24 24', [['line', {x1: '18', y1: '6', x2: '6', y2: '18'}], ['line', {x1: '6', y1: '6', x2: '18', y2: '18'}]], {width: '20', height: '20', 'stroke-linecap': 'round'}],
        zoomIn: ['0 0 24 24', [['circle', {cx: '11', cy: '11', r: '8'}], ['line', {x1: '21', y1: '21', x2: '16.65', y2: '16.65'}], ['line', {x1: '11', y1: '8', x2: '11', y2: '14'}], ['line', {x1: '8', y1: '11', x2: '14', y2: '11'}]]],
        zoomOut: ['0 0 24 24', [['circle', {cx: '11', cy: '11', r: '8'}], ['line', {x1: '21', y1: '21', x2: '16.65', y2: '16.65'}], ['line', {x1: '8', y1: '11', x2: '14', y2: '11'}]]],
        resetZoom: ['0 0 24 24', [['path', {d: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7'}]]],
        fullscreen: ['0 0 24 24', [['path', {d: 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3'}]], {'stroke-linecap': 'round', 'stroke-linejoin': 'round'}],
        fullscreenExit: ['0 0 24 24', [['path', {d: 'M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3'}]], {'stroke-linecap': 'round', 'stroke-linejoin': 'round'}],
        sun: ['0 0 24 24', [['circle', {cx: '12', cy: '12', r: '5'}], ['line', {x1: '12', y1: '1', x2: '12', y2: '3'}], ['line', {x1: '12', y1: '21', x2: '12', y2: '23'}], ['line', {x1: '4.22', y1: '4.22', x2: '5.64', y2: '5.64'}], ['line', {x1: '18.36', y1: '18.36', x2: '19.78', y2: '19.78'}], ['line', {x1: '1', y1: '12', x2: '3', y2: '12'}], ['line', {x1: '21', y1: '12', x2: '23', y2: '12'}], ['line', {x1: '4.22', y1: '19.78', x2: '5.64', y2: '18.36'}], ['line', {x1: '18.36', y1: '5.64', x2: '19.78', y2: '4.22'}]], {'stroke-linecap': 'round', 'stroke-linejoin': 'round'}],
        moon: ['0 0 24 24', [['path', {d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'}]], {'stroke-linecap': 'round', 'stroke-linejoin': 'round'}],
        dragHandle: ['0 0 24 24', [['circle', {cx: '9', cy: '6', r: '1.5'}], ['circle', {cx: '15', cy: '6', r: '1.5'}], ['circle', {cx: '9', cy: '12', r: '1.5'}], ['circle', {cx: '15', cy: '12', r: '1.5'}], ['circle', {cx: '9', cy: '18', r: '1.5'}], ['circle', {cx: '15', cy: '18', r: '1.5'}]], {width: '14', height: '14'}]
    };

    function createIcon(name) {
        const def = ICON_DEFINITIONS[name];
        if (!def) return document.createTextNode('');
        return createSVG(def[0], def[1], def[2] || {});
    }

    const STYLES = `
        :host {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-sizing: border-box;
        }

        *, *:before, *:after {
            box-sizing: inherit;
            user-select: none;
        }

        .wb-backdrop {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.45);
            backdrop-filter: blur(8px);
            z-index: 9999999;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .wb-backdrop.visible {
            opacity: 1;
            pointer-events: auto;
        }

        .wb-modal {
            --bg-dark: #ffffff;
            --panel-bg: rgba(255, 255, 255, 0.88);
            --border-color: rgba(0, 0, 0, 0.12);
            --accent-blue: #0284c7;
            --accent-hover: #0369a1;
            --text-light: #0f172a;
            --text-muted: #64748b;
            --shadow-lg: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
            color: var(--text-light);
            width: ${CONFIG.MODAL_WIDTH};
            height: ${CONFIG.MODAL_HEIGHT};
            background: var(--bg-dark);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            box-shadow: var(--shadow-lg);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
            transform: scale(0.96);
            transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.2s ease, color 0.2s ease;
        }

        .wb-modal[data-theme="dark"] {
            --bg-dark: #0f172a;
            --panel-bg: rgba(30, 41, 59, 0.85);
            --border-color: rgba(255, 255, 255, 0.12);
            --accent-blue: #38bdf8;
            --accent-hover: #0284c7;
            --text-light: #f8fafc;
            --text-muted: #94a3b8;
            --shadow-lg: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
        }

        .wb-backdrop.visible .wb-modal {
            transform: scale(1);
        }

        .wb-modal:fullscreen, .wb-modal:-webkit-full-screen {
            width: 100vw !important;
            height: 100vh !important;
            border-radius: 0 !important;
            border: none !important;
        }

        /* Top Header */
        .wb-header {
            height: 54px;
            padding: 0 20px;
            background: var(--panel-bg);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            justify-content: space-between;
            backdrop-filter: blur(12px);
            z-index: 10;
        }

        .wb-brand {
            display: flex;
            align-items: center;
            gap: 10px;
            font-weight: 700;
            font-size: 16px;
            letter-spacing: 0.5px;
            color: var(--accent-blue);
        }

        .wb-brand-badge {
            background: rgba(56, 189, 248, 0.15);
            color: var(--accent-blue);
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 12px;
            border: 1px solid rgba(56, 189, 248, 0.3);
        }

        .wb-header-actions {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        /* Canvas Workspace */
        .wb-workspace {
            flex: 1;
            position: relative;
            overflow: hidden;
            cursor: crosshair;
            background-color: ${CONFIG.DEFAULT_BG_COLOR};
        }

        .wb-workspace.panning {
            cursor: grab;
        }

        .wb-workspace.panning:active {
            cursor: grabbing;
        }

        canvas {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            touch-action: none;
        }

        /* Floating Toolbar */
        .wb-toolbar {
            position: absolute;
            top: 16px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--panel-bg);
            border: 1px solid var(--border-color);
            padding: 6px 12px;
            border-radius: 30px;
            display: flex;
            align-items: center;
            gap: 6px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(16px);
            z-index: 20;
            touch-action: none;
        }

        .wb-drag-handle {
            cursor: grab;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 4px;
            color: var(--text-muted);
            border-radius: 6px;
            transition: background 0.15s ease, color 0.15s ease;
            user-select: none;
            touch-action: none;
        }

        .wb-drag-handle:hover {
            color: var(--text-light);
            background: rgba(255, 255, 255, 0.1);
        }

        .wb-panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 4px;
        }

        .wb-divider {
            width: 1px;
            height: 22px;
            background: var(--border-color);
            margin: 0 4px;
        }

        /* Controls Panel (Side) */
        .wb-properties-panel {
            position: absolute;
            left: 16px;
            top: 80px;
            background: var(--panel-bg);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(16px);
            z-index: 20;
            width: 180px;
        }

        .wb-prop-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .wb-prop-label {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-muted);
        }

        .wb-color-swatches {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 6px;
        }

        .wb-swatch {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            border: 2px solid transparent;
            cursor: pointer;
            transition: transform 0.15s ease, border-color 0.15s ease;
        }

        .wb-swatch:hover {
            transform: scale(1.15);
        }

        .wb-swatch.active {
            border-color: #ffffff;
            box-shadow: 0 0 0 2px var(--accent-blue);
        }

        .wb-custom-color-wrapper {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 4px;
        }

        .wb-color-picker-input {
            -webkit-appearance: none;
            -moz-appearance: none;
            appearance: none;
            width: 28px;
            height: 28px;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            background: transparent;
            padding: 0;
            overflow: hidden;
        }

        .wb-color-picker-input::-webkit-color-swatch-wrapper {
            padding: 0;
        }

        .wb-color-picker-input::-webkit-color-swatch {
            border: 2px solid var(--border-color);
            border-radius: 50%;
        }

        .wb-color-picker-input::-moz-color-swatch {
            border: 2px solid var(--border-color);
            border-radius: 50%;
        }

        .wb-stroke-slider {
            width: 100%;
            accent-color: var(--accent-blue);
            cursor: pointer;
        }

        /* Zoom & Bottom Controls */
        .wb-bottom-bar {
            position: absolute;
            bottom: 16px;
            right: 16px;
            background: var(--panel-bg);
            border: 1px solid var(--border-color);
            border-radius: 20px;
            padding: 4px 10px;
            display: flex;
            align-items: center;
            gap: 6px;
            z-index: 20;
            backdrop-filter: blur(16px);
        }

        .wb-zoom-label {
            font-size: 12px;
            font-weight: 600;
            color: var(--text-muted);
            min-width: 42px;
            text-align: center;
        }

        /* Buttons & Components */
        .wb-btn {
            background: transparent;
            border: none;
            color: var(--text-light);
            padding: 8px;
            border-radius: 8px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
            position: relative;
        }

        .wb-btn:hover {
            background: rgba(255, 255, 255, 0.1);
            color: #ffffff;
        }

        .wb-btn:active {
            transform: scale(0.95);
        }

        .wb-btn.active {
            background: var(--accent-blue);
            color: #000000;
        }

        .wb-btn-close {
            color: var(--text-muted);
        }

        .wb-btn-close:hover {
            background: rgba(239, 68, 68, 0.2);
            color: #f87171;
        }

        /* Floating Text Box Overlay */
        .wb-text-overlay {
            position: absolute;
            background: transparent;
            border: 1px dashed var(--accent-blue);
            color: var(--text-light);
            font-family: sans-serif;
            font-size: 18px;
            outline: none;
            padding: 4px 8px;
            resize: both;
            min-width: 100px;
            min-height: 36px;
            z-index: 30;
            line-height: 1.3;
        }

        /* Custom Dialog Notification */
        .wb-toast {
            position: absolute;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(50px);
            background: #1e293b;
            color: #f8fafc;
            border: 1px solid var(--accent-blue);
            padding: 8px 18px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 500;
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            z-index: 100;
            pointer-events: none;
            box-shadow: 0 10px 20px rgba(0,0,0,0.4);
        }

        .wb-toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }

        /* Confirmation Modal Overlay */
        .wb-confirm-overlay {
            position: absolute;
            inset: 0;
            background: rgba(15, 23, 42, 0.8);
            backdrop-filter: blur(4px);
            z-index: 50;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease;
        }

        .wb-confirm-overlay.active {
            opacity: 1;
            pointer-events: auto;
        }

        .wb-confirm-box {
            background: #1e293b;
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 20px;
            width: 320px;
            text-align: center;
            box-shadow: var(--shadow-lg);
        }

        .wb-confirm-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .wb-confirm-desc {
            font-size: 13px;
            color: var(--text-muted);
            margin-bottom: 20px;
        }

        .wb-confirm-actions {
            display: flex;
            gap: 10px;
            justify-content: center;
        }

        .wb-btn-modal {
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            border: none;
        }

        .wb-btn-cancel {
            background: rgba(255, 255, 255, 0.1);
            color: var(--text-light);
        }

        .wb-btn-danger {
            background: #ef4444;
            color: #ffffff;
        }
    `;

    /**
     * GENERATE UI DOM STRUCTURE (Trusted Types Safe)
     */
    function buildUI(shadow) {
        // Use Constructible Stylesheets to comply with strict CSP policies
        if (typeof CSSStyleSheet !== 'undefined' && shadow.adoptedStyleSheets) {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(STYLES);
            shadow.adoptedStyleSheets = [sheet];
        } else {
            const styleElem = document.createElement('style');
            styleElem.textContent = STYLES;
            shadow.appendChild(styleElem);
        }

        const backdrop = el('div', { class: 'wb-backdrop', id: 'wb-backdrop' },
            el('div', { class: 'wb-modal' },
                // Top Header
                el('div', { class: 'wb-header' },
                    el('div', { class: 'wb-brand' },
                        createIcon('freehand'),
                        el('span', { textContent: 'WhiteBoard' }),
                        el('span', { class: 'wb-brand-badge', textContent: `v${VERSION}` })
                    ),
                    el('div', { class: 'wb-header-actions' },
                        el('button', { class: 'wb-btn', id: 'wb-btn-undo', title: 'Undo (Ctrl+Z)' }, createIcon('undo')),
                        el('button', { class: 'wb-btn', id: 'wb-btn-redo', title: 'Redo (Ctrl+Y)' }, createIcon('redo')),
                        el('div', { class: 'wb-divider' }),
                        el('button', { class: 'wb-btn', id: 'wb-btn-theme', title: 'Toggle Light/Dark Theme' }, createIcon('moon')),
                        el('button', { class: 'wb-btn', id: 'wb-btn-grid', title: 'Toggle Grid' }, createIcon('grid')),
                        el('button', { class: 'wb-btn', id: 'wb-btn-fullscreen', title: 'Toggle Fullscreen' }, createIcon('fullscreen')),
                        el('button', { class: 'wb-btn', id: 'wb-btn-clear', title: 'Clear Canvas' }, createIcon('trash')),
                        el('button', { class: 'wb-btn', id: 'wb-btn-export', title: 'Export Image' }, createIcon('download')),
                        el('div', { class: 'wb-divider' }),
                        el('button', { class: 'wb-btn wb-btn-close', id: 'wb-btn-close', title: 'Close Modal' }, createIcon('close'))
                    )
                ),
                // Main Workspace Area
                el('div', { class: 'wb-workspace', id: 'wb-workspace' },
                    el('canvas', { id: 'wb-canvas' }),

                    // Floating Central Toolbar
                    el('div', { class: 'wb-toolbar', id: 'wb-toolbar' },
                        el('div', { class: 'wb-drag-handle', id: 'wb-toolbar-drag', title: 'Drag toolbar' }, createIcon('dragHandle')),
                        el('div', { class: 'wb-divider' }),
                        el('button', { class: 'wb-btn active', 'data-tool': 'freehand', title: 'Freehand Pen' }, createIcon('freehand')),
                        el('button', { class: 'wb-btn', 'data-tool': 'line', title: 'Straight Line' }, createIcon('line')),
                        el('button', { class: 'wb-btn', 'data-tool': 'arrow', title: 'Arrow' }, createIcon('arrow')),
                        el('button', { class: 'wb-btn', 'data-tool': 'rectangle', title: 'Rectangle' }, createIcon('rectangle')),
                        el('button', { class: 'wb-btn', 'data-tool': 'circle', title: 'Circle' }, createIcon('circle')),
                        el('button', { class: 'wb-btn', 'data-tool': 'text', title: 'Add Text' }, createIcon('text')),
                        el('div', { class: 'wb-divider' }),
                        el('button', { class: 'wb-btn', 'data-tool': 'eraser', title: 'Eraser' }, createIcon('eraser'))
                    ),

                    // Side Properties Panel
                    el('div', { class: 'wb-properties-panel', id: 'wb-properties-panel' },
                        el('div', { class: 'wb-panel-header' },
                            el('span', { class: 'wb-prop-label', textContent: 'Properties' }),
                            el('div', { class: 'wb-drag-handle', id: 'wb-props-drag', title: 'Drag properties panel' }, createIcon('dragHandle'))
                        ),
                        el('div', { class: 'wb-prop-group' },
                            el('span', { class: 'wb-prop-label', textContent: 'Color Swatches' }),
                            el('div', { class: 'wb-color-swatches', id: 'wb-color-swatches' }),
                            el('div', { class: 'wb-custom-color-wrapper' },
                                el('input', { type: 'color', id: 'wb-custom-color', class: 'wb-color-picker-input', value: '#38bdf8', title: 'Choose Custom Color' }),
                                el('span', { class: 'wb-prop-label', id: 'wb-custom-color-label', textContent: '#38BDF8' })
                            )
                        ),
                        el('div', { class: 'wb-prop-group' },
                            el('div', { style: { display: 'flex', justifyContent: 'space-between' } },
                                el('span', { class: 'wb-prop-label', textContent: 'Stroke Width' }),
                                el('span', { class: 'wb-prop-label', id: 'wb-stroke-val', textContent: '3px' })
                            ),
                            el('input', { type: 'range', class: 'wb-stroke-slider', id: 'wb-stroke-width', min: '1', max: '30', value: '3' })
                        )
                    ),

                    // Bottom Zoom Bar
                    el('div', { class: 'wb-bottom-bar' },
                        el('button', { class: 'wb-btn', id: 'wb-btn-zoom-out', title: 'Zoom Out' }, createIcon('zoomOut')),
                        el('span', { class: 'wb-zoom-label', id: 'wb-zoom-val', textContent: '100%' }),
                        el('button', { class: 'wb-btn', id: 'wb-btn-zoom-in', title: 'Zoom In' }, createIcon('zoomIn')),
                        el('button', { class: 'wb-btn', id: 'wb-btn-zoom-reset', title: 'Reset Zoom' }, createIcon('resetZoom'))
                    ),

                    // Notification Toast
                    el('div', { class: 'wb-toast', id: 'wb-toast', textContent: 'Canvas Auto-Saved' }),

                    // Confirmation Modal
                    el('div', { class: 'wb-confirm-overlay', id: 'wb-confirm-modal' },
                        el('div', { class: 'wb-confirm-box' },
                            el('div', { class: 'wb-confirm-title', textContent: 'Clear Whiteboard?' }),
                            el('div', { class: 'wb-confirm-desc', textContent: 'Are you sure you want to clear all contents? This cannot be undone.' }),
                            el('div', { class: 'wb-confirm-actions' },
                                el('button', { class: 'wb-btn-modal wb-btn-cancel', id: 'wb-confirm-cancel', textContent: 'Cancel' }),
                                el('button', { class: 'wb-btn-modal wb-btn-danger', id: 'wb-confirm-ok', textContent: 'Clear All' })
                            )
                        )
                    )
                )
            )
        );

        shadow.appendChild(backdrop);
    }

    let shadowRoot = null;
    let canvas = null;
    let ctx = null;
    let elements = {};

    function initUI() {
        // Create container host element
        const host = document.createElement('div');
        host.id = 'whiteboard-app-root';
        document.body.appendChild(host);

        // Attach Shadow DOM for scope isolation
        shadowRoot = host.attachShadow({ mode: 'open' });
        buildUI(shadowRoot);

        // Query element references inside shadow root
        canvas = shadowRoot.getElementById('wb-canvas');
        ctx = canvas.getContext('2d');

        elements = {
            backdrop: shadowRoot.getElementById('wb-backdrop'),
            modal: shadowRoot.querySelector('.wb-modal'),
            workspace: shadowRoot.getElementById('wb-workspace'),
            toolbar: shadowRoot.getElementById('wb-toolbar'),
            propertiesPanel: shadowRoot.getElementById('wb-properties-panel'),
            toast: shadowRoot.getElementById('wb-toast'),
            confirmModal: shadowRoot.getElementById('wb-confirm-modal'),
            strokeVal: shadowRoot.getElementById('wb-stroke-val'),
            strokeInput: shadowRoot.getElementById('wb-stroke-width'),
            zoomVal: shadowRoot.getElementById('wb-zoom-val'),
            swatchesContainer: shadowRoot.getElementById('wb-color-swatches'),
            customColorInput: shadowRoot.getElementById('wb-custom-color'),
            customColorLabel: shadowRoot.getElementById('wb-custom-color-label'),
            btnFullscreen: shadowRoot.getElementById('wb-btn-fullscreen'),
            btnTheme: shadowRoot.getElementById('wb-btn-theme')
        };

        buildColorSwatches();
        setupEventListeners();
        loadSavedData();
        resizeCanvas();
    }

    function loadSavedData() {
        try {
            const savedSettings = GM_getValue(CONFIG.STORAGE_KEY_SETTINGS, null);
            if (savedSettings) {
                const settings = JSON.parse(savedSettings);
                if (settings.theme) {
                    state.theme = settings.theme;
                }
            }
            applyTheme(state.theme);

            const savedShapes = GM_getValue(CONFIG.STORAGE_KEY_DATA, null);
            if (savedShapes) {
                state.shapes = JSON.parse(savedShapes);
                redrawCanvas();
            }
        } catch (e) {
            console.error('[Whiteboard] Error loading saved data from GM storage:', e);
        }
    }

    function toggleTheme() {
        const newTheme = state.theme === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme);
        showToast(`Theme: ${newTheme.toUpperCase()}`);
    }

    function applyTheme(theme) {
        state.theme = theme;
        state.bgColor = theme === 'dark' ? CONFIG.DEFAULT_BG_COLOR_DARK : CONFIG.DEFAULT_BG_COLOR_LIGHT;
        if (elements.modal) {
            elements.modal.dataset.theme = theme;
        }
        if (elements.btnTheme) {
            elements.btnTheme.replaceChildren(createIcon(theme === 'dark' ? 'sun' : 'moon'));
            elements.btnTheme.title = `Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`;
        }
        try {
            GM_setValue(CONFIG.STORAGE_KEY_SETTINGS, JSON.stringify({ theme: state.theme }));
        } catch (e) {
            console.error('[Whiteboard] Failed to save settings:', e);
        }
        redrawCanvas();
    }

    function triggerAutoSave() {
        if (state.saveStatusTimer) clearTimeout(state.saveStatusTimer);
        state.saveStatusTimer = setTimeout(() => {
            try {
                GM_setValue(CONFIG.STORAGE_KEY_DATA, JSON.stringify(state.shapes));
                showToast('Progress Saved');
            } catch (e) {
                console.error('[Whiteboard] Failed to save canvas:', e);
            }
        }, CONFIG.AUTO_SAVE_INTERVAL_MS);
    }

    function showToast(message) {
        elements.toast.textContent = message;
        elements.toast.classList.add('show');
        setTimeout(() => elements.toast.classList.remove('show'), 2000);
    }

    /**
     * CANVAS RESIZING & HIGH DPI HANDLING
     */
    function resizeCanvas() {
        if (!canvas || !elements.workspace) return;
        const rect = elements.workspace.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        
        ctx.scale(dpr, dpr);
        redrawCanvas();
    }

    function getCanvasCoordinates(e) {
        const rect = canvas.getBoundingClientRect();
        const rawX = e.clientX - rect.left;
        const rawY = e.clientY - rect.top;

        // Apply Zoom & Pan Transformations
        return {
            x: (rawX - state.pan.x) / state.zoom,
            y: (rawY - state.pan.y) / state.zoom
        };
    }

    /**
     * CANVAS DRAWING & SHAPE RENDERING ENGINE
     */
    function redrawCanvas() {
        if (!ctx) return;
        const rect = elements.workspace.getBoundingClientRect();

        // Clear canvas background
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = state.bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        // Draw dot background grid
        if (state.showGrid) {
            drawGrid(rect.width, rect.height);
        }

        // Apply viewport translation and scaling
        ctx.save();
        ctx.translate(state.pan.x, state.pan.y);
        ctx.scale(state.zoom, state.zoom);

        // Render stored shapes
        for (const shape of state.shapes) {
            renderShape(ctx, shape);
        }

        // Render current active shape in progress
        if (state.currentShape) {
            renderShape(ctx, state.currentShape);
        }

        ctx.restore();
    }

    function drawGrid(width, height) {
        ctx.save();
        ctx.fillStyle = state.theme === 'dark' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.15)';
        
        const size = CONFIG.GRID_SIZE * state.zoom;
        const startX = (state.pan.x % size + size) % size;
        const startY = (state.pan.y % size + size) % size;

        for (let x = startX; x < width; x += size) {
            for (let y = startY; y < height; y += size) {
                ctx.beginPath();
                ctx.arc(x, y, 1.2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }

    function renderShape(targetCtx, shape) {
        targetCtx.save();
        targetCtx.strokeStyle = shape.color;
        targetCtx.fillStyle = shape.fill || 'transparent';
        targetCtx.lineWidth = shape.width;
        targetCtx.lineCap = 'round';
        targetCtx.lineJoin = 'round';

        if (shape.type === 'freehand') {
            if (shape.points.length > 0) {
                targetCtx.beginPath();
                targetCtx.moveTo(shape.points[0].x, shape.points[0].y);
                for (let i = 1; i < shape.points.length; i++) {
                    targetCtx.lineTo(shape.points[i].x, shape.points[i].y);
                }
                targetCtx.stroke();
            }
        } else if (shape.type === 'line') {
            targetCtx.beginPath();
            targetCtx.moveTo(shape.x1, shape.y1);
            targetCtx.lineTo(shape.x2, shape.y2);
            targetCtx.stroke();
        } else if (shape.type === 'arrow') {
            renderArrow(targetCtx, shape.x1, shape.y1, shape.x2, shape.y2, shape.width);
        } else if (shape.type === 'rectangle') {
            targetCtx.beginPath();
            const w = shape.x2 - shape.x1;
            const h = shape.y2 - shape.y1;
            targetCtx.rect(shape.x1, shape.y1, w, h);
            if (shape.fill && shape.fill !== 'transparent') targetCtx.fill();
            targetCtx.stroke();
        } else if (shape.type === 'circle') {
            targetCtx.beginPath();
            const rx = (shape.x2 - shape.x1) / 2;
            const ry = (shape.y2 - shape.y1) / 2;
            const cx = shape.x1 + rx;
            const cy = shape.y1 + ry;
            targetCtx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
            if (shape.fill && shape.fill !== 'transparent') targetCtx.fill();
            targetCtx.stroke();
        } else if (shape.type === 'text') {
            targetCtx.font = `${shape.fontSize || 18}px sans-serif`;
            targetCtx.fillStyle = shape.color;
            const lines = shape.text.split('\n');
            lines.forEach((line, idx) => {
                targetCtx.fillText(line, shape.x, shape.y + (idx * ((shape.fontSize || 18) * 1.2)));
            });
        }

        targetCtx.restore();
    }


    function renderArrow(targetCtx, x1, y1, x2, y2, strokeWidth) {
        const headLength = Math.max(12, strokeWidth * 3);
        const angle = Math.atan2(y2 - y1, x2 - x1);

        targetCtx.beginPath();
        targetCtx.moveTo(x1, y1);
        targetCtx.lineTo(x2, y2);
        targetCtx.stroke();

        targetCtx.beginPath();
        targetCtx.moveTo(x2, y2);
        targetCtx.lineTo(
            x2 - headLength * Math.cos(angle - Math.PI / 6),
            y2 - headLength * Math.sin(angle - Math.PI / 6)
        );
        targetCtx.lineTo(
            x2 - headLength * Math.cos(angle + Math.PI / 6),
            y2 - headLength * Math.sin(angle + Math.PI / 6)
        );
        targetCtx.closePath();
        targetCtx.fillStyle = targetCtx.strokeStyle;
        targetCtx.fill();
    }

    /**
     * MOUSE & POINTER INTERACTION HANDLERS
     */
    function setupEventListeners() {
        window.addEventListener('resize', resizeCanvas);

        // Make Toolbar and Properties Panel Draggable
        makeDraggable(elements.toolbar, shadowRoot.getElementById('wb-toolbar-drag'));
        makeDraggable(elements.propertiesPanel, shadowRoot.getElementById('wb-props-drag'));

        // Prevent panel interactions from drawing on the canvas
        [elements.toolbar, elements.propertiesPanel].forEach(panel => {
            if (panel) {
                panel.addEventListener('mousedown', (e) => e.stopPropagation());
                panel.addEventListener('pointerdown', (e) => e.stopPropagation());
            }
        });

        // Keydown shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.altKey && e.shiftKey && e.code === CONFIG.HOTKEY_TOGGLE) {
                toggleModal();
            }
            if (!state.isOpen) return;

            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z') { e.preventDefault(); undo(); }
                if (e.key === 'y') { e.preventDefault(); redo(); }
            }
            if (e.key === 'Escape') {
                if (state.activeTextInput) removeTextInput();
                else toggleModal(false);
            }
        });

        // Custom Color Picker Listener
        elements.customColorInput.addEventListener('input', (e) => {
            const hexColor = e.target.value;
            state.strokeColor = hexColor;
            if (elements.customColorLabel) {
                elements.customColorLabel.textContent = hexColor.toUpperCase();
            }
            shadowRoot.querySelectorAll('.wb-swatch').forEach(s => s.classList.remove('active'));
        });

        // Fullscreen Toggle Listeners
        elements.btnFullscreen.onclick = toggleFullscreen;
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

        // Workspace panning & drawing listeners
        elements.workspace.addEventListener('mousedown', onPointerDown);
        elements.workspace.addEventListener('mousemove', onPointerMove);
        window.addEventListener('mouseup', onPointerUp);
        elements.workspace.addEventListener('wheel', onWheel, { passive: false });

        // Toolbar Buttons
        const toolButtons = shadowRoot.querySelectorAll('[data-tool]');
        toolButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                toolButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.activeTool = btn.getAttribute('data-tool');
            });
        });

        // Header Actions
        shadowRoot.getElementById('wb-btn-close').onclick = () => toggleModal(false);
        shadowRoot.getElementById('wb-btn-undo').onclick = undo;
        shadowRoot.getElementById('wb-btn-redo').onclick = redo;
        shadowRoot.getElementById('wb-btn-theme').onclick = toggleTheme;
        shadowRoot.getElementById('wb-btn-grid').onclick = () => {
            state.showGrid = !state.showGrid;
            redrawCanvas();
        };
        shadowRoot.getElementById('wb-btn-clear').onclick = () => {
            elements.confirmModal.classList.add('active');
        };
        shadowRoot.getElementById('wb-confirm-cancel').onclick = () => {
            elements.confirmModal.classList.remove('active');
        };
        shadowRoot.getElementById('wb-confirm-ok').onclick = () => {
            elements.confirmModal.classList.remove('active');
            clearCanvas();
        };
        shadowRoot.getElementById('wb-btn-export').onclick = exportImage;

        // Zoom Controls
        shadowRoot.getElementById('wb-btn-zoom-in').onclick = () => setZoom(state.zoom * 1.2);
        shadowRoot.getElementById('wb-btn-zoom-out').onclick = () => setZoom(state.zoom / 1.2);
        shadowRoot.getElementById('wb-btn-zoom-reset').onclick = () => setZoom(1.0, true);

        // Stroke Width Slider
        elements.strokeInput.addEventListener('input', (e) => {
            state.strokeWidth = parseInt(e.target.value, 10);
            elements.strokeVal.textContent = `${state.strokeWidth}px`;
        });
    }

    function onPointerDown(e) {
        if (e.button === 1 || e.spaceKey) { // Middle click or Space key panning
            state.isPanning = true;
            state.panStart = { x: e.clientX - state.pan.x, y: e.clientY - state.pan.y };
            elements.workspace.classList.add('panning');
            return;
        }

        if (e.button !== 0) return; // Left click only

        const coords = getCanvasCoordinates(e);

        if (state.activeTool === 'text') {
            createTextInput(coords.x, coords.y, e.clientX, e.clientY);
            return;
        }

        if (state.activeTool === 'eraser') {
            eraseShapeAt(coords);
            state.isDrawing = true;
            return;
        }

        state.isDrawing = true;
        saveStateForUndo();

        if (state.activeTool === 'freehand') {
            state.currentShape = {
                type: 'freehand',
                color: state.strokeColor,
                width: state.strokeWidth,
                points: [{ x: coords.x, y: coords.y }]
            };
        } else {
            state.currentShape = {
                type: state.activeTool,
                color: state.strokeColor,
                fill: state.fillColor,
                width: state.strokeWidth,
                x1: coords.x,
                y1: coords.y,
                x2: coords.x,
                y2: coords.y
            };
        }
    }

    function onPointerMove(e) {
        if (state.isPanning) {
            state.pan.x = e.clientX - state.panStart.x;
            state.pan.y = e.clientY - state.panStart.y;
            redrawCanvas();
            return;
        }

        if (!state.isDrawing) return;

        const coords = getCanvasCoordinates(e);

        if (state.activeTool === 'eraser') {
            eraseShapeAt(coords);
            return;
        }

        if (!state.currentShape) return;

        if (state.activeTool === 'freehand') {
            state.currentShape.points.push({ x: coords.x, y: coords.y });
        } else {
            state.currentShape.x2 = coords.x;
            state.currentShape.y2 = coords.y;
        }

        redrawCanvas();
    }

    function onPointerUp() {
        if (state.isPanning) {
            state.isPanning = false;
            elements.workspace.classList.remove('panning');
        }

        if (state.isDrawing) {
            state.isDrawing = false;
            if (state.currentShape) {
                state.shapes.push(state.currentShape);
                state.currentShape = null;
                triggerAutoSave();
                redrawCanvas();
            }
        }
    }

    /**
     * TEXT TOOL IMPLEMENTATION
     */
    function createTextInput(canvasX, canvasY, clientX, clientY) {
        if (state.activeTextInput) removeTextInput();

        const input = document.createElement('textarea');
        input.className = 'wb-text-overlay';
        input.style.left = `${clientX - elements.workspace.getBoundingClientRect().left}px`;
        input.style.top = `${clientY - elements.workspace.getBoundingClientRect().top}px`;
        input.style.color = state.strokeColor;

        elements.workspace.appendChild(input);
        setTimeout(() => input.focus(), 10);

        state.activeTextInput = { element: input, x: canvasX, y: canvasY };

        input.addEventListener('blur', () => commitTextInput());
    }

    function commitTextInput() {
        if (!state.activeTextInput) return;
        const text = state.activeTextInput.element.value.trim();
        if (text) {
            saveStateForUndo();
            state.shapes.push({
                type: 'text',
                text: text,
                color: state.strokeColor,
                fontSize: 20,
                x: state.activeTextInput.x,
                y: state.activeTextInput.y + 18
            });
            triggerAutoSave();
            redrawCanvas();
        }
        removeTextInput();
    }

    function removeTextInput() {
        if (state.activeTextInput && state.activeTextInput.element) {
            state.activeTextInput.element.remove();
            state.activeTextInput = null;
        }
    }

    /**
     * DRAGGABLE PANEL HELPER
     */
    function makeDraggable(element, handle) {
        if (!element || !handle) return;
        let isDragging = false;
        let startX = 0, startY = 0;
        let initialLeft = 0, initialTop = 0;

        handle.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.preventDefault();

            isDragging = true;
            handle.setPointerCapture(e.pointerId);

            const parentRect = elements.workspace.getBoundingClientRect();
            const elemRect = element.getBoundingClientRect();

            // Clear CSS transform centering offset on initial drag start
            if (element.style.transform && element.style.transform !== 'none') {
                element.style.transform = 'none';
            }

            initialLeft = elemRect.left - parentRect.left;
            initialTop = elemRect.top - parentRect.top;

            element.style.left = `${initialLeft}px`;
            element.style.top = `${initialTop}px`;
            element.style.right = 'auto';
            element.style.bottom = 'auto';

            startX = e.clientX;
            startY = e.clientY;
        });

        handle.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            e.stopPropagation();
            e.preventDefault();

            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            const parentRect = elements.workspace.getBoundingClientRect();
            const elemRect = element.getBoundingClientRect();

            let newLeft = initialLeft + deltaX;
            let newTop = initialTop + deltaY;

            const maxLeft = parentRect.width - elemRect.width;
            const maxTop = parentRect.height - elemRect.height;

            newLeft = Math.max(0, Math.min(newLeft, maxLeft));
            newTop = Math.max(0, Math.min(newTop, maxTop));

            element.style.left = `${newLeft}px`;
            element.style.top = `${newTop}px`;
        });

        const stopDragging = (e) => {
            if (!isDragging) return;
            isDragging = false;
            try {
                handle.releasePointerCapture(e.pointerId);
            } catch (err) {}
        };

        handle.addEventListener('pointerup', stopDragging);
        handle.addEventListener('pointercancel', stopDragging);
    }

    /**
     * ERASER & ZOOM HELPER FUNCTIONS
     */
    function eraseShapeAt(coords) {
        const threshold = Math.max(10, state.strokeWidth * 2);
        const originalCount = state.shapes.length;

        state.shapes = state.shapes.filter(shape => {
            if (shape.type === 'freehand') {
                return !shape.points.some(pt => Math.hypot(pt.x - coords.x, pt.y - coords.y) < threshold);
            }
            if (shape.type === 'rectangle' || shape.type === 'circle' || shape.type === 'line' || shape.type === 'arrow') {
                const midX = (shape.x1 + shape.x2) / 2;
                const midY = (shape.y1 + shape.y2) / 2;
                return Math.hypot(midX - coords.x, midY - coords.y) > threshold * 2;
            }
            if (shape.type === 'text') {
                return Math.hypot(shape.x - coords.x, shape.y - coords.y) > threshold * 2;
            }
            return true;
        });

        if (state.shapes.length !== originalCount) {
            triggerAutoSave();
            redrawCanvas();
        }
    }

    function onWheel(e) {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        setZoom(state.zoom * zoomFactor);
    }

    function setZoom(newZoom, resetPan = false) {
        state.zoom = Math.min(Math.max(CONFIG.MIN_ZOOM, newZoom), CONFIG.MAX_ZOOM);
        if (resetPan) {
            state.pan = { x: 0, y: 0 };
        }
        elements.zoomVal.textContent = `${Math.round(state.zoom * 100)}%`;
        redrawCanvas();
    }

    /**
     * FULLSCREEN TOGGLE HANDLERS
     */
    function toggleFullscreen() {
        const modal = elements.modal;
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            if (modal.requestFullscreen) {
                modal.requestFullscreen();
            } else if (modal.webkitRequestFullscreen) {
                modal.webkitRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }
    }

    function handleFullscreenChange() {
        const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
        if (elements.btnFullscreen) {
            elements.btnFullscreen.replaceChildren(createIcon(isFS ? 'fullscreenExit' : 'fullscreen'));
            elements.btnFullscreen.title = isFS ? 'Exit Fullscreen' : 'Toggle Fullscreen';
        }
        setTimeout(resizeCanvas, 100);
    }

    /**
     * UNDO / REDO & CANVAS RESET
     */
    function saveStateForUndo() {
        state.undoStack.push(JSON.stringify(state.shapes));
        if (state.undoStack.length > CONFIG.MAX_UNDO_STEPS) state.undoStack.shift();
        state.redoStack = []; // Clear redo on new action
    }

    function undo() {
        if (state.undoStack.length === 0) return;
        state.redoStack.push(JSON.stringify(state.shapes));
        state.shapes = JSON.parse(state.undoStack.pop());
        triggerAutoSave();
        redrawCanvas();
    }

    function redo() {
        if (state.redoStack.length === 0) return;
        state.undoStack.push(JSON.stringify(state.shapes));
        state.shapes = JSON.parse(state.redoStack.pop());
        triggerAutoSave();
        redrawCanvas();
    }

    function clearCanvas() {
        saveStateForUndo();
        state.shapes = [];
        triggerAutoSave();
        redrawCanvas();
        showToast('Canvas Cleared');
    }

    /**
     * SWATCH BUILDER & EXPORT
     */
    function buildColorSwatches() {
        elements.swatchesContainer.replaceChildren();
        CONFIG.COLOR_SWATCHES.forEach(color => {
            const swatch = document.createElement('div');
            swatch.className = `wb-swatch ${color === state.strokeColor ? 'active' : ''}`;
            swatch.style.backgroundColor = color;
            swatch.addEventListener('click', () => {
                shadowRoot.querySelectorAll('.wb-swatch').forEach(s => s.classList.remove('active'));
                swatch.classList.add('active');
                state.strokeColor = color;
                if (elements.customColorInput) {
                    elements.customColorInput.value = color;
                }
                if (elements.customColorLabel) {
                    elements.customColorLabel.textContent = color.toUpperCase();
                }
            });
            elements.swatchesContainer.appendChild(swatch);
        });
    }

    function exportImage() {
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        const rect = elements.workspace.getBoundingClientRect();

        tempCanvas.width = rect.width;
        tempCanvas.height = rect.height;

        // Render solid dark background for clean PNG export
        tempCtx.fillStyle = state.bgColor;
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        for (const shape of state.shapes) {
            renderShape(tempCtx, shape);
        }

        const link = document.createElement('a');
        link.download = `whiteboard-${new Date().toISOString().slice(0,10)}.png`;
        link.href = tempCanvas.toDataURL('image/png');
        link.click();
        showToast('Exported Image');
    }

    /**
     * MODAL TOGGLE & GM MENU COMMANDS
     */
    function toggleModal(flag) {
        state.isOpen = flag !== undefined ? flag : !state.isOpen;
        if (state.isOpen) {
            elements.backdrop.classList.add('visible');
            resizeCanvas();
        } else {
            elements.backdrop.classList.remove('visible');
        }
    }

    // Register Greasemonkey / Tampermonkey menu command
    if (typeof GM_registerMenuCommand !== 'undefined') {
        GM_registerMenuCommand('Open WhiteBoard', () => toggleModal(true));
    }

    // Initialize application UI when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUI);
    } else {
        initUI();
    }

})();