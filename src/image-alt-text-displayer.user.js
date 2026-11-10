// ==UserScript==
// @name         Image alt-text displayer
// @namespace    https://docs.scriptcat.org/
// @version      1.1.3
// @description  Display image alt text on hover as HTML tooltip using constructible stylesheets for CSP compliance
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=duck.ai
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ============ CONFIGURATION ============
    const CONFIG = {
        // Tooltip styling
        backgroundColor: '#2c3e50',
        textColor: '#ecf0f1',
        fontSize: '13px',
        padding: '8px 12px',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        maxWidth: '300px',
        border: '1px solid #34495e',
        
        // Tooltip behavior
        showDelay: 500, // milliseconds
        hideDelay: 100, // milliseconds
        zIndex: '999999',
        
        // Tooltip positioning
        offsetX: 10,
        offsetY: 10,
        
        // Feature flags
        enabled: true,
        onlyEmptyAlt: false, // if true, only show tooltip if alt is not empty
        showOnAllImages: true, // if false, only show on images without title attribute
    };

    // ============ HELPER FUNCTIONS ============
    
    /**
     * Create and inject shadow DOM tooltip container using Constructible Stylesheets for CSP compliance
     */
    function createShadowTooltip() {
        const container = document.createElement('div');
        container.id = 'alt-text-tooltip-host';
        document.body.appendChild(container);

        const shadowRoot = container.attachShadow({ mode: 'open' });

        // Using Constructible Stylesheets to avoid inline <style> injection CSP violations
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(`
            :host {
                --bg-color: ${CONFIG.backgroundColor};
                --text-color: ${CONFIG.textColor};
                --font-size: ${CONFIG.fontSize};
                --padding: ${CONFIG.padding};
                --border-radius: ${CONFIG.borderRadius};
                --box-shadow: ${CONFIG.boxShadow};
                --max-width: ${CONFIG.maxWidth};
                --border: ${CONFIG.border};
                --z-index: ${CONFIG.zIndex};
            }

            #tooltip {
                display: none;
                position: fixed;
                background-color: var(--bg-color);
                color: var(--text-color);
                font-size: var(--font-size);
                padding: var(--padding);
                border-radius: var(--border-radius);
                box-shadow: var(--box-shadow);
                max-width: var(--max-width);
                border: var(--border);
                z-index: var(--z-index);
                word-wrap: break-word;
                white-space: pre-wrap;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                pointer-events: none;
                animation: fadeIn 0.2s ease-in-out;
            }

            #tooltip.visible {
                display: block;
            }

            @keyframes fadeIn {
                from {
                    opacity: 0;
                    transform: translateY(-5px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        `);

        shadowRoot.adoptedStyleSheets = [sheet];

        const tooltip = document.createElement('div');
        tooltip.id = 'tooltip';

        shadowRoot.appendChild(tooltip);

        return {
            container,
            shadowRoot,
            tooltipElement: tooltip,
        };
    }

    /**
     * Position tooltip near cursor
     */
    function positionTooltip(tooltip, x, y) {
        const offsetX = CONFIG.offsetX;
        const offsetY = CONFIG.offsetY;

        let left = x + offsetX;
        let top = y + offsetY;

        // Prevent tooltip from going off-screen (right)
        const tooltipWidth = parseInt(CONFIG.maxWidth) || 300;
        if (left + tooltipWidth > window.innerWidth) {
            left = x - tooltipWidth - offsetX;
        }

        // Prevent tooltip from going off-screen (bottom)
        if (top + 100 > window.innerHeight) {
            top = y - 100 - offsetY;
        }

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    }

    /**
     * Show tooltip with content
     */
    function showTooltip(tooltip, content, x, y) {
        tooltip.textContent = content;
        tooltip.classList.add('visible');
        positionTooltip(tooltip, x, y);
    }

    /**
     * Hide tooltip
     */
    function hideTooltip(tooltip) {
        tooltip.classList.remove('visible');
    }

    /**
     * Attach alt-text tooltip to an image element
     */
    function attachTooltipToImage(img, tooltipElement) {
        let showTimeout;
        let hideTimeout;
        let lastX = 0;
        let lastY = 0;

        img.addEventListener('mouseenter', (event) => {
            const altText = img.getAttribute('alt');

            // Skip if no alt text
            if (!altText || altText.trim() === '') {
                if (!CONFIG.onlyEmptyAlt) return;
            }

            // Skip if image has title and we're not showing on all
            if (!CONFIG.showOnAllImages && img.getAttribute('title')) {
                return;
            }

            clearTimeout(hideTimeout);
            
            // Capture coordinates at mouseenter time
            lastX = event.clientX;
            lastY = event.clientY;
            
            showTimeout = setTimeout(() => {
                showTooltip(tooltipElement, altText || '(no alt text)', lastX, lastY);
            }, CONFIG.showDelay);
        });

        img.addEventListener('mousemove', (event) => {
            // Update last known position
            lastX = event.clientX;
            lastY = event.clientY;
            
            if (tooltipElement.classList.contains('visible')) {
                positionTooltip(tooltipElement, lastX, lastY);
            }
        });

        img.addEventListener('mouseleave', () => {
            clearTimeout(showTimeout);
            hideTimeout = setTimeout(() => {
                hideTooltip(tooltipElement);
            }, CONFIG.hideDelay);
        });
    }

    /**
     * Process all images in the DOM
     */
    function processAllImages(tooltipElement) {
        const images = document.querySelectorAll('img');
        images.forEach(img => attachTooltipToImage(img, tooltipElement));
    }

    /**
     * Watch for dynamically added images
     */
    function observeDOMChanges(tooltipElement) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // Element node
                        if (node.tagName === 'IMG') {
                            attachTooltipToImage(node, tooltipElement);
                        }
                        
                        // Check for images within added element
                        const imgElements = node.querySelectorAll?.('img');
                        if (imgElements) {
                            imgElements.forEach(img => attachTooltipToImage(img, tooltipElement));
                        }
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        return observer;
    }

    // ============ INITIALIZATION ============
    
    if (CONFIG.enabled) {
        // Wait for DOM to be fully loaded
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                const { tooltipElement } = createShadowTooltip();
                processAllImages(tooltipElement);
                observeDOMChanges(tooltipElement);
            });
        } else {
            const { tooltipElement } = createShadowTooltip();
            processAllImages(tooltipElement);
            observeDOMChanges(tooltipElement);
        }
    }
})();