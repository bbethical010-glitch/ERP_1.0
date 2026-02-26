/**
 * KeyboardManager — Single centralized keyboard engine.
 *
 * ALL keyboard bindings live here. No component defines its own listeners.
 * Platform-aware: Cmd on Mac, Ctrl on Windows/Linux.
 * Priority: modal > screen > global.
 */

export const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const MOD = isMac ? 'meta' : 'ctrl';
export const MOD_LABEL = isMac ? '⌘' : 'Ctrl';

/**
 * Normalize a keyboard event into a canonical key string.
 * Examples: "ctrl+k", "alt+c", "escape", "enter", "f1", "arrowdown"
 */
export function normalizeKey(event) {
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('ctrl');
    if (event.altKey) parts.push('alt');
    if (event.shiftKey) parts.push('shift');
    const key = event.key.toLowerCase();
    // Avoid duplicates like "ctrl+control"
    if (!['control', 'meta', 'alt', 'shift'].includes(key)) {
        parts.push(key);
    }
    return parts.join('+');
}

/**
 * Global binding definitions. Each action maps to an array of key strings.
 */
export const BINDINGS = {
    // Navigation
    back: ['escape', 'backspace'],
    backAlt: ['alt+arrowleft'],
    drillDown: ['enter'],

    // Function keys
    company: ['f1'],
    changeDate: ['f2'],
    configure: ['f12'],

    // Mod shortcuts
    commandPalette: [`ctrl+k`],
    print: [`ctrl+p`],
    accept: [`ctrl+enter`],
    resetCompany: [`ctrl+r`],
    save: [`ctrl+s`],

    // Alt shortcuts
    create: ['alt+c'],
    deleteItem: ['alt+d'],

    // Arrow navigation (handled by FocusManager, listed for reference)
    moveUp: ['arrowup'],
    moveDown: ['arrowdown'],
    moveLeft: ['arrowleft'],
    moveRight: ['arrowright'],

    // Tab
    nextField: ['tab'],
    prevField: ['shift+tab'],
};

/**
 * Check if a key string matches a binding action.
 */
export function matchesBinding(keyString, action) {
    const bindings = BINDINGS[action];
    if (!bindings) return false;
    return bindings.includes(keyString);
}

/**
 * Check if the event target is a typing context (input/textarea/contenteditable).
 */
export function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName?.toLowerCase();
    return (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target.isContentEditable ||
        target.getAttribute?.('contenteditable') === 'true'
    );
}

/**
 * Handler stack. Components register handlers with priority.
 * Higher priority = checked first.
 *
 * Priority guide:
 *   100 = modal (command palette, confirm dialogs)
 *   50  = screen-level (voucher form, report drilldown)
 *   10  = global (gateway navigation, app-level shortcuts)
 */
const handlerStack = [];
let _nextId = 0;

export function registerKeyHandler(priority, handler) {
    const id = ++_nextId;
    handlerStack.push({ id, priority, handler });
    // Sort descending by priority
    handlerStack.sort((a, b) => b.priority - a.priority);
    return function unregister() {
        const idx = handlerStack.findIndex((h) => h.id === id);
        if (idx >= 0) handlerStack.splice(idx, 1);
    };
}

/**
 * Install the single global keydown listener.
 * Call once at app startup.
 */
export function installGlobalKeyListener() {
    function onKeyDown(event) {
        const keyString = normalizeKey(event);
        const typing = isTypingTarget(event.target);

        for (const entry of handlerStack) {
            const result = entry.handler(event, keyString, typing);
            if (result === true) {
                event.stopPropagation();
                return;
            }
        }
    }

    window.addEventListener('keydown', onKeyDown, true); // capture phase
    return () => window.removeEventListener('keydown', onKeyDown, true);
}
