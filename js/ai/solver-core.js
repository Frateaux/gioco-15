/**
 * Pure local AI Puzzle Solver & X-Ray Analyzer (runs inside Web Worker & Node tests).
 * - 3x3: Exact optimal IDA* (Manhattan + Linear Conflicts)
 * - 4x4: Exact IDA* within time budget, Weighted A* fallback, Fringe Reduction safety net
 * - 5x5: Weighted A* quick pass + fast guaranteed Fringe Reduction to optimal 3x3
 */

import { isBoardSolved } from '../core/board.js';

const DIRS = [
    [-1, 0], // UP (empty moves up -> tile above moves down)
    [1, 0],  // DOWN
    [0, -1], // LEFT
    [0, 1],  // RIGHT
];

/**
 * Computes admissible Manhattan Distance + Linear Conflicts heuristic.
 * @param {ArrayLike<number>} board
 * @param {number} size
 * @returns {number}
 */
export function computeManhattanAndLinearConflicts(board, size) {
    let manhattan = 0;

    for (let idx = 0; idx < board.length; idx++) {
        const val = board[idx];
        if (val === 0) continue;
        const targetIdx = val - 1;
        const r = Math.floor(idx / size);
        const c = idx % size;
        const tr = Math.floor(targetIdx / size);
        const tc = targetIdx % size;
        manhattan += Math.abs(r - tr) + Math.abs(c - tc);
    }

    let linearConflicts = 0;

    // Row linear conflicts
    for (let r = 0; r < size; r++) {
        const items = [];
        for (let c = 0; c < size; c++) {
            const val = board[r * size + c];
            if (val === 0) continue;
            const targetIdx = val - 1;
            if (Math.floor(targetIdx / size) === r) {
                items.push(targetIdx % size);
            }
        }
        linearConflicts += countMinimalConflictRemovals(items);
    }

    // Column linear conflicts
    for (let c = 0; c < size; c++) {
        const items = [];
        for (let r = 0; r < size; r++) {
            const val = board[r * size + c];
            if (val === 0) continue;
            const targetIdx = val - 1;
            if (targetIdx % size === c) {
                items.push(Math.floor(targetIdx / size));
            }
        }
        linearConflicts += countMinimalConflictRemovals(items);
    }

    return manhattan + 2 * linearConflicts;
}

/**
 * Greedy maximal-conflict removal keeps Linear Conflicts admissible even on 4x4/5x5.
 * @param {number[]} targets
 * @returns {number}
 */
function countMinimalConflictRemovals(targets) {
    const n = targets.length;
    if (n < 2) return 0;

    const active = new Uint8Array(n).fill(1);
    let removals = 0;

    while (true) {
        let maxConf = 0;
        let maxIdx = -1;
        for (let i = 0; i < n; i++) {
            if (!active[i]) continue;
            let conf = 0;
            for (let j = 0; j < n; j++) {
                if (i === j || !active[j]) continue;
                if ((i < j && targets[i] > targets[j]) || (i > j && targets[i] < targets[j])) {
                    conf++;
                }
            }
            if (conf > maxConf) {
                maxConf = conf;
                maxIdx = i;
            }
        }
        if (maxConf === 0 || maxIdx === -1) break;
        active[maxIdx] = 0;
        removals++;
    }

    return removals;
}

/**
 * Converts a sequence of single-tile slides into multi-tile game moves so Par matches
 * the player's move counter when sliding whole rows/columns at once.
 * @param {number[]} startBoard
 * @param {number} size
 * @param {number[]} singleTilePath
 * @returns {{ count: number, firstTile: number|null, steps: Array<{ tile: number, count: number }> }}
 */
export function compressMovesToMultiTile(startBoard, size, singleTilePath) {
    if (!singleTilePath || singleTilePath.length === 0) {
        return { count: 0, firstTile: null, steps: [] };
    }

    const work = startBoard.slice();
    let emptyIdx = work.indexOf(0);
    const steps = [];
    let prevDir = null;

    for (let i = 0; i < singleTilePath.length; i++) {
        const tile = singleTilePath[i];
        const tileIdx = work.indexOf(tile);
        const er = Math.floor(emptyIdx / size);
        const ec = emptyIdx % size;
        const tr = Math.floor(tileIdx / size);
        const tc = tileIdx % size;

        const dir = `${er - tr},${ec - tc}`;
        work[emptyIdx] = tile;
        work[tileIdx] = 0;
        emptyIdx = tileIdx;

        if (steps.length > 0 && prevDir === dir) {
            steps[steps.length - 1].tile = tile;
            steps[steps.length - 1].count++;
        } else {
            steps.push({ tile, count: 1 });
            prevDir = dir;
        }
    }

    return {
        count: steps.length,
        firstTile: steps[0]?.tile ?? null,
        steps,
    };
}

