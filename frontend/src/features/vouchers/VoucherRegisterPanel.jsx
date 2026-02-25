import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { DEMO_BUSINESS_ID } from '../../lib/constants';

export function VoucherRegisterPanel() {
  const navigate = useNavigate();
  const { data: vouchers = [] } = useQuery({
    queryKey: ['vouchers'],
    queryFn: () => api.get(`/vouchers?businessId=${DEMO_BUSINESS_ID}`)
  });

  const [activeIndex, setActiveIndex] = useState(0);

  const rows = useMemo(() => vouchers, [vouchers]);

  function openActive() {
    if (!rows[activeIndex]) return;
    navigate(`/vouchers/${rows[activeIndex].id}/edit`);
  }

  function onKeyDown(event) {
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
    }
  }

  return (
    <section className="boxed shadow-panel focusable" tabIndex={0} autoFocus onKeyDown={onKeyDown}>
      <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Voucher Register</div>
      <table className="w-full table-grid text-sm">
        <thead className="bg-tally-tableHeader">
          <tr>
            <th className="text-left">Date</th>
            <th className="text-left">Type</th>
            <th className="text-left">No.</th>
            <th className="text-left">Narration</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((voucher, idx) => (
            <tr
              key={voucher.id}
              className={idx === activeIndex ? 'bg-tally-background' : ''}
              onClick={() => navigate(`/vouchers/${voucher.id}/edit`)}
              onMouseEnter={() => setActiveIndex(idx)}
            >
              <td>{voucher.voucherDate}</td>
              <td>{voucher.voucherType}</td>
              <td>{voucher.voucherNumber}</td>
              <td>{voucher.narration || '-'}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="text-center py-3">No vouchers found. Press N or Alt+C to create.</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="p-2 text-xs">Arrow keys to navigate | Enter to edit | N to create new</div>
    </section>
  );
}
