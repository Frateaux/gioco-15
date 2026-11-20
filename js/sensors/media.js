/**
 * Live Tile Media controller: 1:1 cropped Personal Photo mode and 60fps
 * split-canvas Live Camera mode via navigator.mediaDevices.getUserMedia.
 * Pure square-crop geometry helpers are exported for unit testing.
 */

/**
 * Computes a centered 1:1 square crop rectangle for any source dimensions.
 * @param {number} width
 * @param {number} height
 * @returns {{ sx: number, sy: number, side: number }}
 */
export function computeSquareCrop(width, height) {
    const safeW = Math.max(0, Math.floor(width));
    const safeH = Math.max(0, Math.floor(height));
    const side = Math.min(safeW, safeH);
    const sx = Math.floor((safeW - side) / 2);
    const sy = Math.floor((safeH - side) / 2);
    return { sx, sy, side };
}

/**
 * Computes the sub-rectangle inside a 1:1 crop belonging to `tileNum` (1-based).
 * @param {number} tileNum
 * @param {number} size
 * @param {{ sx: number, sy: number, side: number }} crop
 * @returns {{ sx: number, sy: number, sw: number, sh: number }}
 */
export function getTileSourceRect(tileNum, size, crop) {
    const targetIdx = tileNum - 1;
    const row = Math.floor(targetIdx / size);
    const col = targetIdx % size;
    const cell = crop.side / size;

    return {
        sx: crop.sx + col * cell,
        sy: crop.sy + row * cell,
        sw: cell,
        sh: cell,
    };
}

/**
 * Decodes an image File into an ImageBitmap or HTMLImageElement with safe cleanup.
 * @param {File} file
 * @returns {Promise<{ source: ImageBitmap|HTMLImageElement, width: number, height: number, release: () => void }>}
 */
async function decodeImageFile(file) {
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(file);
            return {
                source: bitmap,
                width: bitmap.width,
                height: bitmap.height,
                release: () => {
                    try {
                        bitmap.close();
                    } catch (_) {}
                },
            };
        } catch (_) {
            // Fall through to FileReader + Image fallback
        }
    }

    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('File read error'));
        reader.readAsDataURL(file);
    });

    const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Image decode error'));
        el.src = String(dataUrl);
    });

    return {
        source: img,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        release: () => {},
    };
}

