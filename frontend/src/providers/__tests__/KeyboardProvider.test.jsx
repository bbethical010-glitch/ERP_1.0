import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyboardProvider, useKeyboardHandler } from '../KeyboardProvider';

describe('KeyboardProvider', () => {
    let dispatchedEvents = [];

    beforeEach(() => {
        dispatchedEvents = [];
        const originalDispatch = window.dispatchEvent;
        window.dispatchEvent = vi.fn((event) => {
            dispatchedEvents.push(event.type);
            return originalDispatch.call(window, event);
        });
    });

    it('should dispatch open-command-palette on ctrl+k', () => {
        render(<KeyboardProvider><div>Test</div></KeyboardProvider>);

        // Simulating the exact event that `handleGlobalKeyDown` would see
        const event = new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
        // Mock target
        Object.defineProperty(event, 'target', {
            value: { tagName: 'DIV', getAttribute: () => null },
            enumerable: true
        });
        window.dispatchEvent(event);

        expect(dispatchedEvents).toContain('open-command-palette');
    });

    it('should ignore single-key global shortcuts (like / for search) when typing in an input element', async () => {
        const userEvent = (await import('@testing-library/user-event')).default;

        render(
            <KeyboardProvider>
                <input data-testid="test-input" />
            </KeyboardProvider>
        );

        const input = screen.getByTestId('test-input');
        input.focus();

        // Type the global search shortcut (e.g., '/')
        await userEvent.keyboard('/');

        // It should NOT dispatch focus-global-search because we are in an input!
        expect(dispatchedEvents).not.toContain('focus-global-search');
    });

    it('should allow component handlers to override and capture keys in inputs', () => {
        const mockHandler = vi.fn((e, keyString) => {
            if (keyString === 'ctrl+d') return true; // Handled
            return false;
        });

        const TestComponent = () => {
            useKeyboardHandler('test-scope', mockHandler);
            return <div data-testid="test-input-2" contentEditable suppressContentEditableWarning>test</div>;
        };

        render(
            <KeyboardProvider>
                <TestComponent />
            </KeyboardProvider>
        );

        const input = screen.getByTestId('test-input-2');
        input.focus();
        fireEvent.keyDown(input, { key: 'd', ctrlKey: true, bubbles: true });

        expect(mockHandler).toHaveBeenCalled();
    });
});
