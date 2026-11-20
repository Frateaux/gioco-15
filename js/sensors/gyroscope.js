/**
 * Gyroscope & Accelerometer orientation controller for dynamic specular highlights
 * and calibrated Gravity sliding mode. Pure math helpers are exported for unit testing.
 */

/**
 * Clamps a numeric value between min and max.
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
}

/**
 * Normalizes raw DeviceOrientation beta/gamma into screen-aligned tilt axes.
 * @param {number} beta - Front-to-back tilt in degrees [-180, 180]
 * @param {number} gamma - Left-to-right tilt in degrees [-90, 90]
 * @param {number} [screenAngle=0] - Screen orientation angle in degrees (0, 90, 180, 270/-90)
 * @returns {{ x: number, y: number }}
 */
export function computeSquareTiltVector(beta, gamma, screenAngle = 0) {
    const normalizedAngle = ((Math.round(screenAngle / 90) * 90) % 360 + 360) % 360;
    switch (normalizedAngle) {
        case 90:
            return { x: beta, y: -gamma };
        case 180:
            return { x: -gamma, y: -beta };
        case 270:
            return { x: -beta, y: gamma };
        case 0:
        default:
            return { x: gamma, y: beta };
    }
}

/**
 * Maps device tilt relative to a reference angle into specular highlight percentages [8, 92].
 * @param {number} beta
 * @param {number} gamma
 * @param {number} [refBeta=40]
 * @param {number} [refGamma=0]
 * @param {number} [screenAngle=0]
 * @returns {{ xPct: number, yPct: number }}
 */
export function computeSpecularCoords(beta, gamma, refBeta = 40, refGamma = 0, screenAngle = 0) {
    const cur = computeSquareTiltVector(beta, gamma, screenAngle);
    const ref = computeSquareTiltVector(refBeta, refGamma, screenAngle);
    const dx = cur.x - ref.x;
    const dy = cur.y - ref.y;

    return {
        xPct: clamp(50 + (dx / 45) * 42, 8, 92),
        yPct: clamp(50 + (dy / 45) * 42, 8, 92),
    };
}

/**
 * Determines dominant gravity slide direction when tilt exceeds thresholdDeg.
 * @param {number} beta
 * @param {number} gamma
 * @param {number} [refBeta=40]
 * @param {number} [refGamma=0]
 * @param {number} [screenAngle=0]
 * @param {number} [thresholdDeg=22]
 * @returns {{ direction: 'RIGHT'|'LEFT'|'DOWN'|'UP', magnitude: number } | null}
 */
export function computeGravityDirection(
    beta,
    gamma,
    refBeta = 40,
    refGamma = 0,
    screenAngle = 0,
    thresholdDeg = 22
) {
    const cur = computeSquareTiltVector(beta, gamma, screenAngle);
    const ref = computeSquareTiltVector(refBeta, refGamma, screenAngle);
    const dx = cur.x - ref.x;
    const dy = cur.y - ref.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const maxTilt = Math.max(absX, absY);

    if (maxTilt < thresholdDeg) {
        return null;
    }

    const direction = absX >= absY
        ? (dx > 0 ? 'RIGHT' : 'LEFT')
        : (dy > 0 ? 'DOWN' : 'UP');

    return {
        direction,
        magnitude: clamp((maxTilt - thresholdDeg) / 25, 0, 1),
    };
}

/**
 * Finds the adjacent tile number that falls into the empty slot along gravity `direction`.
 * @param {number[]} board
 * @param {number} size
 * @param {'RIGHT'|'LEFT'|'DOWN'|'UP'} direction
 * @returns {number | null}
 */
export function getGravityTileForDirection(board, size, direction) {
    const emptyIdx = board.indexOf(0);
    if (emptyIdx === -1) return null;

    const emptyRow = Math.floor(emptyIdx / size);
    const emptyCol = emptyIdx % size;

    let sourceIdx = -1;
    if (direction === 'RIGHT' && emptyCol > 0) {
        sourceIdx = emptyRow * size + (emptyCol - 1);
    } else if (direction === 'LEFT' && emptyCol < size - 1) {
        sourceIdx = emptyRow * size + (emptyCol + 1);
    } else if (direction === 'DOWN' && emptyRow > 0) {
        sourceIdx = (emptyRow - 1) * size + emptyCol;
    } else if (direction === 'UP' && emptyRow < size - 1) {
        sourceIdx = (emptyRow + 1) * size + emptyCol;
    }

    return sourceIdx !== -1 ? board[sourceIdx] : null;
}

function getScreenOrientationAngle() {
    try {
        if (window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number') {
            return window.screen.orientation.angle;
        }
        if (typeof window.orientation === 'number') {
            return window.orientation;
        }
    } catch (_) {}
    return 0;
}

