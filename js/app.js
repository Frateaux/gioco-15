/**
 * Application orchestrator for Core, Spring Physics, Haptics, Procedural Materials,
 * Zen Audio, Gyroscope, Live Media, Local AI Solver, Daily, Speedsolving, Arcade, Ghost/Replay & PWA.
 */

import {
    applySlide,
    generateSolvableBoard,
    getTileForArrowKey,
    isBoardSolved,
} from './core/board.js';
import { HapticsEngine } from './core/haptics.js';
import { SpringPhysicsEngine } from './core/physics.js';
import { storage } from './core/storage.js';
import { ProceduralSoundEngine } from './audio/sound-engine.js';
import { GyroscopeController, getGravityTileForDirection } from './sensors/gyroscope.js';
import { LiveTileMediaController } from './sensors/media.js';
import { SolverClient } from './ai/solver-client.js';
import { computeManhattanAndLinearConflicts } from './ai/solver-core.js';
import {
    buildDailyShareText,
    copyTextToClipboard,
    generateDailyBoard,
    getTodayDateKey,
} from './modes/daily.js';
import {
    SpeedsolveController,
    buildTrendSvg,
    computeSpeedStats,
    formatCentiseconds,
} from './modes/speedsolve.js';
import { ArcadeController } from './modes/arcade.js';
import {
    ReplayController,
    computeGhostProgress,
    computePlayerProgress,
} from './modes/replay.js';
import { BoardRenderer } from './ui/board-renderer.js';
import { BottomSheetDrawer } from './ui/drawer.js';
import { VictoryModal } from './ui/victory-modal.js';

const THEME_META = {
    plastic: {
        subtitle: "Plastica Vintage '70",
        topBrand: '★ TAVOLETTA MAGICA ★',
        bottomCraft: 'MADE IN ITALY',
        themeColor: '#17110e',
    },
    walnut: {
        subtitle: 'Legno di Noce',
        topBrand: '★ EBANISTERIA ★',
        bottomCraft: 'NOCE MASSICCIO',
        themeColor: '#16110d',
    },
    glass: {
        subtitle: 'Vetro Satinato',
        topBrand: '◆ CRYSTAL EDITION ◆',
        bottomCraft: 'VETRO OTTICO',
        themeColor: '#0b1322',
    },
    aluminum: {
        subtitle: 'Alluminio Anodizzato',
        topBrand: 'CNC • SERIE ZERO',
        bottomCraft: 'ALLUMINIO 6061',
        themeColor: '#15181d',
    },
};

const AUDIO_LABELS = {
    material: 'Suono',
    zen: 'Zen',
    off: 'Muto',
};

const AUDIO_CYCLE = ['material', 'zen', 'off'];

