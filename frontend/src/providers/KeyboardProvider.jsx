import { createContext, useContext, useEffect, useCallback, useRef, useState } from 'react';
import keybindings from '../config/keybindings.json';

const KeyboardContext = createContext(null);

export const KeyboardProvider = ({ children, initialKeyboardFirstMode = true }) => {
    const customHandlersRef = useRef({});
    const [keyboardFirstMode, setKeyboardFirstMode] = useState(initialKeyboardFirstMode);

    useEffect(() => {
        if (keyboardFirstMode) {
            document.body.classList.add('keyboard-first-mode');
        } else {
            document.body.classList.remove('keyboard-first-mode');
        }
    }, [keyboardFirstMode]);

    // Register component level handlers
    const registerHandler = useCallback((scope, handler) => {
        if (!customHandlersRef.current[scope]) {
            customHandlersRef.current[scope] = new Set();
        }
        customHandlersRef.current[scope].add(handler);

        return () => {
            customHandlersRef.current[scope].delete(handler);
        };
    }, []);

    useEffect(() => {
        const handleGlobalKeyDown = (event) => {
            // Skip global keybindings if inside an input, textarea or contenteditable
            // EXCEPT if a component explicitly handles it or it's a specific global overriding shortcut
            const target = event.target;
            const isInput =
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable ||
                (typeof target.getAttribute === 'function' && (
                    target.getAttribute('contenteditable') === 'true' ||
                    target.getAttribute('contenteditable') === ''
                ));

            // Create a normalized key string (e.g. "ctrl+k", "alt+g", "escape")
            let keyString = '';
            if (event.ctrlKey || event.metaKey) keyString += 'ctrl+';
            if (event.altKey) keyString += 'alt+';
            if (event.shiftKey) keyString += 'shift+';
            keyString += event.key.toLowerCase();

            // 1. Dispatch to component-level handlers first (they get priority)
            let handled = false;

            // Notify all registered handlers
            for (const scope in customHandlersRef.current) {
                const handlers = customHandlersRef.current[scope];
                handlers.forEach(handler => {
                    if (handler(event, keyString, isInput)) {
                        handled = true;
                    }
                })
            }

            if (handled) return;

            // 2. Global application-level shortcuts (fallback)
            // Command Palette
            if (keybindings.global.openCommandPalette.includes(keyString)) {
                event.preventDefault();
                // We use a custom event to trigger the palette so we don't need heavy context here.
                window.dispatchEvent(new CustomEvent('open-command-palette'));
                return;
            }

            if (keybindings.global.focusSearch.includes(keyString) && !isInput) {
                event.preventDefault();
                // Custom event to focus search
                window.dispatchEvent(new CustomEvent('focus-global-search'));
                return;
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, []);

    return (
        <KeyboardContext.Provider value={{ registerHandler, keyboardFirstMode, setKeyboardFirstMode }}>
            {children}
        </KeyboardContext.Provider>
    );
};

export const useKeyboard = () => useContext(KeyboardContext);

/**
 * Hook to easily register keyboard handlers in components
 */
export const useKeyboardHandler = (scope, handler) => {
    const { registerHandler } = useKeyboard();

    useEffect(() => {
        if (!handler) return;
        return registerHandler(scope, handler);
    }, [scope, handler, registerHandler]);
};
