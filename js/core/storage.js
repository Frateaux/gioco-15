/**
 * Persistent local store for user settings and personal records,
 * with automatic backward-compatible migration from legacy `gioco15_best_*` keys.
 */

const STORAGE_KEY = 'gioco15_v2_state';
const SUPPORTED_SIZES = [3, 4, 5];
const VALID_THEMES = new Set(['plastic', 'walnut', 'glass', 'aluminum']);
const VALID_PLASTIC_VARIANTS = new Set(['bicolor', 'ivory']);
const VALID_AUDIO_MODES = new Set(['material', 'zen', 'off']);

/**
 * Returns a fresh copy of the default v2 state.
 * @returns {object}
 */
function createDefaultStore() {
    return {
        version: 2,
        settings: {
            size: 4,
            theme: 'plastic',
            plasticVariant: 'bicolor',
            audioMode: 'material',
            haptics: true,
            showHints: true,
            showMediaNumbers: true,
        },
        records: {
            '3x3': null,
            '4x4': null,
            '5x5': null,
        },
        daily: {},
        speedsolves: {
            '3x3': [],
            '4x4': [],
            '5x5': [],
        },
        ghosts: {
            '3x3': null,
            '4x4': null,
            '5x5': null,
        },
    };
}

/**
 * Validates and normalizes a compact Ghost Replay recording.
 * @param {any} raw
 * @param {number} expectedSize
 */
function normalizeGhostRun(raw, expectedSize) {
    if (!raw || typeof raw !== 'object') return null;
    if (!Array.isArray(raw.initialBoard) || raw.initialBoard.length !== expectedSize * expectedSize) {
        return null;
    }
    if (!Array.isArray(raw.log) || raw.log.length === 0) return null;
    const totalMs = Number(raw.totalMs);
    if (!Number.isFinite(totalMs) || totalMs <= 0) return null;

    return {
        initialBoard: raw.initialBoard.map((n) => Number(n)),
        size: expectedSize,
        totalMs: Math.round(totalMs),
        moves: Number(raw.moves) || raw.log.length,
        log: raw.log.slice(0, 600).map((e) => ({
            tile: Number(e.tile),
            ms: Math.max(0, Math.round(Number(e.ms) || 0)),
        })),
    };
}

/**
 * Formats grid size to storage record key (e.g. "4x4").
 * @param {number} size
 * @returns {string}
 */
export function sizeKey(size) {
    return `${size}x${size}`;
}

/**
 * Safely reads and parses JSON from localStorage.
 * @param {string} key
 * @returns {any|null}
 */
function safeReadJSON(key) {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

/**
 * Safely writes JSON to localStorage.
 * @param {string} key
 * @param {any} value
 */
function safeWriteJSON(key, value) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
        // Ignore storage quota or private-mode restrictions cleanly
    }
}

/**
 * Validates and normalizes a legacy or v2 record object.
 * @param {any} raw
 * @returns {{ moves: number, seconds: number, ms: number, updatedAt: number } | null}
 */
function normalizeRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const moves = Number(raw.moves);
    const seconds = Number(raw.seconds);
    if (!Number.isFinite(moves) || moves <= 0 || !Number.isFinite(seconds) || seconds < 0) {
        return null;
    }
    const ms = Number.isFinite(Number(raw.ms)) && Number(raw.ms) >= 0
        ? Math.round(Number(raw.ms))
        : Math.round(seconds * 1000);
    const updatedAt = Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now();
    return {
        moves: Math.round(moves),
        seconds: Math.round(seconds),
        ms,
        updatedAt,
    };
}

/**
 * Returns true if candidate record beats existing record (fewer moves, or faster on tie).
 * @param {{ moves: number, ms: number }} candidate
 * @param {{ moves: number, ms: number } | null} current
 * @returns {boolean}
 */
function isRecordBetter(candidate, current) {
    if (!current) return true;
    if (candidate.moves < current.moves) return true;
    if (candidate.moves === current.moves && candidate.ms < current.ms) return true;
    return false;
}

class LocalStore {
    constructor() {
        this.state = this.loadStore();
    }

