/**
 * Arcade / Roguelike modifiers:
 * - Fog of War: only tiles orthogonally adjacent to the empty space reveal their numbers.
 * - Frozen Tiles: 1 (3x3) or 2 (4x4/5x5) connectivity-verified tiles stay locked for the first 10 moves.
 * - Memory (Blind) Mode: 15s memorization phase before numbers vanish, with penalized Peek (+5s).
 */

/**
 * Returns the set of tile values orthogonally adjacent to the empty slot (0).
 * @param {number[]} board
 * @param {number} size
 * @returns {Set<number>}
 */
export function getFogVisibleTiles(board, size) {
    const visible = new Set();
    const emptyIdx = board.indexOf(0);
    if (emptyIdx === -1) return visible;

    const r = Math.floor(emptyIdx / size);
    const c = emptyIdx % size;

    if (r > 0) visible.add(board[(r - 1) * size + c]);
    if (r < size - 1) visible.add(board[(r + 1) * size + c]);
    if (c > 0) visible.add(board[r * size + (c - 1)]);
    if (c < size - 1) visible.add(board[r * size + (c + 1)]);

    return visible;
}

/**
 * Verifies via BFS that all non-frozen cells form a single connected component
 * so frozen tiles can never mathematically deadlock the puzzle.
 * @param {number} size
 * @param {Set<number>} frozenIndicesSet
 * @returns {boolean}
 */
export function areNonFrozenCellsConnected(size, frozenIndicesSet) {
    const total = size * size;
    const expected = total - frozenIndicesSet.size;
    if (expected <= 0) return false;

    let start = -1;
    for (let i = 0; i < total; i++) {
        if (!frozenIndicesSet.has(i)) {
            start = i;
            break;
        }
    }
    if (start === -1) return false;

    const visited = new Uint8Array(total);
    const queue = [start];
    visited[start] = 1;
    let count = 0;

    while (queue.length > 0) {
        const idx = queue.shift();
        count++;
        const r = Math.floor(idx / size);
        const c = idx % size;
        const neighbors = [];
        if (r > 0) neighbors.push((r - 1) * size + c);
        if (r < size - 1) neighbors.push((r + 1) * size + c);
        if (c > 0) neighbors.push(r * size + (c - 1));
        if (c < size - 1) neighbors.push(r * size + (c + 1));

        for (let i = 0; i < neighbors.length; i++) {
            const n = neighbors[i];
            if (!frozenIndicesSet.has(n) && !visited[n]) {
                visited[n] = 1;
                queue.push(n);
            }
        }
    }

    return count === expected;
}

function manhattanIdx(idxA, idxB, size) {
    return Math.abs(Math.floor(idxA / size) - Math.floor(idxB / size))
        + Math.abs((idxA % size) - (idxB % size));
}

/**
 * Picks 1 (on 3x3) or 2 (on 4x4/5x5) random non-zero tiles at distance >= 2 from
 * the initial empty slot whose non-frozen remainder is guaranteed connected.
 * @param {number[]} board
 * @param {number} size
 * @param {() => number} [rng=Math.random]
 * @returns {Set<number>}
 */
export function pickFrozenTiles(board, size, rng = Math.random) {
    const emptyIdx = board.indexOf(0);
    const candidates = [];

    for (let idx = 0; idx < board.length; idx++) {
        if (board[idx] === 0) continue;
        if (manhattanIdx(idx, emptyIdx, size) >= 2) {
            candidates.push(idx);
        }
    }

    // Shuffle candidate indices via Fisher-Yates
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = candidates[i];
        candidates[i] = candidates[j];
        candidates[j] = tmp;
    }

    const targetCount = size === 3 ? 1 : 2;
    if (targetCount === 2 && candidates.length >= 2) {
        for (let i = 0; i < candidates.length; i++) {
            for (let j = i + 1; j < candidates.length; j++) {
                const a = candidates[i];
                const b = candidates[j];
                if (manhattanIdx(a, b, size) < 3) continue;
                const set = new Set([a, b]);
                if (areNonFrozenCellsConnected(size, set)) {
                    return new Set([board[a], board[b]]);
                }
            }
        }
    }

    // Safe single-tile fallback (guaranteed connected)
    for (let i = 0; i < candidates.length; i++) {
        const idx = candidates[i];
        if (areNonFrozenCellsConnected(size, new Set([idx]))) {
            return new Set([board[idx]]);
        }
    }

    return new Set();
}

/**
 * Checks whether any tile in a sliding line is currently frozen.
 * @param {number[]} movedTiles
 * @param {Set<number>} frozenSet
 * @param {number} iceMovesLeft
 * @returns {boolean}
 */
export function isLineBlockedByIce(movedTiles, frozenSet, iceMovesLeft) {
    if (iceMovesLeft <= 0 || !frozenSet || frozenSet.size === 0) return false;
    for (let i = 0; i < movedTiles.length; i++) {
        if (frozenSet.has(movedTiles[i])) return true;
    }
    return false;
}

