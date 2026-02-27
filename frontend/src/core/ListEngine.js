import { commandBus, COMMANDS } from './CommandBus';

/**
 * List Engine
 * Manages deterministic 1D list traversal for screens like Gateway, Ledgers, Reports.
 * Listens to GRID_UP and GRID_DOWN for navigation, and VIEW_POP / FOCUS_NEXT for actions.
 */
class ListEngine {
    constructor() {
        this.items = []; // Array of { id, onSelect }
        this.currentIndex = 0;
        this.viewId = null;
        this.unsubscribeBus = null;
        this.onBack = null;
    }

    init(viewId, { onBack } = {}) {
        this.viewId = viewId;
        this.items = [];
        this.currentIndex = 0;
        this.onBack = onBack;

        if (this.unsubscribeBus) {
            this.unsubscribeBus();
        }

        const unsubDown = commandBus.subscribe(COMMANDS.GRID_DOWN, () => this.moveDown());
        const unsubUp = commandBus.subscribe(COMMANDS.GRID_UP, () => this.moveUp());
        const unsubEnter = commandBus.subscribe(COMMANDS.FOCUS_NEXT, () => this.selectCurrent());
        const unsubPop = commandBus.subscribe(COMMANDS.VIEW_POP, (payload) => this.handleBack(payload));

        this.unsubscribeBus = () => {
            unsubDown();
            unsubUp();
            unsubEnter();
            unsubPop();
        };

        console.log(`[%cListEngine%c] Initialized for view: ${viewId}`, 'color: #00758f', 'color: inherit');
    }

    destroy() {
        if (this.unsubscribeBus) {
            this.unsubscribeBus();
            this.unsubscribeBus = null;
        }
        this.items = [];
        this.currentIndex = 0;
        this.viewId = null;
        this.onBack = null;
    }

    registerItems(itemsList) {
        this.items = itemsList;
        // Clamp index if items shrink
        if (this.currentIndex >= this.items.length) {
            this.currentIndex = Math.max(0, this.items.length - 1);
            this._focusCurrent();
        }
    }

    setCurrentIndex(index) {
        if (index >= 0 && index < this.items.length) {
            this.currentIndex = index;
            this._focusCurrent();
        }
    }

    moveDown() {
        if (this.items.length === 0) return;
        this.currentIndex = Math.min(this.currentIndex + 1, this.items.length - 1);
        this._focusCurrent();
    }

    moveUp() {
        if (this.items.length === 0) return;
        this.currentIndex = Math.max(this.currentIndex - 1, 0);
        this._focusCurrent();
    }

    selectCurrent() {
        if (this.items.length === 0) return;
        const currentItem = this.items[this.currentIndex];
        if (currentItem && currentItem.onSelect) {
            currentItem.onSelect(this.currentIndex);
        }
    }

    handleBack(payload = {}) {
        if (this.onBack) {
            const handled = this.onBack();
            if (handled) {
                payload.handled = true;
            }
        }
    }

    _focusCurrent() {
        if (this.items.length === 0) return;
        const currentItem = this.items[this.currentIndex];
        if (currentItem && currentItem.id) {
            const el = document.getElementById(currentItem.id);
            if (el) {
                el.focus();
                el.scrollIntoView({ block: 'nearest' });
            }
        }
    }
}

export const listEngine = new ListEngine();
