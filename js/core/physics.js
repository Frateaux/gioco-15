/**
 * 60fps GPU-accelerated spring-damper physics engine for sliding tiles.
 * Operates in normalized cell units (0..size-1) via `transform: translate3d(...)`
 * so tiles remain fluid across viewport resizes without layout reflows.
 */

export class SpringPhysicsEngine {
    /**
     * @param {object} [options]
     * @param {number} [options.stiffness=560] Spring stiffness (slightly underdamped for mechanical micro-bounce)
     * @param {number} [options.damping=31] Viscous damping coefficient
     */
    constructor({ stiffness = 560, damping = 31 } = {}) {
        this.stiffness = stiffness;
        this.damping = damping;
        /** @type {Map<number, { el: HTMLElement, x: number, y: number, vx: number, vy: number, targetX: number, targetY: number, dragX: number, dragY: number, dragging: boolean, settled: boolean }>} */
        this.bodies = new Map();
        this.rafId = null;
        this.lastTime = 0;
        this._tick = this._tick.bind(this);
    }

    /**
     * Dynamically adjusts spring stiffness and damping (e.g. faster response for 3s replay).
     * @param {{ stiffness?: number, damping?: number }} params
     */
    setSpringParams({ stiffness = 560, damping = 31 } = {}) {
        this.stiffness = stiffness;
        this.damping = damping;
    }

    /**
     * Registers DOM tile elements and snaps them immediately to the given board state.
     * @param {Map<number, HTMLElement>} tileElements
     * @param {number[]} board
     * @param {number} size
     */
    registerTiles(tileElements, board, size) {
        this.stop();
        this.bodies.clear();

        for (let idx = 0; idx < board.length; idx++) {
            const num = board[idx];
            if (num === 0) continue;
            const el = tileElements.get(num);
            if (!el) continue;

            const col = idx % size;
            const row = Math.floor(idx / size);

            const body = {
                el,
                x: col,
                y: row,
                vx: 0,
                vy: 0,
                targetX: col,
                targetY: row,
                dragX: 0,
                dragY: 0,
                dragging: false,
                settled: true,
            };
            this.bodies.set(num, body);
            this._applyTransform(body);
        }
    }

    /**
     * Updates target cell positions from a new board array and triggers spring motion.
     * @param {number[]} board
     * @param {number} size
     * @param {object} [options]
     * @param {number[]} [options.impulseTiles] Tiles to receive an initial directional kick
     * @param {'x'|'y'} [options.axis]
     * @param {1|-1} [options.sign]
     * @param {number} [options.initialSpeed=4.2] Speed in cells/sec for tap/flick punchiness
     * @param {boolean} [options.animateShuffle=false] Adds subtle mechanical wave jitter on shuffle
     */
    setTargetsFromBoard(board, size, {
        impulseTiles = null,
        axis = 'x',
        sign = 1,
        initialSpeed = 4.2,
        animateShuffle = false,
    } = {}) {
        const impulseSet = impulseTiles ? new Set(impulseTiles) : null;
        let needsLoop = false;

        for (let idx = 0; idx < board.length; idx++) {
            const num = board[idx];
            if (num === 0) continue;
            const body = this.bodies.get(num);
            if (!body) continue;

            const col = idx % size;
            const row = Math.floor(idx / size);

            const moved = Math.abs(body.targetX - col) > 0.0001 || Math.abs(body.targetY - row) > 0.0001;
            body.targetX = col;
            body.targetY = row;

            if (animateShuffle && moved) {
                body.vx += ((num % 3) - 1) * 1.4;
                body.vy += (((num + 1) % 3) - 1) * 1.4;
                body.settled = false;
                needsLoop = true;
            } else if (moved || !body.settled) {
                if (impulseSet && impulseSet.has(num)) {
                    if (axis === 'x') body.vx += sign * initialSpeed;
                    else body.vy += sign * initialSpeed;
                }
                body.settled = false;
                needsLoop = true;
            }
        }

        if (needsLoop) {
            this._ensureLoop();
        }
    }

