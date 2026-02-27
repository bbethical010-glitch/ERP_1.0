import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { commandBus, COMMANDS } from '../core/CommandBus';

/**
 * ViewStateProvider — Tally-style hierarchical navigation stack.
 *
 * Replaces React Router for all INTERNAL navigation after auth.
 * Every screen pushes onto a stack. Esc/Backspace pops. Enter drills.
 *
 * State shape:
 *   { screen: string, params: object, focusIndex: number }
 *
 * The stack is an array of these states.
 */

const ViewStateContext = createContext(null);

export const SCREENS = {
    GATEWAY: 'gateway',
    LEDGER_LIST: 'ledger-list',
    LEDGER_CREATE: 'ledger-create',
    VOUCHER_REGISTER: 'voucher-register',
    VOUCHER_NEW: 'voucher-new',
    VOUCHER_EDIT: 'voucher-edit',
    DAYBOOK: 'daybook',
    TRIAL_BALANCE: 'trial-balance',
    PROFIT_LOSS: 'profit-loss',
    BALANCE_SHEET: 'balance-sheet',
    USERS: 'users',
    CHANGE_PASSWORD: 'change-password',
    COMPANY_SETUP: 'company-setup',
    RESET_COMPANY: 'reset-company',
};

const INITIAL_STATE = { screen: SCREENS.GATEWAY, params: {}, focusIndex: 0 };

export function ViewStateProvider({ children }) {
    const [stack, setStack] = useState([INITIAL_STATE]);
    const focusRestoreRef = useRef([]);

    const current = stack[stack.length - 1];

    const pushScreen = useCallback((screen, params = {}, currentFocusIndex = 0) => {
        // Save current focus index for restore
        setStack((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                focusIndex: currentFocusIndex,
            };
            return [...updated, { screen, params, focusIndex: 0 }];
        });
    }, []);

    const popScreen = useCallback(() => {
        setStack((prev) => {
            if (prev.length <= 1) return prev; // Can't pop past gateway
            return prev.slice(0, -1);
        });
    }, []);

    const resetToGateway = useCallback(() => {
        setStack([INITIAL_STATE]);
    }, []);

    const replaceScreen = useCallback((screen, params = {}) => {
        setStack((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { screen, params, focusIndex: 0 };
            return updated;
        });
    }, []);

    const setFocusIndex = useCallback((index) => {
        setStack((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { ...updated[updated.length - 1], focusIndex: index };
            return updated;
        });
    }, []);

    // Phase L: Subscribe to CommandBus events for internal navigation
    useEffect(() => {
        const unsubPush = commandBus.subscribe(COMMANDS.VIEW_PUSH, (payload) => {
            pushScreen(payload.screen, payload.params, payload.currentFocusIndex || 0);
        });

        const unsubPop = commandBus.subscribe(COMMANDS.VIEW_POP, () => {
            popScreen();
        });

        // Also update the centralized CommandBus with the active view for logging/context
        commandBus.setActiveView(current?.screen || 'UNKNOWN');

        return () => {
            unsubPush();
            unsubPop();
        };
    }, [pushScreen, popScreen, current?.screen]);

    const value = useMemo(() => ({
        current,
        stack,
        stackDepth: stack.length,
        pushScreen,
        popScreen,
        resetToGateway,
        replaceScreen,
        setFocusIndex,
    }), [current, stack, pushScreen, popScreen, resetToGateway, replaceScreen, setFocusIndex]);

    return (
        <ViewStateContext.Provider value={value}>
            {children}
        </ViewStateContext.Provider>
    );
}

export function useViewState() {
    const ctx = useContext(ViewStateContext);
    if (!ctx) throw new Error('useViewState must be used within ViewStateProvider');
    return ctx;
}
