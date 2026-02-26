import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { getGatewaySections, VOUCHER_QUICK_ACTIONS } from '../../lib/navigation';
import { usePageKeydown } from '../../hooks/usePageKeydown';
import { useRoamingTabIndex, announceToScreenReader } from '../../hooks/useFocusUtilities';
import keybindings from '../../config/keybindings.json';

function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function itemKey(sectionIndex, itemIndex) {
  return `${sectionIndex}:${itemIndex}`;
}

export function GatewayMenu() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const businessId = user?.businessId;
  const canManageUsers = user?.role === 'OWNER';
  const today = new Date().toISOString().slice(0, 10);
  const gatewaySections = useMemo(() => getGatewaySections(canManageUsers), [canManageUsers]);
  const [activeCell, setActiveCell] = useState({ sectionIndex: 0, itemIndex: 0 });
  const itemRefs = useRef({});

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-summary', businessId, today],
    enabled: Boolean(businessId),
    queryFn: () => api.get(`/dashboard/summary?asOf=${today}`)
  });

  const recent = data?.recentVouchers || [];
  const { activeIndex: tableIndex, setActiveIndex: setTableIndex, onKeyDown: roamingKeyDown } = useRoamingTabIndex(recent.length, -1);
  const tableContainerRef = useRef(null);

  useEffect(() => {
    if (tableIndex >= 0 && tableContainerRef.current) {
      const rows = tableContainerRef.current.querySelectorAll('tbody tr');
      if (rows[tableIndex]) {
        rows[tableIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [tableIndex]);

  useEffect(() => {
    const key = itemKey(activeCell.sectionIndex, activeCell.itemIndex);
    itemRefs.current[key]?.focus();
  }, [activeCell]);

  usePageKeydown((event) => {
    // Prevent interfering with inputs
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

    // Numeric shortcuts for Quick Vouchers
    const keyString = event.key.toLowerCase();

    // Quick Map
    const quickMap = {
      '1': '/vouchers/payment/new',
      '2': '/vouchers/receipt/new',
      '3': '/vouchers/sales/new',
      '4': '/vouchers/purchase/new',
      '5': '/vouchers/journal/new',
      '6': '/vouchers/contra/new',
    };

    if (quickMap[keyString]) {
      event.preventDefault();
      navigate(quickMap[keyString]);
      return;
    }

    // Specific Table Navigation if focus is on table area or table index is active
    if (recent.length > 0 && (tableIndex >= 0 || event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        roamingKeyDown(event);
        return;
      }

      if (tableIndex >= 0) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigate(`/vouchers/${recent[tableIndex].id}/edit`);
          return;
        }

        if (event.key.toLowerCase() === 'r') {
          event.preventDefault();
          if (window.confirm('Do you want to reverse this voucher?')) {
            announceToScreenReader('Reversing voucher is not implemented yet.');
            // API call to reverse voucher
          }
          return;
        }
      }
    }


    if (event.altKey) {
      const key = event.key.toLowerCase();
      const match = gatewaySections
        .flatMap((section) => section.items)
        .find((item) => item.hotkey?.toLowerCase() === key);
      if (match) {
        event.preventDefault();
        navigate(match.path);
        return;
      }
    }

    const section = gatewaySections[activeCell.sectionIndex];
    if (!section) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveCell((prev) => ({
        ...prev,
        itemIndex: Math.min(prev.itemIndex + 1, gatewaySections[prev.sectionIndex].items.length - 1)
      }));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveCell((prev) => ({ ...prev, itemIndex: Math.max(prev.itemIndex - 1, 0) }));
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setActiveCell((prev) => {
        const nextSection = Math.min(prev.sectionIndex + 1, gatewaySections.length - 1);
        const nextItem = Math.min(prev.itemIndex, gatewaySections[nextSection].items.length - 1);
        return { sectionIndex: nextSection, itemIndex: nextItem };
      });
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setActiveCell((prev) => {
        const nextSection = Math.max(prev.sectionIndex - 1, 0);
        const nextItem = Math.min(prev.itemIndex, gatewaySections[nextSection].items.length - 1);
        return { sectionIndex: nextSection, itemIndex: nextItem };
      });
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      // Ensure we're not interfering with table selection
      if (tableIndex < 0) {
        const target = section.items[activeCell.itemIndex];
        if (target) navigate(target.path);
      }
    }
  });

  useEffect(() => {
    if (alerts && Object.keys(alerts).length > 0) {
      const issues = [];
      if (alerts.unbalancedDrafts > 0) issues.push(`${alerts.unbalancedDrafts} unbalanced drafts`);
      if (alerts.negativeCashLedgers > 0) issues.push(`${alerts.negativeCashLedgers} negative cash ledgers`);
      if (alerts.missingLedgerMappings > 0) issues.push(`${alerts.missingLedgerMappings} missing ledger mappings`);

      if (issues.length > 0) {
        announceToScreenReader(`Alerts updated: ${issues.join(', ')}`);
      }
    }
  }, [alerts]);

  if (isLoading) {
    return <div className="boxed shadow-panel p-3 text-sm">Loading gateway dashboard...</div>;
  }

  const kpis = data?.kpis || {};
  const alerts = data?.alerts || {};

  return (
    <div className="grid gap-2">
      <section className="boxed shadow-panel">
        <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Gateway of Tally</div>
        <div className="grid gap-2 p-2 lg:grid-cols-3">
          {gatewaySections.map((section, sectionIndex) => (
            <div key={section.id} className="boxed">
              <div className="bg-tally-tableHeader px-2 py-1 border-b border-tally-panelBorder text-xs font-semibold">
                {section.label}
              </div>
              <p className="px-2 py-1 text-[11px] opacity-85">{section.hint}</p>
              <ul className="grid gap-1 p-1">
                {section.items.map((item, itemIndex) => {
                  const key = itemKey(sectionIndex, itemIndex);
                  const isActive =
                    activeCell.sectionIndex === sectionIndex && activeCell.itemIndex === itemIndex;
                  return (
                    <li key={item.id}>
                      <button
                        ref={(element) => {
                          itemRefs.current[key] = element;
                        }}
                        type="button"
                        className={`focusable w-full boxed px-2 py-1 text-left text-sm flex items-center justify-between ${isActive ? 'bg-tally-background' : ''}`}
                        onFocus={() => setActiveCell({ sectionIndex, itemIndex })}
                        onClick={() => navigate(item.path)}
                      >
                        <span>{item.label}</span>
                        <span className="hotkey-chip">Alt+{item.hotkey}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <div className="px-3 py-1 text-[11px] border-t border-tally-panelBorder">
          Use Arrow Keys to move between menu items and Enter to open.
        </div>
      </section>

      <section className="boxed shadow-panel">
        <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Dashboard Highlights</div>
        <div className="grid gap-2 p-2 md:grid-cols-3 xl:grid-cols-6 text-sm">
          <div className="boxed p-2"><p className="text-xs">Total Assets</p><p className="font-semibold">₹ {formatAmount(kpis.totalAssets)}</p></div>
          <div className="boxed p-2"><p className="text-xs">Total Liabilities</p><p className="font-semibold">₹ {formatAmount(kpis.totalLiabilities)}</p></div>
          <div className="boxed p-2"><p className="text-xs">Net Profit (MTD)</p><p className="font-semibold">₹ {formatAmount(kpis.netProfitMtd)}</p></div>
          <div className="boxed p-2"><p className="text-xs">Net Profit (YTD)</p><p className="font-semibold">₹ {formatAmount(kpis.netProfitYtd)}</p></div>
          <div className="boxed p-2"><p className="text-xs">Cash & Bank</p><p className="font-semibold">₹ {formatAmount(kpis.cashBankBalance)}</p></div>
          <div className="boxed p-2"><p className="text-xs">Equity</p><p className="font-semibold">₹ {formatAmount(kpis.equity)}</p></div>
        </div>
      </section>

      <section className="grid gap-2 md:grid-cols-2">
        <div className="boxed shadow-panel">
          <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Alerts</div>
          <div className="p-2 text-sm grid gap-1">
            <div className="boxed p-2 flex justify-between"><span>Unbalanced Draft Vouchers</span><span className={alerts.unbalancedDrafts > 0 ? 'text-tally-warning font-semibold' : 'font-semibold'}>{alerts.unbalancedDrafts || 0}</span></div>
            <div className="boxed p-2 flex justify-between"><span>Negative Cash/Bank Ledgers</span><span className={alerts.negativeCashLedgers > 0 ? 'text-tally-warning font-semibold' : 'font-semibold'}>{alerts.negativeCashLedgers || 0}</span></div>
            <div className="boxed p-2 flex justify-between"><span>Missing Ledger Mappings</span><span className={alerts.missingLedgerMappings > 0 ? 'text-tally-warning font-semibold' : 'font-semibold'}>{alerts.missingLedgerMappings || 0}</span></div>
          </div>
        </div>

        <div className="boxed shadow-panel">
          <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Quick Create Vouchers</div>
          <div className="p-2 grid gap-1 md:grid-cols-2 text-sm">
            {VOUCHER_QUICK_ACTIONS.map((action, idx) => (
              <button
                key={action.id}
                type="button"
                className="focusable boxed px-2 py-2 text-left hover:bg-tally-tableHeader focus:bg-tally-tableHeader flex items-center justify-between"
                onClick={() => navigate(action.path)}
              >
                <span><strong className="text-tally-rowHover underline mr-1">{idx + 1}</strong> {action.label}</span>
                <span className="hotkey-chip">{action.hotkey}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="boxed shadow-panel">
        <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Recent Vouchers</div>
        <div className="max-h-[300px] overflow-auto">
          <table className="w-full table-grid text-sm">
            <thead className="bg-tally-tableHeader sticky top-0 z-10">
              <tr>
                <th className="text-left">Date</th>
                <th className="text-left">Voucher No.</th>
                <th className="text-left">Type</th>
                <th className="text-left">Status</th>
                <th className="text-right">Amount</th>
                <th className="text-left">Narration</th>
              </tr>
            </thead>
            <tbody ref={tableContainerRef}>
              {recent.map((row, index) => (
                <tr
                  key={row.id}
                  className={`cursor-pointer ${tableIndex === index ? 'bg-tally-rowHover text-white' : 'hover:bg-tally-background'}`}
                  onClick={() => navigate(`/vouchers/${row.id}/edit`)}
                  onMouseEnter={() => setTableIndex(index)}
                >
                  <td>{new Date(row.voucherDate).toLocaleDateString('en-IN')}</td>
                  <td>{row.voucherNumber}</td>
                  <td>{row.voucherType}</td>
                  <td>{row.status}</td>
                  <td className="text-right">₹ {formatAmount(row.grossAmount)}</td>
                  <td>{row.narration || '-'}</td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-3">No recent vouchers available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
