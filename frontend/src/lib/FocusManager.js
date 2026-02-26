import { useCallback, useEffect, useRef, useState } from 'react';
import { registerKeyHandler } from './KeyboardManager';

/**
 * useFocusList — Hook for managing keyboard focus in a vertical list.
 *
 * Now registers with KeyboardManager at priority 50 (screen level)
 * instead of relying on React onKeyDown (which loses to capture-phase global listener).
 *
 * Returns:
 *   activeIndex   — currently focused row
 *   setActiveIndex — manual override
 *   containerProps — spread onto the container element
 */
export function useFocusList(itemCount, { initialIndex = 0, onSelect, onBack } = {}) {
    const [activeIndex, setActiveIndex] = useState(initialIndex);
    const containerRef = useRef(null);
    const activeRef = useRef(activeIndex);
    activeRef.current = activeIndex;

    // Clamp index when itemCount changes
    useEffect(() => {
        setActiveIndex((prev) => Math.min(prev, Math.max(0, itemCount - 1)));
    }, [itemCount]);

    // Scroll active item into view
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const row = container.querySelector(`[data-focus-index="${activeIndex}"]`);
        row?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    // Register keyboard handler at screen level (priority 50)
    useEffect(() => {
        if (itemCount <= 0) return;

        return registerKeyHandler(50, (event, keyString, isTyping) => {
            // Only handle if our container is in the DOM and visible
            const container = containerRef.current;
            if (!container || !container.closest('main')) return false;

            // Don't handle arrow keys if user is typing
            if (isTyping && ['arrowdown', 'arrowup'].includes(keyString)) return false;

            switch (keyString) {
                case 'arrowdown':
                    event.preventDefault();
                    setActiveIndex((i) => Math.min(i + 1, itemCount - 1));
                    return true;
                case 'arrowup':
                    event.preventDefault();
                    setActiveIndex((i) => Math.max(i - 1, 0));
                    return true;
                case 'enter':
                    if (!isTyping) {
                        event.preventDefault();
                        onSelect?.(activeRef.current);
                        return true;
                    }
                    return false;
                case 'escape':
                case 'backspace':
                    if (!isTyping) {
                        event.preventDefault();
                        onBack?.();
                        return true;
                    }
                    return false;
                default:
                    return false;
            }
        });
    }, [itemCount, onSelect, onBack]);

    const containerProps = {
        ref: containerRef,
        tabIndex: -1,
        role: 'listbox',
        'aria-activedescendant': `focus-item-${activeIndex}`,
    };

    return { activeIndex, setActiveIndex, containerProps, containerRef };
}

/**
 * Utility: auto-focus container on mount.
 */
export function useAutoFocus(ref) {
    useEffect(() => {
        // Use a slight delay to ensure DOM is settled
        const timer = setTimeout(() => ref.current?.focus(), 50);
        return () => clearTimeout(timer);
    }, [ref]);
}
