/**
 * WCA-style Speedsolving engine: 15s inspection countdown (+2s penalty at 15-17s,
 * auto-start past 17s), exact first-touch timer start, live TPS, Ao5/Ao12 trimmed averages,
 * and inline SVG trend chart builder.
 */

const INSPECTION_LIMIT_MS = 15000;
const DNF_AUTOSTART_MS = 17000;

/**
 * Formats milliseconds into `MM:SS.cc` (centiseconds).
 * @param {number} ms
 * @returns {string}
 */
export function formatCentiseconds(ms) {
    const safeMs = Math.max(0, Math.round(ms));
    const totalCs = Math.floor(safeMs / 10);
    const cs = totalCs % 100;
    const totalSec = Math.floor(totalCs / 100);
    const secs = totalSec % 60;
    const mins = Math.floor(totalSec / 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Computes WCA trimmed average over the last `windowSize` entries
 * (drops single fastest and single slowest). Returns null if fewer than `windowSize` entries.
 * @param {number[]} timesMs
 * @param {number} windowSize
 * @returns {number | null}
 */
export function computeTrimmedAverage(timesMs, windowSize) {
    if (!Array.isArray(timesMs) || timesMs.length < windowSize) return null;
    const slice = timesMs.slice(-windowSize).slice().sort((a, b) => a - b);
    let sum = 0;
    for (let i = 1; i < slice.length - 1; i++) {
        sum += slice[i];
    }
    return Math.round(sum / (slice.length - 2));
}

/**
 * Aggregates historical Speedsolving metrics for a grid size.
 * @param {Array<{ totalMs: number, tps: number, moves: number }>} solves
 * @returns {{ count: number, bestMs: number|null, ao5Ms: number|null, ao12Ms: number|null, avgTps: number }}
 */
export function computeSpeedStats(solves = []) {
    if (!solves || solves.length === 0) {
        return { count: 0, bestMs: null, ao5Ms: null, ao12Ms: null, avgTps: 0 };
    }

    const times = solves.map((s) => s.totalMs);
    let bestMs = times[0];
    let tpsSum = 0;
    for (let i = 0; i < solves.length; i++) {
        if (times[i] < bestMs) bestMs = times[i];
        tpsSum += Number(solves[i].tps) || 0;
    }

    return {
        count: solves.length,
        bestMs,
        ao5Ms: computeTrimmedAverage(times, 5),
        ao12Ms: computeTrimmedAverage(times, 12),
        avgTps: Number((tpsSum / solves.length).toFixed(2)),
    };
}

/**
 * Generates an inline responsive SVG trend chart of the last 20 speedsolves.
 * @param {Array<{ totalMs: number }>} solves
 * @param {{ width?: number, height?: number }} [options]
 * @returns {string}
 */
export function buildTrendSvg(solves = [], { width = 280, height = 84 } = {}) {
    const recent = solves.slice(-20);
    if (recent.length < 2) {
        return `<div class="trend-empty">Completa almeno 2 solve in Speed WCA per il grafico</div>`;
    }

    const padX = 10;
    const padY = 12;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;

    const vals = recent.map((s) => s.totalMs);
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const span = Math.max(200, maxVal - minVal);

    const points = recent.map((s, idx) => {
        const x = padX + (idx / (recent.length - 1)) * innerW;
        const y = padY + innerH - ((s.totalMs - minVal) / span) * innerH;
        return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
    });

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    const areaPath = `${linePath} L${points[points.length - 1].x},${height - padY} L${points[0].x},${height - padY} Z`;

    const ao5 = computeTrimmedAverage(vals, 5);
    let ao5Line = '';
    if (ao5 !== null) {
        const aoY = Math.max(padY, Math.min(height - padY, padY + innerH - ((ao5 - minVal) / span) * innerH));
        ao5Line = `<line x1="${padX}" y1="${aoY.toFixed(1)}" x2="${width - padX}" y2="${aoY.toFixed(1)}" stroke="#fbbf24" stroke-width="1" stroke-dasharray="3 3" opacity="0.7" />`;
    }

    const dots = points
        .map((p, idx) => {
            const isBest = vals[idx] === minVal;
            const color = isBest ? '#34d399' : '#38bdf8';
            return `<circle cx="${p.x}" cy="${p.y}" r="${isBest ? 3.2 : 2.1}" fill="${color}" />`;
        })
        .join('');

    return `
        <svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Andamento tempi Speedsolving">
            <defs>
                <linearGradient id="speedAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.32" />
                    <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.02" />
                </linearGradient>
            </defs>
            ${ao5Line}
            <path d="${areaPath}" fill="url(#speedAreaGrad)" />
            <path d="${linePath}" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            ${dots}
            <text x="${padX}" y="10" fill="rgba(255,255,255,0.65)" font-size="8.5" font-family="monospace">Max ${formatCentiseconds(maxVal)}</text>
            <text x="${width - padX}" y="${height - 2}" text-anchor="end" fill="#34d399" font-size="8.5" font-family="monospace">PB ${formatCentiseconds(minVal)}</text>
        </svg>
    `;
}

export class SpeedsolveController {
    /**
     * @param {object} [options]
     * @param {(info: { phase: string, remainingSec: number, penaltyMs: number }) => void} [options.onTick]
     * @param {(penaltyMs: number) => void} [options.onAutoStart]
     */
    constructor({ onTick = null, onAutoStart = null } = {}) {
        this.onTick = onTick;
        this.onAutoStart = onAutoStart;

        /** @type {'idle'|'inspecting'|'solving'|'finished'} */
        this.phase = 'idle';
        this.inspectionStartPerf = 0;
        this.solveStartPerf = 0;
        this.elapsedMs = 0;
        this.penaltyMs = 0;
        this._intervalId = null;
    }

    /**
     * Begins the 15s WCA inspection phase.
     */
    startInspection() {
        this.reset();
        this.phase = 'inspecting';
        this.inspectionStartPerf = performance.now();
        this.penaltyMs = 0;

        this._emitTick();
        this._intervalId = setInterval(() => this._handleTick(), 50);
    }

    /**
     * Transitions cleanly from inspection to active solving on the exact first move.
     * @returns {{ started: boolean, penaltyMs: number }}
     */
    onFirstMove() {
        if (this.phase === 'solving') {
            return { started: false, penaltyMs: this.penaltyMs };
        }
        if (this.phase === 'inspecting') {
            const waitedMs = performance.now() - this.inspectionStartPerf;
            if (waitedMs > INSPECTION_LIMIT_MS) {
                this.penaltyMs = 2000;
            }
        }
        this._startSolving();
        return { started: true, penaltyMs: this.penaltyMs };
    }

    /**
     * Returns live solving telemetry (elapsed ms, total with penalty, live TPS).
     * @param {number} moves
     * @returns {{ elapsedMs: number, totalMs: number, tps: number, penaltyMs: number }}
     */
    getLiveMetrics(moves) {
        if (this.phase === 'solving') {
            this.elapsedMs = performance.now() - this.solveStartPerf;
        }
        const safeSec = Math.max(0.05, this.elapsedMs / 1000);
        const tps = moves > 0 ? Number((moves / safeSec).toFixed(2)) : 0;
        return {
            elapsedMs: Math.round(this.elapsedMs),
            totalMs: Math.round(this.elapsedMs + this.penaltyMs),
            tps,
            penaltyMs: this.penaltyMs,
        };
    }

    /**
     * Completes the solve and returns official WCA metrics.
     * @param {number} moves
     */
    finish(moves) {
        if (this.phase === 'solving') {
            this.elapsedMs = performance.now() - this.solveStartPerf;
        }
        this._clearTimer();
        this.phase = 'finished';

        const safeSec = Math.max(0.05, this.elapsedMs / 1000);
        const tps = moves > 0 ? Number((moves / safeSec).toFixed(2)) : 0;
        return {
            elapsedMs: Math.round(this.elapsedMs),
            penaltyMs: this.penaltyMs,
            totalMs: Math.round(this.elapsedMs + this.penaltyMs),
            moves,
            tps,
        };
    }

    reset() {
        this._clearTimer();
        this.phase = 'idle';
        this.inspectionStartPerf = 0;
        this.solveStartPerf = 0;
        this.elapsedMs = 0;
        this.penaltyMs = 0;
    }

    _startSolving() {
        this.phase = 'solving';
        this.solveStartPerf = performance.now();
        this.elapsedMs = 0;
        if (!this._intervalId) {
            this._intervalId = setInterval(() => this._handleTick(), 50);
        }
        this._emitTick();
    }

    _handleTick() {
        if (this.phase === 'inspecting') {
            const waitedMs = performance.now() - this.inspectionStartPerf;
            if (waitedMs >= DNF_AUTOSTART_MS) {
                this.penaltyMs = 2000;
                this._startSolving();
                this.onAutoStart?.(this.penaltyMs);
                return;
            }
            if (waitedMs > INSPECTION_LIMIT_MS) {
                this.penaltyMs = 2000;
            }
        } else if (this.phase === 'solving') {
            this.elapsedMs = performance.now() - this.solveStartPerf;
        }
        this._emitTick();
    }

    _emitTick() {
        if (!this.onTick) return;
        let remainingSec = 15;
        if (this.phase === 'inspecting') {
            const waitedMs = performance.now() - this.inspectionStartPerf;
            remainingSec = Math.max(0, (INSPECTION_LIMIT_MS - waitedMs) / 1000);
        }
        this.onTick({
            phase: this.phase,
            remainingSec,
            penaltyMs: this.penaltyMs,
        });
    }

    _clearTimer() {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }
}
