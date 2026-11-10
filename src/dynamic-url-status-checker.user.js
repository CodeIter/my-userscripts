// ==UserScript==
// @name         Dynamic URL Status Checker
// @namespace    https://docs.scriptcat.org/
// @version      1.4.0
// @description  Checks a list of URLs hourly. Add URLs via the extension menu.
// @author       CodeIter
// @icon         https://www.google.com/s2/favicons?sz=64&domain=docs.scriptcat.org
// @background
// @crontab      * once * * *
// @grant        GM_log
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      */*
// @noframes
// ==/UserScript==

(async function main() {
    'use strict';

    const scriptName = 'Dynamic URL Status Checker';
    const STORAGE_KEY = 'monitored_urls';

    // 1. Register the Menu Command (Runs once when script loads)
    // We register it here, but the logic to handle it will be in a separate function
    // Note: In background scripts, menu commands are visible in the ScriptCat dashboard menu.
    GM_registerMenuCommand("➕ Add URL to Monitor", addUrlToMonitor);

    // 2. Get the list of URLs from storage
    let urls = await GM_getValue(STORAGE_KEY, []);

    if (!Array.isArray(urls)) {
        urls = [];
    }

    if (urls.length === 0) {
        /* Silently Ignore
        GM_log(`${scriptName}: No URLs configured. Skipping check.`);
        // Send a notification if empty
        GM_notification({
            title: scriptName,
            text: "No URLs configured. Click the menu to add one.",
            timeout: 5000
        });
        */
        await GM_setValue('monitored_urls', urls)
        return Promise.resolve();
    }

    GM_log(`${scriptName}: Starting scheduled check at ${new Date().toISOString()}`);

    const results = { success: 0, failed: 0, errors: [] };

    // 3. Check each URL
    for (const url of urls) {
        try {
            GM_log(`Checking: ${url}`);
            const status = await checkWebsiteStatus(url);

            if (status === 200) {
                results.success++;
                GM_log(`✅ Success: ${url} returned ${status}`);
            } else {
                results.failed++;
                results.errors.push(`${url} (Status: ${status})`);
                GM_log(`❌ Fail: ${url} returned ${status}`);
            }
        } catch (error) {
            results.failed++;
            results.errors.push(`${url} (${error.message})`);
            GM_log(`❌ Error: ${url} - ${error.message}`);
        }
    }

    // 4. Send Notification based on results
    let notificationText = `Checked ${urls.length} URLs.\n`;
    notificationText += `✅ Success: ${results.success}\n`;
    
    if (results.failed > 0) {
        notificationText += `❌ Failed: ${results.failed}`;
        // Optional: Append first few errors if needed, but keep it concise
        if (results.errors.length > 0) {
            notificationText += `\n(See log for details)`;
        }
    }

    GM_notification({
        title: scriptName,
        text: notificationText,
        timeout: 8000
    });

    // 5. Return Promise
    // If any failed and you want to retry the whole batch, you could reject with CATRetryError
    // For now, we resolve as the "check" is complete.
    return Promise.resolve();

    // If you want the script to retry automatically, reject with CATRetryError
    // Note: 'CATRetryError' is specific to Script Cat's retry mechanism
    // You might need to define or import it depending on the exact Script Cat version
    // For this example, we assume it's available in the global scope or defined here
    //if (typeof CATRetryError !== 'undefined') {
    //    return Promise.reject(new CATRetryError(error.message));
    //} else {
    //    // Fallback if CATRetryError is not defined (standard reject)
    //    return Promise.reject(error);
    //}

})();

// --- Helper Functions ---

/**
 * Prompts the user to add a URL and saves it to storage.
 * This is triggered by the menu command.
 */
function addUrlToMonitor() {
    const newUrl = prompt("Enter the URL to monitor (e.g., https://example.com):");
    
    if (!newUrl) return; // User cancelled

    // Simple validation
    try {
        new URL(newUrl); // Throws error if invalid
    } catch (e) {
        alert(`Invalid URL format. Please include http:// or https://\n${e.message}`);
        return;
    }

    // Get current list
    GM_getValue('monitored_urls', []).then((currentUrls) => {
        if (!Array.isArray(currentUrls)) currentUrls = [];
        
        if (currentUrls.includes(newUrl)) {
            alert("This URL is already in the list.");
            return;
        }

        currentUrls.push(newUrl);
        
        // Save back to storage
        // Using await syntax style within the promise chain for clarity
        GM_setValue('monitored_urls', currentUrls).then(() => {
            GM_notification({
                title: "URL Added",
                text: `Added ${newUrl} to the monitor list.`,
                timeout: 3000
            });
            GM_log(`Added URL: ${newUrl}`);
        });
    });
}

/**
 * Performs the actual HTTP request.
 */
function checkWebsiteStatus(url) {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            timeout: 10000, // 10 second timeout
            onload: function(response) {
                resolve(response.status);
            },
            onerror: function(err) {
                reject(new Error(`Network error: ${err.message}`));
            },
            ontimeout: function() {
                reject(new Error(`Timeout`));
            }
        });
    });
}