    /**
     * Loads v2 state and migrates any missing legacy `gioco15_best_NxN` records.
     * @returns {object}
     */
    loadStore() {
        const defaults = createDefaultStore();
        const saved = safeReadJSON(STORAGE_KEY);

        const merged = createDefaultStore();
        if (saved && typeof saved === 'object') {
            const s = saved.settings || {};
            merged.settings.size = SUPPORTED_SIZES.includes(Number(s.size)) ? Number(s.size) : defaults.settings.size;
            merged.settings.theme = VALID_THEMES.has(s.theme) ? s.theme : defaults.settings.theme;
            merged.settings.plasticVariant = VALID_PLASTIC_VARIANTS.has(s.plasticVariant)
                ? s.plasticVariant
                : defaults.settings.plasticVariant;
            merged.settings.audioMode = VALID_AUDIO_MODES.has(s.audioMode) ? s.audioMode : defaults.settings.audioMode;
            merged.settings.haptics = typeof s.haptics === 'boolean' ? s.haptics : defaults.settings.haptics;
            merged.settings.showHints = typeof s.showHints === 'boolean' ? s.showHints : defaults.settings.showHints;
            merged.settings.showMediaNumbers = typeof s.showMediaNumbers === 'boolean'
                ? s.showMediaNumbers
                : defaults.settings.showMediaNumbers;

            if (saved.records && typeof saved.records === 'object') {
                for (const sz of SUPPORTED_SIZES) {
                    const key = sizeKey(sz);
                    merged.records[key] = normalizeRecord(saved.records[key]);
                }
            }

            if (saved.daily && typeof saved.daily === 'object') {
                merged.daily = { ...saved.daily };
            }

            if (saved.speedsolves && typeof saved.speedsolves === 'object') {
                for (const sz of SUPPORTED_SIZES) {
                    const key = sizeKey(sz);
                    if (Array.isArray(saved.speedsolves[key])) {
                        merged.speedsolves[key] = saved.speedsolves[key].slice(-100);
                    }
                }
            }

            if (saved.ghosts && typeof saved.ghosts === 'object') {
                for (const sz of SUPPORTED_SIZES) {
                    const key = sizeKey(sz);
                    merged.ghosts[key] = normalizeGhostRun(saved.ghosts[key], sz);
                }
            }
        }

        let migrated = false;
        for (const sz of SUPPORTED_SIZES) {
            const key = sizeKey(sz);
            const legacy = normalizeRecord(safeReadJSON(`gioco15_best_${key}`));
            if (legacy && isRecordBetter(legacy, merged.records[key])) {
                merged.records[key] = legacy;
                migrated = true;
            }
        }

        if (migrated || !saved) {
            safeWriteJSON(STORAGE_KEY, merged);
        }

        return merged;
    }

    /**
     * Returns current persisted user settings.
     */
    getSettings() {
        return { ...this.state.settings };
    }

    /**
     * Updates one or more settings and persists immediately.
     * @param {Partial<typeof createDefaultStore extends () => infer R ? R['settings'] : any>} partial
     */
    saveSettings(partial) {
        const next = { ...this.state.settings, ...partial };
        if (!SUPPORTED_SIZES.includes(Number(next.size))) next.size = 4;
        if (!VALID_THEMES.has(next.theme)) next.theme = 'plastic';
        if (!VALID_PLASTIC_VARIANTS.has(next.plasticVariant)) next.plasticVariant = 'bicolor';
        if (!VALID_AUDIO_MODES.has(next.audioMode)) next.audioMode = 'material';
        next.haptics = Boolean(next.haptics);
        next.showHints = Boolean(next.showHints);
        next.showMediaNumbers = Boolean(next.showMediaNumbers);

        this.state.settings = next;
        safeWriteJSON(STORAGE_KEY, this.state);
        return this.getSettings();
    }

    /**
     * Retrieves the personal best record for a grid size.
     * @param {number} size
     */
    getBestRecord(size) {
        const key = sizeKey(size);
        const rec = this.state.records[key];
        return rec ? { ...rec } : null;
    }

