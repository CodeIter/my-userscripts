// ==UserScript==
// @name         Remove Ping Attributes
// @namespace    https://docs.scriptcat.org/
// @version      1.1.1
// @description  Remove ping attributes from all <a> tags and monitor for new ones
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=duck.ai
// @grant        none
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    // Function to remove ping attribute from an element
    function removePingAttribute(element) {
        if (element.tagName === 'A' && element.hasAttribute('ping')) {
            element.removeAttribute('ping');
        }
    }

    // Function to remove ping from all <a> tags in a given element
    function removePingFromAll(container) {
        const links = container.querySelectorAll('a[ping]');
        links.forEach(link => removePingAttribute(link));
    }

    // Remove ping from all existing <a> tags on page load
    removePingFromAll(document);

    // Create and configure MutationObserver to monitor future changes
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            // Check all added nodes
            mutation.addedNodes.forEach((node) => {
                // Only process element nodes (ignore text nodes)
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check if the added node itself is an <a> tag
                    removePingAttribute(node);
                    // Check for <a> tags within the added node
                    removePingFromAll(node);
                }
            });
        });
    });

    // Start observing the entire document tree
    observer.observe(document.documentElement, {
        childList: true,    // Watch for added/removed nodes
        subtree: true       // Watch all descendants
    });
})();
