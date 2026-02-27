import { useEffect, useRef, useState } from 'react';
import { useViewState, SCREENS } from '../providers/ViewStateProvider';
import { useAuth } from '../auth/AuthContext';
import { commandBus, COMMANDS } from '../core/CommandBus';
import { CommandPalette } from '../components/CommandPalette';
import { DatePickerModal } from '../components/DatePickerModal';
import { ResetConfirmModal } from '../components/ResetConfirmModal';
import { getCommandCatalog } from '../lib/navigation';

// Screen components
import { GatewayMenu } from '../features/gateway/GatewayMenu';
import { LedgerCreateForm } from '../features/ledger/LedgerCreateForm';
import { VoucherEntryForm } from '../features/vouchers/VoucherEntryForm';
import { VoucherRegisterPanel } from '../features/vouchers/VoucherRegisterPanel';
import { LedgerPanel } from '../features/ledger/LedgerPanel';
import { DaybookPanel } from '../features/daybook/DaybookPanel';
import { TrialBalancePanel, ProfitLossPanel, BalanceSheetPanel } from '../features/reports/ReportPanels';
import { UsersPanel } from '../features/users/UsersPanel';
import { ChangePasswordPanel } from '../features/users/ChangePasswordPanel';
import { CompanySetupPanel } from '../features/company/CompanySetupPanel';

const isMac = navigator.userAgent.includes('Mac');

/** Helper: shows key combos for both platforms */
function KeyLabel({ mac, win }) {
    return <kbd>{isMac ? mac : win}</kbd>;
}

function DualKey({ mac, win, label }) {
    return <span><kbd>{isMac ? mac : win}</kbd> {label}</span>;
}

/**
 * TallyShell — minimal Tally-style application shell.
 * Header bar + screen content. No fat TopBar.
 */
