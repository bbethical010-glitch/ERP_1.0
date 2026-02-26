import { useCallback, useEffect, useRef } from 'react';

// Utilities for common keyboard operations like focus management, roaming tabindex, and `aria-live` announcements.

/**
 * Hook to trap focus within a container, typically for modals/dialogs.
 */
export function useFocusTrap(active = true) {
    const containerRef = useRef(null);

    useEffect(() => {
        if (!active) return;

        const container = containerRef.current;
        if (!container) return;

        const focusableElements = container.querySelectorAll(
            'a[href], button, textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select, [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        function handleKeyDown(e) {
            if (e.key !== 'Tab') return;

            if (e.shiftKey) {
                if (document.activeElement === firstElement) {
                    lastElement.focus();
                    e.preventDefault();
                }
            } else {
                if (document.activeElement === lastElement) {
                    firstElement.focus();
                    e.preventDefault();
                }
            }
        }

        container.addEventListener('keydown', handleKeyDown);

        // Initial focus
        firstElement.focus();

        return () => {
            container.removeEventListener('keydown', handleKeyDown);
        };
    }, [active]);

    return containerRef;
}

/**
 * Utility to announce messages to screen readers using an aria-live region.
 */
export function announceToScreenReader(message, priority = 'polite') {
    let announcer = document.getElementById('a11y-announcer');
    if (!announcer) {
        announcer = document.createElement('div');
        announcer.id = 'a11y-announcer';
        announcer.setAttribute('aria-live', priority);
        announcer.setAttribute('aria-atomic', 'true');
        announcer.className = 'sr-only'; // visually hidden class (assume exists in global css)
        // Inline fallback for visual hiding
        Object.assign(announcer.style, {
            position: 'absolute',
            width: '1px',
            height: '1px',
            padding: '0',
            margin: '-1px',
            overflow: 'hidden',
            clip: 'rect(0, 0, 0, 0)',
            whiteSpace: 'nowrap',
            borderWidth: '0'
        });
        document.body.appendChild(announcer);
    } else {
        announcer.setAttribute('aria-live', priority);
    }

    // Set message after a tiny tick so duplicate messages still trigger read
    setTimeout(() => {
        announcer.textContent = message;
    }, 50);
}


/* Hook for roaming tabindex to manage a composite widget like a custom listbox */
export function useRoamingTabIndex(itemsCount, initialIndex = 0) {
    const [activeIndex, setActiveIndex] = useState(initialIndex);

    const onKeyDown = useCallback((e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex(prev => Math.min(prev + 1, itemsCount - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex(prev => Math.max(prev - 1, 0));
        }
    }, [itemsCount]);

    return { activeIndex, setActiveIndex, onKeyDown };
}
