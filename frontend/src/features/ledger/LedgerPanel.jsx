import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { DEMO_BUSINESS_ID } from '../../lib/constants';

export function LedgerPanel() {
  const [accountId, setAccountId] = useState('');

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get(`/accounts?businessId=${DEMO_BUSINESS_ID}`)
  });

  const { data: lines = [] } = useQuery({
    queryKey: ['ledger', accountId],
    enabled: Boolean(accountId),
    queryFn: () => api.get(`/ledger/${accountId}?businessId=${DEMO_BUSINESS_ID}`)
  });

  return (
    <section className="boxed shadow-panel">
      <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Ledger</div>
      <div className="p-3">
        <select className="focusable border border-tally-panelBorder bg-white p-1 mb-3" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Select ledger</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.code} - {account.name}</option>
          ))}
        </select>

        <table className="w-full table-grid text-sm">
          <thead className="bg-tally-tableHeader">
            <tr><th>Date</th><th>Voucher</th><th>Type</th><th>Amount</th><th>Running Balance</th></tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx}>
                <td>{line.txnDate}</td>
                <td>{line.voucherNumber}</td>
                <td>{line.entryType}</td>
                <td>{Number(line.amount).toFixed(2)}</td>
                <td>{Number(line.runningBalance).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
