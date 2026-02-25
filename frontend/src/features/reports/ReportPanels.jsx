import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { DEMO_BUSINESS_ID } from '../../lib/constants';

function Panel({ title, children }) {
  return (
    <section className="boxed shadow-panel">
      <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">{title}</div>
      <div className="p-3 text-sm">{children}</div>
    </section>
  );
}

export function TrialBalancePanel() {
  const { data } = useQuery({
    queryKey: ['trial-balance'],
    queryFn: () => api.get(`/reports/trial-balance?businessId=${DEMO_BUSINESS_ID}`)
  });

  return (
    <Panel title="Trial Balance">
      <table className="w-full table-grid text-xs">
        <thead className="bg-tally-tableHeader">
          <tr><th>Code</th><th>Name</th><th>Debit</th><th>Credit</th></tr>
        </thead>
        <tbody>
          {(data?.lines || []).map((line) => (
            <tr key={line.code}><td>{line.code}</td><td>{line.name}</td><td>{Number(line.debit).toFixed(2)}</td><td>{Number(line.credit).toFixed(2)}</td></tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function ProfitLossPanel() {
  const { data } = useQuery({
    queryKey: ['profit-loss'],
    queryFn: () => api.get(`/reports/profit-loss?businessId=${DEMO_BUSINESS_ID}`)
  });

  return (
    <Panel title="Profit & Loss">
      <p>Income: {Number(data?.income || 0).toFixed(2)}</p>
      <p>Expense: {Number(data?.expense || 0).toFixed(2)}</p>
      <p className="font-semibold">Net Profit: {Number(data?.netProfit || 0).toFixed(2)}</p>
    </Panel>
  );
}

export function BalanceSheetPanel() {
  const { data } = useQuery({
    queryKey: ['balance-sheet'],
    queryFn: () => api.get(`/reports/balance-sheet?businessId=${DEMO_BUSINESS_ID}`)
  });

  return (
    <Panel title="Balance Sheet">
      <p>Assets: {Number(data?.assets || 0).toFixed(2)}</p>
      <p>Liabilities + Equity: {Number(data?.liabilitiesAndEquity || 0).toFixed(2)}</p>
    </Panel>
  );
}
