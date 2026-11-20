/**
 * Procedural Web Audio synthesizer for material-matched tactile acoustics
 * and a pentatonic Zen soundscape. Zero external audio assets.
 */

const PENTATONIC_SCALE = [
    261.63, 293.66, 329.63, 392.00, 440.00, // C4, D4, E4, G4, A4
    523.25, 587.33, 659.25, 783.99, 880.00, // C5, D5, E5, G5, A5
    1046.50, 1174.66, 1318.51, 1567.98, 1760.00, // C6, D6, E6, G6, A6
];

export class ProceduralSoundEngine {
    /**
     * @param {object} [options]
     * @param {'material'|'zen'|'off'} [options.mode='material']
     * @param {'plastic'|'walnut'|'glass'|'aluminum'} [options.material='plastic']
     */
    constructor({ mode = 'material', material = 'plastic' } = {}) {
        this.ctx = null;
        this.masterGain = null;
        this.noiseBuffer = null;
        this.mode = mode;
        this.material = material;
    }

    /**
     * @param {'material'|'zen'|'off'} mode
     */
    setMode(mode) {
        this.mode = mode;
    }

    /**
     * @param {'plastic'|'walnut'|'glass'|'aluminum'} material
     */
    setMaterial(material) {
        this.material = material;
    }

    /**
     * Lazily initializes or resumes AudioContext on user gesture.
     * @returns {AudioContext | null}
     */
    unlock() {
        try {
            if (!this.ctx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return null;
                this.ctx = new AudioCtx();

                this.masterGain = this.ctx.createGain();
                this.masterGain.gain.value = 0.85;
                this.masterGain.connect(this.ctx.destination);

                // Shared white-noise buffer reused across percussive impacts
                const len = Math.floor(this.ctx.sampleRate * 0.2);
                this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
                const data = this.noiseBuffer.getChannelData(0);
                for (let i = 0; i < len; i++) {
                    data[i] = Math.random() * 2 - 1;
                }
            }
            if (this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }
            return this.ctx;
        } catch (_) {
            return null;
        }
    }

