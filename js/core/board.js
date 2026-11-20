/**
 * Pure mathematical and logical operations for the N×N sliding puzzle.
 * Zero DOM dependencies so it can be shared between UI, Web Workers, and Node tests.
 */

/**
 * Deterministic PRNG (Mulberry32) returning floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Creates a solved N×N board array with 0 representing the empty slot.
 * @param {number} size
 * @returns {number[]}
 */
export function createSolvedBoard(size) {
    const total = size * size;
    const board = new Array(total);
    for (let i = 0; i < total - 1; i++) {
        board[i] = i + 1;
    }
    board[total - 1] = 0;
    return board;
}

/**
 * Counts the number of inversions in the board (ignoring 0).
 * @param {number[]} board
 * @returns {number}
 */
export function countInversions(board) {
    let inversions = 0;
    const len = board.length;
    for (let i = 0; i < len; i++) {
        const a = board[i];
        if (a === 0) continue;
        for (let j = i + 1; j < len; j++) {
            const b = board[j];
            if (b !== 0 && a > b) {
                inversions++;
            }
        }
    }
    return inversions;
}

/**
 * Verifies the mathematical solvability invariant of the puzzle configuration.
 * @param {number[]} board
 * @param {number} size
 * @returns {boolean}
 */
export function isBoardSolvable(board, size) {
    if (!Array.isArray(board) || board.length !== size * size) return false;
    const inversions = countInversions(board);

    if (size % 2 === 1) {
        return inversions % 2 === 0;
    }

    const emptyIndex = board.indexOf(0);
    if (emptyIndex === -1) return false;
    const emptyRowFromTop = Math.floor(emptyIndex / size);
    const emptyRowFromBottom = size - emptyRowFromTop;

    if (emptyRowFromBottom % 2 === 1) {
        return inversions % 2 === 0;
    }
    return inversions % 2 === 1;
}

/**
 * Checks whether all tiles are in their target positions and 0 is at the end.
 * @param {number[]} board
 * @returns {boolean}
 */
export function isBoardSolved(board) {
    const total = board.length;
    for (let i = 0; i < total - 1; i++) {
        if (board[i] !== i + 1) return false;
    }
    return board[total - 1] === 0;
}

/**
 * Returns valid orthogonal neighbor indices for a given flat index.
 * @param {number} idx
 * @param {number} size
 * @returns {number[]}
 */
function getNeighborIndices(idx, size) {
    const r = Math.floor(idx / size);
    const c = idx % size;
    const neighbors = [];
    if (r > 0) neighbors.push((r - 1) * size + c);
    if (r < size - 1) neighbors.push((r + 1) * size + c);
    if (c > 0) neighbors.push(r * size + (c - 1));
    if (c < size - 1) neighbors.push(r * size + (c + 1));
    return neighbors;
}

/**
 * Generates a uniform, guaranteed-solvable, non-solved N×N board using Fisher-Yates
 * plus mathematical parity correction.
 * @param {number} size
 * @param {() => number} [rng=Math.random]
 * @returns {number[]}
 */
export function generateSolvableBoard(size, rng = Math.random) {
    const board = createSolvedBoard(size);

    for (let i = board.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = board[i];
        board[i] = board[j];
        board[j] = tmp;
    }

    if (!isBoardSolvable(board, size)) {
        const idx1 = board[0] !== 0 ? 0 : 1;
        const idx2 = board[idx1 + 1] !== 0 ? idx1 + 1 : idx1 + 2;
        const tmp = board[idx1];
        board[idx1] = board[idx2];
        board[idx2] = tmp;
    }

    if (isBoardSolved(board)) {
        let emptyIdx = board.indexOf(0);
        let lastEmptyIdx = -1;
        for (let step = 0; step < 2; step++) {
            const candidates = getNeighborIndices(emptyIdx, size).filter((n) => n !== lastEmptyIdx);
            const chosen = candidates[Math.floor(rng() * candidates.length)];
            board[emptyIdx] = board[chosen];
            board[chosen] = 0;
            lastEmptyIdx = emptyIdx;
            emptyIdx = chosen;
        }
    }

    if (!isBoardSolvable(board, size)) {
        throw new Error(`Invariant violation: generated unsolvable ${size}x${size} board.`);
    }

    return board;
}

/**
 * Determines if `tileNum` is aligned with the empty slot (0) and returns the contiguous
 * block of tiles that slide together toward the empty slot.
 * @param {number[]} board
 * @param {number} size
 * @param {number} tileNum
 * @returns {{ direction: 'UP'|'DOWN'|'LEFT'|'RIGHT', axis: 'x'|'y', sign: 1|-1, tiles: number[], tileIdx: number, emptyIdx: number, count: number } | null}
 */
