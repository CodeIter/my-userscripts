// ==UserScript==
// @name         Simple StopWatch Script
// @namespace    https://docs.scriptcat.org/
// @version      2.0.1
// @description  A draggable stopwatch with shadow DOM UI, three standard controls, and lap recorder.
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=duck.ai
// @grant        GM.registerMenuCommand
// @noframes
// ==/UserScript==

(function() {
    'use strict';

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
            console.warn('[StopWatch] Failed to adopt stylesheet:', err);
        }
    }

    class StopWatch {
        constructor() {
            this.startTime = 0;
            this.elapsedTime = 0;
            this.isRunning = false;
            this.timerInterval = null;
            this.lapCount = 0;
        }

        start() {
            if (!this.isRunning) {
                this.startTime = Date.now() - this.elapsedTime;
                this.isRunning = true;
            }
        }

        pause() {
            if (this.isRunning) {
                this.elapsedTime = Date.now() - this.startTime;
                this.isRunning = false;
            }
        }

        reset() {
            this.pause();
            this.elapsedTime = 0;
            this.startTime = 0;
            this.lapCount = 0;
        }

        getTime() {
            if (this.isRunning) {
                return Date.now() - this.startTime;
            }
            return this.elapsedTime;
        }

        formatTime(ms) {
            const totalSeconds = Math.floor(ms / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            const milliseconds = Math.floor((ms % 1000) / 10);

            const pad = (num, len = 2) => String(num).padStart(len, '0');
            return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(milliseconds)}`;
        }
    }

    class StopWatchUI {
        constructor() {
            this.stopwatch = new StopWatch();
            this.hostElement = null;
            this.shadowRoot = null;
            this.displayElement = null;
            this.startPauseBtn = null;
            this.lapsContainer = null;
            this.rafId = null;
        }

        createUI() {
            // Create host element
            this.hostElement = document.createElement('div');
            this.hostElement.id = 'stopwatch-widget-host';

            // Attach isolated shadow DOM
            this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });

            adoptStyleSheet(this.shadowRoot, `
                :host {
                    --bg-dark: #18181b;
                    --bg-card: #27272a;
                    --bg-display: #09090b;
                    --accent-cyan: #38bdf8;
                    --accent-green: #10b981;
                    --accent-amber: #f59e0b;
                    --accent-indigo: #6366f1;
                    --accent-red: #ef4444;
                    --text-main: #f4f4f5;
                    --text-muted: #a1a1aa;
                    --border-color: #3f3f46;
                    --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
                    --radius: 12px;
                }

                .container {
                    position: fixed;
                    top: 80px;
                    right: 24px;
                    background-color: var(--bg-dark);
                    border: 1px solid var(--border-color);
                    border-radius: var(--radius);
                    box-shadow: var(--shadow);
                    padding: 16px;
                    width: 280px;
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    z-index: 999999;
                    user-select: none;
                    box-sizing: border-box;
                    color: var(--text-main);
                }

                .container.dragging {
                    opacity: 0.92;
                    box-shadow: 0 20px 30px -10px rgba(0, 0, 0, 0.7);
                }

                .header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                    cursor: move;
                    padding-bottom: 8px;
                    border-bottom: 1px solid var(--border-color);
                }

                .title-group {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .title-icon {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background-color: var(--accent-cyan);
                    box-shadow: 0 0 8px var(--accent-cyan);
                }

                .title {
                    font-size: 13px;
                    font-weight: 700;
                    letter-spacing: 0.5px;
                    text-transform: uppercase;
                    color: var(--text-muted);
                    margin: 0;
                }

                .close-btn {
                    background: transparent;
                    border: none;
                    font-size: 16px;
                    cursor: pointer;
                    color: var(--text-muted);
                    width: 24px;
                    height: 24px;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.15s ease;
                    padding: 0;
                }

                .close-btn:hover {
                    background-color: var(--bg-card);
                    color: var(--text-main);
                }

                .display {
                    background-color: var(--bg-display);
                    border: 1px solid var(--border-color);
                    border-radius: 8px;
                    padding: 14px 10px;
                    text-align: center;
                    margin-bottom: 14px;
                    font-size: 28px;
                    font-weight: 600;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    color: var(--accent-cyan);
                    letter-spacing: 1px;
                    text-shadow: 0 0 12px rgba(56, 189, 248, 0.25);
                }

                .controls {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 12px;
                }

                button.btn {
                    flex: 1;
                    padding: 9px 0;
                    border: none;
                    border-radius: 8px;
                    font-size: 12px;
                    font-weight: 700;
                    letter-spacing: 0.3px;
                    cursor: pointer;
                    transition: transform 0.1s ease, background-color 0.15s ease, box-shadow 0.15s ease;
                    color: #ffffff;
                    outline: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                button.btn:active {
                    transform: scale(0.96);
                }

                .start-btn {
                    background-color: var(--accent-green);
                    box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25);
                }
                .start-btn:hover {
                    background-color: #059669;
                }

                .pause-btn {
                    background-color: var(--accent-amber);
                    box-shadow: 0 2px 8px rgba(245, 158, 11, 0.25);
                }
                .pause-btn:hover {
                    background-color: #d97706;
                }

                .lap-btn {
                    background-color: var(--accent-indigo);
                    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.25);
                }
                .lap-btn:hover {
                    background-color: #4f46e5;
                }

                .reset-btn {
                    background-color: var(--accent-red);
                    box-shadow: 0 2px 8px rgba(239, 68, 68, 0.25);
                }
                .reset-btn:hover {
                    background-color: #dc2626;
                }

                .laps-wrapper {
                    max-height: 140px;
                    overflow-y: auto;
                    border-top: 1px solid var(--border-color);
                    padding-top: 8px;
                    margin-top: 4px;
                }

                .laps-wrapper::-webkit-scrollbar {
                    width: 4px;
                }
                .laps-wrapper::-webkit-scrollbar-thumb {
                    background: var(--border-color);
                    border-radius: 4px;
                }

                .lap-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 6px 8px;
                    font-size: 12px;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    border-radius: 6px;
                    margin-bottom: 4px;
                    background-color: var(--bg-card);
                    animation: fadeIn 0.2s ease-in-out;
                }

                .lap-item:nth-child(even) {
                    background-color: rgba(39, 39, 42, 0.5);
                }

                .lap-index {
                    color: var(--text-muted);
                    font-weight: 600;
                }

                .lap-val {
                    color: var(--text-main);
                    font-weight: 500;
                }

                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(-4px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `);

            const container = document.createElement('div');
            container.className = 'container';

            // Header Section
            const header = document.createElement('div');
            header.className = 'header';

            const titleGroup = document.createElement('div');
            titleGroup.className = 'title-group';

            const titleIcon = document.createElement('div');
            titleIcon.className = 'title-icon';

            const title = document.createElement('h2');
            title.className = 'title';
            title.textContent = 'Stopwatch';

            titleGroup.appendChild(titleIcon);
            titleGroup.appendChild(title);

            const closeBtn = document.createElement('button');
            closeBtn.className = 'close-btn';
            closeBtn.textContent = '✕';
            closeBtn.addEventListener('click', () => this.close());

            header.appendChild(titleGroup);
            header.appendChild(closeBtn);

            // Time Readout Display
            this.displayElement = document.createElement('div');
            this.displayElement.className = 'display';
            this.displayElement.textContent = '00:00:00.00';

            const controls = document.createElement('div');
            controls.className = 'controls';

            // Button 1: Start / Pause Dynamic Toggle
            this.startPauseBtn = document.createElement('button');
            this.startPauseBtn.className = 'btn start-btn';
            this.startPauseBtn.textContent = 'Start';
            this.startPauseBtn.addEventListener('click', () => this.handleStartPause());

            // Button 2: Lap (Prepend lap record)
            const lapBtn = document.createElement('button');
            lapBtn.className = 'btn lap-btn';
            lapBtn.textContent = 'Lap';
            lapBtn.addEventListener('click', () => this.handleLap());

            // Button 3: Reset
            const resetBtn = document.createElement('button');
            resetBtn.className = 'btn reset-btn';
            resetBtn.textContent = 'Reset';
            resetBtn.addEventListener('click', () => this.handleReset());

            controls.appendChild(this.startPauseBtn);
            controls.appendChild(lapBtn);
            controls.appendChild(resetBtn);

            // Scrollable Laps Container
            this.lapsContainer = document.createElement('div');
            this.lapsContainer.className = 'laps-wrapper';

            // Assemble main container
            container.appendChild(header);
            container.appendChild(this.displayElement);
            container.appendChild(controls);
            container.appendChild(this.lapsContainer);

            this.shadowRoot.appendChild(container);

            this.setupDraggable(container, header);

            return this.hostElement;
        }

        setupDraggable(container, header) {
            let isDragging = false;
            let offsetX = 0;
            let offsetY = 0;

            header.addEventListener('mousedown', (e) => {
                isDragging = true;
                const rect = container.getBoundingClientRect();
                offsetX = e.clientX - rect.left;
                offsetY = e.clientY - rect.top;
                container.classList.add('dragging');
            });

            document.addEventListener('mousemove', (e) => {
                if (isDragging) {
                    container.style.left = `${e.clientX - offsetX}px`;
                    container.style.top = `${e.clientY - offsetY}px`;
                    container.style.right = 'auto';
                }
            });

            document.addEventListener('mouseup', () => {
                if (isDragging) {
                    isDragging = false;
                    container.classList.remove('dragging');
                }
            });
        }

        handleStartPause() {
            if (this.stopwatch.isRunning) {
                // Currently running -> Pause
                this.stopwatch.pause();
                this.startPauseBtn.textContent = 'Start';
                this.startPauseBtn.className = 'btn start-btn';
                if (this.rafId) {
                    cancelAnimationFrame(this.rafId);
                }
            } else {
                // Currently paused/stopped -> Start
                this.stopwatch.start();
                this.startPauseBtn.textContent = 'Pause';
                this.startPauseBtn.className = 'btn pause-btn';
                this.startAnimation();
            }
        }

        handleReset() {
            this.stopwatch.reset();
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
            }

            // Reset Start/Pause button state
            this.startPauseBtn.textContent = 'Start';
            this.startPauseBtn.className = 'btn start-btn';

            // Reset Display readout
            this.displayElement.textContent = '00:00:00.00';

            // Clear laps DOM safely without innerHTML
            while (this.lapsContainer.firstChild) {
                this.lapsContainer.removeChild(this.lapsContainer.firstChild);
            }
        }

        handleLap() {
            const currentTimeMs = this.stopwatch.getTime();
            this.stopwatch.lapCount++;

            const lapItem = document.createElement('div');
            lapItem.className = 'lap-item';

            const lapIndex = document.createElement('span');
            lapIndex.className = 'lap-index';
            lapIndex.textContent = `Lap ${String(this.stopwatch.lapCount).padStart(2, '0')}`;

            const lapVal = document.createElement('span');
            lapVal.className = 'lap-val';
            lapVal.textContent = this.stopwatch.formatTime(currentTimeMs);

            lapItem.appendChild(lapIndex);
            lapItem.appendChild(lapVal);

            // Prepend new lap to top of the laps list
            this.lapsContainer.prepend(lapItem);
        }

        startAnimation() {
            const update = () => {
                this.displayElement.textContent = this.stopwatch.formatTime(
                    this.stopwatch.getTime()
                );
                if (this.stopwatch.isRunning) {
                    this.rafId = requestAnimationFrame(update);
                }
            };
            update();
        }

        show() {
            document.body.appendChild(this.hostElement);
        }

        close() {
            this.stopwatch.reset();
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
            }
            this.hostElement.remove();
        }
    }

    const stopwatchInstances = [];

    function openStopWatch() {
        const stopwatchUI = new StopWatchUI();
        stopwatchUI.createUI();
        stopwatchUI.show();
        stopwatchInstances.push(stopwatchUI);

        const originalClose = stopwatchUI.close.bind(stopwatchUI);
        stopwatchUI.close = function() {
            originalClose();
            const index = stopwatchInstances.indexOf(stopwatchUI);
            if (index > -1) {
                stopwatchInstances.splice(index, 1);
            }
        };
    }

    GM.registerMenuCommand('Open StopWatch', openStopWatch);

})();