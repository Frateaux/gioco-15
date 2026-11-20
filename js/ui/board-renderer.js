/**
 * Renders N×N sliding puzzle tiles into #boardWell and bridges Pointer Events
 * (tap, fast swipe, and live multi-tile drag) directly to SpringPhysicsEngine.
 */

import { getMovableLine, isCheckerboardAccent } from '../core/board.js';

export class BoardRenderer {
    /**
     * @param {object} options
     * @param {HTMLElement} options.boardWell
     * @param {import('../core/physics.js').SpringPhysicsEngine} options.physics
     * @param {() => number[]} options.getBoard
     * @param {() => number} options.getSize
     * @param {() => string} options.getPlasticVariant
     * @param {() => boolean} options.isSolved
     * @param {(tileNum: number, requiredDir?: string|null, options?: object) => boolean} options.onSlideRequest
     * @param {() => void} options.onPointerInteract
     * @param {(tileElements: Map<number, HTMLElement>, size: number) => void} [options.onBoardBuilt]
     */
    constructor({
        boardWell,
        physics,
        getBoard,
        getSize,
        getPlasticVariant,
        isSolved,
        onSlideRequest,
        onPointerInteract,
        onBoardBuilt = null,
    }) {
        this.boardWell = boardWell;
        this.physics = physics;
        this.getBoard = getBoard;
        this.getSize = getSize;
        this.getPlasticVariant = getPlasticVariant;
        this.isSolved = isSolved;
        this.onSlideRequest = onSlideRequest;
        this.onPointerInteract = onPointerInteract;
        this.onBoardBuilt = onBoardBuilt;

        /** @type {Map<number, HTMLElement>} */
        this.tileElements = new Map();
    }

    /**
     * Rebuilds tile DOM elements for the current grid size and plastic variant,
     * and binds them to the physics engine.
     */
    build() {
        const size = this.getSize();
        const board = this.getBoard();
        const plasticVariant = this.getPlasticVariant();
        const total = size * size;
        const tilePct = 100 / size;

        this.boardWell.dataset.size = String(size);
        this.boardWell.style.setProperty('--cell-pct', `${tilePct}%`);
        this.boardWell.innerHTML = '';
        this.tileElements.clear();

        const fragment = document.createDocumentFragment();

        for (let num = 1; num < total; num++) {
            const tile = document.createElement('div');
            tile.className = 'puzzle-tile';
            tile.style.width = `${tilePct}%`;
            tile.style.height = `${tilePct}%`;
            tile.dataset.num = String(num);

            const isBicolor = plasticVariant === 'bicolor';
            const red = isBicolor && isCheckerboardAccent(num, size);
            const surfaceClass = red
                ? 'tile-surface tile-red'
                : `tile-surface tile-ivory ${!isBicolor && num % 2 === 0 ? 'classic-ink' : ''}`;

            tile.innerHTML = `
                <div class="${surfaceClass}">
                    <canvas class="tile-media-canvas" aria-hidden="true"></canvas>
                    <div class="tile-specular"></div>
                    <div class="tile-groove"></div>
                    <span class="tile-number">${num}</span>
                    <span class="correct-dot"></span>
                    <span class="ice-badge" aria-hidden="true"></span>
                </div>
            `;

            this._attachTilePointerEvents(tile, num);
            fragment.appendChild(tile);
            this.tileElements.set(num, tile);
        }

        this.boardWell.appendChild(fragment);
        this.physics.registerTiles(this.tileElements, board, size);
        this.updateCorrectStates(board);
        this.onBoardBuilt?.(this.tileElements, size);
    }

    /**
     * Updates `.is-correct` markers on all tiles for the given board array.
     * @param {number[]} board
     */
    updateCorrectStates(board) {
        for (let idx = 0; idx < board.length; idx++) {
            const num = board[idx];
            if (num === 0) continue;
            const tile = this.tileElements.get(num);
            if (!tile) continue;
            if (idx === num - 1) {
                tile.classList.add('is-correct');
            } else {
                tile.classList.remove('is-correct');
            }
        }
    }

    /**
     * Toggles the "Spia OK" hint state on the board well.
     * @param {boolean} show
     */
    setShowHints(show) {
        this.boardWell.classList.toggle('show-hints', Boolean(show));
    }

    /**
     * Toggles photo/video tile rendering and corner guide numbers on the board well.
     * @param {{ active: boolean, showNumbers: boolean }} mediaState
     */
    setMediaState({ active, showNumbers }) {
        this.boardWell.classList.toggle('has-media', Boolean(active));
        this.boardWell.classList.toggle('show-media-numbers', Boolean(showNumbers));
    }

    /**
     * Highlights (or clears) the AI-recommended next tile.
     * @param {number | null} tileNum
     */
    setHintTile(tileNum) {
        for (const [num, tileEl] of this.tileElements.entries()) {
            tileEl.classList.toggle('is-hint', tileNum !== null && num === tileNum);
        }
    }

