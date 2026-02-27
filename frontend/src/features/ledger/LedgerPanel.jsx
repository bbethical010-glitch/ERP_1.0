import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useViewState, SCREENS } from '../../providers/ViewStateProvider';
import { commandBus, COMMANDS } from '../../core/CommandBus';
import { listEngine } from '../../core/ListEngine';

function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function LedgerPanel() {
  const { pushScreen, popScreen } = useViewState();
  const { user } = useAuth();
  const businessId = user?.businessId;
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [activeIndex, setActiveIndex] = useState(0);

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', businessId],
    enabled: Boolean(businessId),
    queryFn: () => api.get('/accounts'),
  });

  const { data } = useQuery({
    queryKey: ['ledger', businessId, accountId, from, to],
    enabled: Boolean(accountId && businessId),
    queryFn: () => {
      const q = new URLSearchParams();
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      return api.get(`/ledger/${accountId}?${q.toString()}`);
    },
  });

  const lines = data?.lines || [];

  useEffect(() => {
    const listMap = lines.map((line, idx) => ({
      id: `ledger-item-${idx}`,
      onSelect: () => {
        if (line.voucherId) {
          commandBus.dispatch(COMMANDS.VIEW_PUSH, { screen: SCREENS.VOUCHER_EDIT, params: { voucherId: line.voucherId } });
        }
      }
    }));

    listEngine.init(SCREENS.LEDGER_LIST);
    listEngine.registerItems(listMap);
    listEngine.setCurrentIndex(activeIndex);

    const originalFocus = listEngine._focusCurrent.bind(listEngine);
    listEngine._focusCurrent = () => {
      originalFocus();
      setActiveIndex(listEngine.currentIndex);
    };

    return () => listEngine.destroy();
  }, [lines, activeIndex]);

  function onFilterKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      document.getElementById(`ledger-item-${activeIndex}`)?.focus();
    }
  }

  return (
    <section className="tally-panel">
      <div className="tally-panel-header">Ledger</div>
      <div className="p-1 grid gap-1 md:grid-cols-4 text-xs" onKeyDown={onFilterKeyDown}>
        <select autoFocus className="tally-input focusable" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Select ledger</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.code} - {account.name}</option>
          ))}
        </select>
        <input type="date" className="tally-input" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="tally-input" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {accountId && (
        <div className="px-2 py-1 text-xs border-b border-tally-panelBorder">
          Opening Balance: <span className="tally-amount">₹ {formatAmount(data?.openingBalance)}</span>
        </div>
      )}

      <div className="max-h-[calc(100vh-200px)] overflow-auto">
        <table className="w-full table-grid text-sm">
          <thead className="tally-table-header">
            <tr><th>Date</th><th>Voucher</th><th>Status</th><th>Type</th><th>Amount</th><th>Running Bal.</th></tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr
                key={idx}
                id={`ledger-item-${idx}`}
                className={idx === activeIndex ? 'tally-row-active' : ''}
                onClick={() => line.voucherId && commandBus.dispatch(COMMANDS.VIEW_PUSH, { screen: SCREENS.VOUCHER_EDIT, params: { voucherId: line.voucherId } })}
              >
                <td>{new Date(line.txnDate).toLocaleDateString('en-IN')}</td>
                <td>{line.voucherNumber}</td>
                <td>{line.status}</td>
                <td>{line.entryType}</td>
                <td className="text-right tally-amount">₹ {formatAmount(line.amount)}</td>
                <td className="text-right tally-amount">₹ {formatAmount(line.runningBalance)}</td>
              </tr>
            ))}
            {accountId && lines.length === 0 && (
              <tr><td colSpan={6} className="text-center py-2">No entries.</td></tr>
            )}
          </tbody>
          {accountId && (
            <tfoot>
              <tr className="tally-table-header font-bold">
                <td colSpan={5} className="text-right">Closing Balance</td>
                <td className="text-right tally-amount">₹ {formatAmount(data?.closingBalance)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="tally-status-bar">↑↓ Navigate · Enter Open Voucher · Esc Back</div>
    </section>
  );
}