    /**
     * Applies real-time normalized drag offset (in cell units) to a contiguous line of tiles.
     * @param {number[]} tileNums
     * @param {number} dxCells
     * @param {number} dyCells
     */
    setDragOffsets(tileNums, dxCells, dyCells) {
        for (let i = 0; i < tileNums.length; i++) {
            const body = this.bodies.get(tileNums[i]);
            if (!body) continue;
            body.dragging = true;
            body.dragX = dxCells;
            body.dragY = dyCells;
            this._applyTransform(body);
        }
    }

    /**
     * Commits a pointer drag into a solved board state while preserving exact visual
     * position and release velocity for seamless continuity.
     * @param {number[]} tileNums
     * @param {number[]} board
     * @param {number} size
     * @param {number} releaseVelocityCellsPerSec
     * @param {'x'|'y'} axis
     */
    commitDrag(tileNums, board, size, releaseVelocityCellsPerSec, axis) {
        for (let i = 0; i < tileNums.length; i++) {
            const body = this.bodies.get(tileNums[i]);
            if (!body) continue;
            body.x += body.dragX;
            body.y += body.dragY;
            body.dragX = 0;
            body.dragY = 0;
            body.dragging = false;
            if (axis === 'x') {
                body.vx = releaseVelocityCellsPerSec;
            } else {
                body.vy = releaseVelocityCellsPerSec;
            }
            body.settled = false;
        }
        this.setTargetsFromBoard(board, size, { initialSpeed: 0 });
    }

    /**
     * Releases dragged tiles back to their original targets with spring elasticity.
     * @param {number[]} tileNums
     */
    cancelDrag(tileNums) {
        let needsLoop = false;
        for (let i = 0; i < tileNums.length; i++) {
            const body = this.bodies.get(tileNums[i]);
            if (!body) continue;
            body.x += body.dragX;
            body.y += body.dragY;
            body.dragX = 0;
            body.dragY = 0;
            body.dragging = false;
            body.settled = false;
            needsLoop = true;
        }
        if (needsLoop) {
            this._ensureLoop();
        }
    }

    /**
     * Stops the animation loop immediately.
     */
    stop() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.lastTime = 0;
    }

    _ensureLoop() {
        if (this.rafId === null) {
            this.lastTime = performance.now();
            this.rafId = requestAnimationFrame(this._tick);
        }
    }

    /**
     * Integrates spring-damper equations with clamped dt and sub-stepping.
     * @param {number} now
     */
    _tick(now) {
        const rawDt = (now - this.lastTime) / 1000;
        this.lastTime = now;
        const dt = Math.min(Math.max(rawDt, 0.001), 0.032);
        const subSteps = dt > 0.016 ? 2 : 1;
        const stepDt = dt / subSteps;

        let anyMoving = false;
        const k = this.stiffness;
        const c = this.damping;

        for (const body of this.bodies.values()) {
            if (body.dragging || body.settled) continue;

            for (let s = 0; s < subSteps; s++) {
                const dx = body.x - body.targetX;
                const dy = body.y - body.targetY;
                const ax = -k * dx - c * body.vx;
                const ay = -k * dy - c * body.vy;

                body.vx += ax * stepDt;
                body.vy += ay * stepDt;
                body.x += body.vx * stepDt;
                body.y += body.vy * stepDt;
            }

            const dist = Math.hypot(body.x - body.targetX, body.y - body.targetY);
            const speed = Math.hypot(body.vx, body.vy);

            if (dist < 0.0015 && speed < 0.015) {
                body.x = body.targetX;
                body.y = body.targetY;
                body.vx = 0;
                body.vy = 0;
                body.settled = true;
            } else {
                anyMoving = true;
            }

            this._applyTransform(body);
        }

        if (anyMoving) {
            this.rafId = requestAnimationFrame(this._tick);
        } else {
            this.rafId = null;
        }
    }

    /**
     * Writes GPU-composited transform in percentage of tile dimensions.
     * @param {object} body
     */
    _applyTransform(body) {
        const tx = (body.x + body.dragX) * 100;
        const ty = (body.y + body.dragY) * 100;
        body.el.style.transform = `translate3d(${tx.toFixed(3)}%, ${ty.toFixed(3)}%, 0)`;
    }
}
