// ==UserScript==
// @name         Time Tracker
// @namespace    https://docs.scriptcat.org/
// @version      1.7.1
// @description  Track time spent on websites with draggable timer, customizable daily/hourly limits, warnings, auto-dismissing block screen with countdown, temporary access blocking, rule CRUD, JSON import/export, and SPA navigation support.
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        TICK_INTERVAL_MS: 1000,
        IDLE_TIMEOUT_SEC: 60,
        
        DEFAULT_LIMIT_TYPE: 'none',
        DEFAULT_LIMIT_MINUTES: 60,
        DEFAULT_WARNING_PERCENT: 80,
        DEFAULT_SNOOZE_TIME: 1,

        DEFAULT_POSITION: { top: '20px', left: '20px' },
        DEFAULT_MINIMIZED: false,

        THEME: {
            bgPrimary: '#0f172a',
            bgSecondary: '#1e293b',
            bgCard: '#334155',
            textPrimary: '#f8fafc',
            textSecondary: '#94a3b8',
            accent: '#6366f1',
            accentHover: '#4f46e5',
            warning: '#f59e0b',
            danger: '#ef4444',
            success: '#10b981',
            border: 'rgba(255, 255, 255, 0.1)',
            shadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3)'
        }
    };

    const Storage = {
        async get(key, defaultValue) {
            try {
                if (typeof GM_getValue !== 'undefined') {
                    return await GM_getValue(key, defaultValue);
                }
            } catch (e) {
                console.warn('[TimeTracker] GM_getValue failed, falling back to localStorage', e);
            }
            try {
                const val = localStorage.getItem('tt_' + key);
                return val !== null ? JSON.parse(val) : defaultValue;
            } catch (e) {
                return defaultValue;
            }
        },

        async set(key, value) {
            try {
                if (typeof GM_setValue !== 'undefined') {
                    await GM_setValue(key, value);
                    return;
                }
            } catch (e) {
                console.warn('[TimeTracker] GM_setValue failed, falling back to localStorage', e);
            }
            try {
                localStorage.setItem('tt_' + key, JSON.stringify(value));
            } catch (e) {}
        }
    };

    const ScopeMatcher = {
        patternToRegex(pattern) {
            if (!pattern) return null;
            let p = pattern.trim();
            if (!p) return null;
            if (p === '*') return /^.*$/i;

            let regexStr = p
                .replace(/([.+?^=!:${}()|[\]\/\\])/g, "\\$1")
                .replace(/\*/g, ".*");

            if (!p.endsWith('*') && !p.endsWith('$')) {
                regexStr += "(?:[/?#].*)?";
            }

            return new RegExp("^" + regexStr + "$", "i");
        },

        matches(pattern) {
            if (!pattern) return false;
            const p = pattern.trim();
            if (p === '*') return true;

            const rx = this.patternToRegex(p);
            if (!rx) return false;

            const fullHref = location.href;
            const noProtoHref = location.host + location.pathname + location.search + location.hash;
            const noProtoNoQuery = location.host + location.pathname;
            const hostOnly = location.hostname;

            return rx.test(fullHref) || rx.test(noProtoHref) || rx.test(noProtoNoQuery) || rx.test(hostOnly);
        }
    };

    const Utils = {
        getDateKey() {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        },

        getHourKey() {
            const d = new Date();
            return `${this.getDateKey()}_H${d.getHours()}`;
        },

        formatSeconds(totalSec) {
            if (isNaN(totalSec) || totalSec < 0) return '0s';
            const hrs = Math.floor(totalSec / 3600);
            const mins = Math.floor((totalSec % 3600) / 60);
            const secs = totalSec % 60;

            if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
            if (mins > 0) return `${mins}m ${secs}s`;
            return `${secs}s`;
        },

        formatShortSeconds(totalSec) {
            if (isNaN(totalSec) || totalSec < 0) return '00:00';
            const hrs = Math.floor(totalSec / 3600);
            const mins = Math.floor((totalSec % 3600) / 60);
            const secs = totalSec % 60;
            return `${hrs ? hrs + ':' : ''}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        },

        getResetCountdownText(engine) {
            if (!engine.activeRule) return '';
            
            if (Date.now() < engine.snoozeUntil) {
                const diffSecs = Math.ceil((engine.snoozeUntil - Date.now()) / 1000);
                return `Snooze ends in ${this.formatSeconds(diffSecs)}`;
            }

            const now = new Date();
            if (engine.activeRule.limitType === 'hourly') {
                const minsLeft = 59 - now.getMinutes();
                const secsLeft = 60 - now.getSeconds();
                const totalSecs = minsLeft * 60 + secsLeft;
                return `Resets in ${this.formatSeconds(totalSecs)} (top of next hour)`;
            } else if (engine.activeRule.limitType === 'daily') {
                const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
                const totalSecs = Math.floor((tomorrow - now) / 1000);
                return `Resets in ${this.formatSeconds(totalSecs)} (at midnight)`;
            }
            return '';
        }
    };

    class TimeTrackerEngine {
        constructor() {
            this.allRules = [];
            this.activeRule = null;
            this.secondsSpent = 0;
            this.lastTickTime = Date.now();
            this.idleTime = 0;
            this.isUserActive = true;
            this.isBlocked = false;
            this.warningNudgeShown = false;
            this.snoozeUntil = 0;

            this.listeners = [];
            this.timerId = null;
            this.idleCheckId = null;
        }

        async init() {
            await this.loadAllRules();
            this.selectActiveRule();
            await this.loadTimeSpent();
            this.setupActivityListeners();
            this.setupUrlChangeListener();
            this.startTimer();
        }

        async loadAllRules() {
            const rawRules = await Storage.get('rules_list', []);
            this.allRules = rawRules.map(r => ({
                id: r.id || ('rule_' + Math.random().toString(36).substr(2, 9)),
                scopePattern: r.scopePattern || '*',
                limitType: r.limitType || CONFIG.DEFAULT_LIMIT_TYPE,
                limitMinutes: Number(r.limitMinutes) || CONFIG.DEFAULT_LIMIT_MINUTES,
                warningPercent: Number(r.warningPercent) || CONFIG.DEFAULT_WARNING_PERCENT
            }));
        }

        selectActiveRule() {
            const matching = this.allRules.filter(r => ScopeMatcher.matches(r.scopePattern));

            if (matching.length > 0) {
                matching.sort((a, b) => {
                    const aIsStar = a.scopePattern === '*';
                    const bIsStar = b.scopePattern === '*';
                    if (aIsStar && !bIsStar) return 1;
                    if (!aIsStar && bIsStar) return -1;
                    return b.scopePattern.length - a.scopePattern.length;
                });
                this.activeRule = matching[0];
            } else {
                this.activeRule = {
                    id: 'fallback_default',
                    scopePattern: location.hostname,
                    limitType: CONFIG.DEFAULT_LIMIT_TYPE,
                    limitMinutes: CONFIG.DEFAULT_LIMIT_MINUTES,
                    warningPercent: CONFIG.DEFAULT_WARNING_PERCENT
                };
            }
        }

        async saveRule(ruleData) {
            const cleanedPattern = ruleData.scopePattern.trim() || location.hostname;
            const newRule = {
                id: ruleData.id || ('rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
                scopePattern: cleanedPattern,
                limitType: ruleData.limitType,
                limitMinutes: Number(ruleData.limitMinutes) || CONFIG.DEFAULT_LIMIT_MINUTES,
                warningPercent: Number(ruleData.warningPercent) || CONFIG.DEFAULT_WARNING_PERCENT
            };

            const index = this.allRules.findIndex(r => r.id === newRule.id);
            if (index >= 0) {
                this.allRules[index] = newRule;
            } else {
                this.allRules.push(newRule);
            }

            await Storage.set('rules_list', this.allRules);
            this.selectActiveRule();
            await this.loadTimeSpent();
            this.evaluateLimits();
            this.notify();
        }

        async deleteRule(ruleId) {
            this.allRules = this.allRules.filter(r => r.id !== ruleId);
            await Storage.set('rules_list', this.allRules);
            this.selectActiveRule();
            await this.loadTimeSpent();
            this.evaluateLimits();
            this.notify();
        }

        async importRules(importedRules) {
            if (!Array.isArray(importedRules)) {
                throw new Error('Invalid rules format. Expected an array of rules.');
            }

            const validatedRules = importedRules.map(r => ({
                id: r.id || ('rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
                scopePattern: String(r.scopePattern || '*').trim(),
                limitType: ['none', 'daily', 'hourly'].includes(r.limitType) ? r.limitType : CONFIG.DEFAULT_LIMIT_TYPE,
                limitMinutes: Number(r.limitMinutes) || CONFIG.DEFAULT_LIMIT_MINUTES,
                warningPercent: Number(r.warningPercent) || CONFIG.DEFAULT_WARNING_PERCENT
            }));

            const ruleMap = new Map();
            this.allRules.forEach(r => ruleMap.set(r.id, r));
            validatedRules.forEach(r => ruleMap.set(r.id, r));

            this.allRules = Array.from(ruleMap.values());
            await Storage.set('rules_list', this.allRules);
            this.selectActiveRule();
            await this.loadTimeSpent();
            this.evaluateLimits();
            this.notify();
            return validatedRules.length;
        }

        exportRulesJson() {
            return JSON.stringify(this.allRules, null, 2);
        }

        getRecordKey() {
            const scope = this.activeRule ? this.activeRule.scopePattern : location.hostname;
            return `record_${encodeURIComponent(scope)}`;
        }

        async loadTimeSpent() {
            const recordKey = this.getRecordKey();
            const currentPeriodKey = this.activeRule.limitType === 'hourly' ? Utils.getHourKey() : Utils.getDateKey();
            const record = await Storage.get(recordKey, { periodKey: currentPeriodKey, seconds: 0 });

            if (record.periodKey !== currentPeriodKey) {
                this.secondsSpent = 0;
                this.warningNudgeShown = false;
                this.isBlocked = false;
                await this.saveTimeSpent();
            } else {
                this.secondsSpent = record.seconds || 0;
            }
        }

        async checkPeriodRollover() {
            if (!this.activeRule || this.activeRule.limitType === 'none') return;
            const recordKey = this.getRecordKey();
            const currentPeriodKey = this.activeRule.limitType === 'hourly' ? Utils.getHourKey() : Utils.getDateKey();
            const record = await Storage.get(recordKey, { periodKey: currentPeriodKey, seconds: 0 });

            if (record.periodKey !== currentPeriodKey) {
                this.secondsSpent = 0;
                this.warningNudgeShown = false;
                this.isBlocked = false;
                await this.saveTimeSpent();
                this.evaluateLimits();
            }
        }

        async saveTimeSpent() {
            const recordKey = this.getRecordKey();
            const currentPeriodKey = this.activeRule.limitType === 'hourly' ? Utils.getHourKey() : Utils.getDateKey();
            await Storage.set(recordKey, {
                periodKey: currentPeriodKey,
                seconds: this.secondsSpent
            });
        }

        async resetTimeSpent() {
            this.secondsSpent = 0;
            this.warningNudgeShown = false;
            this.isBlocked = false;
            await this.saveTimeSpent();
            this.evaluateLimits();
            this.notify();
        }

        setupActivityListeners() {
            const resetIdle = () => {
                this.idleTime = 0;
                this.isUserActive = true;
            };

            ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'].forEach(evt => {
                window.addEventListener(evt, resetIdle, { passive: true });
            });

            document.addEventListener('visibilitychange', () => {
                this.isUserActive = !document.hidden;
            });

            this.idleCheckId = setInterval(() => {
                this.idleTime += 1;
                if (this.idleTime >= CONFIG.IDLE_TIMEOUT_SEC) {
                    this.isUserActive = false;
                }
            }, 1000);
        }

        setupUrlChangeListener() {
            let lastUrl = location.href;

            const checkUrlChange = () => {
                const currentUrl = location.href;
                if (currentUrl !== lastUrl) {
                    lastUrl = currentUrl;
                    this.handleUrlChange();
                }
            };

            const originalPushState = history.pushState;
            history.pushState = (...args) => {
                originalPushState.apply(history, args);
                checkUrlChange();
            };

            const originalReplaceState = history.replaceState;
            history.replaceState = (...args) => {
                originalReplaceState.apply(history, args);
                checkUrlChange();
            };

            window.addEventListener('popstate', checkUrlChange);
            window.addEventListener('hashchange', checkUrlChange);

            setInterval(checkUrlChange, 1000);
        }

        async handleUrlChange() {
            this.selectActiveRule();
            await this.loadTimeSpent();
            this.evaluateLimits();
            this.notify();
        }

        startTimer() {
            this.timerId = setInterval(async () => {
                await this.checkPeriodRollover();

                if (this.isUserActive && !document.hidden) {
                    this.secondsSpent += 1;
                    this.evaluateLimits();
                    this.notify();

                    if (this.secondsSpent % 5 === 0) {
                        this.saveTimeSpent();
                    }
                } else {
                    this.notify();
                }
            }, CONFIG.TICK_INTERVAL_MS);
        }

        evaluateLimits() {
            if (!this.activeRule || this.activeRule.limitType === 'none') {
                this.isBlocked = false;
                return;
            }

            const limitSeconds = this.activeRule.limitMinutes * 60;
            if (limitSeconds <= 0) return;

            const percent = (this.secondsSpent / limitSeconds) * 100;

            if (percent >= this.activeRule.warningPercent && !this.warningNudgeShown) {
                this.warningNudgeShown = true;
                this.triggerNudge();
            }

            if (Date.now() < this.snoozeUntil) {
                this.isBlocked = false;
                return;
            }

            this.isBlocked = this.secondsSpent >= limitSeconds;
        }

        snooze(minutes = CONFIG.DEFAULT_SNOOZE_TIME) {
            this.snoozeUntil = Date.now() + minutes * 60 * 1000;
            this.isBlocked = false;
            this.notify();
        }

        triggerNudge() {
            if (this.onNudgeCallback) {
                this.onNudgeCallback(this.activeRule.warningPercent);
            }
        }

        subscribe(listener) {
            this.listeners.push(listener);
        }

        notify() {
            this.listeners.forEach(fn => fn(this));
        }
    }

    class TimeTrackerUI {
        constructor(engine) {
            this.engine = engine;
            this.hostEl = null;
            this.shadow = null;
            this.pos = { x: 20, y: 20 };
            this.isDragging = false;
            this.dragOffset = { x: 0, y: 0 };
            this.isSettingsOpen = false;
            this.editingRuleId = null;

            this.init();
        }

        async init() {
            await this.loadPosition();
            this.createShadowDOM();
            this.renderStyles();
            this.renderDOM();
            this.bindEvents();
            this.update();

            this.engine.subscribe(() => this.update());
            this.engine.onNudgeCallback = (percent) => this.showNudge(percent);
        }

        createEl(tag, attrs = {}, children = []) {
            const el = document.createElement(tag);
            for (const [k, v] of Object.entries(attrs)) {
                if (k === 'className') el.className = v;
                else if (k === 'id') el.id = v;
                else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
                else el.setAttribute(k, v);
            }
            const childList = Array.isArray(children) ? children : [children];
            childList.forEach(child => {
                if (child === null || child === undefined) return;
                if (typeof child === 'string' || typeof child === 'number') {
                    el.appendChild(document.createTextNode(String(child)));
                } else if (child instanceof Node) {
                    el.appendChild(child);
                }
            });
            return el;
        }

        async loadPosition() {
            const savedPos = await Storage.get('widget_pos', null);
            if (savedPos) {
                this.pos = savedPos;
            }
        }

        createShadowDOM() {
            this.hostEl = document.createElement('time-tracker-root');
            this.hostEl.style.cssText = 'position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
            document.documentElement.appendChild(this.hostEl);
            this.shadow = this.hostEl.attachShadow({ mode: 'open' });
        }

        renderStyles() {
            const cssText = `
                :host {
                    all: initial;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    font-size: 14px;
                    color: ${CONFIG.THEME.textPrimary};
                }

                * {
                    box-sizing: border-box;
                    margin: 0;
                    padding: 0;
                    user-select: none;
                }

                .widget {
                    position: fixed;
                    z-index: 2147483647;
                    background: rgba(15, 23, 42, 0.85);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    border: 1px solid ${CONFIG.THEME.border};
                    border-radius: 12px;
                    box-shadow: ${CONFIG.THEME.shadow};
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 8px 14px;
                    cursor: grab;
                    transition: border-color 0.2s, transform 0.1s, opacity 0.2s;
                }

                .widget:hover {
                    border-color: ${CONFIG.THEME.accent};
                }

                .widget:active {
                    cursor: grabbing;
                }

                .widget-icon {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 16px;
                }

                .widget-time {
                    font-weight: 600;
                    font-family: monospace;
                    font-size: 14px;
                    color: ${CONFIG.THEME.textPrimary};
                    letter-spacing: 0.5px;
                }

                .widget-progress {
                    width: 40px;
                    height: 4px;
                    background: rgba(255, 255, 255, 0.15);
                    border-radius: 2px;
                    overflow: hidden;
                }

                .widget-progress-fill {
                    height: 100%;
                    width: 0%;
                    background: ${CONFIG.THEME.accent};
                    transition: width 0.3s ease, background-color 0.3s ease;
                }

                .widget-actions {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    margin-left: 4px;
                }

                .btn-icon {
                    background: transparent;
                    border: none;
                    color: ${CONFIG.THEME.textSecondary};
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 4px;
                    border-radius: 6px;
                    transition: background 0.2s, color 0.2s;
                }

                .btn-icon:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: ${CONFIG.THEME.textPrimary};
                }

                .nudge-toast {
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    z-index: 2147483646;
                    background: ${CONFIG.THEME.bgSecondary};
                    border: 1px solid ${CONFIG.THEME.warning};
                    box-shadow: ${CONFIG.THEME.shadow};
                    border-radius: 10px;
                    padding: 14px 18px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    transform: translateY(100px);
                    opacity: 0;
                    transition: transform 0.3s ease, opacity 0.3s ease;
                }

                .nudge-toast.visible {
                    transform: translateY(0);
                    opacity: 1;
                }

                .block-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    z-index: 2147483645;
                    background: rgba(15, 23, 42, 0.95);
                    backdrop-filter: blur(16px);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    text-align: center;
                    padding: 24px;
                    color: ${CONFIG.THEME.textPrimary};
                }

                .block-card {
                    background: ${CONFIG.THEME.bgSecondary};
                    border: 1px solid ${CONFIG.THEME.danger};
                    border-radius: 16px;
                    padding: 32px;
                    max-width: 480px;
                    width: 100%;
                    box-shadow: ${CONFIG.THEME.shadow};
                }

                .block-title {
                    font-size: 24px;
                    font-weight: 700;
                    color: ${CONFIG.THEME.danger};
                    margin-bottom: 12px;
                }

                .block-desc {
                    color: ${CONFIG.THEME.textSecondary};
                    font-size: 15px;
                    line-height: 1.5;
                    margin-bottom: 16px;
                }

                .block-countdown {
                    font-size: 14px;
                    font-weight: 600;
                    color: ${CONFIG.THEME.warning};
                    background: rgba(245, 158, 11, 0.1);
                    border: 1px solid rgba(245, 158, 11, 0.2);
                    padding: 8px 12px;
                    border-radius: 8px;
                    margin-bottom: 24px;
                }

                .modal-backdrop {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    z-index: 2147483646;
                    background: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(6px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.2s ease;
                }

                .modal-backdrop.open {
                    opacity: 1;
                    pointer-events: auto;
                }

                .modal {
                    background: ${CONFIG.THEME.bgSecondary};
                    border: 1px solid ${CONFIG.THEME.border};
                    border-radius: 16px;
                    padding: 24px;
                    width: 560px;
                    max-width: 92vw;
                    box-shadow: ${CONFIG.THEME.shadow};
                    max-height: 85vh;
                    display: flex;
                    flex-direction: column;
                }

                .modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 16px;
                }

                .modal-title {
                    font-size: 18px;
                    font-weight: 600;
                }

                .toolbar {
                    display: flex;
                    gap: 10px;
                    margin-bottom: 16px;
                }

                .rules-container {
                    flex: 1;
                    overflow-y: auto;
                    max-height: 340px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    padding-right: 4px;
                }

                .rules-container::-webkit-scrollbar {
                    width: 6px;
                }

                .rules-container::-webkit-scrollbar-thumb {
                    background: ${CONFIG.THEME.bgCard};
                    border-radius: 3px;
                }

                .rule-card {
                    background: ${CONFIG.THEME.bgPrimary};
                    border: 1px solid ${CONFIG.THEME.border};
                    border-radius: 10px;
                    padding: 12px 14px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    transition: border-color 0.2s;
                }

                .rule-card:hover {
                    border-color: rgba(255, 255, 255, 0.25);
                }

                .rule-card.active-site {
                    border-color: ${CONFIG.THEME.accent};
                    background: rgba(99, 102, 241, 0.08);
                }

                .rule-info {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    min-width: 0;
                }

                .rule-pattern {
                    font-family: monospace;
                    font-weight: 600;
                    font-size: 13px;
                    color: ${CONFIG.THEME.textPrimary};
                    word-break: break-all;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .badge-active {
                    font-family: -apple-system, sans-serif;
                    font-size: 10px;
                    font-weight: 700;
                    padding: 2px 6px;
                    border-radius: 12px;
                    background: ${CONFIG.THEME.success};
                    color: #fff;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .rule-details {
                    font-size: 12px;
                    color: ${CONFIG.THEME.textSecondary};
                }

                .rule-actions {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    flex-shrink: 0;
                }

                .btn-sm {
                    padding: 6px 10px;
                    font-size: 12px;
                    border-radius: 6px;
                }

                .btn-danger {
                    background: rgba(239, 68, 68, 0.2);
                    color: ${CONFIG.THEME.danger};
                    border: 1px solid rgba(239, 68, 68, 0.3);
                }

                .btn-danger:hover {
                    background: ${CONFIG.THEME.danger};
                    color: #fff;
                }

                .empty-rules {
                    text-align: center;
                    padding: 32px 16px;
                    color: ${CONFIG.THEME.textSecondary};
                    font-size: 13px;
                }

                .form-view {
                    display: none;
                    flex-direction: column;
                    gap: 12px;
                    background: ${CONFIG.THEME.bgPrimary};
                    border: 1px solid ${CONFIG.THEME.border};
                    border-radius: 12px;
                    padding: 16px;
                    margin-top: 8px;
                    max-height: 380px;
                    overflow-y: auto;
                }

                .form-view::-webkit-scrollbar {
                    width: 6px;
                }

                .form-view::-webkit-scrollbar-thumb {
                    background: ${CONFIG.THEME.bgCard};
                    border-radius: 3px;
                }

                .form-group {
                    margin-bottom: 0px;
                }

                .form-label {
                    display: block;
                    font-size: 13px;
                    font-weight: 500;
                    color: ${CONFIG.THEME.textSecondary};
                    margin-bottom: 6px;
                }

                .form-control {
                    width: 100%;
                    padding: 8px 10px;
                    background: ${CONFIG.THEME.bgSecondary};
                    border: 1px solid ${CONFIG.THEME.border};
                    border-radius: 8px;
                    color: ${CONFIG.THEME.textPrimary};
                    font-size: 13px;
                    outline: none;
                    transition: border-color 0.2s;
                    user-select: text;
                }

                .form-control:focus {
                    border-color: ${CONFIG.THEME.accent};
                }

                .form-hint {
                    font-size: 11px;
                    color: ${CONFIG.THEME.textSecondary};
                    margin-top: 4px;
                    line-height: 1.3;
                }

                .btn {
                    padding: 8px 14px;
                    border-radius: 8px;
                    border: none;
                    font-weight: 600;
                    font-size: 13px;
                    cursor: pointer;
                    transition: background 0.2s, opacity 0.2s;
                }

                .btn-primary {
                    background: ${CONFIG.THEME.accent};
                    color: #fff;
                }

                .btn-primary:hover {
                    background: ${CONFIG.THEME.accentHover};
                }

                .btn-secondary {
                    background: ${CONFIG.THEME.bgCard};
                    color: ${CONFIG.THEME.textPrimary};
                }

                .btn-secondary:hover {
                    background: rgba(255, 255, 255, 0.15);
                }

                .flex-row {
                    display: flex;
                    gap: 10px;
                    justify-content: flex-end;
                }
            `;

            try {
                const sheet = new CSSStyleSheet();
                sheet.replaceSync(cssText);
                this.shadow.adoptedStyleSheets = [sheet];
            } catch (e) {
                const style = document.createElement('style');
                style.textContent = cssText;
                this.shadow.appendChild(style);
            }
        }

        renderDOM() {
            const container = document.createElement('div');
            const createEl = this.createEl.bind(this);

            const widget = createEl('div', { className: 'widget', id: 'tt-widget', style: { top: `${this.pos.y}px`, left: `${this.pos.x}px` } }, [
                createEl('div', { className: 'widget-icon' }, '⏱️'),
                createEl('div', { className: 'widget-content', id: 'tt-content' }, [
                    createEl('div', { className: 'widget-time', id: 'tt-time' }, '00:00'),
                    createEl('div', { className: 'widget-progress', id: 'tt-progress-container' }, [
                        createEl('div', { className: 'widget-progress-fill', id: 'tt-progress' })
                    ])
                ]),
                createEl('div', { className: 'widget-actions' }, [
                    createEl('button', { className: 'btn-icon', id: 'btn-reset', title: 'Reset Timer' }, '🔄'),
                    createEl('button', { className: 'btn-icon', id: 'btn-settings', title: 'Settings' }, '⚙️')
                ])
            ]);

            const nudge = createEl('div', { className: 'nudge-toast', id: 'tt-nudge' }, [
                createEl('span', { style: { fontSize: '20px' } }, '⚠️'),
                createEl('div', {}, [
                    createEl('div', { style: { fontWeight: '600', color: CONFIG.THEME.warning } }, 'Time Warning'),
                    createEl('div', { id: 'tt-nudge-msg', style: { fontSize: '13px', color: CONFIG.THEME.textSecondary } }, 'You have reached limit warning threshold.')
                ])
            ]);

            const blockOverlay = createEl('div', { className: 'block-overlay', id: 'tt-block', style: { display: 'none' } }, [
                createEl('div', { className: 'block-card' }, [
                    createEl('div', { className: 'block-title' }, 'Time Limit Reached'),
                    createEl('p', { className: 'block-desc' }, [
                        'You\'ve reached your maximum allowed time for ',
                        createEl('strong', { id: 'tt-block-domain', style: { color: CONFIG.THEME.textPrimary } }),
                        '. Take a break!'
                    ]),
                    createEl('div', { className: 'block-countdown', id: 'tt-block-countdown' }, 'Resets in...'),
                    createEl('div', { className: 'flex-row', style: { justifyContent: 'center', gap: '12px' } }, [
                        createEl('button', { className: 'btn btn-secondary', id: 'btn-block-snooze' }, 'Snooze 1 Min'),
                        createEl('button', { className: 'btn btn-secondary', id: 'btn-block-reset' }, 'Reset Time'),
                        createEl('button', { className: 'btn btn-primary', id: 'btn-block-settings' }, 'Adjust Limit')
                    ])
                ])
            ]);

            const modal = createEl('div', { className: 'modal-backdrop', id: 'tt-modal' }, [
                createEl('div', { className: 'modal' }, [
                    createEl('div', { className: 'modal-header' }, [
                        createEl('div', { className: 'modal-title' }, 'Tracker Rules Manager'),
                        createEl('button', { className: 'btn-icon', id: 'btn-close-modal' }, '✕')
                    ]),
                    createEl('div', { className: 'toolbar' }, [
                        createEl('input', {
                            type: 'text',
                            className: 'form-control',
                            id: 'input-search-rules',
                            placeholder: '🔍 Search rules by pattern...'
                        }),
                        createEl('button', { className: 'btn btn-secondary', id: 'btn-import-rules', title: 'Import Rules from JSON', style: { whiteSpace: 'nowrap' } }, '📥 Import'),
                        createEl('button', { className: 'btn btn-secondary', id: 'btn-export-rules', title: 'Export Rules to JSON', style: { whiteSpace: 'nowrap' } }, '📤 Export'),
                        createEl('button', { className: 'btn btn-primary', id: 'btn-add-rule', style: { whiteSpace: 'nowrap' } }, '+ Add New Rule'),
                        createEl('input', { type: 'file', id: 'file-import-rules', accept: '.json', style: { display: 'none' } })
                    ]),
                    createEl('div', { className: 'rules-container', id: 'tt-rules-container' }),

                    createEl('div', { className: 'form-view', id: 'tt-form-view' }, [
                        createEl('div', { id: 'form-view-title', style: { fontWeight: '600', fontSize: '14px', marginBottom: '8px' } }, 'New Rule'),
                        createEl('div', { className: 'form-group' }, [
                            createEl('label', { className: 'form-label' }, 'Scope / Target Pattern'),
                            createEl('input', {
                                type: 'text',
                                className: 'form-control',
                                id: 'input-scope',
                                placeholder: 'e.g. *, example.com, example.com/test/*'
                            }),
                            createEl('div', { className: 'form-hint' }, 'Supports wildcards (*), e.g. *, example.com, example.com/test/*, https://example.com/page?query')
                        ]),
                        createEl('div', { className: 'form-group' }, [
                            createEl('label', { className: 'form-label' }, 'Limit Reset Type'),
                            createEl('select', { className: 'form-control', id: 'input-limit-type' }, [
                                createEl('option', { value: 'none' }, 'No Limits (Track Only)'),
                                createEl('option', { value: 'daily' }, 'Daily Limit'),
                                createEl('option', { value: 'hourly' }, 'Hourly Limit')
                            ])
                        ]),
                        createEl('div', { className: 'form-group', id: 'group-limit-minutes' }, [
                            createEl('label', { className: 'form-label' }, 'Time Limit (Minutes)'),
                            createEl('input', { type: 'number', className: 'form-control', id: 'input-limit-minutes', min: '1', max: '1440', value: '60' })
                        ]),
                        createEl('div', { className: 'form-group', id: 'group-warning-percent' }, [
                            createEl('label', { className: 'form-label' }, 'Warning Threshold (%)'),
                            createEl('input', { type: 'number', className: 'form-control', id: 'input-warning-percent', min: '10', max: '95', value: '80' })
                        ]),
                        createEl('div', { className: 'flex-row', style: { marginTop: '8px' } }, [
                            createEl('button', { className: 'btn btn-secondary', id: 'btn-cancel-form' }, 'Cancel'),
                            createEl('button', { className: 'btn btn-primary', id: 'btn-save-rule' }, 'Save Rule')
                        ])
                    ])
                ])
            ]);

            container.appendChild(widget);
            container.appendChild(nudge);
            container.appendChild(blockOverlay);
            container.appendChild(modal);

            this.shadow.appendChild(container);
        }

        bindEvents() {
            const widget = this.shadow.getElementById('tt-widget');
            const btnReset = this.shadow.getElementById('btn-reset');
            const btnSettings = this.shadow.getElementById('btn-settings');
            const btnCloseModal = this.shadow.getElementById('btn-close-modal');
            const btnAddRule = this.shadow.getElementById('btn-add-rule');
            const btnCancelForm = this.shadow.getElementById('btn-cancel-form');
            const btnSaveRule = this.shadow.getElementById('btn-save-rule');
            const btnBlockSnooze = this.shadow.getElementById('btn-block-snooze');
            const btnBlockReset = this.shadow.getElementById('btn-block-reset');
            const btnBlockSettings = this.shadow.getElementById('btn-block-settings');
            const selectLimitType = this.shadow.getElementById('input-limit-type');
            const searchInput = this.shadow.getElementById('input-search-rules');
            const btnImportRules = this.shadow.getElementById('btn-import-rules');
            const btnExportRules = this.shadow.getElementById('btn-export-rules');
            const fileImportInput = this.shadow.getElementById('file-import-rules');

            btnExportRules.addEventListener('click', () => {
                this.exportRules();
            });

            btnImportRules.addEventListener('click', () => {
                fileImportInput.click();
            });

            fileImportInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = async (evt) => {
                    try {
                        const importedData = JSON.parse(evt.target.result);
                        const count = await this.engine.importRules(importedData);
                        this.renderRulesList(searchInput.value);
                        this.showToast(`Successfully imported ${count} rule(s)`);
                    } catch (err) {
                        console.error('[TimeTracker] Import failed:', err);
                        this.showToast('Import failed: Invalid JSON format');
                    } finally {
                        fileImportInput.value = '';
                    }
                };
                reader.readAsText(file);
            });

            widget.addEventListener('pointerdown', (e) => {
                if (e.target.closest('button')) return;
                this.isDragging = true;
                const rect = widget.getBoundingClientRect();
                this.dragOffset = {
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top
                };
                widget.setPointerCapture(e.pointerId);
            });

            widget.addEventListener('pointermove', (e) => {
                if (!this.isDragging) return;
                let newX = e.clientX - this.dragOffset.x;
                let newY = e.clientY - this.dragOffset.y;

                const maxX = window.innerWidth - widget.offsetWidth;
                const maxY = window.innerHeight - widget.offsetHeight;

                newX = Math.max(10, Math.min(newX, maxX - 10));
                newY = Math.max(10, Math.min(newY, maxY - 10));

                this.pos = { x: newX, y: newY };
                widget.style.left = `${newX}px`;
                widget.style.top = `${newY}px`;
            });

            widget.addEventListener('pointerup', () => {
                if (this.isDragging) {
                    this.isDragging = false;
                    Storage.set('widget_pos', this.pos);
                }
            });

            btnReset.addEventListener('click', () => {
                this.engine.resetTimeSpent();
            });

            btnSettings.addEventListener('click', () => this.openSettings());
            btnCloseModal.addEventListener('click', () => this.closeSettings());
            
            searchInput.addEventListener('input', (e) => {
                this.renderRulesList(e.target.value);
            });

            btnAddRule.addEventListener('click', () => {
                this.openRuleForm();
            });

            btnCancelForm.addEventListener('click', () => {
                this.closeRuleForm();
            });

            btnSaveRule.addEventListener('click', async () => {
                const newScopePattern = this.shadow.getElementById('input-scope').value.trim() || location.hostname;
                const newLimitType = this.shadow.getElementById('input-limit-type').value;
                const newLimitMinutes = parseInt(this.shadow.getElementById('input-limit-minutes').value, 10) || 60;
                const newWarningPercent = parseInt(this.shadow.getElementById('input-warning-percent').value, 10) || 80;

                await this.engine.saveRule({
                    id: this.editingRuleId,
                    scopePattern: newScopePattern,
                    limitType: newLimitType,
                    limitMinutes: newLimitMinutes,
                    warningPercent: newWarningPercent
                });

                this.closeRuleForm();
                this.renderRulesList(searchInput.value);
            });

            selectLimitType.addEventListener('change', (e) => {
                const isNone = e.target.value === 'none';
                this.shadow.getElementById('group-limit-minutes').style.display = isNone ? 'none' : 'block';
                this.shadow.getElementById('group-warning-percent').style.display = isNone ? 'none' : 'block';
            });

            btnBlockSnooze.addEventListener('click', () => {
                this.engine.snooze(CONFIG.DEFAULT_SNOOZE_TIME);
            });

            btnBlockReset.addEventListener('click', () => {
                this.engine.resetTimeSpent();
            });

            btnBlockSettings.addEventListener('click', () => {
                this.openSettings();
            });
        }

        renderRulesList(filterText = '') {
            const container = this.shadow.getElementById('tt-rules-container');
            container.replaceChildren();
            const createEl = this.createEl.bind(this);

            const searchKey = filterText.toLowerCase().trim();
            const rulesToDisplay = this.engine.allRules.filter(r => 
                !searchKey || r.scopePattern.toLowerCase().includes(searchKey)
            );

            if (rulesToDisplay.length === 0) {
                container.appendChild(createEl('div', { className: 'empty-rules' }, 
                    searchKey ? 'No rules matching search filter.' : 'No tracking rules configured. Click "+ Add New Rule" to create one.'
                ));
                return;
            }

            rulesToDisplay.forEach(rule => {
                const isActive = this.engine.activeRule && this.engine.activeRule.id === rule.id;
                
                const card = createEl('div', { className: `rule-card ${isActive ? 'active-site' : ''}` }, [
                    createEl('div', { className: 'rule-info' }, [
                        createEl('div', { className: 'rule-pattern' }, [
                            rule.scopePattern,
                            isActive ? createEl('span', { className: 'badge-active' }, 'Active Here') : null
                        ]),
                        createEl('div', { className: 'rule-details' }, [
                            rule.limitType === 'none' 
                                ? 'No limit (Track only)' 
                                : `Limit: ${rule.limitMinutes} mins (${rule.limitType}) • Warning at ${rule.warningPercent}%`
                        ])
                    ]),
                    createEl('div', { className: 'rule-actions' }, [
                        createEl('button', { className: 'btn btn-secondary btn-sm', title: 'Edit Rule' }, '✏️ Edit'),
                        createEl('button', { className: 'btn btn-danger btn-sm', title: 'Delete Rule' }, '🗑 Delete')
                    ])
                ]);

                const editBtn = card.querySelector('.btn-secondary');
                const deleteBtn = card.querySelector('.btn-danger');

                editBtn.addEventListener('click', () => {
                    this.openRuleForm(rule.id);
                });

                deleteBtn.addEventListener('click', async () => {
                    await this.engine.deleteRule(rule.id);
                    this.renderRulesList(this.shadow.getElementById('input-search-rules').value);
                });

                container.appendChild(card);
            });
        }

        openRuleForm(ruleId = null) {
            this.editingRuleId = ruleId;
            const formView = this.shadow.getElementById('tt-form-view');
            const formTitle = this.shadow.getElementById('form-view-title');
            
            let rule = {
                scopePattern: location.hostname,
                limitType: CONFIG.DEFAULT_LIMIT_TYPE,
                limitMinutes: CONFIG.DEFAULT_LIMIT_MINUTES,
                warningPercent: CONFIG.DEFAULT_WARNING_PERCENT
            };

            if (ruleId) {
                const found = this.engine.allRules.find(r => r.id === ruleId);
                if (found) rule = found;
                formTitle.textContent = 'Edit Tracking Rule';
            } else {
                formTitle.textContent = 'Add New Tracking Rule';
            }

            this.shadow.getElementById('input-scope').value = rule.scopePattern || location.hostname;
            this.shadow.getElementById('input-limit-type').value = rule.limitType || CONFIG.DEFAULT_LIMIT_TYPE;
            this.shadow.getElementById('input-limit-minutes').value = rule.limitMinutes || CONFIG.DEFAULT_LIMIT_MINUTES;
            this.shadow.getElementById('input-warning-percent').value = rule.warningPercent || CONFIG.DEFAULT_WARNING_PERCENT;

            const isNone = (rule.limitType || CONFIG.DEFAULT_LIMIT_TYPE) === 'none';
            this.shadow.getElementById('group-limit-minutes').style.display = isNone ? 'none' : 'block';
            this.shadow.getElementById('group-warning-percent').style.display = isNone ? 'none' : 'block';

            formView.classList.add('open');
            this.shadow.getElementById('input-scope').focus();
        }

        closeRuleForm() {
            const formView = this.shadow.getElementById('tt-form-view');
            formView.classList.remove('open');
            this.editingRuleId = null;
        }

        openSettings() {
            const modal = this.shadow.getElementById('tt-modal');
            this.closeRuleForm();
            this.renderRulesList();
            modal.classList.add('open');
            this.isSettingsOpen = true;
        }

        closeSettings() {
            const modal = this.shadow.getElementById('tt-modal');
            modal.classList.remove('open');
            this.closeRuleForm();
            this.isSettingsOpen = false;
        }

        update() {
            const timeEl = this.shadow.getElementById('tt-time');
            const progressEl = this.shadow.getElementById('tt-progress');
            const progressContainer = this.shadow.getElementById('tt-progress-container');
            const blockEl = this.shadow.getElementById('tt-block');
            const blockDomain = this.shadow.getElementById('tt-block-domain');
            const blockCountdown = this.shadow.getElementById('tt-block-countdown');

            timeEl.textContent = Utils.formatShortSeconds(this.engine.secondsSpent);

            if (this.engine.activeRule && this.engine.activeRule.limitType !== 'none') {
                progressContainer.style.display = 'block';
                const limitSecs = this.engine.activeRule.limitMinutes * 60;
                const percent = Math.min(100, (this.engine.secondsSpent / limitSecs) * 100);
                progressEl.style.width = `${percent}%`;

                if (percent >= 100) {
                    progressEl.style.backgroundColor = CONFIG.THEME.danger;
                } else if (percent >= this.engine.activeRule.warningPercent) {
                    progressEl.style.backgroundColor = CONFIG.THEME.warning;
                } else {
                    progressEl.style.backgroundColor = CONFIG.THEME.accent;
                }
            } else {
                progressContainer.style.display = 'none';
            }

            if (this.engine.isBlocked) {
                blockEl.style.display = 'flex';
                blockDomain.textContent = this.engine.activeRule ? this.engine.activeRule.scopePattern : location.hostname;
                if (blockCountdown) {
                    blockCountdown.textContent = Utils.getResetCountdownText(this.engine);
                }
            } else {
                blockEl.style.display = 'none';
            }
        }

        showNudge(percent) {
            const scope = this.engine.activeRule ? this.engine.activeRule.scopePattern : location.hostname;
            const limitType = this.engine.activeRule ? this.engine.activeRule.limitType : 'limit';
            this.showToast(`You have reached ${percent}% of your ${limitType} limit on ${scope}!`);
        }

        exportRules() {
            const jsonStr = this.engine.exportRulesJson();
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `time-tracker-rules-${Utils.getDateKey()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this.showToast('Rules exported to JSON file');
        }

        showToast(msg) {
            const toast = this.shadow.getElementById('tt-nudge');
            const msgEl = this.shadow.getElementById('tt-nudge-msg');
            if (toast && msgEl) {
                msgEl.textContent = msg;
                toast.classList.add('visible');
                setTimeout(() => {
                    toast.classList.remove('visible');
                }, 4000);
            }
        }
    }

    async function main() {
        const trackerEngine = new TimeTrackerEngine();
        await trackerEngine.init();

        const ui = new TimeTrackerUI(trackerEngine);

        if (typeof GM_registerMenuCommand !== 'undefined') {
            GM_registerMenuCommand('Configure Time Limits', () => {
                ui.openSettings();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }

})();