    /**
     * Saves a completed game if it beats the stored personal record.
     * Also keeps the legacy `gioco15_best_NxN` key synchronized.
     * @param {number} size
     * @param {number} moves
     * @param {number} ms
     * @returns {boolean} true if a new personal record was set
     */
    saveBestIfBetter(size, moves, ms) {
        const key = sizeKey(size);
        const safeMs = Math.max(0, Math.round(ms));
        const seconds = Math.floor(safeMs / 1000);
        const candidate = {
            moves: Math.round(moves),
            seconds,
            ms: safeMs,
            updatedAt: Date.now(),
        };

        const current = this.state.records[key];
        if (!isRecordBetter(candidate, current)) {
            return false;
        }

        this.state.records[key] = candidate;
        safeWriteJSON(STORAGE_KEY, this.state);
        safeWriteJSON(`gioco15_best_${key}`, { moves: candidate.moves, seconds: candidate.seconds });
        return true;
    }

    /**
     * Retrieves a completed Daily Challenge record for `dateKey` and `size`.
     * @param {string} dateKey
     * @param {number} size
     */
    getDailyResult(dateKey, size) {
        const key = `${dateKey}_${sizeKey(size)}`;
        const entry = this.state.daily[key];
        return entry ? { ...entry } : null;
    }

    /**
     * Persists a completed Daily Challenge entry (preserving earliest or improving score).
     * @param {object} result
     */
    saveDailyResult(result) {
        const key = `${result.dateKey}_${sizeKey(result.size)}`;
        const prev = this.state.daily[key];
        if (!prev || result.moves < prev.moves || (result.moves === prev.moves && result.ms < prev.ms)) {
            this.state.daily[key] = { ...result };
            safeWriteJSON(STORAGE_KEY, this.state);
        }
        return { ...this.state.daily[key] };
    }

    /**
     * Returns recorded WCA speedsolving runs for `size`.
     * @param {number} size
     */
    getSpeedsolves(size) {
        const key = sizeKey(size);
        return (this.state.speedsolves[key] || []).map((s) => ({ ...s }));
    }

    /**
     * Appends a completed speedsolving run (capped at last 100 per grid size).
     * @param {number} size
     * @param {{ ms: number, penaltyMs: number, totalMs: number, moves: number, tps: number, timestamp?: number }} entry
     */
    addSpeedsolve(size, entry) {
        const key = sizeKey(size);
        if (!Array.isArray(this.state.speedsolves[key])) {
            this.state.speedsolves[key] = [];
        }
        this.state.speedsolves[key].push({
            ms: Math.round(entry.ms),
            penaltyMs: Math.round(entry.penaltyMs || 0),
            totalMs: Math.round(entry.totalMs),
            moves: Math.round(entry.moves),
            tps: Number(entry.tps) || 0,
            timestamp: entry.timestamp || Date.now(),
        });
        if (this.state.speedsolves[key].length > 100) {
            this.state.speedsolves[key] = this.state.speedsolves[key].slice(-100);
        }
        safeWriteJSON(STORAGE_KEY, this.state);
        return this.getSpeedsolves(size);
    }

    /**
     * Returns the saved Ghost Personal Best run recording for `size`.
     * @param {number} size
     */
    getGhostRun(size) {
        const key = sizeKey(size);
        const g = this.state.ghosts?.[key];
        return g ? { ...g, initialBoard: g.initialBoard.slice(), log: g.log.map((e) => ({ ...e })) } : null;
    }

    /**
     * Saves a compact Ghost recording when a PB is set or no ghost existed yet.
     * @param {number} size
     * @param {object} recording
     */
    saveGhostRun(size, recording) {
        const norm = normalizeGhostRun(recording, size);
        if (!norm) return false;
        const key = sizeKey(size);
        this.state.ghosts[key] = norm;
        safeWriteJSON(STORAGE_KEY, this.state);
        return true;
    }

    /**
     * Exports all settings, personal records, daily results, speedsolves, and ghosts as formatted JSON.
     * @returns {string}
     */
    exportBackupJSON() {
        return JSON.stringify({
            app: 'gioco-del-15-pwa',
            version: 2,
            exportedAt: new Date().toISOString(),
            settings: this.getSettings(),
            records: { ...this.state.records },
            daily: { ...this.state.daily },
            speedsolves: { ...this.state.speedsolves },
            ghosts: { ...this.state.ghosts },
        }, null, 2);
    }

