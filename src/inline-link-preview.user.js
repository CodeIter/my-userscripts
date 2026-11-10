// ==UserScript==
// @name         Inline link preview
// @namespace    https://docs.scriptcat.org/
// @version      1.1.4
// @description  Quickly preview a link on hover
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @grant        GM_xmlhttpRequest
// @connect      *
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    /**
     * Configuration options for Inline Link Preview.
     * Edit variables here to customize behavior, timing, and limits.
     */
    const CONFIG = {
        HOVER_DELAY_MS: 400,        // Time in ms to hover before preview opens
        HIDE_DELAY_MS: 200,         // Time in ms before preview hides on mouse leave
        TIMEOUT_MS: 6000,           // Request timeout in ms
        CACHE_MAX_SIZE: 100,        // Maximum cached preview items in memory
        MAX_TEXT_LENGTH: 300,       // Max characters for text snippet
        OFFSET_X: 15,               // Tooltip horizontal offset from cursor
        OFFSET_Y: 15,               // Tooltip vertical offset from cursor
        EXCLUDED_PROTOCOLS: ['javascript:', 'mailto:', 'tel:', 'data:', 'file:'],
        EXCLUDED_EXTENSIONS: [
            // Documents
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.odt', '.ods',
            // Archives
            '.zip', '.rar', '.7z', '.tar', '.gz', '.xz', '.bz2', '.iso', '.dmg',
            // Images
            '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff', '.webp',
            // Video
            '.mp4', '.avi', '.mov', '.flv', '.wmv', '.mkv', '.webm', '.m4v', '.3gp', '.mpg', '.mpeg',
            // Audio
            '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.wma', '.aiff', '.alac',
            // Executables & Binaries
            '.exe', '.dll', '.so', '.msi', '.deb', '.rpm', '.app', '.apk', '.bin', '.iso',
            // Fonts
            '.ttf', '.otf', '.woff', '.woff2', '.eot',
            // Design & Production
            '.psd', '.ai', '.eps', '.fla', '.indd',
            // Other Binary/Specialized
            '.torrent', '.jar', '.swf', '.class', '.pyc', '.o', '.a', '.lib'
        ]
    };

    /**
     * Simple LRU Cache implementation using JS Map insertion order.
     */
    class PreviewCache {
        constructor(maxSize) {
            this.maxSize = maxSize;
            this.cache = new Map();
        }

        get(key) {
            if (!this.cache.has(key)) return null;
            const value = this.cache.get(key);
            // Refresh insertion key order for LRU
            this.cache.delete(key);
            this.cache.set(key, value);
            return value;
        }

        set(key, value) {
            if (this.cache.has(key)) {
                this.cache.delete(key);
            } else if (this.cache.size >= this.maxSize) {
                // Delete oldest key
                const oldestKey = this.cache.keys().next().value;
                this.cache.delete(oldestKey);
            }
            this.cache.set(key, value);
        }
    }

    const cache = new PreviewCache(CONFIG.CACHE_MAX_SIZE);

    const UI_STYLES = `
        :host {
            all: initial;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .preview-card {
            position: fixed;
            z-index: 2147483647;
            width: 320px;
            max-height: 240px;
            padding: 12px;
            background-color: #1e1e2e;
            color: #cdd6f4;
            border: 1px solid #45475a;
            border-radius: 10px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4), 0 0 1px rgba(255, 255, 255, 0.1);
            font-size: 12px;
            line-height: 1.4;
            box-sizing: border-box;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s;
            transform: translateY(6px);
            pointer-events: none;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .preview-card.visible {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }
        .header {
            display: flex;
            align-items: center;
            gap: 8px;
            border-bottom: 1px solid #313244;
            padding-bottom: 6px;
        }
        .favicon {
            width: 16px;
            height: 16px;
            border-radius: 2px;
            flex-shrink: 0;
            object-fit: contain;
            background-color: transparent;
        }
        .title {
            font-weight: 600;
            font-size: 13px;
            color: #89b4fa;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            flex-grow: 1;
        }
        .url {
            font-size: 10px;
            color: #a6adc8;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .body {
            font-size: 12px;
            color: #bac2de;
            overflow-y: auto;
            max-height: 130px;
            word-break: break-word;
        }
        .loader {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 12px 0;
        }
        .spinner {
            width: 18px;
            height: 18px;
            border: 2px solid rgba(137, 180, 250, 0.2);
            border-top-color: #89b4fa;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .error-state {
            color: #f38ba8;
            font-size: 11px;
            padding: 4px 0;
        }
    `;

    /**
     * Builds the UI hierarchy using direct DOM methods without innerHTML.
     * Uses CSSStyleSheet and adoptedStyleSheets to bypass strict CSP style-src restrictions.
     */
    function buildUI() {
        const host = document.createElement('div');
        host.id = 'inline-link-preview-host';
        const shadowRoot = host.attachShadow({ mode: 'closed' });

        // Apply styles using Constructable Stylesheets if supported (bypasses CSP style-src)
        if ('adoptedStyleSheets' in shadowRoot && 'CSSStyleSheet' in window) {
            try {
                const sheet = new CSSStyleSheet();
                sheet.replaceSync(UI_STYLES);
                shadowRoot.adoptedStyleSheets = [sheet];
            } catch (e) {
                // Fallback to style tag if Constructable Stylesheets fail
                const style = document.createElement('style');
                style.textContent = UI_STYLES;
                shadowRoot.appendChild(style);
            }
        } else {
            const style = document.createElement('style');
            style.textContent = UI_STYLES;
            shadowRoot.appendChild(style);
        }

        const card = document.createElement('div');
        card.className = 'preview-card';

        const header = document.createElement('div');
        header.className = 'header';

        const favicon = document.createElement('img');
        favicon.className = 'favicon';
        favicon.alt = '';

        const title = document.createElement('div');
        title.className = 'title';

        header.appendChild(favicon);
        header.appendChild(title);

        const urlEl = document.createElement('div');
        urlEl.className = 'url';

        const body = document.createElement('div');
        body.className = 'body';

        const loader = document.createElement('div');
        loader.className = 'loader';

        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        loader.appendChild(spinner);

        const snippet = document.createElement('div');
        snippet.className = 'snippet';

        const error = document.createElement('div');
        error.className = 'error-state';

        body.appendChild(loader);
        body.appendChild(snippet);
        body.appendChild(error);

        card.appendChild(header);
        card.appendChild(urlEl);
        card.appendChild(body);

        shadowRoot.appendChild(card);

        (document.body || document.documentElement).appendChild(host);

        return {
            card,
            favicon,
            title,
            urlEl,
            loader,
            snippet,
            error
        };
    }

    /**
     * Helper to decode HTML entities in regex-parsed strings.
     */
    function decodeHTMLEntities(text) {
        if (!text) return '';
        return text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#x27;/g, "'")
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
            .replace(/&#x([a-fA-F0-9]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }

    /**
     * Fallback HTML parser using regex to extract metadata when DOMParser is blocked by TrustedTypes CSP.
     */
    function parseHTMLWithRegex(htmlText, targetUrl) {
        let titleText = '';
        let faviconUrl = '';
        let snippetText = '';

        // Parse Title from og:title, twitter:title, or <title>
        const ogTitleMatch = htmlText.match(/<meta\s+[^>]*property=["']og:title["']\s+[^>]*content=["']([^"']+)["']/i) ||
                              htmlText.match(/<meta\s+[^>]*content=["']([^"']+)["']\s+[^>]*property=["']og:title["']/i) ||
                              htmlText.match(/<meta\s+[^>]*name=["']twitter:title["']\s+[^>]*content=["']([^"']+)["']/i);

        if (ogTitleMatch && ogTitleMatch[1]) {
            titleText = ogTitleMatch[1];
        } else {
            const titleTagMatch = htmlText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            if (titleTagMatch && titleTagMatch[1]) {
                titleText = titleTagMatch[1];
            } else {
                try {
                    titleText = new URL(targetUrl).hostname;
                } catch (e) {
                    titleText = targetUrl;
                }
            }
        }

        // Parse Favicon
        const iconMatch = htmlText.match(/<link\s+[^>]*rel=["'](?:shortcut )?icon["']\s+[^>]*href=["']([^"']+)["']/i) ||
                          htmlText.match(/<link\s+[^>]*href=["']([^"']+)["']\s+[^>]*rel=["'](?:shortcut )?icon["']/i);
        if (iconMatch && iconMatch[1]) {
            try {
                faviconUrl = new URL(decodeHTMLEntities(iconMatch[1]), targetUrl).href;
            } catch (e) {
                faviconUrl = '';
            }
        }

        if (!faviconUrl) {
            try {
                const domain = new URL(targetUrl).hostname;
                faviconUrl = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
            } catch (e) {
                faviconUrl = '';
            }
        }

        // Parse Description
        const metaDescMatch = htmlText.match(/<meta\s+[^>]*name=["']description["']\s+[^>]*content=["']([^"']+)["']/i) ||
                              htmlText.match(/<meta\s+[^>]*content=["']([^"']+)["']\s+[^>]*name=["']description["']/i) ||
                              htmlText.match(/<meta\s+[^>]*property=["']og:description["']\s+[^>]*content=["']([^"']+)["']/i) ||
                              htmlText.match(/<meta\s+[^>]*content=["']([^"']+)["']\s+[^>]*property=["']og:description["']/i);

        if (metaDescMatch && metaDescMatch[1]) {
            snippetText = metaDescMatch[1].trim();
        }

        if (!snippetText || snippetText.length < 25) {
            const cleanHtml = htmlText.replace(/<script[\s\S]*?<\/script>/gi, '')
                                      .replace(/<style[\s\S]*?<\/style>/gi, '');
            const pMatches = cleanHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);

            if (pMatches) {
                const paragraphs = [];
                for (const p of pMatches) {
                    const text = p.replace(/<[^>]+>/g, '').trim();
                    const decoded = decodeHTMLEntities(text);
                    if (decoded.length > 20) {
                        paragraphs.push(decoded);
                        if (paragraphs.length >= 3) break;
                    }
                }
                if (paragraphs.length > 0) {
                    snippetText = paragraphs.join(' ');
                }
            }
        }

        if (!snippetText) {
            snippetText = 'No text preview available for this page.';
        }

        titleText = decodeHTMLEntities(titleText.replace(/<[^>]+>/g, '')).trim();
        snippetText = decodeHTMLEntities(snippetText).trim();

        if (snippetText.length > CONFIG.MAX_TEXT_LENGTH) {
            snippetText = snippetText.substring(0, CONFIG.MAX_TEXT_LENGTH) + '...';
        }

        return {
            title: titleText,
            favicon: faviconUrl,
            snippet: snippetText,
            url: targetUrl
        };
    }

    /**
     * Safely extracts preview meta (title, favicon, snippet) with TrustedTypes & Regex fallback.
     */
    function parseHTML(htmlText, targetUrl) {
        try {
            let htmlInput = htmlText;

            // Attempt Trusted Types policy if available
            if (window.trustedTypes) {
                if (!window.__inlinePreviewPolicy) {
                    try {
                        window.__inlinePreviewPolicy = window.trustedTypes.createPolicy('inlinePreviewPolicy', {
                            createHTML: (s) => s
                        });
                    } catch (e) {
                        // Policy creation blocked by CSP
                    }
                }
                if (window.__inlinePreviewPolicy) {
                    htmlInput = window.__inlinePreviewPolicy.createHTML(htmlText);
                } else if (window.trustedTypes.defaultPolicy) {
                    htmlInput = window.trustedTypes.defaultPolicy.createHTML(htmlText);
                }
            }

            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlInput, 'text/html');

            // Parse Title
            let titleText = '';
            const ogTitle = doc.querySelector('meta[property="og:title"]');
            if (ogTitle && ogTitle.getAttribute('content')) {
                titleText = ogTitle.getAttribute('content');
            } else if (doc.title) {
                titleText = doc.title;
            } else {
                titleText = new URL(targetUrl).hostname;
            }

            // Parse Favicon
            let faviconUrl = '';
            const iconEl = doc.querySelector('link[rel*="icon"]');
            if (iconEl && iconEl.getAttribute('href')) {
                try {
                    faviconUrl = new URL(iconEl.getAttribute('href'), targetUrl).href;
                } catch (e) {
                    faviconUrl = '';
                }
            }
            if (!faviconUrl) {
                const domain = new URL(targetUrl).hostname;
                faviconUrl = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
            }

            // Parse Description / Snippet
            let snippetText = '';
            const metaDesc = doc.querySelector('meta[name="description"]') || doc.querySelector('meta[property="og:description"]');
            if (metaDesc && metaDesc.getAttribute('content')) {
                snippetText = metaDesc.getAttribute('content').trim();
            }

            if (!snippetText || snippetText.length < 25) {
                const paragraphs = Array.from(doc.querySelectorAll('article p, main p, p'))
                    .map(p => p.textContent ? p.textContent.trim() : '')
                    .filter(text => text.length > 20);

                if (paragraphs.length > 0) {
                    snippetText = paragraphs.slice(0, 3).join(' ');
                }
            }

            if (!snippetText) {
                snippetText = 'No text preview available for this page.';
            }

            if (snippetText.length > CONFIG.MAX_TEXT_LENGTH) {
                snippetText = snippetText.substring(0, CONFIG.MAX_TEXT_LENGTH) + '...';
            }

            return {
                title: titleText.trim(),
                favicon: faviconUrl,
                snippet: snippetText,
                url: targetUrl
            };
        } catch (err) {
            // DOMParser blocked by TrustedHTML enforcement -> fallback to Regex extraction
            return parseHTMLWithRegex(htmlText, targetUrl);
        }
    }

    /**
     * Fetches page content via GM_xmlhttpRequest.
     */
    function fetchPage(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                timeout: CONFIG.TIMEOUT_MS,
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const parsed = parseHTML(response.responseText, url);
                            resolve(parsed);
                        } catch (err) {
                            reject(new Error('Failed to parse page content.'));
                        }
                    } else {
                        reject(new Error(`HTTP ${response.status} ${response.statusText}`));
                    }
                },
                onerror: () => reject(new Error('Network request failed.')),
                ontimeout: () => reject(new Error('Request timed out.'))
            });
        });
    }

    let ui = null;
    let hoverTimer = null;
    let hideTimer = null;
    let currentAnchor = null;
    let currentMousePos = { x: 0, y: 0 };

    function positionTooltip(x, y) {
        if (!ui || !ui.card) return;

        const cardWidth = 320;
        const cardHeight = 240;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let posX = x + CONFIG.OFFSET_X;
        let posY = y + CONFIG.OFFSET_Y;

        if (posX + cardWidth > viewportWidth - 10) {
            posX = x - cardWidth - CONFIG.OFFSET_X;
        }
        if (posY + cardHeight > viewportHeight - 10) {
            posY = y - cardHeight - CONFIG.OFFSET_Y;
        }

        posX = Math.max(10, posX);
        posY = Math.max(10, posY);

        ui.card.style.left = `${posX}px`;
        ui.card.style.top = `${posY}px`;
    }

    function resetUI() {
        if (!ui) return;
        ui.title.textContent = '';
        ui.favicon.removeAttribute('src');
        ui.favicon.style.display = 'none';
        ui.urlEl.textContent = '';
        ui.snippet.textContent = '';
        ui.error.textContent = '';
        ui.loader.style.display = 'flex';
        ui.snippet.style.display = 'none';
        ui.error.style.display = 'none';
    }

    function showTooltip() {
        if (ui) ui.card.classList.add('visible');
    }

    function hideTooltip() {
        if (ui) ui.card.classList.remove('visible');
        currentAnchor = null;
    }

    function isValidLink(anchor) {
        if (!anchor || !anchor.href) return false;
        const href = anchor.href;

        // Check excluded protocols
        if (CONFIG.EXCLUDED_PROTOCOLS.some(proto => href.startsWith(proto))) {
            return false;
        }

        // Check current page anchors or same page links
        try {
            const targetUrl = new URL(href, window.location.href);
            if (targetUrl.pathname === window.location.pathname &&
                targetUrl.hostname === window.location.hostname &&
                targetUrl.search === window.location.search &&
                targetUrl.hash) {
                return false;
            }

            // Check excluded file extensions
            const lowerPath = targetUrl.pathname.toLowerCase();
            if (CONFIG.EXCLUDED_EXTENSIONS.some(ext => lowerPath.endsWith(ext))) {
                return false;
            }
        } catch (e) {
            return false;
        }

        return true;
    }

    function handleMouseOver(e) {
        const anchor = e.target.closest('a');
        if (!anchor || !isValidLink(anchor)) return;

        if (currentAnchor === anchor) return;

        clearTimeout(hoverTimer);
        clearTimeout(hideTimer);

        currentAnchor = anchor;
        currentMousePos = { x: e.clientX, y: e.clientY };

        hoverTimer = setTimeout(() => {
            triggerPreview(anchor.href);
        }, CONFIG.HOVER_DELAY_MS);
    }

    function handleMouseMove(e) {
        currentMousePos = { x: e.clientX, y: e.clientY };
        if (currentAnchor && ui && ui.card.classList.contains('visible')) {
            positionTooltip(e.clientX, e.clientY);
        }
    }

    function handleMouseOut(e) {
        const anchor = e.target.closest('a');
        if (!anchor || anchor !== currentAnchor) return;

        clearTimeout(hoverTimer);
        hideTimer = setTimeout(() => {
            hideTooltip();
        }, CONFIG.HIDE_DELAY_MS);
    }

    async function triggerPreview(url) {
        if (!ui) {
            ui = buildUI();
        }

        resetUI();
        positionTooltip(currentMousePos.x, currentMousePos.y);
        ui.urlEl.textContent = url;
        showTooltip();

        // Check Cache
        const cachedData = cache.get(url);
        if (cachedData) {
            renderPreviewData(cachedData);
            return;
        }

        // Fetch network data
        try {
            const data = await fetchPage(url);
            cache.set(url, data);

            // Ensure anchor is still hovered
            if (currentAnchor && currentAnchor.href === url) {
                renderPreviewData(data);
            }
        } catch (err) {
            if (currentAnchor && currentAnchor.href === url) {
                renderError(err.message || 'Failed to load preview.');
            }
        }
    }

    function renderPreviewData(data) {
        if (!ui) return;

        ui.loader.style.display = 'none';

        ui.title.textContent = data.title;
        if (data.favicon) {
            ui.favicon.src = data.favicon;
            ui.favicon.style.display = 'block';
        }

        ui.snippet.textContent = data.snippet;
        ui.snippet.style.display = 'block';
    }

    function renderError(message) {
        if (!ui) return;

        ui.loader.style.display = 'none';
        ui.title.textContent = 'Preview Unavailable';
        ui.error.textContent = message;
        ui.error.style.display = 'block';
    }

    function init() {
        document.addEventListener('mouseover', handleMouseOver, true);
        document.addEventListener('mousemove', handleMouseMove, true);
        document.addEventListener('mouseout', handleMouseOut, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();