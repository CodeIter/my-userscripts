// ==UserScript==
// @name         Random Quran Verse Notifier
// @namespace    https://docs.scriptcat.org/
// @version      1.5.2
// @description  Displays random Quran verse notifications periodically with customizable timers, audio recitations, navigation, and Shadow DOM isolation.
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      cdn.jsdelivr.net
// @connect      raw.githubusercontent.com
// @connect      alquran-api.pages.dev
// @connect      everyayah.com
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    /**
     * TOP-LEVEL CONFIGURATION OBJECT
     * Easily modify intervals, display delays, position, and API endpoints here.
     */
    const CONFIG = {
        // Notification interval in minutes (e.g., 5 for every 5 minutes)
        intervalMinutes: 5,

        // Time in seconds before notification auto-disappears (e.g., 60 seconds)
        autoDismissSeconds: 60,

        // Notification position on screen: 'top-right' or 'bottom-right'
        position: 'top-right',

        // Show first notification immediately upon page load
        showOnLoad: true,

        // Pause auto-dismiss timer when mouse hovers over notification
        pauseOnHover: true,

        // Audio API URL template for fetching verse recitations
        audioApiEndpoint: 'https://alquran-api.pages.dev/api/quran/surah/{chapter}/verse/{verse}?lang=ar',

        // Primary and fallback API URL patterns
        apiEndpoints: [
            'https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions/ara-quranspelled/{chapter}/{verse}.min.json',
            'https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions/ara-quranspelled/{chapter}/{verse}.json',
            'https://raw.githubusercontent.com/fawazahmed0/quran-api/1/editions/ara-quranspelled/{chapter}/{verse}.min.json',
            'https://raw.githubusercontent.com/fawazahmed0/quran-api/1/editions/ara-quranspelled/{chapter}/{verse}.json'
        ]
    };

    const SURAHS = [
        { id: 1, name: 'الفاتحة', verses: 7 },
        { id: 2, name: 'البقرة', verses: 286 },
        { id: 3, name: 'آل عمران', verses: 200 },
        { id: 4, name: 'النساء', verses: 176 },
        { id: 5, name: 'المائدة', verses: 120 },
        { id: 6, name: 'الأنعام', verses: 165 },
        { id: 7, name: 'الأعراف', verses: 206 },
        { id: 8, name: 'الأنفال', verses: 75 },
        { id: 9, name: 'التوبة', verses: 129 },
        { id: 10, name: 'يونس', verses: 109 },
        { id: 11, name: 'هود', verses: 123 },
        { id: 12, name: 'يوسف', verses: 111 },
        { id: 13, name: 'الرعد', verses: 43 },
        { id: 14, name: 'إبراهيم', verses: 52 },
        { id: 15, name: 'الحجر', verses: 99 },
        { id: 16, name: 'النحل', verses: 128 },
        { id: 17, name: 'الإسراء', verses: 111 },
        { id: 18, name: 'الكهف', verses: 110 },
        { id: 19, name: 'مريم', verses: 98 },
        { id: 20, name: 'طه', verses: 135 },
        { id: 21, name: 'الأنبياء', verses: 112 },
        { id: 22, name: 'الحج', verses: 78 },
        { id: 23, name: 'المؤمنون', verses: 118 },
        { id: 24, name: 'النور', verses: 64 },
        { id: 25, name: 'الفرقان', verses: 77 },
        { id: 26, name: 'الشعراء', verses: 227 },
        { id: 27, name: 'النمل', verses: 93 },
        { id: 28, name: 'القصص', verses: 88 },
        { id: 29, name: 'العنكبوت', verses: 69 },
        { id: 30, name: 'الروم', verses: 60 },
        { id: 31, name: 'لقمان', verses: 34 },
        { id: 32, name: 'السجدة', verses: 30 },
        { id: 33, name: 'الأحزاب', verses: 73 },
        { id: 34, name: 'سبأ', verses: 54 },
        { id: 35, name: 'فاطر', verses: 45 },
        { id: 36, name: 'يس', verses: 83 },
        { id: 37, name: 'الصافات', verses: 182 },
        { id: 38, name: 'ص', verses: 88 },
        { id: 39, name: 'الزمر', verses: 75 },
        { id: 40, name: 'غافر', verses: 85 },
        { id: 41, name: 'فصلت', verses: 54 },
        { id: 42, name: 'الشورى', verses: 53 },
        { id: 43, name: 'الزخرف', verses: 89 },
        { id: 44, name: 'الدخان', verses: 59 },
        { id: 45, name: 'الجاثية', verses: 37 },
        { id: 46, name: 'الأحقاف', verses: 35 },
        { id: 47, name: 'محمد', verses: 38 },
        { id: 48, name: 'الفتح', verses: 29 },
        { id: 49, name: 'الحجرات', verses: 18 },
        { id: 50, name: 'ق', verses: 45 },
        { id: 51, name: 'الذاريات', verses: 60 },
        { id: 52, name: 'الطور', verses: 49 },
        { id: 53, name: 'النجم', verses: 62 },
        { id: 54, name: 'القمر', verses: 55 },
        { id: 55, name: 'الرحمن', verses: 78 },
        { id: 56, name: 'الواقعة', verses: 96 },
        { id: 57, name: 'الحديد', verses: 29 },
        { id: 58, name: 'المجادلة', verses: 22 },
        { id: 59, name: 'الحشر', verses: 24 },
        { id: 60, name: 'الممتحنة', verses: 13 },
        { id: 61, name: 'الصف', verses: 14 },
        { id: 62, name: 'الجمعة', verses: 11 },
        { id: 63, name: 'المنافقون', verses: 11 },
        { id: 64, name: 'التغابن', verses: 18 },
        { id: 65, name: 'الطلاق', verses: 12 },
        { id: 66, name: 'التحريم', verses: 12 },
        { id: 67, name: 'الملك', verses: 30 },
        { id: 68, name: 'القلم', verses: 52 },
        { id: 69, name: 'الحاقة', verses: 52 },
        { id: 70, name: 'المعارج', verses: 44 },
        { id: 71, name: 'نوح', verses: 28 },
        { id: 72, name: 'الجن', verses: 28 },
        { id: 73, name: 'المزمل', verses: 20 },
        { id: 74, name: 'المدثر', verses: 56 },
        { id: 75, name: 'القيامة', verses: 40 },
        { id: 76, name: 'الإنسان', verses: 31 },
        { id: 77, name: 'المرسلات', verses: 50 },
        { id: 78, name: 'النبأ', verses: 40 },
        { id: 79, name: 'النازعات', verses: 46 },
        { id: 80, name: 'عبس', verses: 42 },
        { id: 81, name: 'التكوير', verses: 29 },
        { id: 82, name: 'الانفطار', verses: 19 },
        { id: 83, name: 'المطففين', verses: 36 },
        { id: 84, name: 'الانشقاق', verses: 25 },
        { id: 85, name: 'البروج', verses: 22 },
        { id: 86, name: 'الطارق', verses: 17 },
        { id: 87, name: 'الأعلى', verses: 19 },
        { id: 88, name: 'الغاشية', verses: 26 },
        { id: 89, name: 'الفجر', verses: 30 },
        { id: 90, name: 'البلد', verses: 20 },
        { id: 91, name: 'الشمس', verses: 15 },
        { id: 92, name: 'الليل', verses: 21 },
        { id: 93, name: 'الضحى', verses: 11 },
        { id: 94, name: 'الشرح', verses: 8 },
        { id: 95, name: 'التين', verses: 8 },
        { id: 96, name: 'العلق', verses: 19 },
        { id: 97, name: 'القدر', verses: 5 },
        { id: 98, name: 'البينة', verses: 8 },
        { id: 99, name: 'الزلزلة', verses: 8 },
        { id: 100, name: 'العاديات', verses: 11 },
        { id: 101, name: 'القارعة', verses: 11 },
        { id: 102, name: 'التكاثر', verses: 8 },
        { id: 103, name: 'العصر', verses: 3 },
        { id: 104, name: 'الهمزة', verses: 9 },
        { id: 105, name: 'الفيل', verses: 5 },
        { id: 106, name: 'قريش', verses: 4 },
        { id: 107, name: 'الماعون', verses: 7 },
        { id: 108, name: 'الكوثر', verses: 3 },
        { id: 109, name: 'الكافرون', verses: 6 },
        { id: 110, name: 'النصر', verses: 3 },
        { id: 111, name: 'المسد', verses: 5 },
        { id: 112, name: 'الإخلاص', verses: 4 },
        { id: 113, name: 'الفلق', verses: 5 },
        { id: 114, name: 'الناس', verses: 6 }
    ];

    function createElement(tagName, attributes = {}, ...children) {
        const element = document.createElement(tagName);

        for (const [key, value] of Object.entries(attributes)) {
            if (key === 'className') {
                element.className = value;
            } else if (key === 'style' && typeof value === 'object') {
                Object.assign(element.style, value);
            } else if (key.startsWith('on') && typeof value === 'function') {
                const eventName = key.substring(2).toLowerCase();
                element.addEventListener(eventName, value);
            } else if (value !== null && value !== undefined) {
                element.setAttribute(key, String(value));
            }
        }

        for (const child of children) {
            if (child === null || child === undefined) continue;
            if (typeof child === 'string' || typeof child === 'number') {
                element.appendChild(document.createTextNode(String(child)));
            } else if (child instanceof Node) {
                element.appendChild(child);
            }
        }

        return element;
    }

    let shadowRoot = null;
    let containerElement = null;

    function initShadowDOM() {
        if (shadowRoot) return;

        const host = document.createElement('div');
        host.id = 'quran-verse-notification-root';
        host.style.position = 'fixed';
        host.style.zIndex = '2147483647';
        host.style.pointerEvents = 'none';

        if (CONFIG.position === 'bottom-right') {
            host.style.bottom = '20px';
            host.style.right = '20px';
        } else {
            host.style.top = '20px';
            host.style.right = '20px';
        }

        document.documentElement.appendChild(host);
        shadowRoot = host.attachShadow({ mode: 'closed' });

        const cssText = `
            :host {
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                direction: rtl;
                text-align: right;
            }

            .toast-wrapper {
                pointer-events: auto;
                width: 380px;
                max-width: calc(100vw - 40px);
                background: #ffffff;
                color: #1f2937;
                border-radius: 12px;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
                border: 1px solid rgba(16, 185, 129, 0.2);
                overflow: hidden;
                opacity: 0;
                transform: translateY(${CONFIG.position === 'bottom-right' ? '20px' : '-20px'});
                transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                cursor: pointer;
                user-select: none;
            }

            .toast-wrapper.show {
                opacity: 1;
                transform: translateY(0);
            }

            .toast-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 16px;
                background-color: #064e3b;
                color: #ffffff;
            }

            .toast-title-container {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .quran-icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 24px;
                height: 24px;
                background: rgba(255, 255, 255, 0.15);
                border-radius: 50%;
                font-size: 13px;
            }

            .surah-title {
                font-size: 15px;
                font-weight: 700;
                color: #f0fdf4;
            }

            .verse-badge {
                font-size: 12px;
                background-color: #047857;
                color: #d1fae5;
                padding: 2px 8px;
                border-radius: 12px;
                font-weight: 600;
            }

            .close-btn {
                background: transparent;
                border: none;
                color: #a7f3d0;
                font-size: 20px;
                line-height: 1;
                cursor: pointer;
                padding: 4px 8px;
                border-radius: 6px;
                transition: background-color 0.2s, color 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .close-btn:hover {
                background-color: rgba(255, 255, 255, 0.15);
                color: #ffffff;
            }

            .header-actions {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .nav-controls {
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .select-dropdown {
                background: rgba(255, 255, 255, 0.15);
                border: 1px solid rgba(255, 255, 255, 0.3);
                color: #ffffff;
                font-size: 11px;
                font-weight: 600;
                padding: 2px 4px;
                border-radius: 6px;
                cursor: pointer;
                outline: none;
                max-width: 90px;
                direction: rtl;
            }

            .select-dropdown option {
                background: #064e3b;
                color: #ffffff;
            }

            .nav-btn {
                background: rgba(255, 255, 255, 0.12);
                border: 1px solid rgba(255, 255, 255, 0.25);
                color: #e6f4ea;
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
                padding: 3px 7px;
                border-radius: 6px;
                transition: background-color 0.2s, color 0.2s, border-color 0.2s;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                user-select: none;
            }

            .nav-btn:hover {
                background-color: rgba(255, 255, 255, 0.25);
                color: #ffffff;
                border-color: rgba(255, 255, 255, 0.4);
            }

            .nav-btn:active {
                transform: scale(0.96);
            }

            .toast-body {
                padding: 18px 16px;
                background: #fdfbf7;
            }

            .verse-text {
                font-family: "Scheherazade New", "Amiri", "Traditional Arabic", serif;
                font-size: 20px;
                line-height: 1.8;
                color: #111827;
                margin: 0;
                word-wrap: break-word;
                text-align: center;
                max-height: 5.4em; /* Approx 3 lines (3 * 1.8 line-height) */
                overflow-y: auto;
                padding-left: 4px;
                scrollbar-width: thin;
                scrollbar-color: #10b981 #e5e7eb;
            }

            .verse-text::-webkit-scrollbar {
                width: 6px;
            }

            .verse-text::-webkit-scrollbar-track {
                background: #e5e7eb;
                border-radius: 3px;
            }

            .verse-text::-webkit-scrollbar-thumb {
                background: #10b981;
                border-radius: 3px;
            }

            .toast-footer {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 16px;
                background-color: #f3f4f6;
                border-top: 1px solid #e5e7eb;
                font-size: 12px;
                color: #6b7280;
            }

            .link-hint {
                color: #059669;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .progress-bar-container {
                height: 4px;
                background-color: #e5e7eb;
                width: 100%;
                overflow: hidden;
            }

            .progress-bar {
                height: 100%;
                background-color: #10b981;
                width: 100%;
                transition: width 0.1s linear;
            }

            .audio-container {
                display: flex;
                align-items: center;
                justify-content: space-between;
                background-color: #ecfdf5;
                border: 1px solid #a7f3d0;
                border-radius: 8px;
                padding: 6px 12px;
                margin-top: 12px;
                gap: 8px;
            }

            .audio-info {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 12px;
                color: #065f46;
                font-weight: 600;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
            }

            .audio-play-btn {
                background-color: #059669;
                color: #ffffff;
                border: none;
                border-radius: 50%;
                width: 30px;
                height: 30px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                font-size: 13px;
                transition: background-color 0.2s, transform 0.1s;
                flex-shrink: 0;
            }

            .audio-play-btn:hover {
                background-color: #047857;
                transform: scale(1.05);
            }

            .audio-play-btn:active {
                transform: scale(0.95);
            }
        `;

        try {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(cssText);
            shadowRoot.adoptedStyleSheets = [sheet];
        } catch (e) {
            const style = document.createElement('style');
            style.textContent = cssText;
            shadowRoot.appendChild(style);
        }

        containerElement = createElement('div', { className: 'toast-container' });
        shadowRoot.appendChild(containerElement);
    }

    function fetchVerseData(chapter, verse) {
        return new Promise((resolve, reject) => {
            const urls = CONFIG.apiEndpoints.map(endpoint =>
                endpoint.replace('{chapter}', chapter).replace('{verse}', verse)
            );

            let endpointIndex = 0;

            function tryFetchNext() {
                if (endpointIndex >= urls.length) {
                    reject(new Error('All API endpoints failed.'));
                    return;
                }

                const currentUrl = urls[endpointIndex++];
                const requestFn = (typeof GM_xmlhttpRequest !== 'undefined')
                    ? GM_xmlhttpRequest
                    : (typeof GM !== 'undefined' && GM.xmlHttpRequest)
                        ? GM.xmlHttpRequest
                        : null;

                if (requestFn) {
                    requestFn({
                        method: 'GET',
                        url: currentUrl,
                        timeout: 10000,
                        onload: function (response) {
                            if (response.status >= 200 && response.status < 300) {
                                try {
                                    const parsed = JSON.parse(response.responseText);
                                    resolve(parsed);
                                } catch (e) {
                                    tryFetchNext();
                                }
                            } else {
                                tryFetchNext();
                            }
                        },
                        onerror: tryFetchNext,
                        ontimeout: tryFetchNext
                    });
                } else {
                    fetch(currentUrl)
                        .then(res => res.json())
                        .then(data => resolve(data))
                        .catch(() => tryFetchNext());
                }
            }

            tryFetchNext();
        });
    }

    function fetchAudioData(chapter, verse) {
        return new Promise((resolve) => {
            const url = CONFIG.audioApiEndpoint
                .replace('{chapter}', chapter)
                .replace('{verse}', verse);

            const requestFn = (typeof GM_xmlhttpRequest !== 'undefined')
                ? GM_xmlhttpRequest
                : (typeof GM !== 'undefined' && GM.xmlHttpRequest)
                    ? GM.xmlHttpRequest
                    : null;

            function processResponse(responseText) {
                try {
                    const parsed = JSON.parse(responseText);
                    if (parsed && parsed.audio) {
                        const audioList = Object.values(parsed.audio);
                        if (audioList.length > 0) {
                            const randomAudio = audioList[Math.floor(Math.random() * audioList.length)];
                            resolve({
                                url: randomAudio.url || randomAudio.originalUrl,
                                reciter: randomAudio.reciter || ''
                            });
                            return;
                        }
                    }
                    resolve(null);
                } catch (e) {
                    resolve(null);
                }
            }

            if (requestFn) {
                requestFn({
                    method: 'GET',
                    url: url,
                    timeout: 8000,
                    onload: (res) => (res.status >= 200 && res.status < 300) ? processResponse(res.responseText) : resolve(null),
                    onerror: () => resolve(null),
                    ontimeout: () => resolve(null)
                });
            } else {
                fetch(url)
                    .then(res => res.text())
                    .then(text => processResponse(text))
                    .catch(() => resolve(null));
            }
        });
    }

    let sharedAudioCtx = null;

    function getAudioContext() {
        if (!sharedAudioCtx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                sharedAudioCtx = new AudioCtx();
            }
        }
        if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
            sharedAudioCtx.resume();
        }
        return sharedAudioCtx;
    }

    function decodeAudioDataPromise(audioCtx, arrayBuffer) {
        return new Promise((resolve, reject) => {
            const bufferCopy = arrayBuffer.slice(0);
            const promiseOrVoid = audioCtx.decodeAudioData(
                bufferCopy,
                (decoded) => resolve(decoded),
                (err) => reject(err)
            );
            if (promiseOrVoid && typeof promiseOrVoid.then === 'function') {
                promiseOrVoid.then(resolve).catch(reject);
            }
        });
    }

    function fetchAudioArrayBuffer(url) {
        return new Promise((resolve, reject) => {
            const requestFn = (typeof GM_xmlhttpRequest !== 'undefined')
                ? GM_xmlhttpRequest
                : (typeof GM !== 'undefined' && GM.xmlHttpRequest)
                    ? GM.xmlHttpRequest
                    : null;

            if (requestFn) {
                requestFn({
                    method: 'GET',
                    url: url,
                    responseType: 'arraybuffer',
                    timeout: 15000,
                    onload: (response) => {
                        if (response.status >= 200 && response.status < 300) {
                            resolve(response.response);
                        } else {
                            reject(new Error(`HTTP status ${response.status}`));
                        }
                    },
                    onerror: (err) => reject(err),
                    ontimeout: () => reject(new Error('Audio fetch timed out'))
                });
            } else {
                fetch(url)
                    .then(res => res.arrayBuffer())
                    .then(buf => resolve(buf))
                    .catch(err => reject(err));
            }
        });
    }

    function getPrevVerseInfo(surahId, verseNum) {
        if (verseNum > 1) {
            const currentSurah = SURAHS.find(s => s.id === surahId);
            return { surah: currentSurah, verse: verseNum - 1 };
        }
        const prevSurahId = surahId > 1 ? surahId - 1 : 114;
        const prevSurah = SURAHS.find(s => s.id === prevSurahId);
        return { surah: prevSurah, verse: prevSurah.verses };
    }

    function getNextVerseInfo(surahId, verseNum) {
        const currentSurah = SURAHS.find(s => s.id === surahId);
        if (verseNum < currentSurah.verses) {
            return { surah: currentSurah, verse: verseNum + 1 };
        }
        const nextSurahId = surahId < 114 ? surahId + 1 : 1;
        const nextSurah = SURAHS.find(s => s.id === nextSurahId);
        return { surah: nextSurah, verse: 1 };
    }

    function displayNotification(surahInfo, verseNumber, verseText, audioData) {
        initShadowDOM();

        while (containerElement.firstChild) {
            containerElement.removeChild(containerElement.firstChild);
        }

        let currentSurah = surahInfo;
        let currentVerse = verseNumber;
        let quranUrl = `https://quran.com/ar/${currentSurah.id}/${currentVerse}`;
        let isNavigating = false;

        const iconElem = createElement('span', { className: 'quran-icon' }, '📖');

        // Dropdown selection for Surahs
        const surahSelect = createElement('select', {
            className: 'select-dropdown',
            title: 'اختر السورة',
            onClick: (e) => e.stopPropagation(),
            onChange: (e) => {
                e.stopPropagation();
                const selectedSurahId = parseInt(e.target.value, 10);
                const newSurah = SURAHS.find(s => s.id === selectedSurahId);
                if (newSurah) {
                    populateVerseSelect(newSurah, 1);
                    navigateTo(newSurah, 1);
                }
            }
        });

        SURAHS.forEach(s => {
            const option = createElement('option', { value: s.id }, `${s.id}. ${s.name}`);
            if (s.id === currentSurah.id) option.selected = true;
            surahSelect.appendChild(option);
        });

        // Dropdown selection for Verses
        const verseSelect = createElement('select', {
            className: 'select-dropdown',
            title: 'اختر الآية',
            onClick: (e) => e.stopPropagation(),
            onChange: (e) => {
                e.stopPropagation();
                const selectedVerseNum = parseInt(e.target.value, 10);
                navigateTo(currentSurah, selectedVerseNum);
            }
        });

        function populateVerseSelect(surah, selectedVerse) {
            while (verseSelect.firstChild) {
                verseSelect.removeChild(verseSelect.firstChild);
            }
            for (let i = 1; i <= surah.verses; i++) {
                const opt = createElement('option', { value: i }, `آية ${i}`);
                if (i === selectedVerse) opt.selected = true;
                verseSelect.appendChild(opt);
            }
        }

        populateVerseSelect(currentSurah, currentVerse);

        const titleContainer = createElement('div', { className: 'toast-title-container' },
            iconElem,
            surahSelect,
            verseSelect
        );

        const closeBtn = createElement('button', {
            className: 'close-btn',
            title: 'إغلاق',
            onClick: (e) => {
                e.stopPropagation();
                dismissToast();
            }
        }, '✕');

        const prevBtn = createElement('button', {
            className: 'nav-btn',
            title: 'الآية السابقة',
            onClick: (e) => {
                e.stopPropagation();
                const prevInfo = getPrevVerseInfo(currentSurah.id, currentVerse);
                navigateTo(prevInfo.surah, prevInfo.verse);
            }
        }, '► السابقة');

        const nextBtn = createElement('button', {
            className: 'nav-btn',
            title: 'الآية التالية',
            onClick: (e) => {
                e.stopPropagation();
                const nextInfo = getNextVerseInfo(currentSurah.id, currentVerse);
                navigateTo(nextInfo.surah, nextInfo.verse);
            }
        }, 'التالية ◄');

        const navControls = createElement('div', { className: 'nav-controls' }, prevBtn, nextBtn);
        const headerActions = createElement('div', { className: 'header-actions' }, navControls, closeBtn);

        const headerElem = createElement('div', { className: 'toast-header' },
            titleContainer,
            headerActions
        );

        const verseParagraph = createElement('p', { className: 'verse-text' }, verseText);

        let audioContainer = null;
        let isAudioPlaying = false;
        let stopAudioPlayback = null;

        function buildAudioPlayer(newAudioData) {
            if (!newAudioData || !newAudioData.url) return null;

            const playIcon = createElement('span', { className: 'play-icon' }, '▶');
            const playBtn = createElement('button', {
                className: 'audio-play-btn',
                title: 'تشغيل الصوت'
            }, playIcon);

            let audioBuffer = null;
            let currentSource = null;
            let isDownloading = false;
            let playbackStartTime = 0;
            let pauseOffset = 0;
            let isManualStop = false;

            stopAudioPlayback = function () {
                if (currentSource) {
                    isManualStop = true;
                    try {
                        currentSource.stop();
                        currentSource.disconnect();
                    } catch (e) { }
                    currentSource = null;
                }
                isAudioPlaying = false;
                audioBuffer = null;
            };

            playBtn.addEventListener('click', async (e) => {
                e.stopPropagation();

                const audioCtx = getAudioContext();
                if (!audioCtx) {
                    playIcon.textContent = '⚠️';
                    playBtn.title = 'غير مدعوم في هذا المتصفح';
                    return;
                }

                if (isAudioPlaying) {
                    isAudioPlaying = false;
                    pauseOffset += audioCtx.currentTime - playbackStartTime;
                    isManualStop = true;
                    if (currentSource) {
                        try { currentSource.stop(); } catch (err) { }
                        currentSource = null;
                    }
                    playIcon.textContent = '▶';
                    playBtn.title = 'تشغيل الصوت';
                    isPaused = false;
                    return;
                }

                if (isDownloading) return;

                if (!audioBuffer) {
                    isDownloading = true;
                    playIcon.textContent = '⏳';
                    playBtn.title = 'جاري التحميل...';

                    try {
                        const rawArrayBuffer = await fetchAudioArrayBuffer(newAudioData.url);
                        audioBuffer = await decodeAudioDataPromise(audioCtx, rawArrayBuffer);
                    } catch (err) {
                        console.error('[Quran Notifier] Web Audio decode error:', err);
                        playIcon.textContent = '⚠️';
                        playBtn.title = 'فشل تحميل الصوت';
                        isDownloading = false;
                        return;
                    }

                    isDownloading = false;
                }

                try {
                    currentSource = audioCtx.createBufferSource();
                    currentSource.buffer = audioBuffer;
                    currentSource.connect(audioCtx.destination);

                    const startOffset = pauseOffset % audioBuffer.duration;
                    playbackStartTime = audioCtx.currentTime;
                    isManualStop = false;

                    currentSource.onended = () => {
                        if (!isManualStop) {
                            isAudioPlaying = false;
                            pauseOffset = 0;
                            playIcon.textContent = '▶';
                            playBtn.title = 'تشغيل الصوت';
                            isPaused = false;
                        }
                    };

                    currentSource.start(0, startOffset);
                    isAudioPlaying = true;
                    playIcon.textContent = '⏸';
                    playBtn.title = 'إيقاف مؤقت';
                    isPaused = true;
                } catch (err) {
                    console.error('[Quran Notifier] Web Audio playback error:', err);
                    playIcon.textContent = '⚠️';
                    playBtn.title = 'فشل تشغيل الصوت';
                }
            });

            const reciterLabel = createElement('span', { className: 'audio-info' },
                '🎧 ',
                newAudioData.reciter ? `القارئ: ${newAudioData.reciter}` : 'تلاوة صوتية'
            );

            return createElement('div', { className: 'audio-container' },
                reciterLabel,
                playBtn
            );
        }

        if (audioData) {
            audioContainer = buildAudioPlayer(audioData);
        }

        const bodyChildren = [verseParagraph];
        if (audioContainer) bodyChildren.push(audioContainer);

        const bodyElem = createElement('div', { className: 'toast-body' }, ...bodyChildren);

        const linkHint = createElement('span', { className: 'link-hint' }, 'اقرأ في Quran.com ↗');
        const chapterInfoText = createElement('span', {}, `سورة ${currentSurah.id} : الآية ${currentVerse}`);
        const footerElem = createElement('div', { className: 'toast-footer' },
            chapterInfoText,
            linkHint
        );

        const progressBar = createElement('div', { className: 'progress-bar' });
        const progressBarContainer = createElement('div', { className: 'progress-bar-container' }, progressBar);

        async function navigateTo(newSurah, newVerse) {
            if (isNavigating) return;
            isNavigating = true;

            if (typeof stopAudioPlayback === 'function') {
                stopAudioPlayback();
            }

            verseParagraph.textContent = 'جاري تحميل الآية...';
            currentSurah = newSurah;
            currentVerse = newVerse;
            quranUrl = `https://quran.com/ar/${newSurah.id}/${newVerse}`;

            surahSelect.value = String(newSurah.id);
            populateVerseSelect(newSurah, newVerse);
            chapterInfoText.textContent = `سورة ${newSurah.id} : الآية ${newVerse}`;

            if (audioContainer && audioContainer.parentNode) {
                audioContainer.parentNode.removeChild(audioContainer);
                audioContainer = null;
            }

            remainingMs = totalMs;

            try {
                const [textData, newAudioData] = await Promise.all([
                    fetchVerseData(newSurah.id, newVerse),
                    fetchAudioData(newSurah.id, newVerse)
                ]);

                if (textData && textData.text) {
                    verseParagraph.textContent = textData.text;

                    if (newAudioData && newAudioData.url) {
                        audioContainer = buildAudioPlayer(newAudioData);
                        if (audioContainer) {
                            bodyElem.appendChild(audioContainer);
                        }
                    }
                } else {
                    verseParagraph.textContent = 'تعذر تحميل الآية.';
                }
            } catch (err) {
                console.error('[Quran Notifier] Error navigating verse:', err);
                verseParagraph.textContent = 'تعذر تحميل الآية.';
            } finally {
                isNavigating = false;
            }
        }

        const toastWrapper = createElement('div', {
            className: 'toast-wrapper',
            onClick: () => {
                window.open(quranUrl, '_blank', 'noopener,noreferrer');
                dismissToast();
            }
        },
            headerElem,
            bodyElem,
            footerElem,
            progressBarContainer
        );

        containerElement.appendChild(toastWrapper);

        requestAnimationFrame(() => {
            toastWrapper.classList.add('show');
        });

        const totalMs = CONFIG.autoDismissSeconds * 1000;
        let remainingMs = totalMs;
        let lastTimestamp = performance.now();
        let animationFrameId = null;
        let isPaused = false;

        function updateProgress(now) {
            if (!isPaused) {
                const delta = now - lastTimestamp;
                remainingMs -= delta;

                const percentage = Math.max(0, (remainingMs / totalMs) * 100);
                progressBar.style.width = `${percentage}%`;

                if (remainingMs <= 0) {
                    dismissToast();
                    return;
                }
            }
            lastTimestamp = now;
            animationFrameId = requestAnimationFrame(updateProgress);
        }

        if (CONFIG.pauseOnHover) {
            toastWrapper.addEventListener('mouseenter', () => { isPaused = true; });
            toastWrapper.addEventListener('mouseleave', () => {
                if (!isAudioPlaying) {
                    isPaused = false;
                }
                lastTimestamp = performance.now();
            });
        }

        animationFrameId = requestAnimationFrame(updateProgress);

        function dismissToast() {
            if (typeof stopAudioPlayback === 'function') {
                stopAudioPlayback();
            }
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            toastWrapper.classList.remove('show');
            setTimeout(() => {
                if (toastWrapper.parentNode) {
                    toastWrapper.parentNode.removeChild(toastWrapper);
                }
            }, 400);
        }
    }

    async function triggerRandomVerseNotification() {
        const randomSurah = SURAHS[Math.floor(Math.random() * SURAHS.length)];
        const randomVerseNum = Math.floor(Math.random() * randomSurah.verses) + 1;

        try {
            const [textData, audioData] = await Promise.all([
                fetchVerseData(randomSurah.id, randomVerseNum),
                fetchAudioData(randomSurah.id, randomVerseNum)
            ]);

            if (textData && textData.text) {
                displayNotification(randomSurah, randomVerseNum, textData.text, audioData);
            }
        } catch (error) {
            console.error('[Quran Verse Notifier] Failed to fetch verse:', error);
        }
    }

    function startNotifier() {
        if (CONFIG.showOnLoad) {
            setTimeout(triggerRandomVerseNotification, 1500);
        }

        const intervalMs = Math.max(1, CONFIG.intervalMinutes) * 60 * 1000;
        setInterval(triggerRandomVerseNotification, intervalMs);
    }

    startNotifier();
})();