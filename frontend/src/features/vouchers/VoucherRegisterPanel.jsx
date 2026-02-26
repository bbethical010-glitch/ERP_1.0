import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { VOUCHER_STATUSES, VOUCHER_TYPES } from '../../lib/constants';
import { usePageKeydown } from '../../hooks/usePageKeydown';
import { useAuth } from '../../auth/AuthContext';

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function VoucherRegisterPanel() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const businessId = user?.businessId;
  const [search, setSearch] = useState('');
  const [voucherType, setVoucherType] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef(null);

  const limit = 15;
  const offset = (page - 1) * limit;

  const { data, isLoading } = useQuery({
    queryKey: ['vouchers', businessId, { search, voucherType, status, from, to, limit, offset }],
    enabled: Boolean(businessId),
    queryFn: () => {
      const query = new URLSearchParams({
        limit: String(limit),
        offset: String(offset)
      });
      if (search) query.set('search', search);
      if (voucherType) query.set('voucherType', voucherType);
      if (status) query.set('status', status);
      if (from) query.set('from', from);
      if (to) query.set('to', to);
      return api.get(`/vouchers?${query.toString()}`);
    }
  });

  const rows = useMemo(() => data?.items || [], [data]);
  const total = data?.page?.total || 0;
  const pageCount = Math.max(Math.ceil(total / limit), 1);

  const openActive = useCallback(() => {
    if (!rows[activeIndex]) return;
    navigate(`/vouchers/${rows[activeIndex].id}/edit`);
  }, [activeIndex, navigate, rows]);

  const onKeyDown = useCallback(
    (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((idx) => Math.min(idx + 1, Math.max(rows.length - 1, 0)));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((idx) => Math.max(idx - 1, 0));
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        openActive();
        return;
      }

      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        navigate('/vouchers/new');
        return;
      }

      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    },
    [navigate, openActive, rows.length]
  );

  usePageKeydown(onKeyDown);

  return (
    <section className="boxed shadow-panel">
      <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Voucher Register</div>

      <div className="p-3 grid gap-2 md:grid-cols-6 text-sm">
        <input
          ref={searchRef}
          className="focusable border border-tally-panelBorder p-1 bg-white md:col-span-2"
          placeholder="Search voucher no / narration"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="focusable border border-tally-panelBorder p-1 bg-white"
          value={voucherType}
          onChange={(e) => {
            setVoucherType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All Types</option>
          {VOUCHER_TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <select
          className="focusable border border-tally-panelBorder p-1 bg-white"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All Status</option>
          {VOUCHER_STATUSES.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <input
          type="date"
          className="focusable border border-tally-panelBorder p-1 bg-white"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
        />
        <input
          type="date"
          className="focusable border border-tally-panelBorder p-1 bg-white"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="max-h-[420px] overflow-auto">
        <table className="w-full table-grid text-sm">
          <thead className="bg-tally-tableHeader sticky top-0 z-10">
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
                className={`${idx === activeIndex ? 'bg-tally-background' : ''} hover:bg-tally-background cursor-pointer`}
                onClick={() => navigate(`/vouchers/${voucher.id}/edit`)}
                onMouseEnter={() => setActiveIndex(idx)}
                tabIndex={0}
                onFocus={() => setActiveIndex(idx)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    navigate(`/vouchers/${voucher.id}/edit`);
                  }
                }}
              >
                <td>{formatDate(voucher.voucherDate)}</td>
                <td>{voucher.voucherNumber}</td>
                <td>{voucher.voucherType}</td>
                <td>{voucher.status}</td>
                <td className="text-right">₹ {formatAmount(voucher.grossAmount)}</td>
                <td>{voucher.narration || '-'}</td>
              </tr>
            ))}

            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-3">No vouchers found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="p-3 flex items-center justify-between text-xs">
        <span>Showing {rows.length} of {total} • `/` search • Enter open</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="focusable boxed px-2 py-1"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
          >
            Prev
          </button>
          <span>Page {page} / {pageCount}</span>
          <button
            type="button"
            className="focusable boxed px-2 py-1"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(p + 1, pageCount))}
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