    /**
     * Applies Arcade modifier visuals (Fog of War, Frozen Tiles, Blind Memory).
     * @param {object} snapshot
     */
    applyArcadeState({
        fogActive = false,
        fogVisibleTiles = null,
        frozenTiles = null,
        iceMovesLeft = 0,
        memoryBlind = false,
        memoryPeeking = false,
    } = {}) {
        this.boardWell.classList.toggle('arcade-fog', Boolean(fogActive));
        this.boardWell.classList.toggle('arcade-blind', Boolean(memoryBlind));
        this.boardWell.classList.toggle('arcade-peeking', Boolean(memoryPeeking));

        for (const [num, tileEl] of this.tileElements.entries()) {
            const fogVisible = fogActive && fogVisibleTiles ? fogVisibleTiles.has(num) : false;
            tileEl.classList.toggle('is-fog-visible', fogVisible);

            const isFrozen = iceMovesLeft > 0 && frozenTiles ? frozenTiles.has(num) : false;
            tileEl.classList.toggle('is-frozen', isFrozen);
            const badge = tileEl.querySelector('.ice-badge');
            if (badge) {
                badge.textContent = isFrozen ? String(iceMovesLeft) : '';
            }
        }
    }

    /**
     * Triggers a short mechanical shake on blocked frozen tiles.
     * @param {number[]} tileNums
     */
    triggerIceShake(tileNums) {
        for (let i = 0; i < tileNums.length; i++) {
            const tileEl = this.tileElements.get(tileNums[i]);
            if (!tileEl) continue;
            tileEl.classList.remove('is-ice-shake');
            void tileEl.offsetWidth;
            tileEl.classList.add('is-ice-shake');
            setTimeout(() => tileEl.classList.remove('is-ice-shake'), 320);
        }
    }

    /**
     * Attaches tap, swipe, and live multi-tile direct drag handlers via Pointer Events.
     * @param {HTMLElement} tileEl
     * @param {number} num
     */
    _attachTilePointerEvents(tileEl, num) {
        let activePointerId = null;
        let startX = 0;
        let startY = 0;
        let lastTime = 0;
        let lastProgress = 0;
        let velocityCellsPerSec = 0;
        let movedMaxPx = 0;
        let cellPx = 80;
        let movableLine = null;
        let currentProgress = 0;

        const resetDrag = () => {
            activePointerId = null;
            movableLine = null;
            currentProgress = 0;
            velocityCellsPerSec = 0;
        };

        tileEl.addEventListener('pointerdown', (e) => {
            if (this.isSolved() || activePointerId !== null) return;
            if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;

            e.preventDefault();
            this.onPointerInteract();

            activePointerId = e.pointerId;
            startX = e.clientX;
            startY = e.clientY;
            lastTime = performance.now();
            lastProgress = 0;
            currentProgress = 0;
            velocityCellsPerSec = 0;
            movedMaxPx = 0;

            const size = this.getSize();
            const rect = this.boardWell.getBoundingClientRect();
            cellPx = Math.max(24, rect.width / size);
            movableLine = getMovableLine(this.getBoard(), size, num);

            try {
                tileEl.setPointerCapture(e.pointerId);
            } catch (_) {}
        });

        tileEl.addEventListener('pointermove', (e) => {
            if (e.pointerId !== activePointerId || this.isSolved()) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            movedMaxPx = Math.max(movedMaxPx, Math.hypot(dx, dy));

            if (!movableLine) return;

            const rawDelta = movableLine.axis === 'x' ? dx : dy;
            const directedCells = (rawDelta * movableLine.sign) / cellPx;

            // Clamp with gentle rubber-band resistance past boundaries [0, 1]
            let clamped = directedCells;
            if (clamped < 0) {
                clamped = Math.max(-0.06, clamped * 0.2);
            } else if (clamped > 1) {
                clamped = 1 + Math.min(0.05, (clamped - 1) * 0.2);
            }

            const now = performance.now();
            const dt = (now - lastTime) / 1000;
            if (dt > 0.004) {
                const instVel = (clamped - lastProgress) / dt;
                velocityCellsPerSec = velocityCellsPerSec * 0.4 + instVel * 0.6;
                lastProgress = clamped;
                lastTime = now;
            }

            currentProgress = clamped;
            const offset = clamped * movableLine.sign;
            if (movableLine.axis === 'x') {
                this.physics.setDragOffsets(movableLine.tiles, offset, 0);
            } else {
                this.physics.setDragOffsets(movableLine.tiles, 0, offset);
            }
        });

        tileEl.addEventListener('pointerup', (e) => {
            if (e.pointerId !== activePointerId) return;

            const line = movableLine;
            const isTap = movedMaxPx < 10;
            const progress = currentProgress;
            const releaseVel = velocityCellsPerSec * (line ? line.sign : 1);
            const directionalVel = velocityCellsPerSec;

            resetDrag();

            if (this.isSolved()) {
                if (line) this.physics.cancelDrag(line.tiles);
                return;
            }

            if (isTap) {
                if (line) this.physics.cancelDrag(line.tiles);
                this.onSlideRequest(num, null, { fromDrag: false });
                return;
            }

            if (!line) return;

            const shouldCommit = progress >= 0.3 || (progress >= 0.08 && directionalVel > 1.8);
            if (shouldCommit) {
                const committed = this.onSlideRequest(num, line.direction, {
                    fromDrag: true,
                    movedTiles: line.tiles,
                    releaseVelocity: releaseVel,
                    axis: line.axis,
                });
                if (!committed) {
                    this.physics.cancelDrag(line.tiles);
                }
            } else {
                this.physics.cancelDrag(line.tiles);
            }
        });

        tileEl.addEventListener('pointercancel', (e) => {
            if (e.pointerId !== activePointerId) return;
            const line = movableLine;
            resetDrag();
            if (line) {
                this.physics.cancelDrag(line.tiles);
            }
        });
    }
}