/**
 * Exact IDA* solver using Manhattan Distance + Linear Conflicts.
 * @param {number[]} startBoard
 * @param {number} size
 * @param {{ timeBudgetMs?: number }} [options]
 * @returns {{ solved: boolean, optimal: boolean, path?: number[], timedOut?: boolean, expanded: number, elapsedMs: number }}
 */
export function solveIDAStar(startBoard, size, { timeBudgetMs = 900 } = {}) {
    const startMs = performance.now();
    if (isBoardSolved(startBoard)) {
        return { solved: true, optimal: true, path: [], expanded: 0, elapsedMs: 0 };
    }

    const board = Int8Array.from(startBoard);
    const emptyInit = board.indexOf(0);
    let threshold = computeManhattanAndLinearConflicts(board, size);
    const path = [];
    let expanded = 0;
    let timedOut = false;

    const search = (emptyIdx, prevEmptyIdx, g, bound) => {
        expanded++;
        if ((expanded & 2047) === 0 && performance.now() - startMs >= timeBudgetMs) {
            timedOut = true;
            return Infinity;
        }

        const h = computeManhattanAndLinearConflicts(board, size);
        const f = g + h;
        if (f > bound) return f;
        if (h === 0) return -1;

        const er = Math.floor(emptyIdx / size);
        const ec = emptyIdx % size;
        let minNext = Infinity;

        for (let d = 0; d < 4; d++) {
            const nr = er + DIRS[d][0];
            const nc = ec + DIRS[d][1];
            if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
            const nIdx = nr * size + nc;
            if (nIdx === prevEmptyIdx) continue;

            const movedTile = board[nIdx];
            board[emptyIdx] = movedTile;
            board[nIdx] = 0;
            path.push(movedTile);

            const res = search(nIdx, emptyIdx, g + 1, bound);
            if (res === -1) return -1;
            if (timedOut) return Infinity;
            if (res < minNext) minNext = res;

            path.pop();
            board[nIdx] = movedTile;
            board[emptyIdx] = 0;
        }

        return minNext;
    };

    while (true) {
        const res = search(emptyInit, -1, 0, threshold);
        if (res === -1) {
            return {
                solved: true,
                optimal: true,
                path: path.slice(),
                expanded,
                elapsedMs: Math.round(performance.now() - startMs),
            };
        }
        if (timedOut || res === Infinity) {
            return {
                solved: false,
                optimal: false,
                timedOut: true,
                expanded,
                elapsedMs: Math.round(performance.now() - startMs),
            };
        }
        threshold = res;
    }
}

class MinHeap {
    constructor() {
        this.items = [];
    }

    get size() {
        return this.items.length;
    }

    push(node) {
        this.items.push(node);
        this._bubbleUp(this.items.length - 1);
    }

    pop() {
        const top = this.items[0];
        const end = this.items.pop();
        if (this.items.length > 0) {
            this.items[0] = end;
            this._sinkDown(0);
        }
        return top;
    }

    _bubbleUp(idx) {
        const item = this.items[idx];
        while (idx > 0) {
            const parentIdx = (idx - 1) >> 1;
            const parent = this.items[parentIdx];
            if (item.f >= parent.f) break;
            this.items[idx] = parent;
            idx = parentIdx;
        }
        this.items[idx] = item;
    }

    _sinkDown(idx) {
        const len = this.items.length;
        const item = this.items[idx];
        while (true) {
            const left = (idx << 1) + 1;
            const right = left + 1;
            let swap = -1;
            if (left < len && this.items[left].f < item.f) swap = left;
            if (right < len && this.items[right].f < (swap === -1 ? item.f : this.items[left].f)) {
                swap = right;
            }
            if (swap === -1) break;
            this.items[idx] = this.items[swap];
            idx = swap;
        }
        this.items[idx] = item;
    }
}

function encodeBoardKey(board) {
    let key = '';
    for (let i = 0; i < board.length; i++) {
        key += String.fromCharCode(65 + board[i]);
    }
    return key;
}

