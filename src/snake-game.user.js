// ==UserScript==
// @name         Snake game
// @namespace    https://docs.scriptcat.org/
// @version      1.4.1
// @description  Snake game inside web browser with pass through walls option.
// @author       CodeIter
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        // Wall Wrap Config: Set to true for screen edge wrapping, false for wall collision death
        PASS_THROUGH_WALLS: true,

        GRID_SIZE: 20,                // Number of cells per row/column
        CANVAS_SIZE: 400,             // Width & Height of the canvas in px
        INITIAL_SPEED_MS: 200,        // Starting tick interval in ms (lower = faster)
        SPEED_DECREMENT_MS: 2,        // Speedup per normal food eaten
        MIN_SPEED_MS: 30,             // Maximum speed cap
        LEVEL_UP_THRESHOLD: 10,       // Normal food items eaten per level up
        NORMAL_FOOD_TIMEOUT_MS: 10000,// 10 Seconds
        POISON_TIMEOUT_MS: 8000,      // 8 Seconds

        // Emoji Collections
        NORMAL_FOODS: ['🍎', '🍌', '🍓', '🍑', '🍒', '🍉', '🍇', '🍐', '🫐'],
        KILL_POISON_FOODS: ['🌶️', '🫑'],
        SHRINK_POISON_FOODS: ['🍏', '🍋‍🟩', '🍋'],

        // Styling Palette
        COLOR_BG: '#1e293b',
        COLOR_GRID: '#334155',
        COLOR_SNAKE_HEAD: '#22c55e',
        COLOR_SNAKE_BODY: '#4ade80',
        COLOR_TEXT: '#f8fafc',
        STORAGE_KEY_SCORES: 'SNAKE_GAME_HIGH_SCORES_V1',
        STORAGE_KEY_LAST_NAME: 'SNAKE_GAME_LAST_PLAYER_NAME'
    };

    // Helper wrapper for GM storage with fallback to localStorage
    const Storage = {
        get: function(key, defaultValue) {
            try {
                if (typeof GM_getValue === 'function') {
                    return GM_getValue(key, defaultValue);
                }
            } catch(e) {}
            const val = localStorage.getItem(key);
            return val ? JSON.parse(val) : defaultValue;
        },
        set: function(key, value) {
            try {
                if (typeof GM_setValue === 'function') {
                    GM_setValue(key, value);
                    return;
                }
            } catch(e) {}
            localStorage.setItem(key, JSON.stringify(value));
        }
    };

    // Shadow DOM & Element References
    let shadowHost = null;
    let shadowRoot = null;
    let modalContainer = null;
    let canvas = null;
    let ctx = null;

    let snake = [];
    let direction = { x: 1, y: 0 };
    let nextDirection = { x: 1, y: 0 };

    let normalFood = null;       // { x, y, emoji, timer }
    let killPoisonFood = null;   // { x, y, emoji, timer }
    let shrinkPoisonFood = null; // { x, y, emoji, timer }

    let score = 0;
    let level = 1;
    let foodsEaten = 0;
    let currentSpeed = CONFIG.INITIAL_SPEED_MS;
    let highScores = [];

    let isPaused = false;
    let isGameOver = false;
    let gameLoopTimeout = null;
    let isListenerAttached = false;

    // Shadow DOM element lookup helper
    function $(id) {
        return shadowRoot ? shadowRoot.getElementById(id) : null;
    }

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
            console.warn('[Snake Game] Failed to adopt stylesheet:', err);
        }
    }

    // Safe DOM element builder that avoids TrustedType / innerHTML restrictions completely
    function el(tag, props = {}, children = []) {
        const element = document.createElement(tag);
        for (const [key, val] of Object.entries(props)) {
            if (key === 'style' && typeof val === 'object') {
                Object.assign(element.style, val);
            } else if (key === 'className' || key === 'class') {
                element.className = val;
            } else if (key === 'value' && (tag === 'input' || tag === 'textarea')) {
                element.value = val;
            } else if (key.startsWith('on') && typeof val === 'function') {
                element.addEventListener(key.substring(2).toLowerCase(), val);
            } else {
                element.setAttribute(key, val);
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

    function createModal() {
        if (shadowHost) return;

        // Create host element for Shadow DOM encapsulation
        shadowHost = document.createElement('div');
        shadowHost.id = 'snake-game-shadow-host';
        shadowHost.style.position = 'absolute';
        shadowHost.style.top = '0';
        shadowHost.style.left = '0';
        shadowHost.style.zIndex = '9999999';

        // Attach Shadow Root
        shadowRoot = shadowHost.attachShadow({ mode: 'open' });

        const styleText = `
            :host {
                all: initial;
            }
            .sg-modal-overlay {
                position: fixed;
                top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(15, 23, 42, 0.85);
                backdrop-filter: blur(4px);
                z-index: 999999;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                color: ${CONFIG.COLOR_TEXT};
                box-sizing: border-box;
            }
            .sg-modal-overlay * {
                box-sizing: border-box;
            }
            .sg-modal-card {
                background: #0f172a;
                border: 2px solid #334155;
                border-radius: 16px;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
                padding: 20px;
                display: flex;
                flex-direction: column;
                align-items: center;
                position: relative;
                max-width: 95vw;
                outline: none;
            }
            .sg-close-btn {
                position: absolute;
                top: 12px;
                right: 16px;
                background: transparent;
                border: none;
                color: #94a3b8;
                font-size: 24px;
                cursor: pointer;
                line-height: 1;
                transition: color 0.2s;
            }
            .sg-close-btn:hover { color: #f43f5e; }
            .sg-top-bar {
                display: flex;
                justify-content: space-around;
                width: 100%;
                margin-bottom: 12px;
                font-weight: 700;
                font-size: 16px;
                background: #1e293b;
                padding: 10px 16px;
                border-radius: 8px;
            }
            .sg-stat { display: flex; gap: 6px; align-items: center; }
            .sg-stat-val { color: #38bdf8; }
            .sg-canvas-container {
                position: relative;
                border-radius: 8px;
                overflow: hidden;
                box-shadow: inset 0 0 10px rgba(0,0,0,0.5);
            }
            canvas#sg-canvas {
                display: block;
                background-color: ${CONFIG.COLOR_BG};
                outline: none;
            }
            .sg-bottom-bar {
                display: flex;
                gap: 10px;
                margin-top: 14px;
                width: 100%;
                justify-content: center;
            }
            .sg-btn {
                background: #334155;
                color: #f8fafc;
                border: none;
                padding: 8px 16px;
                border-radius: 6px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                font-size: 14px;
            }
            .sg-btn:hover { background: #475569; transform: translateY(-1px); }
            .sg-btn:active { transform: translateY(0); }
            .sg-btn-primary { background: #2563eb; }
            .sg-btn-primary:hover { background: #1d4ed8; }
            .sg-overlay-panel {
                position: absolute;
                top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(15, 23, 42, 0.95);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                border-radius: 8px;
                z-index: 10;
                padding: 20px;
            }
            .sg-scores-list {
                width: 100%;
                max-height: 240px;
                overflow-y: auto;
                margin: 10px 0;
                padding: 0;
                list-style: none;
            }
            .sg-scores-list li {
                display: flex;
                justify-content: space-between;
                padding: 6px 12px;
                border-bottom: 1px solid #334155;
                font-size: 14px;
            }
            .sg-input {
                background: #1e293b;
                border: 1px solid #475569;
                color: #fff;
                padding: 8px 12px;
                border-radius: 6px;
                margin: 10px 0;
                width: 80%;
                text-align: center;
                font-size: 16px;
                outline: none;
            }
            .sg-input:focus {
                border-color: #38bdf8;
            }
        `;

        // Programmatically build DOM without innerHTML to satisfy TrustedHTML CSP rules
        modalContainer = el('div', { class: 'sg-modal-overlay' }, [
            el('div', { class: 'sg-modal-card', tabindex: '-1', id: 'sg-modal-card' }, [
                el('button', { class: 'sg-close-btn', id: 'sg-close-x' }, ['×']),
                el('div', { class: 'sg-top-bar' }, [
                    el('div', { class: 'sg-stat' }, ['Level: ', el('span', { class: 'sg-stat-val', id: 'sg-level' }, ['1'])]),
                    el('div', { class: 'sg-stat' }, ['Score: ', el('span', { class: 'sg-stat-val', id: 'sg-score' }, ['0'])]),
                    el('div', { class: 'sg-stat' }, ['High: ', el('span', { class: 'sg-stat-val', id: 'sg-high' }, ['0'])])
                ]),
                el('div', { class: 'sg-canvas-container' }, [
                    el('canvas', { id: 'sg-canvas', width: CONFIG.CANVAS_SIZE, height: CONFIG.CANVAS_SIZE, tabindex: '0' }),
                    el('div', { id: 'sg-sub-panel', class: 'sg-overlay-panel', style: { display: 'none' } })
                ]),
                el('div', { class: 'sg-bottom-bar' }, [
                    el('button', { class: 'sg-btn', id: 'sg-btn-pause' }, ['Pause']),
                    el('button', { class: 'sg-btn', id: 'sg-btn-restart' }, ['Restart']),
                    el('button', { class: 'sg-btn', id: 'sg-btn-scores' }, ['Scores'])
                ])
            ])
        ]);

        adoptStyleSheet(shadowRoot, styleText);
        shadowRoot.appendChild(modalContainer);
        document.body.appendChild(shadowHost);

        canvas = $('sg-canvas');
        ctx = canvas.getContext('2d');

        $('sg-close-x').addEventListener('click', closeModal);
        $('sg-btn-pause').addEventListener('click', togglePause);
        $('sg-btn-restart').addEventListener('click', () => {
            restartGame();
            focusCanvas();
        });
        $('sg-btn-scores').addEventListener('click', toggleScoresOverlay);

        if (!isListenerAttached) {
            window.addEventListener('keydown', handleKeyDown, true);
            isListenerAttached = true;
        }
    }

    function focusCanvas() {
        if (canvas) {
            canvas.focus();
        } else {
            const card = $('sg-modal-card');
            if (card) card.focus();
        }
    }

    function openGameModal() {
        if (!shadowHost) {
            createModal();
        } else {
            modalContainer.style.display = 'flex';
        }

        highScores = Storage.get(CONFIG.STORAGE_KEY_SCORES, []);
        updateTopBar();
        restartGame();
        focusCanvas();
    }

    function closeModal() {
        if (modalContainer) {
            modalContainer.style.display = 'none';
        }
        clearTimeout(gameLoopTimeout);
        clearAllFoodTimers();
    }

    function restartGame() {
        clearTimeout(gameLoopTimeout);
        clearAllFoodTimers();

        const center = Math.floor(CONFIG.GRID_SIZE / 2);
        snake = [
            { x: center, y: center },
            { x: center - 1, y: center },
            { x: center - 2, y: center }
        ];

        direction = { x: 1, y: 0 };
        nextDirection = { x: 1, y: 0 };
        score = 0;
        level = 1;
        foodsEaten = 0;
        currentSpeed = CONFIG.INITIAL_SPEED_MS;
        isPaused = false;
        isGameOver = false;

        const pauseBtn = $('sg-btn-pause');
        if (pauseBtn) pauseBtn.textContent = 'Pause';
        hideSubPanel();

        spawnNormalFood();
        spawnKillPoisonFood();
        spawnShrinkPoisonFood();

        updateTopBar();
        runGameLoop();
    }

    function handleKeyDown(e) {
        if (!modalContainer || modalContainer.style.display === 'none') return;

        // Check focused element inside Shadow DOM
        const activeEl = shadowRoot ? shadowRoot.activeElement : null;
        const activeTag = activeEl ? activeEl.tagName.toUpperCase() : '';
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') {
            return;
        }

        const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space'];
        if (keys.includes(e.code)) {
            e.preventDefault();
        }

        if (isGameOver) return;

        switch (e.code) {
            case 'ArrowUp':
            case 'KeyW':
                if (direction.y === 0) nextDirection = { x: 0, y: -1 };
                break;
            case 'ArrowDown':
            case 'KeyS':
                if (direction.y === 0) nextDirection = { x: 0, y: 1 };
                break;
            case 'ArrowLeft':
            case 'KeyA':
                if (direction.x === 0) nextDirection = { x: -1, y: 0 };
                break;
            case 'ArrowRight':
            case 'KeyD':
                if (direction.x === 0) nextDirection = { x: 1, y: 0 };
                break;
            case 'Space':
                togglePause();
                break;
        }
    }

    function getRandomPosition() {
        const cellSize = CONFIG.GRID_SIZE;
        let pos;
        let collision = true;

        while (collision) {
            pos = {
                x: Math.floor(Math.random() * cellSize),
                y: Math.floor(Math.random() * cellSize)
            };

            const snakeHit = snake.some(seg => seg.x === pos.x && seg.y === pos.y);
            const nHit = normalFood && normalFood.x === pos.x && normalFood.y === pos.y;
            const kHit = killPoisonFood && killPoisonFood.x === pos.x && killPoisonFood.y === pos.y;
            const sHit = shrinkPoisonFood && shrinkPoisonFood.x === pos.x && shrinkPoisonFood.y === pos.y;

            if (!snakeHit && !nHit && !kHit && !sHit) {
                collision = false;
            }
        }
        return pos;
    }

    function getRandomEmoji(array) {
        return array[Math.floor(Math.random() * array.length)];
    }

    function spawnNormalFood() {
        if (normalFood && normalFood.timer) clearTimeout(normalFood.timer);
        const pos = getRandomPosition();
        normalFood = {
            x: pos.x,
            y: pos.y,
            emoji: getRandomEmoji(CONFIG.NORMAL_FOODS),
            timer: setTimeout(() => spawnNormalFood(), CONFIG.NORMAL_FOOD_TIMEOUT_MS)
        };
    }

    function spawnKillPoisonFood() {
        if (killPoisonFood && killPoisonFood.timer) clearTimeout(killPoisonFood.timer);
        const pos = getRandomPosition();
        killPoisonFood = {
            x: pos.x,
            y: pos.y,
            emoji: getRandomEmoji(CONFIG.KILL_POISON_FOODS),
            timer: setTimeout(() => spawnKillPoisonFood(), CONFIG.POISON_TIMEOUT_MS)
        };
    }

    function spawnShrinkPoisonFood() {
        if (shrinkPoisonFood && shrinkPoisonFood.timer) clearTimeout(shrinkPoisonFood.timer);
        const pos = getRandomPosition();
        shrinkPoisonFood = {
            x: pos.x,
            y: pos.y,
            emoji: getRandomEmoji(CONFIG.SHRINK_POISON_FOODS),
            timer: setTimeout(() => spawnShrinkPoisonFood(), CONFIG.POISON_TIMEOUT_MS)
        };
    }

    function clearAllFoodTimers() {
        if (normalFood && normalFood.timer) clearTimeout(normalFood.timer);
        if (killPoisonFood && killPoisonFood.timer) clearTimeout(killPoisonFood.timer);
        if (shrinkPoisonFood && shrinkPoisonFood.timer) clearTimeout(shrinkPoisonFood.timer);
    }

    function runGameLoop() {
        if (isPaused || isGameOver) return;

        update();
        render();

        if (!isGameOver) {
            gameLoopTimeout = setTimeout(runGameLoop, currentSpeed);
        }
    }

    function update() {
        direction = { ...nextDirection };
        let head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };

        // Handle Wall Edge Collisions & Pass Through Wrap
        if (CONFIG.PASS_THROUGH_WALLS) {
            if (head.x < 0) head.x = CONFIG.GRID_SIZE - 1;
            else if (head.x >= CONFIG.GRID_SIZE) head.x = 0;

            if (head.y < 0) head.y = CONFIG.GRID_SIZE - 1;
            else if (head.y >= CONFIG.GRID_SIZE) head.y = 0;
        } else {
            if (head.x < 0 || head.x >= CONFIG.GRID_SIZE || head.y < 0 || head.y >= CONFIG.GRID_SIZE) {
                triggerGameOver('Hit the wall!');
                return;
            }
        }

        // Self collisions
        if (snake.some(seg => seg.x === head.x && seg.y === head.y)) {
            triggerGameOver('Bit yourself!');
            return;
        }

        snake.unshift(head);

        // Check Normal Food collision
        if (normalFood && head.x === normalFood.x && head.y === normalFood.y) {
            score += 10 * level;
            foodsEaten++;

            level = Math.floor(foodsEaten / CONFIG.LEVEL_UP_THRESHOLD) + 1;
            currentSpeed = Math.max(CONFIG.MIN_SPEED_MS, currentSpeed - CONFIG.SPEED_DECREMENT_MS);

            updateTopBar();
            spawnNormalFood();
        } 
        // Check Kill Poison collision
        else if (killPoisonFood && head.x === killPoisonFood.x && head.y === killPoisonFood.y) {
            triggerGameOver('Ate deadly poison!');
            return;
        } 
        // Check Shrink Poison collision
        else if (shrinkPoisonFood && head.x === shrinkPoisonFood.x && head.y === shrinkPoisonFood.y) {
            if (snake.length <= 2) {
                triggerGameOver('Shrank out of existence!');
                return;
            } else {
                snake.pop(); // Remove regular tail
                snake.pop(); // Remove extra segment to shrink
                spawnShrinkPoisonFood();
            }
        } 
        else {
            snake.pop();
        }
    }

    function render() {
        if (!ctx) return;
        const cellSize = CONFIG.CANVAS_SIZE / CONFIG.GRID_SIZE;

        ctx.fillStyle = CONFIG.COLOR_BG;
        ctx.fillRect(0, 0, CONFIG.CANVAS_SIZE, CONFIG.CANVAS_SIZE);

        ctx.strokeStyle = CONFIG.COLOR_GRID;
        ctx.lineWidth = 0.5;
        for (let i = 0; i < CONFIG.CANVAS_SIZE; i += cellSize) {
            ctx.beginPath();
            ctx.moveTo(i, 0); ctx.lineTo(i, CONFIG.CANVAS_SIZE);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, i); ctx.lineTo(CONFIG.CANVAS_SIZE, i);
            ctx.stroke();
        }

        ctx.font = `${cellSize * 0.75}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const drawEmoji = (item) => {
            if (!item) return;
            ctx.fillText(
                item.emoji, 
                item.x * cellSize + cellSize / 2, 
                item.y * cellSize + cellSize / 2 + 2
            );
        };

        drawEmoji(normalFood);
        drawEmoji(killPoisonFood);
        drawEmoji(shrinkPoisonFood);

        snake.forEach((segment, index) => {
            ctx.fillStyle = index === 0 ? CONFIG.COLOR_SNAKE_HEAD : CONFIG.COLOR_SNAKE_BODY;
            const x = segment.x * cellSize;
            const y = segment.y * cellSize;
            const pad = 1;

            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(x + pad, y + pad, cellSize - pad * 2, cellSize - pad * 2, index === 0 ? 6 : 4);
            } else {
                ctx.rect(x + pad, y + pad, cellSize - pad * 2, cellSize - pad * 2);
            }
            ctx.fill();
        });
    }

    function getHighestScore() {
        return highScores.length > 0 ? highScores[0].score : 0;
    }

    function updateTopBar() {
        const lvlEl = $('sg-level');
        const scoreEl = $('sg-score');
        const highEl = $('sg-high');

        if (lvlEl) lvlEl.textContent = level;
        if (scoreEl) scoreEl.textContent = score;
        if (highEl) highEl.textContent = Math.max(score, getHighestScore());
    }

    function togglePause() {
        if (isGameOver) return;
        isPaused = !isPaused;
        const btn = $('sg-btn-pause');
        if (btn) btn.textContent = isPaused ? 'Resume' : 'Pause';

        if (!isPaused) {
            runGameLoop();
            focusCanvas();
        }
    }

    function triggerGameOver(reason) {
        isGameOver = true;
        clearAllFoodTimers();

        const lastPlayerName = Storage.get(CONFIG.STORAGE_KEY_LAST_NAME, '');
        const panel = $('sg-sub-panel');

        const saveBtn = el('button', { class: 'sg-btn sg-btn-primary', id: 'sg-save-score-btn' }, ['Save Score']);
        const input = el('input', { type: 'text', id: 'sg-player-name', class: 'sg-input', placeholder: 'Enter Username', value: lastPlayerName, maxlength: '15' });

        panel.replaceChildren(
            el('h2', { style: { margin: '0 0 8px 0', color: '#f43f5e', fontSize: '22px' } }, ['Game Over']),
            el('p', { style: { margin: '0 0 12px 0', color: '#94a3b8', fontSize: '14px' } }, [reason]),
            el('p', { style: { margin: '0 0 10px 0', fontWeight: 'bold' } }, [`Your Score: ${score}`]),
            input,
            saveBtn
        );
        panel.style.display = 'flex';

        input.focus();
        input.select();

        const saveHandler = () => {
            const name = input.value.trim() || 'Anonymous';
            Storage.set(CONFIG.STORAGE_KEY_LAST_NAME, name);
            saveScore(name, score);
            showScoresOverlay();
        };

        saveBtn.addEventListener('click', saveHandler);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveHandler();
        });
    }

    function saveScore(username, userScore) {
        highScores.push({ name: username, score: userScore, date: new Date().toLocaleDateString() });
        highScores.sort((a, b) => b.score - a.score);
        highScores = highScores.slice(0, 10);

        Storage.set(CONFIG.STORAGE_KEY_SCORES, highScores);
        updateTopBar();
    }

    function showScoresOverlay() {
        const panel = $('sg-sub-panel');

        let listItems = [];
        if (highScores.length === 0) {
            listItems.push(el('li', { style: { justifyContent: 'center', color: '#94a3b8' } }, ['No High Scores Yet']));
        } else {
            listItems = highScores.map((s, idx) => 
                el('li', {}, [
                    el('span', {}, [
                        el('strong', {}, [`#${idx + 1} `]),
                        s.name
                    ]),
                    el('span', { style: { color: '#38bdf8' } }, [`${s.score} pts`])
                ])
            );
        }

        const scoresList = el('ul', { class: 'sg-scores-list' }, listItems);
        const closeBtn = el('button', { class: 'sg-btn', id: 'sg-close-scores-btn', style: { marginTop: '10px' } }, ['Back to Game']);

        panel.replaceChildren(
            el('h2', { style: { margin: '0 0 10px 0', color: '#f8fafc', fontSize: '20px' } }, ['Top 10 Scores']),
            scoresList,
            closeBtn
        );
        panel.style.display = 'flex';

        closeBtn.addEventListener('click', () => {
            if (isGameOver) {
                restartGame();
            } else {
                hideSubPanel();
            }
            focusCanvas();
        });
    }

    function toggleScoresOverlay() {
        const panel = $('sg-sub-panel');
        if (panel.style.display === 'flex') {
            hideSubPanel();
            focusCanvas();
        } else {
            showScoresOverlay();
        }
    }

    function hideSubPanel() {
        const panel = $('sg-sub-panel');
        if (panel) panel.style.display = 'none';
    }

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Play Game', openGameModal);
    } else {
        console.log('Snake Game Userscript loaded with Shadow DOM & Trusted Types compliance.');
    }
})();