export function TallyShell() {
    const { current, popScreen, pushScreen, resetToGateway } = useViewState();
    const { user, logout } = useAuth();
    const canManageUsers = user?.role === 'OWNER';

    const [paletteOpen, setPaletteOpen] = useState(false);
    const [datePickerOpen, setDatePickerOpen] = useState(false);
    const [resetModalOpen, setResetModalOpen] = useState(false);
    const [workingDate, setWorkingDate] = useState(new Date().toISOString().slice(0, 10));

    const displayDate = workingDate
        ? new Date(workingDate + 'T00:00:00').toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric'
        })
        : '—';

    // Register CommandBus listeners for System Commands
    useEffect(() => {
        const unsubPalette = commandBus.subscribe(COMMANDS.OPEN_CONFIG, () => {
            if (!paletteOpen && !datePickerOpen && !resetModalOpen) setPaletteOpen(true);
        });

        const unsubReset = commandBus.subscribe(COMMANDS.RESET_COMPANY, () => {
            if (!paletteOpen && !datePickerOpen && !resetModalOpen) setResetModalOpen(true);
        });

        const unsubPrint = commandBus.subscribe(COMMANDS.PRINT, () => {
            if (!paletteOpen && !datePickerOpen && !resetModalOpen) {
                window.dispatchEvent(new CustomEvent('open-print-preview'));
            }
        });

        const unsubViewPop = commandBus.subscribe(COMMANDS.VIEW_POP, () => {
            // VIEW_POP is global back, only pop if we aren't handling it locally in a modal
            if (!paletteOpen && !datePickerOpen && !resetModalOpen) {
                popScreen();
            }
        });

        return () => {
            unsubPalette();
            unsubReset();
            unsubPrint();
            unsubViewPop();
        };
    }, [paletteOpen, datePickerOpen, resetModalOpen, popScreen]);

    // Build command catalog for palette
    const commands = getCommandCatalog(canManageUsers).map((cmd) => ({
        ...cmd,
        onSelect: () => {
            const screenMap = {
                '/ledger': SCREENS.LEDGER_LIST,
                '/ledger/new': SCREENS.LEDGER_CREATE,
                '/vouchers': SCREENS.VOUCHER_REGISTER,
                '/vouchers/new': SCREENS.VOUCHER_NEW,
                '/daybook': SCREENS.DAYBOOK,
                '/reports/trial-balance': SCREENS.TRIAL_BALANCE,
                '/reports/profit-loss': SCREENS.PROFIT_LOSS,
                '/reports/balance-sheet': SCREENS.BALANCE_SHEET,
                '/users': SCREENS.USERS,
                '/change-password': SCREENS.CHANGE_PASSWORD,
                '/company-setup': SCREENS.COMPANY_SETUP,
                '/gateway': SCREENS.GATEWAY,
            };
            const screen = screenMap[cmd.path];
            if (screen) pushScreen(screen);
        },
    }));

    function handlePaletteNavigate(path) {
        setPaletteOpen(false);
        const screenMap = {
            '/ledger': SCREENS.LEDGER_LIST,
            '/ledger/new': SCREENS.LEDGER_CREATE,
            '/vouchers': SCREENS.VOUCHER_REGISTER,
            '/vouchers/new': SCREENS.VOUCHER_NEW,
            '/daybook': SCREENS.DAYBOOK,
            '/reports/trial-balance': SCREENS.TRIAL_BALANCE,
            '/reports/profit-loss': SCREENS.PROFIT_LOSS,
            '/reports/balance-sheet': SCREENS.BALANCE_SHEET,
            '/users': SCREENS.USERS,
            '/change-password': SCREENS.CHANGE_PASSWORD,
            '/company-setup': SCREENS.COMPANY_SETUP,
            '/gateway': SCREENS.GATEWAY,
        };
        const screen = screenMap[path];
        if (screen) pushScreen(screen);
        else if (path === '/login') { logout(); }
    }

    function renderScreen() {
        switch (current.screen) {
            case SCREENS.GATEWAY:
                return <GatewayMenu />;
            case SCREENS.LEDGER_LIST:
                return <LedgerPanel />;
            case SCREENS.LEDGER_CREATE:
                return <LedgerCreateForm />;
            case SCREENS.VOUCHER_REGISTER:
                return <VoucherRegisterPanel />;
            case SCREENS.VOUCHER_NEW:
                try {
                    return <VoucherEntryForm vtype={current.params?.vtype} />;
                } catch (e) {
                    console.error("VoucherEntryForm Mount Crash:", e);
                    return <div className="p-4 text-red-500 bg-red-100 font-mono text-sm leading-relaxed overflow-auto max-h-[80vh]">
                        <h2 className="font-bold text-lg mb-2">Voucher Crash</h2>
                        <pre>{e.toString()}\n{e.stack}</pre>
                    </div>;
                }
            case SCREENS.VOUCHER_EDIT:
                try {
                    return <VoucherEntryForm voucherId={current.params?.voucherId} vtype={current.params?.vtype} />;
                } catch (e) {
                    console.error("VoucherEntryForm Mount Crash:", e);
                    return <div className="p-4 text-red-500">Voucher Crash: {e.message}</div>;
                }
            case SCREENS.DAYBOOK:
                return <DaybookPanel />;
            case SCREENS.TRIAL_BALANCE:
                return <TrialBalancePanel />;
            case SCREENS.PROFIT_LOSS:
                return <ProfitLossPanel />;
            case SCREENS.BALANCE_SHEET:
                return <BalanceSheetPanel />;
            case SCREENS.USERS:
                return <UsersPanel />;
            case SCREENS.CHANGE_PASSWORD:
                return <ChangePasswordPanel />;
            case SCREENS.COMPANY_SETUP:
                return <CompanySetupPanel />;
            default:
                return <GatewayMenu />;
        }
    }

    const screenLabel = {
        [SCREENS.GATEWAY]: 'Gateway of Tally',
        [SCREENS.LEDGER_LIST]: 'Ledger',
        [SCREENS.LEDGER_CREATE]: 'Create Ledger',
        [SCREENS.VOUCHER_REGISTER]: 'Voucher Register',
        [SCREENS.VOUCHER_NEW]: 'Voucher Entry',
        [SCREENS.VOUCHER_EDIT]: 'Alter Voucher',
        [SCREENS.DAYBOOK]: 'Daybook',
        [SCREENS.TRIAL_BALANCE]: 'Trial Balance',
        [SCREENS.PROFIT_LOSS]: 'Profit & Loss',
        [SCREENS.BALANCE_SHEET]: 'Balance Sheet',
        [SCREENS.USERS]: 'Users',
        [SCREENS.CHANGE_PASSWORD]: 'Change Password',
        [SCREENS.COMPANY_SETUP]: 'Company Setup',
    }[current.screen] || 'Gateway';

    return (
        <div className="min-h-screen bg-tally-background text-tally-text">
            {/* Minimal Tally header */}
            <header className="bg-tally-header text-white border-b border-tally-panelBorder px-2 py-1 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">{user?.businessName || 'Company'}</span>
                    <span className="opacity-60">›</span>
                    <span>{screenLabel}</span>
                </div>
                <div className="flex items-center gap-3 opacity-80">
                    <button
                        type="button"
                        className="focusable border border-white/30 px-2 py-0.5"
                        onClick={() => setDatePickerOpen(true)}
                    >
                        F2: {displayDate}
                    </button>
                    <DualKey mac="⌘K" win="Ctrl+K" label="GoTo" />
                    <span><kbd>Esc</kbd> Back</span>
                    <DualKey mac="⌘P" win="Ctrl+P" label="Print" />
                    <DualKey mac="⌘R" win="Ctrl+R" label="Reset" />
                    <span className="font-semibold">{user?.displayName || user?.username}</span>
                    <button
                        type="button"
                        className="focusable border border-white/30 px-2 py-0.5"
                        onClick={() => { logout(); }}
                    >
                        Quit
                    </button>
                </div>
            </header>

            {/* Screen content — no mainRef.focus() to avoid stealing focus from panels */}
            <main className="p-1">
                {renderScreen()}
            </main>

            {/* Modals */}
            <CommandPalette
                open={paletteOpen}
                commands={commands}
                onClose={() => setPaletteOpen(false)}
                onNavigate={handlePaletteNavigate}
            />
            <DatePickerModal
                open={datePickerOpen}
                currentDate={workingDate}
                onClose={() => setDatePickerOpen(false)}
                onDateChange={(date) => { setWorkingDate(date); setDatePickerOpen(false); }}
            />
            <ResetConfirmModal
                open={resetModalOpen}
                onClose={() => setResetModalOpen(false)}
                onReset={() => { setResetModalOpen(false); resetToGateway(); }}
            />
        </div>
    );
}