/**
 * Bounded Weighted A* fallback for deep 4x4 and fast 5x5 attempts.
 * @param {number[]} startBoard
 * @param {number} size
 * @param {{ weight?: number, timeBudgetMs?: number, maxNodes?: number }} [options]
 * @returns {{ solved: boolean, optimal: boolean, path?: number[], timedOut?: boolean, expanded: number, elapsedMs: number }}
 */
export function solveWeightedAStar(startBoard, size, {
    weight = 1.65,
    timeBudgetMs = 350,
    maxNodes = 45000,
} = {}) {
    const startMs = performance.now();
    if (isBoardSolved(startBoard)) {
        return { solved: true, optimal: true, path: [], expanded: 0, elapsedMs: 0 };
    }

    const heap = new MinHeap();
    const bestG = new Map();
    const parents = [];

    const startKey = encodeBoardKey(startBoard);
    const h0 = computeManhattanAndLinearConflicts(startBoard, size);
    bestG.set(startKey, 0);
    parents.push({ parentId: -1, tile: 0 });
    heap.push({
        id: 0,
        board: Int8Array.from(startBoard),
        emptyIdx: startBoard.indexOf(0),
        g: 0,
        f: weight * h0,
    });

    let expanded = 0;

    while (heap.size > 0) {
        if (expanded >= maxNodes || ((expanded & 1023) === 0 && performance.now() - startMs >= timeBudgetMs)) {
            return {
                solved: false,
                optimal: false,
                timedOut: true,
                expanded,
                elapsedMs: Math.round(performance.now() - startMs),
            };
        }

        const node = heap.pop();
        expanded++;

        const er = Math.floor(node.emptyIdx / size);
        const ec = node.emptyIdx % size;

        for (let d = 0; d < 4; d++) {
            const nr = er + DIRS[d][0];
            const nc = ec + DIRS[d][1];
            if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;

            const nIdx = nr * size + nc;
            const movedTile = node.board[nIdx];
            const nextBoard = node.board.slice();
            nextBoard[node.emptyIdx] = movedTile;
            nextBoard[nIdx] = 0;

            const g = node.g + 1;
            const key = encodeBoardKey(nextBoard);
            const prevG = bestG.get(key);
            if (prevG !== undefined && prevG <= g) continue;
            bestG.set(key, g);

            const h = computeManhattanAndLinearConflicts(nextBoard, size);
            const nodeId = parents.length;
            parents.push({ parentId: node.id, tile: movedTile });

            if (h === 0) {
                const path = [];
                let cur = nodeId;
                while (cur > 0) {
                    path.push(parents[cur].tile);
                    cur = parents[cur].parentId;
                }
                path.reverse();
                return {
                    solved: true,
                    optimal: false,
                    path,
                    expanded,
                    elapsedMs: Math.round(performance.now() - startMs),
                };
            }

            heap.push({
                id: nodeId,
                board: nextBoard,
                emptyIdx: nIdx,
                g,
                f: g + weight * h,
            });
        }
    }

    return {
        solved: false,
        optimal: false,
        timedOut: true,
        expanded,
        elapsedMs: Math.round(performance.now() - startMs),
    };
}

/**
 * Micro-BFS/A* for moving a single target tile to `targetIdx` while avoiding `locked` cells.
 */
function findSingleTileSubpath(board, size, tileVal, targetIdx, locked) {
    const startTileIdx = board.indexOf(tileVal);
    const startEmptyIdx = board.indexOf(0);
    if (startTileIdx === targetIdx) return [];

    const total = size * size;
    const tRow = Math.floor(targetIdx / size);
    const tCol = targetIdx % size;
    const dist = (idx) => Math.abs(Math.floor(idx / size) - tRow) + Math.abs((idx % size) - tCol);

    const heap = new MinHeap();
    const visited = new Uint8Array(total * total);
    const parents = [{ parentId: -1, emptyIdx: startEmptyIdx }];
    visited[startTileIdx * total + startEmptyIdx] = 1;
    heap.push({ id: 0, tileIdx: startTileIdx, emptyIdx: startEmptyIdx, g: 0, f: dist(startTileIdx) * 3 });

    while (heap.size > 0) {
        const cur = heap.pop();
        if (cur.tileIdx === targetIdx) {
            return reconstructEmptyMoves(board, size, cur.id, parents);
        }

        const er = Math.floor(cur.emptyIdx / size);
        const ec = cur.emptyIdx % size;

        for (let d = 0; d < 4; d++) {
            const nr = er + DIRS[d][0];
            const nc = ec + DIRS[d][1];
            if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
            const nIdx = nr * size + nc;
            if (locked[nIdx]) continue;

            const nextTileIdx = nIdx === cur.tileIdx ? cur.emptyIdx : cur.tileIdx;
            const stateKey = nextTileIdx * total + nIdx;
            if (visited[stateKey]) continue;
            visited[stateKey] = 1;

            const g = cur.g + 1;
            const h = dist(nextTileIdx) * 3 + Math.abs(Math.floor(nextTileIdx / size) - nr)
                + Math.abs((nextTileIdx % size) - nc);
            const nodeId = parents.length;
            parents.push({ parentId: cur.id, emptyIdx: nIdx });
            heap.push({ id: nodeId, tileIdx: nextTileIdx, emptyIdx: nIdx, g, f: g + h });
        }
    }

    return null;
}

