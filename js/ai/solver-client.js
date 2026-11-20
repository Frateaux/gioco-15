/**
 * Async Promise bridge to the dedicated AI solver Web Worker,
 * with stale-request cancellation and graceful inline fallback if Workers are unavailable.
 */

import { analyzeRunXRay, solvePuzzle } from './solver-core.js';

export class SolverClient {
    constructor() {
        this.worker = null;
        this.nextId = 1;
        this.pending = new Map();
        this.latestByType = new Map();
        this._initWorker();
    }

    _initWorker() {
        if (typeof Worker === 'undefined') return;
        try {
            this.worker = new Worker(new URL('./solver.worker.js', import.meta.url), {
                type: 'module',
            });
            this.worker.onmessage = (event) => {
                const { id, ok, result, error } = event.data || {};
                const entry = this.pending.get(id);
                if (!entry) return;
                this.pending.delete(id);

                if (ok) {
                    entry.resolve(result);
                } else {
                    entry.reject(new Error(error || 'Solver worker failed'));
                }
            };
            this.worker.onerror = () => {
                this._fallbackRejectAll();
                this.terminate();
            };
        } catch (_) {
            this.worker = null;
        }
    }

    _fallbackRejectAll() {
        for (const entry of this.pending.values()) {
            entry.resolve(null);
        }
        this.pending.clear();
    }

    _dispatch(type, payload, fallbackFn) {
        const reqId = this.nextId++;
        this.latestByType.set(type, reqId);

        if (!this.worker) {
            return Promise.resolve(fallbackFn()).then((res) => (
                this.latestByType.get(type) === reqId ? res : null
            ));
        }

        return new Promise((resolve, reject) => {
            this.pending.set(reqId, {
                resolve: (res) => {
                    if (this.latestByType.get(type) !== reqId) {
                        resolve(null);
                        return;
                    }
                    resolve(res);
                },
                reject,
            });
            this.worker.postMessage({ id: reqId, type, payload });
        }).catch(() => fallbackFn());
    }

    /**
     * Computes the initial Par (target move count) for a board configuration.
     * @param {number[]} board
     * @param {number} size
     */
    computePar(board, size) {
        return this._dispatch(
            'solvePar',
            { board: board.slice(), size },
            () => solvePuzzle(board, size, { mode: 'par' })
        );
    }

    /**
     * Computes the best next tile to slide from the current board state.
     * @param {number[]} board
     * @param {number} size
     */
    getHint(board, size) {
        return this._dispatch(
            'getHint',
            { board: board.slice(), size },
            () => solvePuzzle(board, size, { mode: 'hint' })
        );
    }

    /**
     * Runs post-game X-Ray efficiency and mistake-cluster analysis.
     * @param {object} payload
     */
    analyzeXRay(payload) {
        return this._dispatch(
            'analyzeXRay',
            payload,
            () => analyzeRunXRay(payload)
        );
    }

    /**
     * Cancels stale in-flight requests of a given type without killing the worker.
     * @param {string} type
     */
    invalidate(type) {
        this.latestByType.set(type, this.nextId++);
    }

    terminate() {
        if (this.worker) {
            try {
                this.worker.terminate();
            } catch (_) {}
            this.worker = null;
        }
    }
}
