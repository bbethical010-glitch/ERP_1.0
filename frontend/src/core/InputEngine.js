import { commandBus, COMMANDS } from './CommandBus';

/**
 * Input Arbitration Layer
 * Centralizes all keyboard events, normalizes keys, and dispatches abstract commands.
 * Runs in "passive" overlay mode initially to maintain backward compatibility.
 */
class InputEngine {
    constructor() {
        this.isEnabled = true;
        this.handleKeyDown = this.handleKeyDown.bind(this);
    }

    init() {
        window.addEventListener('keydown', this.handleKeyDown);
        console.log('[%cInputEngine%c] Initialized and attached to window.', 'color: #005a8f; font-weight: bold', 'color: inherit');
    }

    destroy() {
        window.removeEventListener('keydown', this.handleKeyDown);
        console.log('[%cInputEngine%c] Destroyed.', 'color: #005a8f; font-weight: bold', 'color: inherit');
    }

    setEnabled(enabled) {
        this.isEnabled = enabled;
    }

    handleKeyDown(event) {
        if (!this.isEnabled) return;

        // Normalize platform modifiers
        const isMac = navigator.userAgent.includes('Mac');
        const isCmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;
        const isAlt = event.altKey;

        let commandToDispatch = null;

        // Translation logic
        if (isCmdOrCtrl && event.key === 'Enter') {
            commandToDispatch = COMMANDS.FORM_SAVE;
        } else if (isCmdOrCtrl && event.key.toLowerCase() === 'r') {
            commandToDispatch = COMMANDS.RESET_COMPANY;
        } else if (isCmdOrCtrl && event.key.toLowerCase() === 'p') {
            commandToDispatch = COMMANDS.PRINT;
        } else if (event.key === 'F12') {
            commandToDispatch = COMMANDS.OPEN_CONFIG;
        } else if (isAlt && event.key === 'ArrowLeft') {
            commandToDispatch = COMMANDS.VIEW_POP;
        } else if (event.key === 'Escape') {
            commandToDispatch = COMMANDS.VIEW_POP;
        } else if (event.key === 'Enter') {
            commandToDispatch = COMMANDS.FOCUS_NEXT;
        } else if (event.key === 'ArrowDown') {
            commandToDispatch = 'GRID_DOWN';
        } else if (event.key === 'ArrowUp') {
            commandToDispatch = 'GRID_UP';
        }

        if (commandToDispatch) {
            // For Phase K: We do NOT call event.preventDefault() generally to avoid
            // breaking existing functionality while we validate the CommandBus.
            // Once the FocusGraph and ViewEngine are strictly engaged, we will 
            // aggressively consume these events.

            commandBus.dispatch(commandToDispatch, {
                originalEvent: event,
                key: event.key,
                isCmdOrCtrl,
                isAlt
            });
        }
    }
}

export const inputEngine = new InputEngine();