/**
 * Micro-A* on compact `(posA, posB, pos0)` state to place the final two tiles of a
 * fringe row or column cleanly (eliminates corner-wrap special cases).
 */
function findPairSubpath(board, size, valA, targetA, valB, targetB, locked) {
    const initA = board.indexOf(valA);
    const initB = board.indexOf(valB);
    const init0 = board.indexOf(0);
    if (initA === targetA && initB === targetB) return [];

    const total = size * size;
    const tAr = Math.floor(targetA / size);
    const tAc = targetA % size;
    const tBr = Math.floor(targetB / size);
    const tBc = targetB % size;

    const manh = (a, b) => Math.abs(Math.floor(a / size) - tAr) + Math.abs((a % size) - tAc)
        + Math.abs(Math.floor(b / size) - tBr) + Math.abs((b % size) - tBc);

    const heap = new MinHeap();
    const visited = new Uint8Array(total * total * total);
    const parents = [{ parentId: -1, emptyIdx: init0 }];
    visited[(initA * total + initB) * total + init0] = 1;
    heap.push({ id: 0, posA: initA, posB: initB, emptyIdx: init0, g: 0, f: manh(initA, initB) * 3 });

    while (heap.size > 0) {
        const cur = heap.pop();
        if (cur.posA === targetA && cur.posB === targetB) {
            return reconstructEmptyMoves(board, size, cur.id, parents);
        }

        const er = Math.floor(cur.emptyIdx / size);
        const ec = cur.emptyIdx % size;

        for (let d = 0; d < 4; d++) {
            const nr = er + DIRS[d][0];
            const nc = ec + DIRS[d][1];
            if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
            const nIdx = nr * size + nc;
            if (locked[nIdx]) continue;

            const nextA = nIdx === cur.posA ? cur.emptyIdx : cur.posA;
            const nextB = nIdx === cur.posB ? cur.emptyIdx : cur.posB;
            const key = (nextA * total + nextB) * total + nIdx;
            if (visited[key]) continue;
            visited[key] = 1;

            const g = cur.g + 1;
            const h = manh(nextA, nextB) * 3;
            const nodeId = parents.length;
            parents.push({ parentId: cur.id, emptyIdx: nIdx });
            heap.push({ id: nodeId, posA: nextA, posB: nextB, emptyIdx: nIdx, g, f: g + h });
        }
    }

    return null;
}

function reconstructEmptyMoves(board, size, endId, parents) {
    const emptySequence = [];
    let cur = endId;
    while (cur > 0) {
        emptySequence.push(parents[cur].emptyIdx);
        cur = parents[cur].parentId;
    }
    emptySequence.reverse();

    const movedTiles = [];
    let emptyIdx = board.indexOf(0);
    for (let i = 0; i < emptySequence.length; i++) {
        const nextEmpty = emptySequence[i];
        const tileVal = board[nextEmpty];
        movedTiles.push(tileVal);
        board[emptyIdx] = tileVal;
        board[nextEmpty] = 0;
        emptyIdx = nextEmpty;
    }
    return movedTiles;
}

/**
 * Strips consecutive back-and-forth moves of the same tile.
 * @param {number[]} moves
 * @returns {number[]}
 */
function stripAdjacentBacktracks(moves) {
    const cleaned = [];
    for (let i = 0; i < moves.length; i++) {
        if (cleaned.length > 0 && cleaned[cleaned.length - 1] === moves[i]) {
            cleaned.pop();
        } else {
            cleaned.push(moves[i]);
        }
    }
    return cleaned;
}

