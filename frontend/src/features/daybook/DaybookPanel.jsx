import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { VOUCHER_STATUSES, VOUCHER_TYPES } from '../../lib/constants';
import { useAuth } from '../../auth/AuthContext';

function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function DaybookPanel() {
  const { user } = useAuth();
  const businessId = user?.businessId;
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [voucherType, setVoucherType] = useState('');
  const [status, setStatus] = useState('');

  const { data = [] } = useQuery({
    queryKey: ['daybook', businessId, { from, to, voucherType, status }],
    enabled: Boolean(businessId),
    queryFn: () => {
      const q = new URLSearchParams({ from, to });
      if (voucherType) q.set('voucherType', voucherType);
      if (status) q.set('status', status);
      return api.get(`/daybook?${q.toString()}`);
    }
  });

  return (
    <section className="boxed shadow-panel">
      <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Daybook</div>

      <div className="p-3 grid gap-2 md:grid-cols-4 text-sm">
        <input type="date" className="focusable border border-tally-panelBorder p-1 bg-white" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="focusable border border-tally-panelBorder p-1 bg-white" value={to} onChange={(e) => setTo(e.target.value)} />
        <select className="focusable border border-tally-panelBorder p-1 bg-white" value={voucherType} onChange={(e) => setVoucherType(e.target.value)}>
          <option value="">All Types</option>
          {VOUCHER_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select className="focusable border border-tally-panelBorder p-1 bg-white" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Status</option>
          {VOUCHER_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      <table className="w-full table-grid text-sm">
        <thead className="bg-tally-tableHeader">
          <tr><th>Date</th><th>Voucher</th><th>No.</th><th>Status</th><th>Narration</th><th>Debit</th><th>Credit</th></tr>
        </thead>
        <tbody>
          {data.map((line) => (
            <tr key={line.id}>
              <td>{new Date(line.voucherDate).toLocaleDateString('en-IN')}</td>
              <td>{line.voucherType}</td>
              <td>{line.voucherNumber}</td>
              <td>{line.status}</td>
              <td>{line.narration || '-'}</td>
              <td className="text-right">₹ {formatAmount(line.debitTotal)}</td>
              <td className="text-right">₹ {formatAmount(line.creditTotal)}</td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center py-3">No daybook records found.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