export function getMovableLine(board, size, tileNum) {
    if (!tileNum || tileNum === 0) return null;
    const tileIdx = board.indexOf(tileNum);
    const emptyIdx = board.indexOf(0);
    if (tileIdx === -1 || emptyIdx === -1) return null;

    const tileRow = Math.floor(tileIdx / size);
    const tileCol = tileIdx % size;
    const emptyRow = Math.floor(emptyIdx / size);
    const emptyCol = emptyIdx % size;

    if (tileRow !== emptyRow && tileCol !== emptyCol) return null;

    const tiles = [];
    let direction;
    let axis;
    let sign;

    if (tileRow === emptyRow) {
        axis = 'x';
        sign = emptyCol > tileCol ? 1 : -1;
        direction = sign === 1 ? 'RIGHT' : 'LEFT';
        for (let c = emptyCol - sign; c !== tileCol - sign; c -= sign) {
            tiles.push(board[tileRow * size + c]);
        }
    } else {
        axis = 'y';
        sign = emptyRow > tileRow ? 1 : -1;
        direction = sign === 1 ? 'DOWN' : 'UP';
        for (let r = emptyRow - sign; r !== tileRow - sign; r -= sign) {
            tiles.push(board[r * size + tileCol]);
        }
    }

    return {
        direction,
        axis,
        sign,
        tiles,
        tileIdx,
        emptyIdx,
        count: tiles.length,
    };
}

/**
 * Executes a single or multi-tile slide on a copy of the board.
 * @param {number[]} board
 * @param {number} size
 * @param {number} tileNum
 * @param {'UP'|'DOWN'|'LEFT'|'RIGHT'|null} [requiredDir=null]
 * @returns {{ board: number[], movedTiles: number[], count: number, direction: 'UP'|'DOWN'|'LEFT'|'RIGHT', axis: 'x'|'y', sign: 1|-1, newlyCorrectTiles: number[] } | null}
 */
export function applySlide(board, size, tileNum, requiredDir = null) {
    const line = getMovableLine(board, size, tileNum);
    if (!line) return null;
    if (requiredDir && line.direction !== requiredDir) return null;

    const nextBoard = board.slice();
    const { tileIdx, emptyIdx, axis, sign } = line;

    if (axis === 'x') {
        const row = Math.floor(tileIdx / size);
        const tileCol = tileIdx % size;
        const emptyCol = emptyIdx % size;
        const step = -sign;
        for (let c = emptyCol; c !== tileCol; c += step) {
            nextBoard[row * size + c] = nextBoard[row * size + (c + step)];
        }
    } else {
        const col = tileIdx % size;
        const tileRow = Math.floor(tileIdx / size);
        const emptyRow = Math.floor(emptyIdx / size);
        const step = -sign;
        for (let r = emptyRow; r !== tileRow; r += step) {
            nextBoard[r * size + col] = nextBoard[(r + step) * size + col];
        }
    }
    nextBoard[tileIdx] = 0;

    const newlyCorrectTiles = [];
    for (let i = 0; i < line.tiles.length; i++) {
        const num = line.tiles[i];
        if (nextBoard[num - 1] === num) {
            newlyCorrectTiles.push(num);
        }
    }

    return {
        board: nextBoard,
        movedTiles: line.tiles,
        count: line.count,
        direction: line.direction,
        axis: line.axis,
        sign: line.sign,
        newlyCorrectTiles,
    };
}

/**
 * Maps an arrow key name to the adjacent tile number that slides into the empty slot.
 * @param {number[]} board
 * @param {number} size
 * @param {string} key
 * @returns {number | null}
 */
export function getTileForArrowKey(board, size, key) {
    const emptyIdx = board.indexOf(0);
    if (emptyIdx === -1) return null;

    const r = Math.floor(emptyIdx / size);
    const c = emptyIdx % size;

    let targetIdx = -1;
    if (key === 'ArrowUp' && r < size - 1) targetIdx = (r + 1) * size + c;
    else if (key === 'ArrowDown' && r > 0) targetIdx = (r - 1) * size + c;
    else if (key === 'ArrowLeft' && c < size - 1) targetIdx = r * size + (c + 1);
    else if (key === 'ArrowRight' && c > 0) targetIdx = r * size + (c - 1);

    return targetIdx !== -1 ? board[targetIdx] : null;
}

/**
 * Determines whether a tile has the red checkerboard accent in the classic 70s layout.
 * @param {number} num
 * @param {number} size
 * @returns {boolean}
 */
export function isCheckerboardAccent(num, size) {
    const targetIdx = num - 1;
    const targetRow = Math.floor(targetIdx / size);
    const targetCol = targetIdx % size;
    return (targetRow + targetCol) % 2 === 1;
}
