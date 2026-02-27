import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { VOUCHER_STATUSES, VOUCHER_TYPES } from '../../lib/constants';
import { useAuth } from '../../auth/AuthContext';
import { useViewState, SCREENS } from '../../providers/ViewStateProvider';
import { commandBus, COMMANDS } from '../../core/CommandBus';
import { listEngine } from '../../core/ListEngine';

function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function DaybookPanel() {
  const { popScreen } = useViewState();
  const { user } = useAuth();
  const businessId = user?.businessId;
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [voucherType, setVoucherType] = useState('');
  const [status, setStatus] = useState('');

  const [activeIndex, setActiveIndex] = useState(0);

  const { data = [] } = useQuery({
    queryKey: ['daybook', businessId, { from, to, voucherType, status }],
    enabled: Boolean(businessId),
    queryFn: () => {
      const q = new URLSearchParams({ from, to });
      if (voucherType) q.set('voucherType', voucherType);
      if (status) q.set('status', status);
      return api.get(`/daybook?${q.toString()}`);
    },
  });

  useEffect(() => {
    const listMap = data.map((line, idx) => ({
      id: `daybook-item-${idx}`,
      onSelect: () => {
        // Expand/Edit could go here
        commandBus.dispatch(COMMANDS.VIEW_PUSH, { screen: SCREENS.VOUCHER_EDIT, params: { voucherId: line.id } });
      }
    }));

    listEngine.init(SCREENS.DAYBOOK);
    listEngine.registerItems(listMap);
    listEngine.setCurrentIndex(activeIndex);

    const originalFocus = listEngine._focusCurrent.bind(listEngine);
    listEngine._focusCurrent = () => {
      originalFocus();
      setActiveIndex(listEngine.currentIndex);
    };

    return () => listEngine.destroy();
  }, [data, activeIndex]);

  return (
    <section className="tally-panel">
      <div className="tally-panel-header">Daybook</div>

      <div className="p-1 grid gap-1 md:grid-cols-4 text-xs">
        <input type="date" className="tally-input" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="tally-input" value={to} onChange={(e) => setTo(e.target.value)} />
        <select className="tally-input" value={voucherType} onChange={(e) => setVoucherType(e.target.value)}>
          <option value="">All Types</option>
          {VOUCHER_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select className="tally-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Status</option>
          {VOUCHER_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      <div className="max-h-[calc(100vh-180px)] overflow-auto">
        <table className="w-full table-grid text-sm">
          <thead className="tally-table-header">
            <tr><th>Date</th><th>Type</th><th>No.</th><th>Status</th><th>Narration</th><th>Debit</th><th>Credit</th></tr>
          </thead>
          <tbody>
            {data.map((line, idx) => (
              <tr
                key={line.id}
                id={`daybook-item-${idx}`}
                className={idx === activeIndex ? 'tally-row-active' : ''}
              >
                <td>{new Date(line.voucherDate).toLocaleDateString('en-IN')}</td>
                <td>{line.voucherType}</td>
                <td>{line.voucherNumber}</td>
                <td>{line.status}</td>
                <td>{line.narration || '-'}</td>
                <td className="text-right tally-amount">₹ {formatAmount(line.debitTotal)}</td>
                <td className="text-right tally-amount">₹ {formatAmount(line.creditTotal)}</td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr><td colSpan={7} className="text-center py-2">No records.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="tally-status-bar">↑↓ Navigate · Enter Open · Esc Back</div>
    </section>
  );
}