export class ArcadeController {
    /**
     * @param {object} [options]
     * @param {(sec: number) => void} [options.onMemoryTick]
     * @param {(phase: string) => void} [options.onMemoryPhaseChange]
     */
    constructor({ onMemoryTick = null, onMemoryPhaseChange = null } = {}) {
        this.onMemoryTick = onMemoryTick;
        this.onMemoryPhaseChange = onMemoryPhaseChange;

        this.modifiers = {
            fog: false,
            ice: false,
            memory: false,
        };

        /** @type {Set<number>} */
        this.frozenTiles = new Set();
        this.iceMovesLeft = 0;

        /** @type {'idle'|'memorize'|'blind'|'peeking'} */
        this.memoryPhase = 'idle';
        this.memoryRemainingSec = 15;
        this.memoryPenaltyMs = 0;
        this.memoryPeeks = 0;

        this._memorizeStartPerf = 0;
        this._memorizeInterval = null;
        this._peekTimeout = null;
    }

    setModifier(name, enabled) {
        if (name in this.modifiers) {
            this.modifiers[name] = Boolean(enabled);
        }
    }

    hasAnyModifier() {
        return this.modifiers.fog || this.modifiers.ice || this.modifiers.memory;
    }

    /**
     * Initializes Arcade modifier states for a freshly started board.
     * @param {number[]} board
     * @param {number} size
     */
    startRun(board, size) {
        this.reset();

        if (this.modifiers.ice) {
            this.frozenTiles = pickFrozenTiles(board, size);
            this.iceMovesLeft = this.frozenTiles.size > 0 ? 10 : 0;
        }

        if (this.modifiers.memory) {
            this._startMemorizeCountdown();
        }
    }

    /**
     * Returns true if a sliding block is blocked by frozen tiles.
     * @param {number[]} movedTiles
     * @returns {boolean}
     */
    isBlocked(movedTiles) {
        return isLineBlockedByIce(movedTiles, this.frozenTiles, this.iceMovesLeft);
    }

    /**
     * Updates Arcade counters after a legal tile move.
     * @returns {{ thawed: boolean, becameBlind: boolean }}
     */
    onValidMove() {
        let thawed = false;
        let becameBlind = false;

        if (this.modifiers.memory && this.memoryPhase === 'memorize') {
            this.forceStartBlind();
            becameBlind = true;
        }

        if (this.iceMovesLeft > 0) {
            this.iceMovesLeft--;
            if (this.iceMovesLeft === 0) {
                this.frozenTiles.clear();
                thawed = true;
            }
        }

        return { thawed, becameBlind };
    }

    /**
     * Immediately ends the 15s observation phase and enters blind solving.
     */
    forceStartBlind() {
        clearInterval(this._memorizeInterval);
        this._memorizeInterval = null;
        if (this.memoryPhase !== 'blind') {
            this.memoryPhase = 'blind';
            this.memoryRemainingSec = 0;
            this.onMemoryPhaseChange?.('blind');
        }
    }

    /**
     * Temporarily reveals numbers in Memory mode at a +5s time penalty.
     * @param {number} [durationMs=2500]
     * @param {number} [penaltyMs=5000]
     * @returns {boolean}
     */
    triggerPeek(durationMs = 2500, penaltyMs = 5000) {
        if (!this.modifiers.memory || this.memoryPhase !== 'blind') return false;

        this.memoryPenaltyMs += penaltyMs;
        this.memoryPeeks++;
        this.memoryPhase = 'peeking';
        this.onMemoryPhaseChange?.('peeking');

        clearTimeout(this._peekTimeout);
        this._peekTimeout = setTimeout(() => {
            if (this.memoryPhase === 'peeking') {
                this.memoryPhase = 'blind';
                this.onMemoryPhaseChange?.('blind');
            }
        }, durationMs);

        return true;
    }

    /**
     * Reveals all numbers and clears active ice on solve completion.
     */
    revealAllOnVictory() {
        clearInterval(this._memorizeInterval);
        clearTimeout(this._peekTimeout);
        this._memorizeInterval = null;
        this._peekTimeout = null;
        this.memoryPhase = 'idle';
        this.iceMovesLeft = 0;
        this.frozenTiles.clear();
    }

    reset() {
        clearInterval(this._memorizeInterval);
        clearTimeout(this._peekTimeout);
        this._memorizeInterval = null;
        this._peekTimeout = null;
        this.frozenTiles.clear();
        this.iceMovesLeft = 0;
        this.memoryPhase = 'idle';
        this.memoryRemainingSec = 15;
        this.memoryPenaltyMs = 0;
        this.memoryPeeks = 0;
    }

    /**
     * Computes visual flags consumed by BoardRenderer.applyArcadeState().
     * @param {number[]} board
     * @param {number} size
     */
    getSnapshot(board, size) {
        const fogActive = this.modifiers.fog;
        return {
            fogActive,
            fogVisibleTiles: fogActive ? getFogVisibleTiles(board, size) : null,
            frozenTiles: this.iceMovesLeft > 0 ? this.frozenTiles : null,
            iceMovesLeft: this.iceMovesLeft,
            memoryBlind: this.modifiers.memory && this.memoryPhase === 'blind',
            memoryPeeking: this.modifiers.memory && this.memoryPhase === 'peeking',
        };
    }

    _startMemorizeCountdown() {
        this.memoryPhase = 'memorize';
        this.memoryRemainingSec = 15;
        this._memorizeStartPerf = performance.now();
        this.onMemoryPhaseChange?.('memorize');
        this.onMemoryTick?.(15);

        this._memorizeInterval = setInterval(() => {
            const elapsed = (performance.now() - this._memorizeStartPerf) / 1000;
            const rem = Math.max(0, 15 - elapsed);
            this.memoryRemainingSec = rem;
            this.onMemoryTick?.(rem);
            if (rem <= 0) {
                this.forceStartBlind();
            }
        }, 100);
    }
}