export class GyroscopeController {
    /**
     * @param {object} [options]
     * @param {(direction: 'RIGHT'|'LEFT'|'DOWN'|'UP') => void} [options.onGravitySlide]
     * @param {(status: { code: string, message: string }) => void} [options.onStatusChange]
     * @param {(tilt: { xPct: number, yPct: number, dx: number, dy: number }) => void} [options.onTiltUpdate]
     */
    constructor({ onGravitySlide = null, onStatusChange = null, onTiltUpdate = null } = {}) {
        this.onGravitySlide = onGravitySlide;
        this.onStatusChange = onStatusChange;
        this.onTiltUpdate = onTiltUpdate;

        this.dynamicLightEnabled = false;
        this.gravityEnabled = false;
        this.listening = false;
        this.hasSignal = false;
        this.permissionGranted = false;

        this.refBeta = 40;
        this.refGamma = 0;
        this.hasCalibratedRef = false;
        this.lastRawBeta = null;
        this.lastRawGamma = null;

        // Smoothed specular light state
        this.targetLightX = 35;
        this.targetLightY = 25;
        this.currentLightX = 35;
        this.currentLightY = 25;
        this.lightRafId = null;

        // Gravity hysteresis & debounce state
        this.activationThresholdDeg = 22;
        this.releaseThresholdDeg = 10;
        this.cooldownMs = 320;
        this.lastTriggerAt = 0;
        this.gravityArmed = true;

        this._signalTimeout = null;
        this._onOrientation = this._onOrientation.bind(this);
        this._stepLight = this._stepLight.bind(this);
    }

    /**
     * Checks whether the browser exposes DeviceOrientationEvent.
     * @returns {boolean}
     */
    isSupported() {
        return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
    }

    /**
     * Checks whether iOS-style explicit permission request is required.
     * @returns {boolean}
     */
    needsPermission() {
        return typeof DeviceOrientationEvent !== 'undefined'
            && typeof DeviceOrientationEvent.requestPermission === 'function';
    }

    /**
     * Requests permission if required (must be called on user gesture) and starts listening.
     * @returns {Promise<boolean>}
     */
    async ensureListening() {
        if (!this.isSupported()) {
            this._emitStatus('unsupported', 'Giroscopio non disponibile su questo dispositivo');
            return false;
        }

        if (this.needsPermission() && !this.permissionGranted) {
            try {
                const res = await DeviceOrientationEvent.requestPermission();
                if (res !== 'granted') {
                    this._emitStatus('denied', 'Permesso sensori negato dal browser');
                    return false;
                }
                this.permissionGranted = true;
            } catch (_) {
                this._emitStatus('denied', 'Impossibile attivare i sensori di movimento');
                return false;
            }
        }

        if (!this.listening) {
            this.listening = true;
            this.hasSignal = false;
            window.addEventListener('deviceorientation', this._onOrientation, { passive: true });
            this._startSignalWatchdog();
        }

        return true;
    }

    /**
     * Enables or disables dynamic specular lighting driven by tilt.
     * @param {boolean} enabled
     * @returns {Promise<boolean>}
     */
    async setDynamicLight(enabled) {
        if (enabled) {
            const ok = await this.ensureListening();
            if (!ok) {
                this.dynamicLightEnabled = false;
                return false;
            }
            this.dynamicLightEnabled = true;
            document.body.classList.add('gyro-light-active');
            this._ensureLightLoop();
            if (this.hasSignal) {
                this._emitStatus('active', '');
            }
            return true;
        }

        this.dynamicLightEnabled = false;
        document.body.classList.remove('gyro-light-active');
        this._resetLightVariables();
        this._stopIfIdle();
        return true;
    }

    /**
     * Enables or disables Gravity sliding mode.
     * @param {boolean} enabled
     * @returns {Promise<boolean>}
     */
    async setGravityMode(enabled) {
        if (enabled) {
            const ok = await this.ensureListening();
            if (!ok) {
                this.gravityEnabled = false;
                return false;
            }
            this.gravityEnabled = true;
            this.hasCalibratedRef = false;
            this.gravityArmed = true;
            this.lastTriggerAt = 0;
            if (this.hasSignal) {
                this._emitStatus('active', '');
            }
            return true;
        }

        this.gravityEnabled = false;
        this._stopIfIdle();
        return true;
    }

    /**
     * Recalibrates the neutral resting tilt angle to the device's current orientation.
     */
    recalibrate() {
        if (this.lastRawBeta !== null && this.lastRawGamma !== null) {
            this.refBeta = this.lastRawBeta;
            this.refGamma = this.lastRawGamma;
            this.hasCalibratedRef = true;
            this.gravityArmed = true;
            this.lastTriggerAt = 0;
        } else {
            this.hasCalibratedRef = false;
        }
    }

