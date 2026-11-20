/**
 * Victory celebration modal controller with X-Ray analysis, Daily Share, and Speedsolving summary.
 */

function buildXRaySparkline(hCurve = []) {
    if (!hCurve || hCurve.length < 2) return '';
    const w = 260;
    const h = 36;
    const maxH = Math.max(1, ...hCurve);
    const pts = hCurve.map((val, idx) => {
        const x = 4 + (idx / (hCurve.length - 1)) * (w - 8);
        const y = 4 + (1 - val / maxH) * (h - 8);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `
        <svg class="xray-sparkline" viewBox="0 0 ${w} ${h}" aria-hidden="true">
            <polyline fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(' ')}" />
        </svg>
    `;
}

export class VictoryModal {
    /**
     * @param {object} options
     * @param {HTMLElement} options.modal
     * @param {HTMLElement} options.movesEl
     * @param {HTMLElement} options.timeEl
     * @param {HTMLElement} options.newRecordBadge
     * @param {HTMLElement} options.slotEl
     * @param {HTMLElement} options.playAgainBtn
     * @param {() => void} options.onPlayAgain
     */
    constructor({ modal, movesEl, timeEl, newRecordBadge, slotEl, playAgainBtn, onPlayAgain }) {
        this.modal = modal;
        this.movesEl = movesEl;
        this.timeEl = timeEl;
        this.newRecordBadge = newRecordBadge;
        this.slotEl = slotEl;
        this.playAgainBtn = playAgainBtn;
        this.onPlayAgain = onPlayAgain;
        this.isOpen = false;
        this._openTimer = null;

        this.playAgainBtn.addEventListener('click', () => {
            this.hide();
            this.onPlayAgain();
        });
    }

    /**
     * Opens the modal with celebratory stats, optional X-Ray, Daily share, or Speedsolving info.
     * @param {object} data
     */
    show({
        moves,
        formattedTime,
        isNewRecord,
        xray = null,
        dailyShareText = null,
        speedSummary = null,
        memorySummary = null,
        canReplay = false,
        onCopyDaily = null,
        onWatchReplay = null,
    }) {
        clearTimeout(this._openTimer);
        this.movesEl.textContent = String(moves);
        this.timeEl.textContent = formattedTime;
        this.newRecordBadge.classList.toggle('hidden', !isNewRecord);

        this._renderSlot({
            xray,
            dailyShareText,
            speedSummary,
            memorySummary,
            canReplay,
            onCopyDaily,
            onWatchReplay,
        });

        this._openTimer = setTimeout(() => {
            this.isOpen = true;
            this.modal.classList.add('is-open');
            this.modal.setAttribute('aria-hidden', 'false');
        }, 200);
    }

    /**
     * Updates only the X-Ray section asynchronously if the Worker responds slightly after opening.
     * @param {object} xray
     */
    updateXRay(xray) {
        if (!this.slotEl || !xray) return;
        const container = this.slotEl.querySelector('.xray-box');
        if (container) {
            container.outerHTML = this._renderXRayHtml(xray);
        }
    }

    _renderSlot({
        xray,
        dailyShareText,
        speedSummary,
        memorySummary,
        canReplay,
        onCopyDaily,
        onWatchReplay,
    }) {
        if (!this.slotEl) return;
        const blocks = [];

        if (speedSummary) {
            blocks.push(`
                <div class="speed-summary-box">
                    <div class="xray-header">
                        <span>Speedsolving WCA</span>
                        <span class="xray-efficiency">${speedSummary.tps} TPS</span>
                    </div>
                    <div class="mode-info-sub">
                        ${speedSummary.penaltyMs ? 'Penalità ispezione: +2.00s · ' : ''}Ao5: <strong>${speedSummary.ao5Label}</strong>
                    </div>
                </div>
            `);
        }

        if (memorySummary) {
            blocks.push(`
                <div class="speed-summary-box">
                    <div class="xray-header">
                        <span>Modalità Memoria</span>
                        <span class="xray-efficiency">${memorySummary.peeks} sbirciate</span>
                    </div>
                    <div class="mode-info-sub">
                        Penalità accumulata: +${Math.round(memorySummary.penaltyMs / 1000)}s
                    </div>
                </div>
            `);
        }

        if (xray) {
            blocks.push(this._renderXRayHtml(xray));
        }

        if (dailyShareText) {
            blocks.push(`
                <div class="daily-share-box">
                    <pre class="daily-share-pre" id="victoryDailyPre"></pre>
                    <button type="button" class="copy-daily-btn" id="victoryCopyDailyBtn">Copia risultato</button>
                </div>
            `);
        }

        if (canReplay) {
            blocks.push(`
                <button type="button" class="replay-btn" id="watchReplayBtn">
                    <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
                        <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    <span>Rivedi Replay (3s)</span>
                </button>
            `);
        }

        this.slotEl.innerHTML = blocks.join('');

        if (dailyShareText) {
            const pre = this.slotEl.querySelector('#victoryDailyPre');
            const copyBtn = this.slotEl.querySelector('#victoryCopyDailyBtn');
            if (pre) pre.textContent = dailyShareText;
            if (copyBtn && onCopyDaily) {
                copyBtn.addEventListener('click', async () => {
                    const ok = await onCopyDaily(dailyShareText);
                    copyBtn.textContent = ok ? 'Copiato!' : 'Copia non riuscita';
                    setTimeout(() => {
                        if (copyBtn.isConnected) copyBtn.textContent = 'Copia risultato';
                    }, 1800);
                });
            }
        }

        if (canReplay && onWatchReplay) {
            const replayBtn = this.slotEl.querySelector('#watchReplayBtn');
            replayBtn?.addEventListener('click', () => onWatchReplay());
        }
    }

    _renderXRayHtml(xray) {
        const parNote = xray.par ? `Par ${xray.optimal ? '' : '~'}${xray.par}` : 'Raggi X';
        const items = (xray.hotspots || [])
            .map((line) => `<li>${this._escapeHtml(line)}</li>`)
            .join('');
        return `
            <div class="xray-box">
                <div class="xray-header">
                    <span>Raggi X · ${parNote}</span>
                    <span class="xray-efficiency">${xray.efficiency}%</span>
                </div>
                <div class="xray-bar-track">
                    <div class="xray-bar-fill" style="width: ${xray.efficiency}%"></div>
                </div>
                ${buildXRaySparkline(xray.hCurve)}
                <ul class="xray-hotspots">${items}</ul>
            </div>
        `;
    }

    _escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    hide() {
        clearTimeout(this._openTimer);
        this.isOpen = false;
        this.modal.classList.remove('is-open');
        this.modal.setAttribute('aria-hidden', 'true');
    }
}
