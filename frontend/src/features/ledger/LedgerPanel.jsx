import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { DEMO_BUSINESS_ID } from '../../lib/constants';

function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function LedgerPanel() {
  const navigate = useNavigate();
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get(`/accounts?businessId=${DEMO_BUSINESS_ID}`)
  });

  const { data } = useQuery({
    queryKey: ['ledger', accountId, from, to],
    enabled: Boolean(accountId),
    queryFn: () => {
      const q = new URLSearchParams({ businessId: DEMO_BUSINESS_ID });
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      return api.get(`/ledger/${accountId}?${q.toString()}`);
    }
  });

  const lines = data?.lines || [];

  return (
    <section className="boxed shadow-panel">
      <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Ledger Display</div>
      <div className="p-3 grid gap-2 md:grid-cols-4 text-sm">
        <select className="focusable border border-tally-panelBorder bg-white p-1" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Select ledger</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.code} - {account.name}</option>
          ))}
        </select>
        <input type="date" className="focusable border border-tally-panelBorder bg-white p-1" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="focusable border border-tally-panelBorder bg-white p-1" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {accountId && (
        <div className="px-3 pb-2 text-sm">
          <span className="font-semibold">Opening Balance:</span> ₹ {formatAmount(data?.openingBalance)}
        </div>
      )}

      <table className="w-full table-grid text-sm">
        <thead className="bg-tally-tableHeader">
          <tr><th>Date</th><th>Voucher</th><th>Status</th><th>Type</th><th>Amount</th><th>Running Balance</th></tr>
        </thead>
        <tbody>
          {lines.map((line, idx) => (
            <tr key={idx} className="hover:bg-tally-background cursor-pointer" onClick={() => navigate(`/vouchers/${line.voucherId}/edit`)}>
              <td>{new Date(line.txnDate).toLocaleDateString('en-IN')}</td>
              <td>{line.voucherNumber}</td>
              <td>{line.status}</td>
              <td>{line.entryType}</td>
              <td className="text-right">₹ {formatAmount(line.amount)}</td>
              <td className="text-right">₹ {formatAmount(line.runningBalance)}</td>
            </tr>
          ))}
          {accountId && lines.length === 0 && (
            <tr>
              <td colSpan={6} className="text-center py-3">No ledger entries in selected range.</td>
            </tr>
          )}
        </tbody>
        {accountId && (
          <tfoot>
            <tr className="bg-tally-tableHeader font-semibold">
              <td colSpan={5} className="text-right">Closing Balance</td>
              <td className="text-right">₹ {formatAmount(data?.closingBalance)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </section>
  );
}