function formatTime(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

class Gioco15App {
    constructor() {
        this.settings = storage.getSettings();
        this.board = [];
        this.moves = 0;
        this.elapsedMs = 0;
        this.startTimePerf = 0;
        this.timerInterval = null;
        this.timerRunning = false;
        this.isSolved = false;

        this.playMode = 'classic'; // 'classic' | 'daily' | 'speed'
        this.dailyDateKey = getTodayDateKey();
        this.initialPar = null;
        this.parOptimal = true;
        this.initialH = 1;
        this.runTrace = [];
        this.gameGenerationId = 0;

        this.isReplaying = false;
        this.lastRecording = null;
        this.lastVictoryData = null;
        this.activeGhostRecord = null;
        this.activeGhostRun = null;
        this.ghostInterval = null;

        this.physics = new SpringPhysicsEngine();
        this.haptics = new HapticsEngine(this.settings.haptics);
        this.sound = new ProceduralSoundEngine({
            mode: this.settings.audioMode,
            material: this.settings.theme,
        });

        this._cacheDOM();
        this._initControllers();
        this._bindEvents();
        this._applyAllSettingsToUI();
        this.startNewGame(this.settings.size, { silent: true });
    }

    _cacheDOM() {
        this.themeColorMeta = document.querySelector('meta[name="theme-color"]');
        this.brandBadge = document.getElementById('brandBadge');
        this.headerTitleNum = document.getElementById('headerTitleNum');
        this.materialSubtitle = document.getElementById('materialSubtitle');
        this.gridPillBtn = document.getElementById('gridPillBtn');
        this.gridBadgeText = document.getElementById('gridBadgeText');
        this.movesDisplay = document.getElementById('movesDisplay');
        this.parSubLabel = document.getElementById('parSubLabel');
        this.timeDisplay = document.getElementById('timeDisplay');
        this.bestDisplay = document.getElementById('bestDisplay');
        this.frameTopBrand = document.getElementById('frameTopBrand');
        this.gridSubLabel = document.getElementById('gridSubLabel');
        this.frameBottomCraft = document.getElementById('frameBottomCraft');
        this.boardWell = document.getElementById('boardWell');

        this.shuffleBtn = document.getElementById('shuffleBtn');
        this.hintBtn = document.getElementById('hintBtn');
        this.quickAudioBtn = document.getElementById('quickAudioBtn');
        this.quickAudioLabel = document.getElementById('quickAudioLabel');
        this.audioIconOn = document.getElementById('audioIconOn');
        this.audioIconOff = document.getElementById('audioIconOff');
        this.menuBtn = document.getElementById('menuBtn');

        this.sizeButtons = document.querySelectorAll('.size-btn');
        this.hintsToggleSwitch = document.getElementById('hintsToggleSwitch');
        this.hapticsToggleSwitch = document.getElementById('hapticsToggleSwitch');
        this.hapticsDesc = document.getElementById('hapticsDesc');
        this.themeCards = document.querySelectorAll('[data-theme-choice]');
        this.plasticVariantGroup = document.getElementById('plasticVariantGroup');
        this.plasticVarButtons = document.querySelectorAll('.plastic-var-btn');
        this.audioModeButtons = document.querySelectorAll('.audio-mode-btn');

        this.hudSlot = document.getElementById('hudSlot');
        this.ghostBarSlot = document.getElementById('ghostBarSlot');
        this.gyroLightSwitch = document.getElementById('gyroLightSwitch');
        this.gravityModeSwitch = document.getElementById('gravityModeSwitch');
        this.gyroSubActions = document.getElementById('gyroSubActions');
        this.recalibrateGyroBtn = document.getElementById('recalibrateGyroBtn');
        this.gyroStatusMsg = document.getElementById('gyroStatusMsg');

        this.mediaModeButtons = document.querySelectorAll('.media-mode-btn');
        this.photoFileInput = document.getElementById('photoFileInput');
        this.mediaSubActions = document.getElementById('mediaSubActions');
        this.changePhotoBtn = document.getElementById('changePhotoBtn');
        this.flipCameraBtn = document.getElementById('flipCameraBtn');
        this.mediaNumbersSwitch = document.getElementById('mediaNumbersSwitch');
        this.mediaStatusMsg = document.getElementById('mediaStatusMsg');

        this.playModeButtons = document.querySelectorAll('.play-mode-btn');
        this.dailyDateLabel = document.getElementById('dailyDateLabel');
        this.dailyStatusBadge = document.getElementById('dailyStatusBadge');
        this.dailyStatusDetail = document.getElementById('dailyStatusDetail');
        this.drawerCopyDailyBtn = document.getElementById('drawerCopyDailyBtn');
        this.speedStatsGridLabel = document.getElementById('speedStatsGridLabel');
        this.speedCountLabel = document.getElementById('speedCountLabel');
        this.speedPbVal = document.getElementById('speedPbVal');
        this.speedAo5Val = document.getElementById('speedAo5Val');
        this.speedAo12Val = document.getElementById('speedAo12Val');
        this.speedTpsVal = document.getElementById('speedTpsVal');
        this.speedTrendChart = document.getElementById('speedTrendChart');

        this.arcadeFogSwitch = document.getElementById('arcadeFogSwitch');
        this.arcadeIceSwitch = document.getElementById('arcadeIceSwitch');
        this.arcadeMemorySwitch = document.getElementById('arcadeMemorySwitch');

        this.exportBackupBtn = document.getElementById('exportBackupBtn');
        this.importBackupBtn = document.getElementById('importBackupBtn');
        this.importBackupInput = document.getElementById('importBackupInput');
        this.backupStatusMsg = document.getElementById('backupStatusMsg');
    }

    _initControllers() {
        this.solver = new SolverClient();
        this.replay = new ReplayController();
        this.arcade = new ArcadeController({
            onMemoryTick: (rem) => this._onArcadeMemoryTick(rem),
            onMemoryPhaseChange: () => {
                this._syncArcadeVisuals();
                this._renderHudSlot();
            },
        });
        this.speedsolve = new SpeedsolveController({
            onTick: (info) => this._onSpeedsolveTick(info),
            onAutoStart: () => {
                this.sound.playUI();
                this.haptics.vibrateUI();
            },
        });

        this.gyro = new GyroscopeController({
            onGravitySlide: (direction) => this._handleGravitySlide(direction),
            onStatusChange: ({ message }) => this._setStatusNote(this.gyroStatusMsg, message),
            onTiltUpdate: ({ dx, dy }) => this._updateTiltBubble(dx, dy),
        });

        this.media = new LiveTileMediaController({
            onStateChange: ({ message }) => {
                this._setStatusNote(this.mediaStatusMsg, message || '');
                this._syncSensorsAndMediaUI();
            },
        });

        this.boardRenderer = new BoardRenderer({
            boardWell: this.boardWell,
            physics: this.physics,
            getBoard: () => this.board,
            getSize: () => this.settings.size,
            getPlasticVariant: () => this.settings.plasticVariant,
            isSolved: () => this.isSolved || this.isReplaying,
            onSlideRequest: (tileNum, requiredDir, opts) => this.handleSlide(tileNum, requiredDir, opts),
            onPointerInteract: () => this.sound.unlock(),
            onBoardBuilt: (tileElements, size) => {
                this.media.bindTileCanvases(tileElements, size);
                this._syncSensorsAndMediaUI();
                this._syncArcadeVisuals();
            },
        });

        this.drawer = new BottomSheetDrawer({
            drawer: document.getElementById('settingsDrawer'),
            backdrop: document.getElementById('drawerBackdrop'),
            dragHandle: document.getElementById('sheetDragHandle'),
            closeBtn: document.getElementById('closeDrawerBtn'),
            triggerBtn: this.menuBtn,
            onToggleFeedback: () => {
                this.sound.playUI();
                this.haptics.vibrateUI();
            },
        });

        this.victoryModal = new VictoryModal({
            modal: document.getElementById('victoryModal'),
            movesEl: document.getElementById('modalMoves'),
            timeEl: document.getElementById('modalTime'),
            newRecordBadge: document.getElementById('newRecordBadge'),
            slotEl: document.getElementById('victorySlot'),
            playAgainBtn: document.getElementById('playAgainBtn'),
            onPlayAgain: () => this.startNewGame(this.settings.size),
        });
    }

    _bindEvents() {
        this.shuffleBtn.addEventListener('click', () => {
            this.sound.unlock();
            this.startNewGame(this.settings.size);
        });

        this.hintBtn.addEventListener('click', async () => {
            this.sound.unlock();
            await this._requestHint();
        });

        this.playModeButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.playMode;
                if (!mode || mode === this.playMode) return;
                this.playMode = mode;
                this.sound.playUI();
                this.haptics.vibrateUI();
                this.startNewGame(this.settings.size);
            });
        });

        this.drawerCopyDailyBtn.addEventListener('click', async () => {
            const saved = storage.getDailyResult(this.dailyDateKey, this.settings.size);
            if (!saved) return;
            const shareText = buildDailyShareText({
                dateKey: saved.dateKey,
                size: saved.size,
                formattedTime: formatTime(Math.floor(saved.ms / 1000)),
                moves: saved.moves,
                par: saved.par,
                parOptimal: saved.parOptimal,
                efficiency: saved.efficiency,
            });
            const ok = await copyTextToClipboard(shareText);
            this.drawerCopyDailyBtn.textContent = ok ? 'Copiato!' : 'Copia non riuscita';
            setTimeout(() => {
                this.drawerCopyDailyBtn.textContent = 'Copia risultato di oggi';
            }, 1800);
        });

        // Arcade modifiers
        const bindArcadeSwitch = (btn, modName) => {
            btn.addEventListener('click', () => {
                this.sound.unlock();
                this.arcade.setModifier(modName, !this.arcade.modifiers[modName]);
                this.sound.playUI();
                this.haptics.vibrateUI();
                this.startNewGame(this.settings.size, { silent: true });
            });
        };
        bindArcadeSwitch(this.arcadeFogSwitch, 'fog');
        bindArcadeSwitch(this.arcadeIceSwitch, 'ice');
        bindArcadeSwitch(this.arcadeMemorySwitch, 'memory');

        // Backup Export / Import JSON
        this.exportBackupBtn.addEventListener('click', () => {
            this.sound.playUI();
            this.haptics.vibrateUI();
            try {
                const json = storage.exportBackupJSON();
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `gioco15-backup-${getTodayDateKey()}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                this._setStatusNote(this.backupStatusMsg, 'Backup JSON esportato correttamente.');
            } catch (_) {
                this._setStatusNote(this.backupStatusMsg, 'Impossibile esportare il backup su questo browser.');
            }
        });

        this.importBackupBtn.addEventListener('click', () => {
            this.sound.playUI();
            this.importBackupInput.click();
        });

        this.importBackupInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
                const text = await file.text();
                const res = storage.importBackupJSON(text);
                if (!res.ok) {
                    this._setStatusNote(this.backupStatusMsg, res.error || 'Importazione fallita.');
                    return;
                }
                this.settings = storage.getSettings();
                this.sound.setMode(this.settings.audioMode);
                this.sound.setMaterial(this.settings.theme);
                this.haptics.setEnabled(this.settings.haptics);
                this._applyAllSettingsToUI();
                this.boardRenderer.build();
                this._renderGhostBar();
                this._setStatusNote(
                    this.backupStatusMsg,
                    `Backup importato (${res.stats.records} record, ${res.stats.speedsolves} solve WCA).`
                );
                this.sound.playUI();
                this.haptics.vibrateUI();
            } catch (_) {
                this._setStatusNote(this.backupStatusMsg, 'Errore durante la lettura del file JSON.');
            }
        });

        this.gridPillBtn.addEventListener('click', () => {
            this.sound.playUI();
            this.haptics.vibrateUI();
            this.drawer.open('game');
        });

        this.quickAudioBtn.addEventListener('click', () => {
            this.sound.unlock();
            const currentIdx = AUDIO_CYCLE.indexOf(this.settings.audioMode);
            const nextMode = AUDIO_CYCLE[(currentIdx + 1) % AUDIO_CYCLE.length];
            this._updateSettings({ audioMode: nextMode });
            this.sound.playUI();
            this.haptics.vibrateUI();
        });

        this.sizeButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const nextSize = Number(btn.dataset.size);
                if (nextSize === this.settings.size) return;
                this.sound.unlock();
                this.startNewGame(nextSize);
            });
        });

        this.hintsToggleSwitch.addEventListener('click', () => {
            this._updateSettings({ showHints: !this.settings.showHints });
            this.sound.playUI();
            this.haptics.vibrateUI();
        });

        this.hapticsToggleSwitch.addEventListener('click', () => {
            this._updateSettings({ haptics: !this.settings.haptics });
            this.sound.playUI();
            this.haptics.vibrateUI();
        });

        this.themeCards.forEach((card) => {
            card.addEventListener('click', () => {
                const nextTheme = card.dataset.themeChoice;
                if (nextTheme === this.settings.theme) return;
                this._updateSettings({ theme: nextTheme });
                this.sound.playUI();
                this.haptics.vibrateUI();
            });
        });

        this.plasticVarButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const variant = btn.dataset.plasticVar;
                if (variant === this.settings.plasticVariant) return;
                this._updateSettings({ plasticVariant: variant });
                this.boardRenderer.build();
                this.sound.playUI();
                this.haptics.vibrateUI();
            });
        });

        this.audioModeButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.audioMode;
                if (mode === this.settings.audioMode) return;
                this._updateSettings({ audioMode: mode });
                this.sound.playUI();
                this.haptics.vibrateUI();
            });
        });

        // Gyroscope & Gravity controls
        this.gyroLightSwitch.addEventListener('click', async () => {
            this.sound.unlock();
            const next = !this.gyro.dynamicLightEnabled;
            await this.gyro.setDynamicLight(next);
            this.sound.playUI();
            this.haptics.vibrateUI();
            this._syncSensorsAndMediaUI();
        });

        this.gravityModeSwitch.addEventListener('click', async () => {
            this.sound.unlock();
            const next = !this.gyro.gravityEnabled;
            await this.gyro.setGravityMode(next);
            this.sound.playUI();
            this.haptics.vibrateUI();
            this._syncSensorsAndMediaUI();
        });

        this.recalibrateGyroBtn.addEventListener('click', () => {
            this.gyro.recalibrate();
            this.sound.playUI();
            this.haptics.vibrateUI();
        });

        // Live Tile Media controls (Numbers / 1:1 Photo / Live Camera)
        this.mediaModeButtons.forEach((btn) => {
            btn.addEventListener('click', async () => {
                this.sound.unlock();
                const target = btn.dataset.mediaMode;
                if (target === 'none') {
                    this.media.clearMedia();
                    this.sound.playUI();
                    this.haptics.vibrateUI();
                } else if (target === 'photo') {
                    if (this.media.hasPhoto() && this.media.mode !== 'photo') {
                        this.media.activateExistingPhoto();
                        this.sound.playUI();
                        this.haptics.vibrateUI();
                    } else {
                        this.photoFileInput.click();
                    }
                } else if (target === 'video') {
                    await this.media.startVideo();
                    this.sound.playUI();
                    this.haptics.vibrateUI();
                }
            });
        });

        this.photoFileInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            await this.media.loadPhotoFile(file);
            this.sound.playUI();
            this.haptics.vibrateUI();
        });

        this.changePhotoBtn.addEventListener('click', () => {
            this.photoFileInput.click();
        });

        this.flipCameraBtn.addEventListener('click', async () => {
            this.sound.unlock();
            await this.media.toggleCameraFacing();
            this.sound.playUI();
            this.haptics.vibrateUI();
        });

        this.mediaNumbersSwitch.addEventListener('click', () => {
            this._updateSettings({ showMediaNumbers: !this.settings.showMediaNumbers });
            this.sound.playUI();
            this.haptics.vibrateUI();
        });

        // Delegate quick controls inside #hudSlot
        this.hudSlot.addEventListener('click', async (e) => {
            const actionBtn = e.target.closest('[data-hud-action]');
            if (!actionBtn) return;
            const action = actionBtn.dataset.hudAction;
            this.sound.unlock();
            if (action === 'recalibrate-gyro') {
                this.gyro.recalibrate();
            } else if (action === 'disable-gravity') {
                await this.gyro.setGravityMode(false);
                this._syncSensorsAndMediaUI();
            } else if (action === 'toggle-media-numbers') {
                this._updateSettings({ showMediaNumbers: !this.settings.showMediaNumbers });
            } else if (action === 'flip-camera') {
                await this.media.toggleCameraFacing();
            } else if (action === 'clear-media') {
                this.media.clearMedia();
            } else if (action === 'start-memory-blind') {
                this.arcade.forceStartBlind();
            } else if (action === 'peek-memory') {
                this.arcade.triggerPeek(2500, 5000);
            } else if (action === 'stop-replay') {
                this._stopReplay(true);
            }
            this.sound.playUI();
            this.haptics.vibrateUI();
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.isReplaying) {
                    this._stopReplay(true);
                } else if (this.drawer.isOpen) {
                    this.drawer.close();
                } else if (this.victoryModal.isOpen) {
                    this.victoryModal.hide();
                }
                return;
            }

            if (this.isSolved || this.isReplaying || this.drawer.isOpen || this.victoryModal.isOpen) return;
            const targetTile = getTileForArrowKey(this.board, this.settings.size, e.key);
            if (targetTile !== null) {
                e.preventDefault();
                this.sound.unlock();
                this.handleSlide(targetTile, null, { fromDrag: false });
            }
        });
    }

    _updateSettings(partial) {
        this.settings = storage.saveSettings(partial);
        this.sound.setMode(this.settings.audioMode);
        this.sound.setMaterial(this.settings.theme);
        this.haptics.setEnabled(this.settings.haptics);
        this._applyAllSettingsToUI();
    }

    _applyAllSettingsToUI() {
        const { size, theme, plasticVariant, audioMode, haptics, showHints } = this.settings;
        const maxTile = size * size - 1;
        const meta = THEME_META[theme] || THEME_META.plastic;

        document.body.dataset.theme = theme;
        document.body.dataset.plasticVariant = plasticVariant;
        if (this.themeColorMeta) {
            this.themeColorMeta.setAttribute('content', meta.themeColor);
        }

        this.brandBadge.textContent = String(maxTile);
        this.headerTitleNum.textContent = String(maxTile);
        this.materialSubtitle.textContent = meta.subtitle;
        this.frameTopBrand.textContent = meta.topBrand;
        this.frameBottomCraft.textContent = meta.bottomCraft;
        this.gridBadgeText.textContent = `${size}×${size}`;
        this.gridSubLabel.textContent = `N° 1 - ${maxTile}`;

        this.boardRenderer.setShowHints(showHints);

        // Quick audio chip
        this.quickAudioLabel.textContent = AUDIO_LABELS[audioMode] || 'Suono';
        const muted = audioMode === 'off';
        this.audioIconOn.classList.toggle('hidden', muted);
        this.audioIconOff.classList.toggle('hidden', !muted);

        // Drawer controls sync
        this.sizeButtons.forEach((btn) => {
            btn.classList.toggle('is-active', Number(btn.dataset.size) === size);
        });

        this.hintsToggleSwitch.setAttribute('aria-checked', String(showHints));
        this.hapticsToggleSwitch.setAttribute('aria-checked', String(haptics));
        if (!this.haptics.isSupported()) {
            this.hapticsDesc.textContent = 'Vibrazione non supportata su questo dispositivo (modalità silenziosa)';
        } else {
            this.hapticsDesc.textContent = 'Vibrazione proporzionale al numero di tessere spinte';
        }

        this.themeCards.forEach((card) => {
            card.classList.toggle('is-active', card.dataset.themeChoice === theme);
        });

        this.plasticVariantGroup.classList.toggle('hidden', theme !== 'plastic');
        this.plasticVarButtons.forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.plasticVar === plasticVariant);
        });

        this.audioModeButtons.forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.audioMode === audioMode);
        });

        this._syncSensorsAndMediaUI();
        this._syncModesUI();
        this._updateBestDisplay();
    }

    _setStatusNote(el, message) {
        if (!el) return;
        const text = (message || '').trim();
        el.textContent = text;
        el.classList.toggle('hidden', text.length === 0);
    }

    _updateTiltBubble(dx, dy) {
        const bubble = this.hudSlot.querySelector('.tilt-bubble');
        if (!bubble) return;
        const maxShift = 4.5;
        const shiftX = Math.max(-maxShift, Math.min(maxShift, (dx / 25) * maxShift));
        const shiftY = Math.max(-maxShift, Math.min(maxShift, (dy / 25) * maxShift));
        bubble.style.transform = `translate3d(${shiftX.toFixed(1)}px, ${shiftY.toFixed(1)}px, 0)`;
    }

    _syncSensorsAndMediaUI() {
        if (!this.gyro || !this.media) return;

        const { showMediaNumbers } = this.settings;
        const mediaMode = this.media.mode;
        const mediaActive = mediaMode === 'photo' || mediaMode === 'video';

        this.gyroLightSwitch.setAttribute('aria-checked', String(this.gyro.dynamicLightEnabled));
        this.gravityModeSwitch.setAttribute('aria-checked', String(this.gyro.gravityEnabled));
        this.gyroSubActions.classList.toggle('hidden', !this.gyro.gravityEnabled);

        this.mediaModeButtons.forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.mediaMode === mediaMode);
        });

        this.mediaSubActions.classList.toggle('hidden', !mediaActive);
        this.changePhotoBtn.classList.toggle('hidden', mediaMode !== 'photo');
        this.flipCameraBtn.classList.toggle('hidden', mediaMode !== 'video');
        this.mediaNumbersSwitch.setAttribute('aria-checked', String(showMediaNumbers));

        this.boardRenderer.setMediaState({ active: mediaActive, showNumbers: showMediaNumbers });
        this._renderHudSlot();
    }

    _renderHudSlot() {
        if (this.isReplaying) {
            this.hudSlot.innerHTML = `
                <div class="hud-pill hud-pill--replay">
                    <span>Replay 3s</span>
                    <div class="replay-mini-track"><div id="replayProgressFill" class="replay-mini-fill"></div></div>
                    <button type="button" class="hud-pill-btn hud-pill-btn--danger" data-hud-action="stop-replay">Chiudi</button>
                </div>
            `;
            return;
        }

        const pills = [];

        if (this.playMode === 'daily') {
            pills.push(`
                <div class="hud-pill hud-pill--daily">
                    <span>Sfida ${this.dailyDateKey}</span>
                </div>
            `);
        } else if (this.playMode === 'speed') {
            const phase = this.speedsolve.phase;
            let speedClass = 'hud-pill hud-pill--speed';
            let inner = '';
            if (phase === 'inspecting') {
                const rem = Math.max(0, 15 - (performance.now() - this.speedsolve.inspectionStartPerf) / 1000);
                if (rem <= 3) speedClass += ' is-danger';
                else if (rem <= 5) speedClass += ' is-warn';
                inner = `<span>Ispezione</span><span id="speedHudMetric" class="hud-mono">${rem.toFixed(1)}s</span>`;
            } else {
                const metrics = this.speedsolve.getLiveMetrics(this.moves);
                const pen = metrics.penaltyMs ? ' (+2)' : '';
                inner = `<span>WCA${pen}</span><span id="speedHudMetric" class="hud-mono">${metrics.tps.toFixed(2)} TPS</span>`;
            }
            pills.push(`<div id="speedHudPill" class="${speedClass}">${inner}</div>`);
        }

        if (this.arcade?.iceMovesLeft > 0) {
            pills.push(`
                <div class="hud-pill hud-pill--speed">
                    <span>Ghiaccio: <strong id="iceMovesBadge">${this.arcade.iceMovesLeft}</strong></span>
                </div>
            `);
        }

        if (this.arcade?.modifiers.memory && !this.isSolved) {
            const mPhase = this.arcade.memoryPhase;
            if (mPhase === 'memorize') {
                const rem = this.arcade.memoryRemainingSec.toFixed(1);
                pills.push(`
                    <div class="hud-pill hud-pill--memory">
                        <span>Memoria</span>
                        <span id="memoryHudMetric" class="hud-mono">${rem}s</span>
                        <button type="button" class="hud-pill-btn" data-hud-action="start-memory-blind">Inizia</button>
                    </div>
                `);
            } else if (mPhase === 'blind') {
                pills.push(`
                    <div class="hud-pill hud-pill--memory">
                        <span>Cieca</span>
                        <button type="button" class="hud-pill-btn" data-hud-action="peek-memory">Sbircia (+5s)</button>
                    </div>
                `);
            } else if (mPhase === 'peeking') {
                pills.push(`
                    <div class="hud-pill hud-pill--memory">
                        <span>Sbirciata attiva…</span>
                    </div>
                `);
            }
        }

        if (this.gyro?.gravityEnabled) {
            pills.push(`
                <div class="hud-pill">
                    <span class="tilt-indicator" aria-hidden="true"><span class="tilt-bubble"></span></span>
                    <span>Gravità</span>
                    <button type="button" class="hud-pill-btn" data-hud-action="recalibrate-gyro">Calibra</button>
                    <button type="button" class="hud-pill-btn hud-pill-btn--danger" data-hud-action="disable-gravity" aria-label="Disattiva gravità">×</button>
                </div>
            `);
        }

        if (this.media?.mode === 'photo' || this.media?.mode === 'video') {
            const isVideo = this.media.mode === 'video';
            const label = isVideo ? 'Video Live' : 'Foto 1:1';
            const indicator = isVideo ? '<span class="live-dot" aria-hidden="true"></span>' : '';
            const camBtn = isVideo
                ? '<button type="button" class="hud-pill-btn" data-hud-action="flip-camera" title="Cambia fotocamera">Cam</button>'
                : '';

            pills.push(`
                <div class="hud-pill">
                    ${indicator}
                    <span>${label}</span>
                    <button type="button" class="hud-pill-btn" data-hud-action="toggle-media-numbers" title="Mostra/nascondi numeri">#</button>
                    ${camBtn}
                    <button type="button" class="hud-pill-btn hud-pill-btn--danger" data-hud-action="clear-media" aria-label="Torna ai numeri">×</button>
                </div>
            `);
        }

        this.hudSlot.innerHTML = pills.join('');
    }

    _onArcadeMemoryTick(rem) {
        const el = document.getElementById('memoryHudMetric');
        if (el) el.textContent = `${rem.toFixed(1)}s`;
    }

    _syncArcadeVisuals() {
        if (!this.arcade || !this.boardRenderer) return;
        this.boardRenderer.applyArcadeState(this.arcade.getSnapshot(this.board, this.settings.size));
    }

    _renderGhostBar() {
        if (this.isReplaying) {
            this.ghostBarSlot.innerHTML = '';
            return;
        }
        const size = this.settings.size;
        this.activeGhostRecord = storage.getBestRecord(size);
        this.activeGhostRun = storage.getGhostRun(size);

        if (!this.activeGhostRecord && !this.activeGhostRun) {
            this.ghostBarSlot.innerHTML = '';
            return;
        }

        const pbSec = this.activeGhostRecord ? formatTime(this.activeGhostRecord.seconds) : '--:--';
        this.ghostBarSlot.innerHTML = `
            <div class="ghost-race-bar" title="Confronto in tempo reale con il tuo Record Personale">
                <span class="ghost-race-label">Ghost PB (${pbSec})</span>
                <div class="ghost-track">
                    <div id="ghostPlayerFill" class="ghost-player-fill"></div>
                    <div id="ghostMarker" class="ghost-marker"></div>
                </div>
                <span id="ghostDelta" class="ghost-delta">0%</span>
            </div>
        `;
        this._updateGhostBarProgress();
    }

    _updateGhostBarProgress() {
        const fillEl = document.getElementById('ghostPlayerFill');
        const markerEl = document.getElementById('ghostMarker');
        const deltaEl = document.getElementById('ghostDelta');
        if (!fillEl || !markerEl || !deltaEl) return;

        const currentH = computeManhattanAndLinearConflicts(this.board, this.settings.size);
        const playerPct = computePlayerProgress({
            currentH,
            initialH: this.initialH,
            isSolved: this.isSolved,
        });
        const curMs = this.playMode === 'speed'
            ? this.speedsolve.getLiveMetrics(this.moves).elapsedMs
            : (this.timerRunning ? performance.now() - this.startTimePerf : this.elapsedMs);
        const ghostPct = computeGhostProgress({
            elapsedMs: curMs,
            bestRecord: this.activeGhostRecord,
            ghostRun: this.activeGhostRun,
        }) ?? 0;

        fillEl.style.width = `${playerPct}%`;
        markerEl.style.left = `${ghostPct}%`;
        const diff = playerPct - ghostPct;
        deltaEl.textContent = diff >= 0 ? `+${diff}%` : `${diff}%`;
    }

    _startGhostUpdater() {
        clearInterval(this.ghostInterval);
        this.ghostInterval = setInterval(() => this._updateGhostBarProgress(), 150);
    }

    _stopGhostUpdater() {
        clearInterval(this.ghostInterval);
        this.ghostInterval = null;
    }

    _syncModesUI() {
        const size = this.settings.size;
        this.dailyDateKey = getTodayDateKey();

        this.playModeButtons.forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.playMode === this.playMode);
        });

        this.arcadeFogSwitch.setAttribute('aria-checked', String(this.arcade.modifiers.fog));
        this.arcadeIceSwitch.setAttribute('aria-checked', String(this.arcade.modifiers.ice));
        this.arcadeMemorySwitch.setAttribute('aria-checked', String(this.arcade.modifiers.memory));

        this.dailyDateLabel.textContent = this.dailyDateKey;
        const dailySaved = storage.getDailyResult(this.dailyDateKey, size);
        if (dailySaved) {
            this.dailyStatusBadge.textContent = 'Completata';
            this.dailyStatusDetail.textContent = `${dailySaved.moves} mosse · ${formatTime(Math.floor(dailySaved.ms / 1000))} · ${dailySaved.efficiency}% efficienza`;
            this.drawerCopyDailyBtn.classList.remove('hidden');
        } else {
            this.dailyStatusBadge.textContent = 'Da completare';
            this.dailyStatusDetail.textContent = `Configurazione deterministica ${size}×${size} del giorno.`;
            this.drawerCopyDailyBtn.classList.add('hidden');
        }

        const solves = storage.getSpeedsolves(size);
        const stats = computeSpeedStats(solves);
        this.speedStatsGridLabel.textContent = `${size}×${size}`;
        this.speedCountLabel.textContent = `${stats.count} solve`;
        this.speedPbVal.textContent = stats.bestMs !== null ? formatCentiseconds(stats.bestMs) : '--';
        this.speedAo5Val.textContent = stats.ao5Ms !== null ? formatCentiseconds(stats.ao5Ms) : '--';
        this.speedAo12Val.textContent = stats.ao12Ms !== null ? formatCentiseconds(stats.ao12Ms) : '--';
        this.speedTpsVal.textContent = stats.count > 0 ? stats.avgTps.toFixed(2) : '--';
        this.speedTrendChart.innerHTML = buildTrendSvg(solves);
    }

    _onSpeedsolveTick({ phase, remainingSec, penaltyMs }) {
        if (this.playMode !== 'speed' || this.isSolved) return;

        if (phase === 'solving') {
            const metrics = this.speedsolve.getLiveMetrics(this.moves);
            this.timeDisplay.textContent = formatCentiseconds(metrics.totalMs);
        } else if (phase === 'inspecting') {
            this.timeDisplay.textContent = penaltyMs ? '+2.00' : '00:00.00';
        }

        const pill = document.getElementById('speedHudPill');
        const metricEl = document.getElementById('speedHudMetric');
        if (!pill || !metricEl) {
            this._renderHudSlot();
            return;
        }

        if (phase === 'inspecting') {
            pill.classList.toggle('is-warn', remainingSec <= 5 && remainingSec > 3);
            pill.classList.toggle('is-danger', remainingSec <= 3);
            metricEl.textContent = penaltyMs ? '+2s' : `${remainingSec.toFixed(1)}s`;
        } else {
            pill.classList.remove('is-warn', 'is-danger');
            const metrics = this.speedsolve.getLiveMetrics(this.moves);
            pill.firstElementChild.textContent = penaltyMs ? 'WCA (+2)' : 'WCA';
            metricEl.textContent = `${metrics.tps.toFixed(2)} TPS`;
        }
    }

    async _computeInitialPar(genId) {
        this.parSubLabel.classList.remove('hidden');
        this.parSubLabel.textContent = 'Par …';

        const res = await this.solver.computePar(this.board, this.settings.size);
        if (!res || genId !== this.gameGenerationId) return;

        this.initialPar = res.par;
        this.parOptimal = Boolean(res.optimal);
        this.parSubLabel.textContent = `Par ${this.parOptimal ? '' : '~'}${this.initialPar}`;
    }

    async _requestHint() {
        if (this.isSolved || this.isReplaying) return;
        const genId = this.gameGenerationId;
        const boardSnapshot = this.board.slice();

        this.hintBtn.disabled = true;
        try {
            const res = await this.solver.getHint(boardSnapshot, this.settings.size);
            if (!res || genId !== this.gameGenerationId || this.isSolved || this.isReplaying) return;
            if (boardSnapshot.some((v, idx) => v !== this.board[idx])) return;

            let chosenTile = res.hintTile;
            if (chosenTile) {
                const candidateSlide = applySlide(this.board, this.settings.size, chosenTile);
                if (!candidateSlide || this.arcade.isBlocked(candidateSlide.movedTiles)) {
                    chosenTile = this._findBestNonFrozenTile();
                }
            }

            if (chosenTile) {
                this.boardRenderer.setHintTile(chosenTile);
                this.sound.playUI();
                this.haptics.vibrateUI();
            }
        } finally {
            this.hintBtn.disabled = false;
        }
    }

    _findBestNonFrozenTile() {
        const size = this.settings.size;
        const emptyIdx = this.board.indexOf(0);
        const er = Math.floor(emptyIdx / size);
        const ec = emptyIdx % size;
        let bestTile = null;
        let bestH = Infinity;

        const neighbors = [];
        if (er > 0) neighbors.push(this.board[(er - 1) * size + ec]);
        if (er < size - 1) neighbors.push(this.board[(er + 1) * size + ec]);
        if (ec > 0) neighbors.push(this.board[er * size + (ec - 1)]);
        if (ec < size - 1) neighbors.push(this.board[er * size + (ec + 1)]);

        for (const t of neighbors) {
            if (this.arcade.isBlocked([t])) continue;
            const sim = applySlide(this.board, size, t);
            if (!sim) continue;
            const h = computeManhattanAndLinearConflicts(sim.board, size);
            if (h < bestH) {
                bestH = h;
                bestTile = t;
            }
        }
        return bestTile;
    }

    _handleGravitySlide(direction) {
        if (this.isSolved || this.drawer.isOpen || this.victoryModal.isOpen) return;
        const tileNum = getGravityTileForDirection(this.board, this.settings.size, direction);
        if (tileNum !== null) {
            this.handleSlide(tileNum, direction, { fromDrag: false });
        }
    }

    _updateBestDisplay() {
        const best = storage.getBestRecord(this.settings.size);
        if (!best) {
            this.bestDisplay.textContent = '-- / --:--';
            return;
        }
        this.bestDisplay.textContent = `${best.moves}m / ${formatTime(best.seconds)}`;
    }

    _startTimerIfNeeded() {
        if (this.timerRunning || this.isSolved) return;
        this.timerRunning = true;
        this.startTimePerf = performance.now();
        this.timerInterval = setInterval(() => {
            this.elapsedMs = performance.now() - this.startTimePerf;
            this.timeDisplay.textContent = formatTime(Math.floor(this.elapsedMs / 1000));
        }, 250);
    }

    _stopTimer() {
        if (this.timerRunning) {
            this.elapsedMs = performance.now() - this.startTimePerf;
        }
        this.timerRunning = false;
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    /**
     * Executes a single or multi-tile slide and updates physics, audio, haptics, and state.
     * @param {number} tileNum
     * @param {'UP'|'DOWN'|'LEFT'|'RIGHT'|null} [requiredDir=null]
     * @param {object} [options]
     * @returns {boolean}
     */
    handleSlide(tileNum, requiredDir = null, { fromDrag = false, movedTiles = null, releaseVelocity = 0, axis = 'x' } = {}) {
        if (this.isSolved || this.isReplaying) return false;

        const size = this.settings.size;
        const hBefore = computeManhattanAndLinearConflicts(this.board, size);
        const result = applySlide(this.board, size, tileNum, requiredDir);
        if (!result) return false;

        if (this.arcade.isBlocked(result.movedTiles)) {
            this.boardRenderer.triggerIceShake(result.movedTiles);
            this.sound.playIceBlocked();
            this.haptics.vibrateUI();
            return false;
        }

        this.board = result.board;
        if (this.playMode === 'speed') {
            this.speedsolve.onFirstMove();
        } else {
            this._startTimerIfNeeded();
        }

        this._startGhostUpdater();

        const moveMs = this.playMode === 'speed'
            ? this.speedsolve.getLiveMetrics(this.moves + 1).elapsedMs
            : (this.timerRunning ? performance.now() - this.startTimePerf : this.elapsedMs);
        this.replay.recordMove(tileNum, moveMs);

        this.moves++;
        this.movesDisplay.textContent = String(this.moves);

        const arcadeTick = this.arcade.onValidMove();
        if (arcadeTick.thawed) {
            this.sound.playIceThaw();
        }

        const hAfter = computeManhattanAndLinearConflicts(this.board, size);
        this.runTrace.push({
            moveIndex: this.moves,
            tile: tileNum,
            count: result.count,
            hBefore,
            hAfter,
            deltaH: hAfter - hBefore,
        });
        this.boardRenderer.setHintTile(null);

        if (fromDrag) {
            this.physics.commitDrag(movedTiles || result.movedTiles, this.board, size, releaseVelocity, axis);
        } else {
            this.physics.setTargetsFromBoard(this.board, size, {
                impulseTiles: result.movedTiles,
                axis: result.axis,
                sign: result.sign,
                initialSpeed: 4.5,
            });
        }

        if (this.playMode === 'speed') {
            this._onSpeedsolveTick({
                phase: this.speedsolve.phase,
                remainingSec: 0,
                penaltyMs: this.speedsolve.penaltyMs,
            });
        } else if (arcadeTick.becameBlind || arcadeTick.thawed || this.arcade.iceMovesLeft > 0) {
            this._renderHudSlot();
        }

        this._syncArcadeVisuals();
        this._updateGhostBarProgress();
        this.boardRenderer.updateCorrectStates(this.board);
        this.sound.playSlide({
            count: result.count,
            primaryTile: tileNum,
            newlyCorrectTiles: result.newlyCorrectTiles,
        });
        this.haptics.vibrateSlide(result.count);

        if (isBoardSolved(this.board)) {
            this._handleVictory();
        }

        return true;
    }

    async _handleVictory() {
        this.isSolved = true;
        this._stopTimer();
        this._stopGhostUpdater();
        this.boardRenderer.setHintTile(null);

        const memorySummary = this.arcade.modifiers.memory && this.arcade.memoryPeeks > 0
            ? { peeks: this.arcade.memoryPeeks, penaltyMs: this.arcade.memoryPenaltyMs }
            : null;
        const memPenaltyMs = this.arcade.memoryPenaltyMs;
        this.arcade.revealAllOnVictory();
        this._syncArcadeVisuals();

        const size = this.settings.size;
        let finalMs = this.elapsedMs + memPenaltyMs;
        let formattedTime = formatTime(Math.floor(finalMs / 1000));
        let speedSummary = null;

        if (this.playMode === 'speed') {
            const speedRes = this.speedsolve.finish(this.moves);
            speedRes.penaltyMs += memPenaltyMs;
            speedRes.totalMs += memPenaltyMs;
            finalMs = speedRes.totalMs;
            formattedTime = formatCentiseconds(finalMs);
            const allSolves = storage.addSpeedsolve(size, speedRes);
            const stats = computeSpeedStats(allSolves);
            speedSummary = {
                tps: speedRes.tps.toFixed(2),
                penaltyMs: speedRes.penaltyMs,
                ao5Label: stats.ao5Ms !== null ? formatCentiseconds(stats.ao5Ms) : 'N/D (<5)',
            };
        } else {
            this.speedsolve.reset();
        }

        this.timeDisplay.textContent = formattedTime;
        this._updateGhostBarProgress();

        const hadGhost = Boolean(storage.getGhostRun(size));
        const isNewRecord = storage.saveBestIfBetter(size, this.moves, finalMs);
        this.lastRecording = this.replay.finalizeRecording(finalMs);
        if (this.lastRecording && (isNewRecord || !hadGhost)) {
            storage.saveGhostRun(size, this.lastRecording);
        }
        this._updateBestDisplay();

        this.sound.playVictory();
        this.haptics.vibrateVictory();

        const genId = this.gameGenerationId;
        const xray = await this.solver.analyzeXRay({
            runTrace: this.runTrace,
            totalMoves: this.moves,
            par: this.initialPar,
            optimal: this.parOptimal,
        });
        if (genId !== this.gameGenerationId) return;

        let dailyShareText = null;
        if (this.playMode === 'daily') {
            const efficiency = xray ? xray.efficiency : 100;
            storage.saveDailyResult({
                dateKey: this.dailyDateKey,
                size,
                moves: this.moves,
                ms: Math.round(finalMs),
                par: this.initialPar,
                parOptimal: this.parOptimal,
                efficiency,
                completedAt: Date.now(),
            });
            dailyShareText = buildDailyShareText({
                dateKey: this.dailyDateKey,
                size,
                formattedTime,
                moves: this.moves,
                par: this.initialPar,
                parOptimal: this.parOptimal,
                efficiency,
            });
        }

        this._syncModesUI();
        this._renderHudSlot();

        this.lastVictoryData = {
            moves: this.moves,
            formattedTime,
            isNewRecord,
            xray,
            dailyShareText,
            speedSummary,
            memorySummary,
            canReplay: Boolean(this.lastRecording && this.lastRecording.log.length > 0),
            onCopyDaily: (txt) => copyTextToClipboard(txt),
            onWatchReplay: () => this._startReplay(),
        };

        this.victoryModal.show(this.lastVictoryData);
    }

    _startReplay() {
        if (!this.lastRecording || this.lastRecording.log.length === 0) return;

        this.victoryModal.hide();
        this.isReplaying = true;
        this.physics.setSpringParams({ stiffness: 920, damping: 44 });

        const rec = this.lastRecording;
        let replayBoard = rec.initialBoard.slice();
        this.board = replayBoard.slice();
        this.physics.registerTiles(this.boardRenderer.tileElements, replayBoard, rec.size);
        this.boardRenderer.updateCorrectStates(replayBoard);
        this._renderHudSlot();
        this._renderGhostBar();

        this.replay.play(rec, {
            durationMs: 3000,
            onApplyStep: (tileNum) => {
                const res = applySlide(replayBoard, rec.size, tileNum);
                if (!res) return;
                replayBoard = res.board;
                this.board = replayBoard;
                this.physics.setTargetsFromBoard(replayBoard, rec.size, {
                    impulseTiles: res.movedTiles,
                    axis: res.axis,
                    sign: res.sign,
                    initialSpeed: 6,
                });
                this.boardRenderer.updateCorrectStates(replayBoard);
                this.sound.playSlide({
                    count: res.count,
                    primaryTile: tileNum,
                    newlyCorrectTiles: res.newlyCorrectTiles,
                });
            },
            onProgress: (pct) => {
                const fill = document.getElementById('replayProgressFill');
                if (fill) fill.style.width = `${pct}%`;
            },
            onFinish: () => {
                this._stopReplay(false);
            },
        });
    }

    _stopReplay(cancelled) {
        this.replay.stop(false);
        this.isReplaying = false;
        this.physics.setSpringParams({ stiffness: 560, damping: 31 });

        if (this.lastRecording) {
            // Snap to final solved state cleanly
            const size = this.lastRecording.size;
            let solved = this.lastRecording.initialBoard.slice();
            for (const step of this.lastRecording.log) {
                const res = applySlide(solved, size, step.tile);
                if (res) solved = res.board;
            }
            this.board = solved;
            this.physics.registerTiles(this.boardRenderer.tileElements, solved, size);
            this.boardRenderer.updateCorrectStates(solved);
        }

        this._renderHudSlot();
        this._renderGhostBar();
        if (this.lastVictoryData && !cancelled) {
            this.victoryModal.show(this.lastVictoryData);
        } else if (this.lastVictoryData && cancelled) {
            this.victoryModal.show(this.lastVictoryData);
        }
    }

    /**
     * Starts or restarts a solvable game for the chosen grid size and active play mode.
     * @param {number} [newSize=this.settings.size]
     * @param {{ silent?: boolean }} [options]
     */
    startNewGame(newSize = this.settings.size, { silent = false } = {}) {
        this._stopTimer();
        this._stopGhostUpdater();
        this.replay.stop(false);
        this.isReplaying = false;
        this.physics.setSpringParams({ stiffness: 560, damping: 31 });
        this.speedsolve.reset();
        this.arcade.reset();
        this.victoryModal.hide();

        this.gameGenerationId++;
        this.solver.invalidate('solvePar');
        this.solver.invalidate('getHint');

        const sizeChanged = newSize !== this.settings.size;
        if (sizeChanged) {
            this._updateSettings({ size: newSize });
        }

        this.moves = 0;
        this.elapsedMs = 0;
        this.isSolved = false;
        this.initialPar = null;
        this.parOptimal = true;
        this.runTrace = [];
        this.lastVictoryData = null;

        this.movesDisplay.textContent = '0';
        this.timeDisplay.textContent = this.playMode === 'speed' ? '00:00.00' : '00:00';
        this.boardRenderer.setHintTile(null);

        if (this.playMode === 'daily') {
            this.dailyDateKey = getTodayDateKey();
            this.board = generateDailyBoard(this.settings.size, this.dailyDateKey);
        } else {
            this.board = generateSolvableBoard(this.settings.size);
        }

        this.initialH = computeManhattanAndLinearConflicts(this.board, this.settings.size);
        this.replay.beginRecording(this.board, this.settings.size);
        this.arcade.startRun(this.board, this.settings.size);

        const expectedTiles = this.settings.size * this.settings.size - 1;
        if (sizeChanged || this.boardRenderer.tileElements.size !== expectedTiles) {
            this.boardRenderer.build();
        } else {
            this.physics.setTargetsFromBoard(this.board, this.settings.size, { animateShuffle: true });
            this.boardRenderer.updateCorrectStates(this.board);
            this._syncArcadeVisuals();
        }

        if (this.playMode === 'speed') {
            this.speedsolve.startInspection();
        }

        this._renderHudSlot();
        this._renderGhostBar();
        this._syncModesUI();
        this._computeInitialPar(this.gameGenerationId);

        if (!silent) {
            this.sound.playSlide({ count: 2, primaryTile: 1, newlyCorrectTiles: [] });
            this.haptics.vibrateSlide(2);
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.__gioco15App = new Gioco15App();
});

window.addEventListener('load', () => {
    if ('serviceWorker' in navigator) {
        try {
            navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
        } catch (_) {}
    }
});
