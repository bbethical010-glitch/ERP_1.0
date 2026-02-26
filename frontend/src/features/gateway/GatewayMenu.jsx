import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useViewState, SCREENS } from '../../providers/ViewStateProvider';
import { getGatewaySections, VOUCHER_QUICK_ACTIONS } from '../../lib/navigation';
import { useFocusList, useAutoFocus } from '../../lib/FocusManager';
import { registerKeyHandler, matchesBinding } from '../../lib/KeyboardManager';

function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * GatewayMenu — Terminal-style Tally gateway.
 * Vertical stacked sections. Arrow↑↓ navigates. Enter drills. No cards.
 */
export function GatewayMenu() {
  const { pushScreen, current } = useViewState();
  const { user } = useAuth();
  const businessId = user?.businessId;
  const canManageUsers = user?.role === 'OWNER';
  const containerRef = useRef(null);

  const gatewaySections = useMemo(() => getGatewaySections(canManageUsers), [canManageUsers]);

  // Flatten all menu items into a single list for keyboard navigation
  const allItems = useMemo(() => {
    const items = [];
    gatewaySections.forEach((section) => {
      items.push({ type: 'section', label: section.label, hint: section.hint });
      section.items.forEach((item) => {
        items.push({ type: 'item', ...item, section: section.label });
      });
    });
    return items;
  }, [gatewaySections]);

  const selectableItems = useMemo(() => allItems.filter((i) => i.type === 'item'), [allItems]);

  // Screen mapping for path→screen
  const pathToScreen = {
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
  };

  function navigateItem(item) {
    const screen = pathToScreen[item.path];
    if (screen) pushScreen(screen);
  }

  const { activeIndex, setActiveIndex, containerProps } = useFocusList(selectableItems.length, {
    initialIndex: current.focusIndex || 0,
    onSelect: (idx) => navigateItem(selectableItems[idx]),
  });

  useAutoFocus(containerProps.ref);

  // Register numeric shortcuts for voucher types (priority 20, above global)
  useEffect(() => {
    return registerKeyHandler(20, (event, keyString, isTyping) => {
      if (isTyping) return false;

      // Numeric shortcuts 1-6 for quick voucher creation
      const quickTypes = {
        '1': 'JOURNAL',
        '2': 'PAYMENT',
        '3': 'RECEIPT',
        '4': 'SALES',
        '5': 'PURCHASE',
        '6': 'CONTRA',
      };
      if (quickTypes[keyString]) {
        event.preventDefault();
        pushScreen(SCREENS.VOUCHER_NEW, { vtype: quickTypes[keyString] });
        return true;
      }

      // Alt+Hotkey for direct item navigation
      if (event.altKey) {
        const key = event.key.toLowerCase();
        const match = selectableItems.find((item) => item.hotkey?.toLowerCase() === key);
        if (match) {
          event.preventDefault();
          navigateItem(match);
          return true;
        }
      }

      // N for new voucher
      if (keyString === 'n') {
        event.preventDefault();
        pushScreen(SCREENS.VOUCHER_NEW);
        return true;
      }

      return false;
    });
  }, [selectableItems, pushScreen]);

  // Dashboard summary (minimal, one-line, no cards)
  const { data } = useQuery({
    queryKey: ['dashboard-summary', businessId],
    enabled: Boolean(businessId),
    queryFn: () => api.get(`/dashboard/summary?asOf=${new Date().toISOString().slice(0, 10)}`),
  });

  const kpis = data?.kpis || {};
  const alerts = data?.alerts || {};

  // Build flat display with section headers
  let itemIndex = 0;
  const displayRows = allItems.map((entry, flatIdx) => {
    if (entry.type === 'section') {
      return (
        <tr key={`section-${flatIdx}`} className="tally-section-row">
          <td colSpan={3} className="font-bold text-xs py-1 px-2 border-b border-tally-panelBorder bg-tally-tableHeader">
            {entry.label} <span className="font-normal opacity-60">— {entry.hint}</span>
          </td>
        </tr>
      );
    }

    const idx = itemIndex++;
    const isActive = idx === activeIndex;
    return (
      <tr
        key={entry.id}
        data-focus-index={idx}
        className={isActive ? 'tally-row-active' : ''}
        onClick={() => navigateItem(entry)}
      >
        <td className="px-2 py-0.5 text-sm">{entry.label}</td>
        <td className="px-2 py-0.5 text-xs opacity-70">{entry.section}</td>
        <td className="px-2 py-0.5 text-xs text-right">
          <kbd>{entry.hotkey ? `Alt+${entry.hotkey}` : ''}</kbd>
        </td>
      </tr>
    );
  });

  return (
    <section className="tally-panel">
      <div className="tally-panel-header">Gateway of Tally</div>

      {/* Menu list */}
      <div {...containerProps} style={{ outline: 'none' }}>
        <table className="w-full text-sm">
          <tbody>
            {displayRows}
          </tbody>
        </table>
      </div>

      {/* Financial summary line (dense, no cards) */}
      <div className="border-t border-tally-panelBorder px-2 py-1 text-xs flex gap-4 flex-wrap">
        <span>Assets: <strong className="tally-amount">₹{formatAmount(kpis.totalAssets)}</strong></span>
        <span>Liabilities: <strong className="tally-amount">₹{formatAmount(kpis.totalLiabilities)}</strong></span>
        <span>Profit(MTD): <strong className="tally-amount">₹{formatAmount(kpis.netProfitMtd)}</strong></span>
        <span>Cash: <strong className="tally-amount">₹{formatAmount(kpis.cashBankBalance)}</strong></span>
        {alerts.unbalancedDrafts > 0 && (
          <span className="text-tally-warning">⚠ {alerts.unbalancedDrafts} unbalanced drafts</span>
        )}
      </div>

      {/* Quick create bar */}
      <div className="border-t border-tally-panelBorder px-2 py-1 text-xs flex gap-3">
        {VOUCHER_QUICK_ACTIONS.map((action, idx) => (
          <span key={action.id}>
            <kbd>{idx + 1}</kbd> {action.label}
          </span>
        ))}
      </div>

      <div className="tally-status-bar">
        ↑↓ Navigate · Enter Open · 1-6 Quick Voucher · Alt+Key Shortcut
      </div>
    </section>
  );
}
