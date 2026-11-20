/**
 * Tactile haptic feedback engine using the Web Vibration API,
 * modulated proportionally to the "weight" (number of tiles pushed in one move).
 * Degrades cleanly and silently when unsupported.
 */

export class HapticsEngine {
    constructor(enabled = true) {
        this.enabled = Boolean(enabled);
    }

    /**
     * Checks whether the browser supports the Vibration API.
     * @returns {boolean}
     */
    isSupported() {
        return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    }

    /**
     * Enables or disables haptic feedback.
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
    }

    /**
     * Dispatches a vibration pattern safely.
     * @param {number|number[]} pattern
     */
    trigger(pattern) {
        if (!this.enabled || !this.isSupported()) return;
        try {
            navigator.vibrate(pattern);
        } catch (_) {
            // Silently degrade when blocked by browser/OS policy
        }
    }

    /**
     * Tactile feedback proportional to how many tiles moved simultaneously.
     * @param {number} [count=1]
     */
    vibrateSlide(count = 1) {
        if (count <= 1) {
            this.trigger(10);
        } else if (count === 2) {
            this.trigger([16, 10, 12]);
        } else if (count === 3) {
            this.trigger([24, 12, 18]);
        } else {
            this.trigger([32, 14, 22]);
        }
    }

    /**
     * Subtle click for UI controls.
     */
    vibrateUI() {
        this.trigger(6);
    }

    /**
     * Celebratory pattern upon solving the board.
     */
    vibrateVictory() {
        this.trigger([20, 45, 25, 45, 65]);
    }
}