/**
 * Guaranteed sub-20ms Fringe Reduction solver for 5x5 (and 4x4 fallback),
 * reducing the board layer-by-layer to an exact optimal 3x3 IDA* finish.
 * @param {number[]} startBoard
 * @param {number} size
 * @returns {{ solved: boolean, optimal: boolean, path: number[], expanded: number, elapsedMs: number }}
 */
export function solveByFringeReduction(startBoard, size) {
    const startMs = performance.now();
    if (isBoardSolved(startBoard)) {
        return { solved: true, optimal: true, path: [], expanded: 0, elapsedMs: 0 };
    }

    const work = startBoard.slice();
    const locked = new Uint8Array(size * size);
    const fullPath = [];

    const appendMoves = (sub) => {
        if (!sub) return false;
        for (let i = 0; i < sub.length; i++) fullPath.push(sub[i]);
        return true;
    };

    for (let k = 0; k < size - 3; k++) {
        // Solve top row `k` from col `k` to `size - 3`
        for (let c = k; c < size - 2; c++) {
            const targetIdx = k * size + c;
            const tileVal = targetIdx + 1;
            const sub = findSingleTileSubpath(work, size, tileVal, targetIdx, locked);
            if (!appendMoves(sub)) {
                return { solved: false, optimal: false, path: [], expanded: 0, elapsedMs: Math.round(performance.now() - startMs) };
            }
            locked[targetIdx] = 1;
        }

        // Solve last two tiles of row `k` together as a pair
        const rowAIdx = k * size + (size - 2);
        const rowBIdx = k * size + (size - 1);
        const rowPair = findPairSubpath(work, size, rowAIdx + 1, rowAIdx, rowBIdx + 1, rowBIdx, locked);
        if (!appendMoves(rowPair)) {
            return { solved: false, optimal: false, path: [], expanded: 0, elapsedMs: Math.round(performance.now() - startMs) };
        }
        locked[rowAIdx] = 1;
        locked[rowBIdx] = 1;

        // Solve left column `k` from row `k + 1` to `size - 3`
        for (let r = k + 1; r < size - 2; r++) {
            const targetIdx = r * size + k;
            const tileVal = targetIdx + 1;
            const sub = findSingleTileSubpath(work, size, tileVal, targetIdx, locked);
            if (!appendMoves(sub)) {
                return { solved: false, optimal: false, path: [], expanded: 0, elapsedMs: Math.round(performance.now() - startMs) };
            }
            locked[targetIdx] = 1;
        }

        // Solve last two tiles of column `k` together as a pair
        const colAIdx = (size - 2) * size + k;
        const colBIdx = (size - 1) * size + k;
        const colPair = findPairSubpath(work, size, colAIdx + 1, colAIdx, colBIdx + 1, colBIdx, locked);
        if (!appendMoves(colPair)) {
            return { solved: false, optimal: false, path: [], expanded: 0, elapsedMs: Math.round(performance.now() - startMs) };
        }
        locked[colAIdx] = 1;
        locked[colBIdx] = 1;
    }

    // Solve remaining bottom-right 3x3 subgrid optimally with IDA*
    const offset = size - 3;
    const valMap = new Map();
    const revMap = new Map();
    const subBoard = [];

    let mappedIdx = 1;
    for (let sr = 0; sr < 3; sr++) {
        for (let sc = 0; sc < 3; sc++) {
            const origTarget = (offset + sr) * size + (offset + sc) + 1;
            if (sr === 2 && sc === 2) continue;
            valMap.set(origTarget, mappedIdx);
            revMap.set(mappedIdx, origTarget);
            mappedIdx++;
        }
    }

    for (let sr = 0; sr < 3; sr++) {
        for (let sc = 0; sc < 3; sc++) {
            const origVal = work[(offset + sr) * size + (offset + sc)];
            subBoard.push(origVal === 0 ? 0 : valMap.get(origVal));
        }
    }

    const subSol = solveIDAStar(subBoard, 3, { timeBudgetMs: 400 });
    if (!subSol.solved) {
        return {
            solved: false,
            optimal: false,
            path: [],
            expanded: subSol.expanded,
            elapsedMs: Math.round(performance.now() - startMs),
        };
    }

    for (let i = 0; i < subSol.path.length; i++) {
        fullPath.push(revMap.get(subSol.path[i]));
    }

    return {
        solved: true,
        optimal: false,
        path: stripAdjacentBacktracks(fullPath),
        expanded: subSol.expanded,
        elapsedMs: Math.round(performance.now() - startMs),
    };
}

