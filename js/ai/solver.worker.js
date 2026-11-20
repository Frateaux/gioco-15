/**
 * Dedicated ES Module Web Worker for IDA*, Weighted A*, Fringe Reduction,
 * and post-game X-Ray analysis without ever blocking the 60fps UI thread.
 */

import { analyzeRunXRay, solvePuzzle } from './solver-core.js';

self.onmessage = (event) => {
    const { id, type, payload } = event.data || {};
    try {
        let result = null;
        if (type === 'solvePar') {
            result = solvePuzzle(payload.board, payload.size, { mode: 'par' });
        } else if (type === 'getHint') {
            result = solvePuzzle(payload.board, payload.size, { mode: 'hint' });
        } else if (type === 'analyzeXRay') {
            result = analyzeRunXRay(payload);
        } else {
            throw new Error(`Unknown worker message type: ${type}`);
        }

        self.postMessage({ id, type, ok: true, result });
    } catch (err) {
        self.postMessage({
            id,
            type,
            ok: false,
            error: err?.message || 'Worker solver error',
        });
    }
};