    /**
     * Emits a filtered noise burst with exponential decay.
     */
    _playNoiseBurst(time, duration, filterType, freq, q, peakGain) {
        const ctx = this.ctx;
        if (!ctx || !this.noiseBuffer) return;

        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;

        const filter = ctx.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.setValueAtTime(freq, time);
        if (q > 0) filter.Q.setValueAtTime(q, time);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(peakGain, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        src.start(time);
        src.stop(time + duration + 0.005);
    }

    /**
     * Emits a single pitched oscillator envelope.
     */
    _playTone(time, duration, type, startFreq, endFreq, peakGain, attack = 0.002, destination = null) {
        const ctx = this.ctx;
        if (!ctx) return;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(startFreq, time);
        if (endFreq !== startFreq) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), time + duration);
        }

        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.linearRampToValueAtTime(peakGain, time + attack);
        gain.gain.exponentialRampToValueAtTime(0.0008, time + duration);

        osc.connect(gain);
        gain.connect(destination || this.masterGain);

        osc.start(time);
        osc.stop(time + duration + 0.01);
    }

    /**
     * Plays the tactile slide acoustic matching either the selected material or Zen mode.
     * @param {object} [params]
     * @param {number} [params.count=1]
     * @param {number} [params.primaryTile=1]
     * @param {number[]} [params.newlyCorrectTiles=[]]
     */
    playSlide({ count = 1, primaryTile = 1, newlyCorrectTiles = [] } = {}) {
        if (this.mode === 'off') return;
        const ctx = this.unlock();
        if (!ctx) return;

        try {
            const now = ctx.currentTime;
            if (this.mode === 'zen') {
                this._playZenSlide(now, primaryTile, newlyCorrectTiles);
                return;
            }

            switch (this.material) {
                case 'walnut':
                    this._playWalnutClack(now, count);
                    break;
                case 'glass':
                    this._playGlassClink(now, count, primaryTile);
                    break;
                case 'aluminum':
                    this._playAluminumClick(now, count, primaryTile);
                    break;
                case 'plastic':
                default:
                    this._playPlasticClack(now, count);
                    break;
            }
        } catch (_) {
            // Gracefully ignore blocked playback
        }
    }

    _playPlasticClack(now, count) {
        // Sharp 70s ABS plastic impact + hollow cavity + subtle mechanical bounce echo
        this._playNoiseBurst(now, 0.026, 'bandpass', 1350 + count * 85, 3.2, 0.42);
        this._playTone(now, 0.032, 'triangle', 320 + count * 22, 115, 0.25);
        this._playNoiseBurst(now + 0.03, 0.016, 'bandpass', 1600, 2.6, 0.12);
    }

    _playWalnutClack(now, count) {
        // Warm, damped low-mid woody knock + deep body weight proportional to tile count
        const weight = Math.min(count, 4);
        this._playNoiseBurst(now, 0.034, 'bandpass', 480 + weight * 30, 1.8, 0.36);
        this._playTone(now, 0.055, 'sine', 210 - weight * 10, 88, 0.34, 0.002);
        this._playTone(now + 0.004, 0.04, 'triangle', 340, 145, 0.11, 0.002);
    }

    _playGlassClink(now, count, tile) {
        // Crystalline high-harmonic shimmer with silky transient
        const base = 1680 + (tile % 5) * 140 + Math.min(count, 3) * 45;
        this._playNoiseBurst(now, 0.018, 'bandpass', 3800, 3.5, 0.16);
        this._playTone(now, 0.135, 'sine', base, base * 0.992, 0.13, 0.002);
        this._playTone(now, 0.085, 'sine', base * 2.75, base * 2.73, 0.045, 0.002);
    }

    _playAluminumClick(now, count, tile) {
        // Brushed slide swish + crisp CNC metallic ping and detent lock
        const ping = 2350 + (tile % 4) * 180;
        this._playNoiseBurst(now, 0.02, 'highpass', 2800, 1.2, 0.18);
        this._playNoiseBurst(now, 0.025, 'bandpass', 3550, 8.0, 0.22);
        this._playTone(now, 0.065, 'sine', ping, ping * 0.985, 0.09, 0.001);
        this._playTone(now + 0.012, 0.028, 'triangle', 820 + count * 35, 260, 0.14, 0.001);
    }

    _playZenSlide(now, primaryTile, newlyCorrectTiles) {
        const ctx = this.ctx;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2400, now);
        lp.connect(this.masterGain);

        const noteFreq = PENTATONIC_SCALE[(primaryTile - 1) % PENTATONIC_SCALE.length];
        this._playTone(now, 0.36, 'sine', noteFreq, noteFreq, 0.18, 0.008, lp);
        this._playTone(now, 0.18, 'triangle', noteFreq * 2, noteFreq * 2, 0.04, 0.008, lp);

        // Harmonic resolution chord when tile(s) lock into their home slot
        if (newlyCorrectTiles && newlyCorrectTiles.length > 0) {
            const rootIdx = (newlyCorrectTiles[0] - 1) % 5;
            const chord = [
                PENTATONIC_SCALE[rootIdx + 5],
                PENTATONIC_SCALE[rootIdx + 7],
                PENTATONIC_SCALE[rootIdx + 10],
            ];
            const chordTime = now + 0.055;
            for (const f of chord) {
                this._playTone(chordTime, 0.48, 'sine', f, f, 0.075, 0.012, lp);
            }
        }
    }

    /**
     * Subtle UI tap sound matching the active material or Zen mode.
     */
    playUI() {
        if (this.mode === 'off') return;
        const ctx = this.unlock();
        if (!ctx) return;

        try {
            const now = ctx.currentTime;
            if (this.mode === 'zen') {
                this._playTone(now, 0.14, 'sine', 659.25, 659.25, 0.08, 0.006);
                return;
            }
            const freqMap = {
                plastic: 1100,
                walnut: 520,
                glass: 2400,
                aluminum: 1950,
            };
            this._playNoiseBurst(now, 0.016, 'bandpass', freqMap[this.material] || 1100, 3.0, 0.15);
        } catch (_) {}
    }

    /**
     * Victory fanfare tailored to either Zen pentatonic arpeggio or active material timbre.
     */
    playVictory() {
        if (this.mode === 'off') return;
        const ctx = this.unlock();
        if (!ctx) return;

        try {
            const now = ctx.currentTime + 0.04;
            if (this.mode === 'zen') {
                const arpeggio = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
                arpeggio.forEach((f, i) => {
                    this._playTone(now + i * 0.09, 0.65, 'sine', f, f, 0.11, 0.01);
                });
                return;
            }

            const waveMap = {
                plastic: 'triangle',
                walnut: 'sine',
                glass: 'sine',
                aluminum: 'triangle',
            };
            const wave = waveMap[this.material] || 'triangle';
            const notes = [523.25, 659.25, 783.99, 1046.50, 783.99, 1046.50];
            const durations = [0.11, 0.11, 0.11, 0.22, 0.10, 0.42];
            let cursor = now;

            notes.forEach((freq, idx) => {
                this._playTone(cursor, durations[idx], wave, freq, freq, 0.18, 0.005);
                cursor += durations[idx] * 0.92;
            });
        } catch (_) {}
    }

    /**
     * Crisp icy lock feedback when attempting to push a frozen tile.
     */
    playIceBlocked() {
        if (this.mode === 'off') return;
        const ctx = this.unlock();
        if (!ctx) return;

        try {
            const now = ctx.currentTime;
            this._playNoiseBurst(now, 0.022, 'bandpass', 4200, 4.5, 0.22);
            this._playTone(now, 0.09, 'sine', 2450, 2100, 0.11, 0.001);
            this._playTone(now + 0.035, 0.07, 'sine', 1980, 1750, 0.08, 0.001);
        } catch (_) {}
    }

    /**
     * Gentle crystalline thaw chime when frozen tiles unlock after 10 moves.
     */
    playIceThaw() {
        if (this.mode === 'off') return;
        const ctx = this.unlock();
        if (!ctx) return;

        try {
            const now = ctx.currentTime;
            [1174.66, 1567.98, 2093.0].forEach((freq, i) => {
                this._playTone(now + i * 0.045, 0.24, 'sine', freq, freq, 0.09, 0.004);
            });
        } catch (_) {}
    }
}
