import { useMemo, useRef, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { VOUCHER_STATUSES, VOUCHER_TYPES } from '../../lib/constants';
import { useAuth } from '../../auth/AuthContext';
import { useViewState, SCREENS } from '../../providers/ViewStateProvider';
import { commandBus, COMMANDS } from '../../core/CommandBus';
import { listEngine } from '../../core/ListEngine';

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function VoucherRegisterPanel() {
  const { pushScreen, popScreen } = useViewState();
  const { user } = useAuth();
  const businessId = user?.businessId;
  const [search, setSearch] = useState('');
  const [voucherType, setVoucherType] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const searchRef = useRef(null);

  const [activeIndex, setActiveIndex] = useState(0);

  const limit = 20;
  const offset = (page - 1) * limit;

  const { data, isLoading } = useQuery({
    queryKey: ['vouchers', businessId, { search, voucherType, status, from, to, limit, offset }],
    enabled: Boolean(businessId),
    queryFn: () => {
      const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (search) query.set('search', search);
      if (voucherType) query.set('voucherType', voucherType);
      if (status) query.set('status', status);
      if (from) query.set('from', from);
      if (to) query.set('to', to);
      return api.get(`/vouchers?${query.toString()}`);
    },
  });

  const rows = useMemo(() => data?.items || [], [data]);
  const total = data?.page?.total || 0;
  const pageCount = Math.max(Math.ceil(total / limit), 1);

  useEffect(() => {
    const listMap = rows.map((voucher, idx) => ({
      id: `voucher-item-${idx}`,
      onSelect: () => {
        commandBus.dispatch(COMMANDS.VIEW_PUSH, { screen: SCREENS.VOUCHER_EDIT, params: { voucherId: voucher.id } });
      }
    }));

    listEngine.init(SCREENS.VOUCHER_REGISTER);
    listEngine.registerItems(listMap);
    listEngine.setCurrentIndex(activeIndex);

    const originalFocus = listEngine._focusCurrent.bind(listEngine);
    listEngine._focusCurrent = () => {
      originalFocus();
      setActiveIndex(listEngine.currentIndex);
    };

    return () => listEngine.destroy();
  }, [rows, activeIndex]);

  function onFilterKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      document.getElementById(`voucher-item-${activeIndex}`)?.focus();
    }
  }

  // Hotkey N for new voucher from register
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (!isInput && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        commandBus.dispatch(COMMANDS.VIEW_PUSH, { screen: SCREENS.VOUCHER_NEW });
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  return (
    <section className="tally-panel">
      <div className="tally-panel-header">Voucher Register</div>

      <div className="p-1 grid gap-1 md:grid-cols-6 text-xs" onKeyDown={onFilterKeyDown}>
        <input
          ref={searchRef}
          className="tally-input md:col-span-2"
          placeholder="/ Search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select className="tally-input" value={voucherType} onChange={(e) => { setVoucherType(e.target.value); setPage(1); }}>
          <option value="">All Types</option>
          {VOUCHER_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select className="tally-input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All Status</option>
          {VOUCHER_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <input type="date" className="tally-input" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        <input type="date" className="tally-input" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
      </div>

      <div className="max-h-[calc(100vh-180px)] overflow-auto">
        <table className="w-full table-grid text-sm">
          <thead className="tally-table-header">
            <tr>
              <th className="text-left">Date</th>
              <th className="text-left">Voucher No</th>
              <th className="text-left">Type</th>
              <th className="text-left">Status</th>
              <th className="text-right">Amount</th>
              <th className="text-left">Narration</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((voucher, idx) => (
              <tr
                key={voucher.id}
                id={`voucher-item-${idx}`}
                className={idx === activeIndex ? 'tally-row-active' : ''}
                onClick={() => commandBus.dispatch(COMMANDS.VIEW_PUSH, { screen: SCREENS.VOUCHER_EDIT, params: { voucherId: voucher.id } })}
              >
                <td>{formatDate(voucher.voucherDate)}</td>
                <td>{voucher.voucherNumber}</td>
                <td>{voucher.voucherType}</td>
                <td>{voucher.status}</td>
                <td className="text-right tally-amount">₹ {formatAmount(voucher.grossAmount)}</td>
                <td>{voucher.narration || '-'}</td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="text-center py-2">No vouchers found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="tally-status-bar flex items-center justify-between">
        <span>{rows.length} of {total} · ↑↓ Navigate · Enter Open · N New · Esc Back</span>
        <div className="flex items-center gap-1">
          <button type="button" className="tally-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
          <span>P{page}/{pageCount}</span>
          <button type="button" className="tally-btn" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>
    </section>
  );
}