    /**
     * Validates and merges an exported JSON backup (v2 or legacy format) into local state.
     * @param {string | object} jsonInput
     * @returns {{ ok: boolean, error?: string, stats?: { records: number, speedsolves: number, daily: number } }}
     */
    importBackupJSON(jsonInput) {
        let parsed = null;
        try {
            parsed = typeof jsonInput === 'string' ? JSON.parse(jsonInput) : jsonInput;
        } catch (_) {
            return { ok: false, error: 'File JSON non valido o corrotto' };
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { ok: false, error: 'Struttura backup non riconosciuta' };
        }

        let importedRecords = 0;
        let importedSpeeds = 0;
        let importedDaily = 0;

        const incomingRecords = parsed.records && typeof parsed.records === 'object' ? parsed.records : parsed;
        for (const sz of SUPPORTED_SIZES) {
            const key = sizeKey(sz);
            const rawRec = incomingRecords[key] || parsed[`gioco15_best_${key}`];
            const norm = normalizeRecord(rawRec);
            if (norm) {
                if (isRecordBetter(norm, this.state.records[key])) {
                    this.state.records[key] = norm;
                    safeWriteJSON(`gioco15_best_${key}`, { moves: norm.moves, seconds: norm.seconds });
                }
                importedRecords++;
            }
        }

        if (parsed.daily && typeof parsed.daily === 'object') {
            for (const [dKey, dVal] of Object.entries(parsed.daily)) {
                if (!dVal || typeof dVal !== 'object' || !dVal.dateKey) continue;
                const prev = this.state.daily[dKey];
                if (!prev || dVal.moves < prev.moves || (dVal.moves === prev.moves && dVal.ms < prev.ms)) {
                    this.state.daily[dKey] = { ...dVal };
                }
                importedDaily++;
            }
        }

        if (parsed.speedsolves && typeof parsed.speedsolves === 'object') {
            for (const sz of SUPPORTED_SIZES) {
                const key = sizeKey(sz);
                const list = parsed.speedsolves[key];
                if (!Array.isArray(list)) continue;
                const existing = this.state.speedsolves[key] || [];
                const seenTs = new Set(existing.map((e) => e.timestamp));
                for (const item of list) {
                    if (!item || typeof item !== 'object') continue;
                    const totalMs = Number(item.totalMs);
                    if (!Number.isFinite(totalMs) || totalMs <= 0) continue;
                    const ts = Number(item.timestamp) || Date.now();
                    if (seenTs.has(ts)) continue;
                    seenTs.add(ts);
                    existing.push({
                        ms: Math.max(0, Math.round(Number(item.ms) || totalMs)),
                        penaltyMs: Math.max(0, Math.round(Number(item.penaltyMs) || 0)),
                        totalMs: Math.round(totalMs),
                        moves: Math.max(1, Math.round(Number(item.moves) || 1)),
                        tps: Number(item.tps) || 0,
                        timestamp: ts,
                    });
                    importedSpeeds++;
                }
                this.state.speedsolves[key] = existing.slice(-100);
            }
        }

        if (parsed.ghosts && typeof parsed.ghosts === 'object') {
            for (const sz of SUPPORTED_SIZES) {
                const key = sizeKey(sz);
                const normGhost = normalizeGhostRun(parsed.ghosts[key], sz);
                if (normGhost && !this.state.ghosts[key]) {
                    this.state.ghosts[key] = normGhost;
                }
            }
        }

        if (parsed.settings && typeof parsed.settings === 'object') {
            this.saveSettings(parsed.settings);
        } else {
            safeWriteJSON(STORAGE_KEY, this.state);
        }

        if (importedRecords === 0 && importedSpeeds === 0 && importedDaily === 0 && !parsed.settings) {
            return { ok: false, error: 'Nessun dato compatibile trovato nel file' };
        }

        return {
            ok: true,
            stats: { records: importedRecords, speedsolves: importedSpeeds, daily: importedDaily },
        };
    }
}

export const storage = new LocalStore();
