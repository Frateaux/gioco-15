/**
 * Smooth Bottom Sheet Drawer with swipe-to-dismiss handle, tab navigation,
 * backdrop click, and Escape key handling.
 */

export class BottomSheetDrawer {
    /**
     * @param {object} options
     * @param {HTMLElement} options.drawer
     * @param {HTMLElement} options.backdrop
     * @param {HTMLElement} options.dragHandle
     * @param {HTMLElement} options.closeBtn
     * @param {HTMLElement} options.triggerBtn
     * @param {() => void} [options.onToggleFeedback]
     */
    constructor({ drawer, backdrop, dragHandle, closeBtn, triggerBtn, onToggleFeedback }) {
        this.drawer = drawer;
        this.backdrop = backdrop;
        this.dragHandle = dragHandle;
        this.closeBtn = closeBtn;
        this.triggerBtn = triggerBtn;
        this.onToggleFeedback = onToggleFeedback;
        this.isOpen = false;

        this.tabs = drawer.querySelectorAll('.sheet-tab');
        this.panels = drawer.querySelectorAll('.tab-panel');

        this._bindEvents();
    }

    open(tabName = null) {
        if (tabName) {
            this.switchTab(tabName);
        }
        this.isOpen = true;
        this.drawer.classList.add('is-open');
        this.backdrop.classList.add('is-open');
        this.drawer.setAttribute('aria-hidden', 'false');
        this.backdrop.setAttribute('aria-hidden', 'false');
        this.triggerBtn.setAttribute('aria-expanded', 'true');
        this.drawer.style.transform = '';
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.drawer.classList.remove('is-open');
        this.backdrop.classList.remove('is-open');
        this.drawer.setAttribute('aria-hidden', 'true');
        this.backdrop.setAttribute('aria-hidden', 'true');
        this.triggerBtn.setAttribute('aria-expanded', 'false');
        this.drawer.style.transform = '';
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    switchTab(tabName) {
        this.tabs.forEach((tab) => {
            const active = tab.dataset.tab === tabName;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', String(active));
        });
        this.panels.forEach((panel) => {
            panel.classList.toggle('is-active', panel.dataset.tabPanel === tabName);
        });
    }

    _bindEvents() {
        this.triggerBtn.addEventListener('click', () => {
            this.onToggleFeedback?.();
            this.open();
        });

        this.closeBtn.addEventListener('click', () => {
            this.onToggleFeedback?.();
            this.close();
        });

        this.backdrop.addEventListener('click', () => {
            this.close();
        });

        this.tabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                this.onToggleFeedback?.();
                this.switchTab(tab.dataset.tab);
            });
        });

        // Swipe-down gesture on handle/header to dismiss
        let dragPointerId = null;
        let dragStartY = 0;
        let currentDragY = 0;

        this.dragHandle.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button')) return;
            dragPointerId = e.pointerId;
            dragStartY = e.clientY;
            currentDragY = 0;
            this.drawer.classList.add('is-dragging');
            try {
                this.dragHandle.setPointerCapture(e.pointerId);
            } catch (_) {}
        });

        this.dragHandle.addEventListener('pointermove', (e) => {
            if (e.pointerId !== dragPointerId) return;
            const dy = Math.max(0, e.clientY - dragStartY);
            currentDragY = dy;
            this.drawer.style.transform = `translate3d(0, ${dy}px, 0)`;
        });

        const endHandleDrag = (e) => {
            if (e.pointerId !== dragPointerId) return;
            dragPointerId = null;
            this.drawer.classList.remove('is-dragging');
            this.drawer.style.transform = '';
            if (currentDragY > 90) {
                this.close();
            }
            currentDragY = 0;
        };

        this.dragHandle.addEventListener('pointerup', endHandleDrag);
        this.dragHandle.addEventListener('pointercancel', endHandleDrag);
    }
}
