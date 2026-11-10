// ==UserScript==
// @name         Take Screenshot with html2canvas-pro
// @namespace    https://docs.scriptcat.org/
// @version      1.2.1
// @description  Take screenshot from web browser with html2canvas-pro lib
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @require      https://github.com/yorickshan/html2canvas-pro/releases/download/v2.4.5/html2canvas-pro.min.js
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

/**
 * XXX on website that use color function "oklch", html2canvas fail to capture screenshot.
 * Page screenshot failed: Error: Attempting to parse an unsupported color function "oklch".
 * MOVED to html2canvas-pro.
 */

(function() {
'use strict';

// ==========================================
// CONFIGURATION & CONSTANTS
// ==========================================
const CONFIG = {
    // Default filename prefix for downloaded screenshots
    FILENAME_PREFIX: 'screenshot',

    // Highlight styling during element selection mode
    HIGHLIGHT_OUTLINE: '2px dashed #ff4757',
    HIGHLIGHT_BG: 'rgba(255, 71, 87, 0.15)',

    // Z-Index for modal and highlight overlay
    MODAL_Z_INDEX: 2147483647,

    // Custom options passed directly to html2canvas
    // Options reference: https://html2canvas.hertzen.com/configuration
    HTML2CANVAS_OPTIONS: {
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: '#ffffff',
        // Disable foreignObject rendering to prevent SVG data: URI CSP violations
        foreignObjectRendering: false
    }
};

// ==========================================
// STYLES INJECTION
// ==========================================
const STYLES = `
    .ts-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.7);
        z-index: ${CONFIG.MODAL_Z_INDEX};
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-sizing: border-box;
    }

    .ts-modal-card {
        background: #ffffff;
        border-radius: 8px;
        width: 80vw;
        max-width: 900px;
        max-height: 85vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        overflow: hidden;
        animation: ts-fade-in 0.2s ease-out;
    }

    @keyframes ts-fade-in {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
    }

    .ts-modal-header {
        padding: 14px 20px;
        background: #f8f9fa;
        border-bottom: 1px solid #e9ecef;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-weight: 600;
        font-size: 16px;
        color: #212529;
    }

    .ts-modal-body {
        padding: 20px;
        overflow: auto;
        max-height: calc(85vh - 120px);
        display: flex;
        justify-content: center;
        align-items: center;
        background: #e9ecef;
    }

    /* Using canvas for rendering preview bypasses img-src CSP rules */
    .ts-modal-body canvas {
        max-width: 100%;
        height: auto;
        border: 1px solid #ced4da;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .ts-modal-footer {
        padding: 12px 20px;
        background: #f8f9fa;
        border-top: 1px solid #e9ecef;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
    }

    .ts-btn {
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        border: 1px solid transparent;
        transition: background-color 0.15s ease-in-out;
    }

    .ts-btn-secondary {
        background-color: #6c757d;
        color: #ffffff;
    }
    .ts-btn-secondary:hover { background-color: #5a6268; }

    .ts-btn-primary {
        background-color: #0d6efd;
        color: #ffffff;
    }
    .ts-btn-primary:hover { background-color: #0b5ed7; }

    .ts-btn-success {
        background-color: #198754;
        color: #ffffff;
    }
    .ts-btn-success:hover { background-color: #157347; }

    .ts-element-highlight {
        outline: ${CONFIG.HIGHLIGHT_OUTLINE} !important;
        background-color: ${CONFIG.HIGHLIGHT_BG} !important;
        cursor: crosshair !important;
    }
`;

function injectStyles() {
    if (!document.getElementById('ts-styles')) {
        const style = document.createElement('style');
        style.id = 'ts-styles';
        style.textContent = STYLES;
        document.head.appendChild(style);
    }
}

// ==========================================
// MODAL DIALOG DISPLAY
// ==========================================
function displayModal(capturedCanvas) {
    injectStyles();

    const overlay = document.createElement('div');
    overlay.className = 'ts-modal-overlay';

    const card = document.createElement('div');
    card.className = 'ts-modal-card';

    // Header
    const header = document.createElement('div');
    header.className = 'ts-modal-header';
    header.textContent = 'Screenshot Preview';

    // Body - Render onto a new <canvas> element to bypass CSP img-src limitations
    const body = document.createElement('div');
    body.className = 'ts-modal-body';

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = capturedCanvas.width;
    previewCanvas.height = capturedCanvas.height;
    const ctx = previewCanvas.getContext('2d');
    if (ctx) {
        ctx.drawImage(capturedCanvas, 0, 0);
    }
    body.appendChild(previewCanvas);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'ts-modal-footer';

    // Close Button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ts-btn ts-btn-secondary';
    closeBtn.textContent = 'Close';
    closeBtn.onclick = () => document.body.removeChild(overlay);

    // Copy Button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'ts-btn ts-btn-primary';
    copyBtn.textContent = 'Copy';
    copyBtn.onclick = async () => {
        try {
            capturedCanvas.toBlob(async (blob) => {
                if (!blob) throw new Error('Failed to create Blob');
                const item = new ClipboardItem({ [blob.type]: blob });
                await navigator.clipboard.write([item]);

                const originalText = copyBtn.textContent;
                copyBtn.textContent = 'Copied!';
                setTimeout(() => { copyBtn.textContent = originalText; }, 2000);
            });
        } catch (err) {
            console.error('Copy failed: ', err);
            alert('Could not copy screenshot to clipboard.');
        }
    };

    // Download Button
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'ts-btn ts-btn-success';
    downloadBtn.textContent = 'Download';
    downloadBtn.onclick = () => {
        capturedCanvas.toBlob((blob) => {
            if (!blob) {
                alert('Failed to process image download.');
                return;
            }
            const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = `${CONFIG.FILENAME_PREFIX}_${dateStr}.png`;
            link.href = blobUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(blobUrl);
        }, 'image/png');
    };

    footer.appendChild(copyBtn);
    footer.appendChild(downloadBtn);
    footer.appendChild(closeBtn);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);
    overlay.appendChild(card);

    document.body.appendChild(overlay);
}

// ==========================================
// SCREENSHOT ACTIONS
// ==========================================

// 1. Full Page Screenshot
function takePageScreenshot() {
    const targetElement = document.documentElement || document.body;
    html2canvas(targetElement, CONFIG.HTML2CANVAS_OPTIONS)
        .then(displayModal)
        .catch(err => {
            console.error('Page screenshot failed:', err);
            alert('Failed to capture page screenshot.');
        });
}

// 2. Element Screenshot (Interactive Picker)
function takeElementScreenshot() {
    injectStyles();
    let hoveredEl = null;

    const onMouseOver = (e) => {
        if (hoveredEl) {
            hoveredEl.classList.remove('ts-element-highlight');
        }
        hoveredEl = e.target;
        if (hoveredEl) {
            hoveredEl.classList.add('ts-element-highlight');
        }
    };

    const onClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        cleanup();

        const target = e.target;
        html2canvas(target, CONFIG.HTML2CANVAS_OPTIONS)
            .then(displayModal)
            .catch(err => {
                console.error('Element screenshot failed:', err);
                alert('Failed to capture element screenshot.');
            });
    };

    const onKeyDown = (e) => {
        if (e.key === 'Escape') {
            cleanup();
        }
    };

    const cleanup = () => {
        if (hoveredEl) {
            hoveredEl.classList.remove('ts-element-highlight');
        }
        document.removeEventListener('mouseover', onMouseOver, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeyDown, true);
    };

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
}

// ==========================================
// MENU COMMAND REGISTRATION
// ==========================================
if (typeof GM_registerMenuCommand !== 'undefined') {
    GM_registerMenuCommand('Page screenshot', takePageScreenshot);
    GM_registerMenuCommand('Element screenshot', takeElementScreenshot);
} else {
    console.warn('GM_registerMenuCommand is not supported in this script manager or configuration.');
}

})();