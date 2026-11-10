// ==UserScript==
// @name         Href url as title attribute
// @namespace    https://docs.scriptcat.org/
// @version      1.2.1
// @description  Show link url as link title attribute
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=duck.ai
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function addHrefToTitle() {
        // Get all links with href attribute that haven't been processed yet
        const links = document.querySelectorAll('a[href]:not([data-visitedByHrefAsTitle])');
        
        links.forEach(link => {
            const href = link.getAttribute('href');
            const currentTitle = link.getAttribute('title');
            
            // Append href to existing title or use href alone
            const newTitle = currentTitle 
                ? `${currentTitle} - ${href}` 
                : href;
            
            link.setAttribute('title', newTitle);
            link.setAttribute('data-visitedByHrefAsTitle', 'true');
        });
    }

    // Run on page load
    addHrefToTitle();
    
    // Handle dynamically added links
    const observer = new MutationObserver(addHrefToTitle);
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