    /**
     * Detaches all listeners and resets lighting state cleanly.
     */
    destroy() {
        this.dynamicLightEnabled = false;
        this.gravityEnabled = false;
        document.body.classList.remove('gyro-light-active');
        this._resetLightVariables();
        this._stopListening();
    }

    _startSignalWatchdog() {
        clearTimeout(this._signalTimeout);
        this._signalTimeout = setTimeout(() => {
            if (this.listening && !this.hasSignal) {
                this._emitStatus('no_signal', 'Nessun segnale giroscopio rilevato (dispositivo fisso o desktop)');
            }
        }, 2500);
    }

    _stopIfIdle() {
        if (!this.dynamicLightEnabled && !this.gravityEnabled) {
            this._stopListening();
            this._emitStatus('idle', '');
        }
    }

    _stopListening() {
        clearTimeout(this._signalTimeout);
        if (this.listening) {
            window.removeEventListener('deviceorientation', this._onOrientation);
            this.listening = false;
        }
        if (this.lightRafId !== null) {
            cancelAnimationFrame(this.lightRafId);
            this.lightRafId = null;
        }
    }

    _resetLightVariables() {
        this.targetLightX = 35;
        this.targetLightY = 25;
        this.currentLightX = 35;
        this.currentLightY = 25;
        if (typeof document !== 'undefined') {
            document.documentElement.style.setProperty('--light-x', '35%');
            document.documentElement.style.setProperty('--light-y', '25%');
        }
    }

    _emitStatus(code, message) {
        this.onStatusChange?.({ code, message });
    }

    _onOrientation(event) {
        if (typeof event.beta !== 'number' || typeof event.gamma !== 'number') return;
        if (Number.isNaN(event.beta) || Number.isNaN(event.gamma)) return;

        if (!this.hasSignal) {
            this.hasSignal = true;
            clearTimeout(this._signalTimeout);
            this._emitStatus('active', '');
        }

        const beta = event.beta;
        const gamma = event.gamma;
        this.lastRawBeta = beta;
        this.lastRawGamma = gamma;

        if (!this.hasCalibratedRef) {
            this.refBeta = beta;
            this.refGamma = gamma;
            this.hasCalibratedRef = true;
        }

        const angle = getScreenOrientationAngle();
        const spec = computeSpecularCoords(beta, gamma, this.refBeta, this.refGamma, angle);

        if (this.dynamicLightEnabled) {
            this.targetLightX = spec.xPct;
            this.targetLightY = spec.yPct;
            this._ensureLightLoop();
        }

        const curVec = computeSquareTiltVector(beta, gamma, angle);
        const refVec = computeSquareTiltVector(this.refBeta, this.refGamma, angle);
        const dx = curVec.x - refVec.x;
        const dy = curVec.y - refVec.y;
        this.onTiltUpdate?.({ xPct: spec.xPct, yPct: spec.yPct, dx, dy });

        if (this.gravityEnabled && !document.hidden) {
            const maxAbs = Math.max(Math.abs(dx), Math.abs(dy));
            if (maxAbs < this.releaseThresholdDeg) {
                this.gravityArmed = true;
                return;
            }

            const grav = computeGravityDirection(
                beta,
                gamma,
                this.refBeta,
                this.refGamma,
                angle,
                this.activationThresholdDeg
            );
            if (!grav) return;

            const now = performance.now();
            if (this.gravityArmed || (now - this.lastTriggerAt >= this.cooldownMs)) {
                this.gravityArmed = false;
                this.lastTriggerAt = now;
                this.onGravitySlide?.(grav.direction);
            }
        }
    }

    _ensureLightLoop() {
        if (this.lightRafId === null && this.dynamicLightEnabled) {
            this.lightRafId = requestAnimationFrame(this._stepLight);
        }
    }

    _stepLight() {
        this.lightRafId = null;
        if (!this.dynamicLightEnabled) return;

        const lerp = 0.22;
        this.currentLightX += (this.targetLightX - this.currentLightX) * lerp;
        this.currentLightY += (this.targetLightY - this.currentLightY) * lerp;

        document.documentElement.style.setProperty('--light-x', `${this.currentLightX.toFixed(1)}%`);
        document.documentElement.style.setProperty('--light-y', `${this.currentLightY.toFixed(1)}%`);

        const delta = Math.abs(this.targetLightX - this.currentLightX)
            + Math.abs(this.targetLightY - this.currentLightY);
        if (delta > 0.15) {
            this.lightRafId = requestAnimationFrame(this._stepLight);
        }
    }
}