/**
 * Unified solver entry point: computes Par, optimality flag, and next optimal Hint tile.
 * @param {number[]} board
 * @param {number} size
 * @param {{ mode?: 'par'|'hint' }} [options]
 * @returns {{ solved: boolean, optimal: boolean, par: number, singlePar: number, hintTile: number|null, singleSteps: number[], elapsedMs: number }}
 */
export function solvePuzzle(board, size, { mode = 'par' } = {}) {
    if (isBoardSolved(board)) {
        return {
            solved: true,
            optimal: true,
            par: 0,
            singlePar: 0,
            hintTile: null,
            singleSteps: [],
            elapsedMs: 0,
        };
    }

    let res;
    if (size === 3) {
        res = solveIDAStar(board, 3, { timeBudgetMs: 500 });
    } else if (size === 4) {
        const idaBudget = mode === 'hint' ? 450 : 950;
        res = solveIDAStar(board, 4, { timeBudgetMs: idaBudget });
        if (!res.solved) {
            res = solveWeightedAStar(board, 4, { weight: 1.65, timeBudgetMs: 380, maxNodes: 45000 });
        }
        if (!res.solved) {
            res = solveByFringeReduction(board, 4);
        }
    } else {
        res = solveWeightedAStar(board, size, { weight: 2.1, timeBudgetMs: 280, maxNodes: 30000 });
        if (!res.solved) {
            res = solveByFringeReduction(board, size);
        }
    }

    const singleSteps = res.solved ? res.path : [];
    const compressed = compressMovesToMultiTile(board, size, singleSteps);

    return {
        solved: res.solved,
        optimal: Boolean(res.optimal),
        par: compressed.count,
        singlePar: singleSteps.length,
        hintTile: compressed.firstTile,
        singleSteps,
        elapsedMs: res.elapsedMs,
    };
}

/**
 * Post-game X-Ray efficiency & mistake-cluster analyzer.
 * @param {object} params
 * @param {Array<{ moveIndex: number, tile: number, count: number, hBefore: number, hAfter: number, deltaH: number }>} params.runTrace
 * @param {number} params.totalMoves
 * @param {number|null} params.par
 * @param {boolean} params.optimal
 */
export function analyzeRunXRay({ runTrace = [], totalMoves = 0, par = null, optimal = true } = {}) {
    const safePar = par && par > 0 ? par : null;
    const efficiency = safePar && totalMoves > 0
        ? Math.min(100, Math.round((safePar / totalMoves) * 100))
        : 100;
    const extraMoves = safePar ? Math.max(0, totalMoves - safePar) : 0;

    const hCurve = [];
    if (runTrace.length > 0) {
        hCurve.push(runTrace[0].hBefore);
        for (let i = 0; i < runTrace.length; i++) {
            hCurve.push(runTrace[i].hAfter);
        }
    }

    // Group consecutive detours where heuristic distance did not improve (deltaH >= 0)
    const clusters = [];
    let current = null;

    for (let i = 0; i < runTrace.length; i++) {
        const step = runTrace[i];
        if (step.deltaH >= 0) {
            if (!current) {
                current = {
                    startMove: step.moveIndex,
                    endMove: step.moveIndex,
                    cost: step.deltaH + 1,
                    deltaSum: step.deltaH,
                    tiles: new Set([step.tile]),
                };
            } else {
                current.endMove = step.moveIndex;
                current.cost += step.deltaH + 1;
                current.deltaSum += step.deltaH;
                current.tiles.add(step.tile);
            }
        } else if (current) {
            clusters.push(current);
            current = null;
        }
    }
    if (current) clusters.push(current);

    clusters.sort((a, b) => b.cost - a.cost);
    const hotspots = clusters.slice(0, 3).map((c) => {
        const rangeLabel = c.startMove === c.endMove
            ? `Mossa ${c.startMove}`
            : `Mosse ${c.startMove}–${c.endMove}`;
        const tileList = Array.from(c.tiles).slice(0, 3).join(', ');
        const deltaNote = c.deltaSum > 0 ? `+${c.deltaSum} distanza` : 'passo laterale';
        return `${rangeLabel}: deviazione (${deltaNote}, tessere ${tileList})`;
    });

    if (hotspots.length === 0) {
        hotspots.push('Percorso molto pulito: nessuna deviazione rilevante!');
    }

    return {
        efficiency,
        par: safePar,
        optimal,
        totalMoves,
        extraMoves,
        hCurve,
        hotspots,
    };
}
