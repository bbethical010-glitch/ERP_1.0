export const COMMANDS = {
    FOCUS_NEXT: 'FOCUS_NEXT',
    FOCUS_PREV: 'FOCUS_PREV',
    VIEW_PUSH: 'VIEW_PUSH',
    VIEW_POP: 'VIEW_POP',
    FORM_SAVE: 'FORM_SAVE',
    VOUCHER_POST: 'VOUCHER_POST',
    RESET_COMPANY: 'RESET_COMPANY',
    PRINT: 'PRINT',
    OPEN_CONFIG: 'OPEN_CONFIG',
    GRID_UP: 'GRID_UP',
    GRID_DOWN: 'GRID_DOWN',
    GRID_LEFT: 'GRID_LEFT',
    GRID_RIGHT: 'GRID_RIGHT',
    GRID_ENTER: 'GRID_ENTER'
};

class CommandBus {
    constructor() {
        this.listeners = new Map();
        this.activeViewId = 'GLOBAL'; // Default view identifier
    }

    setActiveView(viewId) {
        this.activeViewId = viewId;
    }

    subscribe(command, callback) {
        if (!this.listeners.has(command)) {
            this.listeners.set(command, new Set());
        }
        this.listeners.get(command).add(callback);

        // Return unsubscribe function
        return () => {
            const commandListeners = this.listeners.get(command);
            if (commandListeners) {
                commandListeners.delete(callback);
            }
        };
    }

    dispatch(command, payload = {}) {
        this.logCommand(command, payload);

        const commandListeners = this.listeners.get(command);
        if (commandListeners) {
            commandListeners.forEach((callback) => {
                try {
                    callback(payload);
                } catch (error) {
                    console.error(`[CommandBus] Error executing subscriber for ${command}:`, error);
                }
            });
        }
    }

    logCommand(command, payload) {
        const timestamp = new Date().toISOString();
        // In actual production, payload might be large (like DOM events), 
        // so we format it carefully or extract safe parts.
        let safePayload = { ...payload };
        if (safePayload.originalEvent) {
            safePayload.originalEvent = `[Event: ${safePayload.originalEvent.type}]`;
        }
        console.log(
            `[%c${timestamp}%c] [%cCMD: ${command}%c] [%cVIEW: ${this.activeViewId}%c]`,
            'color: gray', 'color: inherit',
            'color: #d16b15; font-weight: bold', 'color: inherit',
            'color: #216159; font-weight: bold', 'color: inherit',
            safePayload
        );
    }
}

export const commandBus = new CommandBus();
