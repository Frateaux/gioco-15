/**
 * Deterministic Daily Challenge (Wordle-style seeded board + emoji result share card).
 */

import { generateSolvableBoard, mulberry32 } from '../core/board.js';

/**
 * Formats a Date as local YYYY-MM-DD key.
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
export function getTodayDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Deterministic 32-bit FNV-1a string hash for PRNG seeding.
 * @param {string} str
 * @returns {number}
 */
export function hashStringToSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/**
 * Generates the exact same guaranteed-solvable board worldwide for a given date & grid size.
 * @param {number} size
 * @param {string} [dateKey=getTodayDateKey()]
 * @returns {number[]}
 */
export function generateDailyBoard(size, dateKey = getTodayDateKey()) {
    const seed = hashStringToSeed(`gioco15-daily-${dateKey}-${size}x${size}`);
    return generateSolvableBoard(size, mulberry32(seed));
}

/**
 * Builds an emoji progress bar representing efficiency vs Par.
 * @param {number} efficiency - 0..100
 * @param {number} [length=10]
 * @returns {string}
 */
export function buildEfficiencyEmojiBar(efficiency, length = 10) {
    const pct = Math.max(0, Math.min(100, Math.round(efficiency)));
    const filled = Math.max(1, Math.min(length, Math.round((pct / 100) * length)));
    const fillGlyph = pct >= 85 ? '🟩' : pct >= 60 ? '🟨' : '🟧';
    return fillGlyph.repeat(filled) + '⬜'.repeat(length - filled);
}

/**
 * Builds the clean Wordle-style share card text.
 * @param {object} params
 * @param {string} params.dateKey
 * @param {number} params.size
 * @param {string} params.formattedTime
 * @param {number} params.moves
 * @param {number|null} params.par
 * @param {boolean} params.parOptimal
 * @param {number} params.efficiency
 * @returns {string}
 */
export function buildDailyShareText({
    dateKey,
    size,
    formattedTime,
    moves,
    par,
    parOptimal = true,
    efficiency = 100,
}) {
    const parLabel = par ? `${parOptimal ? '' : '~'}${par}` : '--';
    const bar = buildEfficiencyEmojiBar(efficiency);
    return [
        `🧩 Gioco del 15 — Sfida ${dateKey}`,
        `📐 ${size}×${size} · ⏱️ ${formattedTime} · 🎯 ${moves}/${parLabel} mosse (${efficiency}%)`,
        bar,
    ].join('\n');
}

/**
 * Copies text to clipboard safely with a DOM fallback for restricted origins.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyTextToClipboard(text) {
    try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (_) {
        // Fall back to execCommand below
    }

    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return Boolean(ok);
    } catch (_) {
        return false;
    }
}
