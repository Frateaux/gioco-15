/**
 * Compact move recording (`[{ tile, ms }]`), live Ghost Race progress vs Personal Best,
 * and 3-second 60fps Time-Lapse Replay engine.
 */

function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
}

/**
 * Computes player heuristic completion percentage [0, 100].
 * @param {{ currentH: number, initialH: number, isSolved: boolean }} params
 * @returns {number}
 */
export function computePlayerProgress({ currentH, initialH, isSolved }) {
    if (isSolved) return 100;
    const base = Math.max(1, initialH || 1);
    return clamp(Math.round((1 - currentH / base) * 100), 0, 99);
}

/**
 * Computes Ghost Personal Best progress percentage [0, 100] at `elapsedMs`.
 * Interpolates smoothly over ghost move timestamps when available, or linearly over PB ms.
 * @param {{ elapsedMs: number, bestRecord: { ms: number }|null, ghostRun: { totalMs: number, log: Array<{ ms: number }> }|null }} params
 * @returns {number | null}
 */
export function computeGhostProgress({ elapsedMs, bestRecord = null, ghostRun = null }) {
    if (ghostRun && Array.isArray(ghostRun.log) && ghostRun.log.length > 0 && ghostRun.totalMs > 0) {
        const log = ghostRun.log;
        const n = log.length;
        if (elapsedMs <= 0) return 0;
        if (elapsedMs >= ghostRun.totalMs) return 100;

        let completed = 0;
        let prevMs = 0;
        for (let i = 0; i < n; i++) {
            const stepMs = Math.max(prevMs, Number(log[i].ms) || 0);
            if (elapsedMs >= stepMs) {
                completed = i + 1;
                prevMs = stepMs;
            } else {
                const span = Math.max(1, stepMs - prevMs);
                const frac = (elapsedMs - prevMs) / span;
                completed = i + frac;
                break;
            }
        }
        return clamp(Math.round((completed / n) * 100), 0, 100);
    }

    if (bestRecord && bestRecord.ms > 0) {
        return clamp(Math.round((elapsedMs / bestRecord.ms) * 100), 0, 100);
    }

    return null;
}

/**
 * Compresses a move log `[{ tile, ms }]` into a smooth 3-second time-lapse schedule
 * blending 70% even pacing and 30% original cadence.
 * @param {Array<{ tile: number, ms: number }>} log
 * @param {number} [totalDurationMs=3000]
 * @returns {Array<{ tile: number, triggerAtMs: number }>}
 */
export function buildTimeLapseSchedule(log, totalDurationMs = 3000) {
    if (!Array.isArray(log) || log.length === 0) return [];

    const scale = totalDurationMs / 3000;
    const leadInMs = Math.round(200 * scale);
    const activeWindowMs = Math.round(2500 * scale);
    const n = log.length;
    const maxLogMs = Math.max(1, Number(log[n - 1]?.ms) || 1);

    let lastTrigger = leadInMs;
    return log.map((entry, idx) => {
        const uniformRatio = (idx + 1) / n;
        const rhythmRatio = clamp((Number(entry.ms) || 0) / maxLogMs, 0, 1);
        const blendedRatio = uniformRatio * 0.7 + rhythmRatio * 0.3;
        const rawTrigger = leadInMs + blendedRatio * activeWindowMs;
        const triggerAtMs = Math.max(lastTrigger, Math.round(rawTrigger));
        lastTrigger = triggerAtMs;
        return {
            tile: entry.tile,
            triggerAtMs,
        };
    });
}

export class ReplayController {
    constructor() {
        this.recording = null;
        this.isPlaying = false;
        this._rafId = null;
        this._finishTimeout = null;
        this._onFinish = null;
    }

    /**
     * Begins recording a new game run from its initial shuffled board.
     * @param {number[]} initialBoard
     * @param {number} size
     */
    beginRecording(initialBoard, size) {
        this.recording = {
            initialBoard: initialBoard.slice(),
            size,
            totalMs: 0,
            moves: 0,
            log: [],
        };
    }

    /**
     * Appends a single move `{ tile, ms }` to the active run log.
     * @param {number} tile
     * @param {number} elapsedMs
     */
    recordMove(tile, elapsedMs) {
        if (!this.recording) return;
        this.recording.moves++;
        if (this.recording.log.length < 600) {
            this.recording.log.push({
                tile,
                ms: Math.max(0, Math.round(elapsedMs)),
            });
        }
    }

    /**
     * Finalizes and returns a cloned recording snapshot.
     * @param {number} totalMs
     */
    finalizeRecording(totalMs) {
        if (!this.recording) return null;
        this.recording.totalMs = Math.max(1, Math.round(totalMs));
        return {
            initialBoard: this.recording.initialBoard.slice(),
            size: this.recording.size,
            totalMs: this.recording.totalMs,
            moves: this.recording.moves,
            log: this.recording.log.map((e) => ({ ...e })),
        };
    }

    /**
     * Plays back a recording in `durationMs` (default 3 seconds) via requestAnimationFrame.
     * @param {{ initialBoard: number[], size: number, log: Array<{ tile: number, ms: number }> }} recording
     * @param {object} callbacks
     */
    play(recording, {
        durationMs = 3000,
        onStart = null,
        onApplyStep = null,
        onProgress = null,
        onFinish = null,
    } = {}) {
        this.stop(false);
        if (!recording || !Array.isArray(recording.log) || recording.log.length === 0) {
            onFinish?.(false);
            return;
        }

        const schedule = buildTimeLapseSchedule(recording.log, durationMs);
        const startPerf = performance.now();
        let nextIdx = 0;

        this.isPlaying = true;
        this._onFinish = onFinish;
        onStart?.(recording);

        const tick = (now) => {
            if (!this.isPlaying) return;
            const elapsed = now - startPerf;

            while (nextIdx < schedule.length && elapsed >= schedule[nextIdx].triggerAtMs) {
                onApplyStep?.(schedule[nextIdx].tile, nextIdx + 1, schedule.length);
                nextIdx++;
            }

            const pct = clamp(Math.round((elapsed / durationMs) * 100), 0, 100);
            onProgress?.(pct);

            if (nextIdx >= schedule.length && elapsed >= durationMs) {
                this.isPlaying = false;
                this._rafId = null;
                const cb = this._onFinish;
                this._onFinish = null;
                cb?.(true);
                return;
            }

            this._rafId = requestAnimationFrame(tick);
        };

        this._rafId = requestAnimationFrame(tick);
    }

    /**
     * Stops playback immediately and optionally invokes completion cleanup.
     * @param {boolean} [notify=true]
     */
    stop(notify = true) {
        const wasPlaying = this.isPlaying;
        this.isPlaying = false;
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        clearTimeout(this._finishTimeout);
        this._finishTimeout = null;
        const cb = this._onFinish;
        this._onFinish = null;
        if (notify && wasPlaying) {
            cb?.(false);
        }
    }
}