export class LiveTileMediaController {
    /**
     * @param {object} [options]
     * @param {(state: { mode: 'none'|'photo'|'video', ok: boolean, message?: string, facingMode?: string }) => void} [options.onStateChange]
     */
    constructor({ onStateChange = null } = {}) {
        this.onStateChange = onStateChange;

        /** @type {'none'|'photo'|'video'} */
        this.mode = 'none';
        /** @type {'environment'|'user'} */
        this.facingMode = 'environment';
        this.mirrorVideo = false;
        this.size = 4;

        /** @type {Map<number, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D }>} */
        this.tileCanvases = new Map();
        this.photoCanvas = null;

        this.videoEl = null;
        this.stream = null;
        this.rafId = null;
        this.videoRequestId = 0;

        this._renderVideoFrame = this._renderVideoFrame.bind(this);
        this._handleVisibility = this._handleVisibility.bind(this);
        this._handlePageHide = this._handlePageHide.bind(this);

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this._handleVisibility);
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('pagehide', this._handlePageHide);
        }
    }

    /**
     * Returns true if the browser exposes navigator.mediaDevices.getUserMedia.
     * @returns {boolean}
     */
    isCameraSupported() {
        return typeof navigator !== 'undefined'
            && Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
    }

    /**
     * Returns true if a photo has already been cropped and cached in memory.
     * @returns {boolean}
     */
    hasPhoto() {
        return Boolean(this.photoCanvas);
    }

    /**
     * Attaches and sizes per-tile `<canvas>` elements after a board build.
     * @param {Map<number, HTMLElement>} tileElements
     * @param {number} size
     */
    bindTileCanvases(tileElements, size) {
        this.size = size;
        this.tileCanvases.clear();
        const tileRes = size === 3 ? 220 : size === 4 ? 170 : 136;

        for (const [num, tileEl] of tileElements.entries()) {
            const canvas = tileEl.querySelector('.tile-media-canvas');
            if (!canvas) continue;
            canvas.width = tileRes;
            canvas.height = tileRes;
            const ctx = canvas.getContext('2d', { alpha: false });
            if (ctx) {
                this.tileCanvases.set(num, { canvas, ctx });
            }
        }

        if (this.mode === 'photo' && this.photoCanvas) {
            this._drawSourceToTiles(this.photoCanvas, this.photoCanvas.width, this.photoCanvas.height, false);
        }
    }

    /**
     * Loads a user image file, center-crops it to 1:1, and activates Photo mode.
     * @param {File} file
     * @returns {Promise<boolean>}
     */
    async loadPhotoFile(file) {
        if (!file || (file.type && !file.type.startsWith('image/'))) {
            this.onStateChange?.({ mode: this.mode, ok: false, message: 'Seleziona un file immagine valido' });
            return false;
        }

        this.stopVideo();

        let decoded = null;
        try {
            decoded = await decodeImageFile(file);
            const crop = computeSquareCrop(decoded.width, decoded.height);
            if (crop.side <= 0) {
                throw new Error('Empty image dimensions');
            }

            const targetSide = Math.min(960, Math.max(320, crop.side));
            if (!this.photoCanvas) {
                this.photoCanvas = document.createElement('canvas');
            }
            this.photoCanvas.width = targetSide;
            this.photoCanvas.height = targetSide;

            const pCtx = this.photoCanvas.getContext('2d', { alpha: false });
            pCtx.drawImage(
                decoded.source,
                crop.sx,
                crop.sy,
                crop.side,
                crop.side,
                0,
                0,
                targetSide,
                targetSide
            );

            this.mode = 'photo';
            this._drawSourceToTiles(this.photoCanvas, targetSide, targetSide, false);
            this.onStateChange?.({ mode: 'photo', ok: true, message: '' });
            return true;
        } catch (_) {
            this.onStateChange?.({ mode: this.mode, ok: false, message: 'Impossibile leggere questa immagine' });
            return false;
        } finally {
            decoded?.release();
        }
    }

    /**
     * Reactivates an already-loaded photo without reopening the file picker.
     * @returns {boolean}
     */
    activateExistingPhoto() {
        if (!this.photoCanvas) return false;
        this.stopVideo();
        this.mode = 'photo';
        this._drawSourceToTiles(this.photoCanvas, this.photoCanvas.width, this.photoCanvas.height, false);
        this.onStateChange?.({ mode: 'photo', ok: true, message: '' });
        return true;
    }

    /**
     * Requests camera access on explicit user action and renders live video onto tiles at 60fps.
     * @param {'environment'|'user'} [facingMode=this.facingMode]
     * @returns {Promise<boolean>}
     */
    async startVideo(facingMode = this.facingMode) {
        if (!this.isCameraSupported()) {
            this.onStateChange?.({
                mode: this.mode,
                ok: false,
                message: 'Fotocamera non disponibile (richiede HTTPS o localhost)',
            });
            return false;
        }

        const previousMode = this.mode;
        this.stopVideo();
        const reqId = ++this.videoRequestId;

        let stream = null;
        try {
            stream = await this._acquireStream(facingMode);
        } catch (err) {
            if (reqId !== this.videoRequestId) return false;
            const msg = this._mapMediaError(err);
            this.mode = previousMode === 'photo' && this.photoCanvas ? 'photo' : 'none';
            if (this.mode === 'photo') {
                this._drawSourceToTiles(this.photoCanvas, this.photoCanvas.width, this.photoCanvas.height, false);
            }
            this.onStateChange?.({ mode: this.mode, ok: false, message: msg });
            return false;
        }

        // Anti-race guard: user switched mode or navigated while permission prompt was open
        if (reqId !== this.videoRequestId) {
            this._stopStreamTracks(stream);
            return false;
        }

        if (!this.videoEl) {
            const v = document.createElement('video');
            v.playsInline = true;
            v.muted = true;
            v.autoplay = true;
            this.videoEl = v;
        }

        const videoTrack = stream.getVideoTracks()[0];
        const actualFacing = videoTrack?.getSettings?.()?.facingMode || facingMode;
        this.facingMode = facingMode;
        this.mirrorVideo = actualFacing === 'user';

        this.stream = stream;
        this.videoEl.srcObject = stream;

        try {
            await this.videoEl.play();
        } catch (_) {}

        if (reqId !== this.videoRequestId) {
            this.stopVideo();
            return false;
        }

        this.mode = 'video';
        this._ensureVideoLoop();
        this.onStateChange?.({ mode: 'video', ok: true, message: '', facingMode: this.facingMode });
        return true;
    }

    /**
     * Switches between rear (`environment`) and front (`user`) cameras when Video Live is active.
     * @returns {Promise<boolean>}
     */
    async toggleCameraFacing() {
        const nextFacing = this.facingMode === 'environment' ? 'user' : 'environment';
        if (this.mode !== 'video') {
            this.facingMode = nextFacing;
            return false;
        }
        return this.startVideo(nextFacing);
    }

    /**
     * Stops any active camera stream and cancels the 60fps render loop.
     */
    stopVideo() {
        this.videoRequestId++;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.stream) {
            this._stopStreamTracks(this.stream);
            this.stream = null;
        }
        if (this.videoEl) {
            try {
                this.videoEl.pause();
                this.videoEl.srcObject = null;
            } catch (_) {}
        }
    }

    /**
     * Returns to classic numbered tiles and releases any camera stream cleanly.
     */
    clearMedia() {
        this.stopVideo();
        this.mode = 'none';
        for (const { canvas, ctx } of this.tileCanvases.values()) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        this.onStateChange?.({ mode: 'none', ok: true, message: '' });
    }

    destroy() {
        this.clearMedia();
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this._handleVisibility);
        }
        if (typeof window !== 'undefined') {
            window.removeEventListener('pagehide', this._handlePageHide);
        }
    }

    async _acquireStream(facingMode) {
        try {
            return await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: facingMode },
                    width: { ideal: 720 },
                    height: { ideal: 720 },
                },
                audio: false,
            });
        } catch (err) {
            if (err && (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError')) {
                return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            }
            throw err;
        }
    }

    _stopStreamTracks(stream) {
        try {
            for (const track of stream.getTracks()) {
                track.stop();
            }
        } catch (_) {}
    }

    _mapMediaError(err) {
        const name = err?.name || '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            return 'Permesso fotocamera negato dal browser';
        }
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
            return 'Nessuna fotocamera rilevata su questo dispositivo';
        }
        if (name === 'NotReadableError' || name === 'TrackStartError') {
            return 'Fotocamera occupata da un’altra applicazione';
        }
        return 'Impossibile avviare la fotocamera';
    }

    _ensureVideoLoop() {
        if (this.rafId === null && this.mode === 'video' && !document.hidden) {
            this.rafId = requestAnimationFrame(this._renderVideoFrame);
        }
    }

    _renderVideoFrame() {
        this.rafId = null;
        if (this.mode !== 'video' || !this.videoEl || document.hidden) return;

        if (this.videoEl.readyState >= 2 && this.videoEl.videoWidth > 0 && this.videoEl.videoHeight > 0) {
            this._drawSourceToTiles(
                this.videoEl,
                this.videoEl.videoWidth,
                this.videoEl.videoHeight,
                this.mirrorVideo
            );
        }

        this.rafId = requestAnimationFrame(this._renderVideoFrame);
    }

    _drawSourceToTiles(source, srcWidth, srcHeight, mirrorX) {
        const crop = computeSquareCrop(srcWidth, srcHeight);
        if (crop.side <= 0) return;

        for (const [num, { canvas, ctx }] of this.tileCanvases.entries()) {
            const rect = getTileSourceRect(num, this.size, crop);
            const dstW = canvas.width;
            const dstH = canvas.height;

            if (mirrorX) {
                const mirroredSx = crop.sx + crop.side - ((rect.sx - crop.sx) + rect.sw);
                ctx.save();
                ctx.translate(dstW, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(source, mirroredSx, rect.sy, rect.sw, rect.sh, 0, 0, dstW, dstH);
                ctx.restore();
            } else {
                ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, dstW, dstH);
            }
        }
    }

    _handleVisibility() {
        if (this.mode !== 'video') return;
        if (document.hidden) {
            if (this.rafId !== null) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
        } else {
            this._ensureVideoLoop();
        }
    }

    _handlePageHide() {
        this.stopVideo();
    }
}
