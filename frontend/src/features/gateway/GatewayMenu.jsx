import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';

function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const quickActions = [
  { label: 'Journal Voucher', path: '/vouchers/new?vtype=JOURNAL' },
  { label: 'Payment Voucher', path: '/vouchers/new?vtype=PAYMENT' },
  { label: 'Receipt Voucher', path: '/vouchers/new?vtype=RECEIPT' },
  { label: 'Sales Voucher', path: '/vouchers/new?vtype=SALES' },
  { label: 'Purchase Voucher', path: '/vouchers/new?vtype=PURCHASE' },
  { label: 'Contra Voucher', path: '/vouchers/new?vtype=CONTRA' }
];

export function GatewayMenu() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const businessId = user?.businessId;
  const today = new Date().toISOString().slice(0, 10);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-summary', businessId, today],
    enabled: Boolean(businessId),
    queryFn: () => api.get(`/dashboard/summary?asOf=${today}`)
  });

  if (isLoading) {
    return <div className="boxed shadow-panel p-4 text-sm">Loading dashboard...</div>;
  }

  const kpis = data?.kpis || {};
  const alerts = data?.alerts || {};
  const recent = data?.recentVouchers || [];

  return (
    <div className="grid gap-3">
      <section className="boxed shadow-panel">
        <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Gateway Dashboard</div>
        <div className="grid gap-2 p-3 md:grid-cols-3 xl:grid-cols-6 text-sm">
          <div className="boxed p-2"><p className="text-xs">Total Assets</p><p className="font-semibold">₹ {formatAmount(kpis.totalAssets)}</p></div>
          <div className="boxed p-2"><p className="text-xs">Total Liabilities</p><p className="font-semibold">₹ {formatAmount(kpis.totalLiabilities)}</p></div>
          <div className="boxed p-2"><p className="text-xs">Net Profit (MTD)</p><p className="font-semibold">₹ {formatAmount(kpis.netProfitMtd)}</p></div>
          <div className="boxed p-2"><p className="text-xs">Net Profit (YTD)</p><p className="font-semibold">₹ {formatAmount(kpis.netProfitYtd)}</p></div>
          <div className="boxed p-2"><p className="text-xs">Cash & Bank</p><p className="font-semibold">₹ {formatAmount(kpis.cashBankBalance)}</p></div>
          <div className="boxed p-2"><p className="text-xs">Equity</p><p className="font-semibold">₹ {formatAmount(kpis.equity)}</p></div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="boxed shadow-panel">
          <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Alerts</div>
          <div className="p-3 text-sm grid gap-2">
            <div className="boxed p-2 flex justify-between"><span>Unbalanced Draft Vouchers</span><span className={alerts.unbalancedDrafts > 0 ? 'text-tally-warning font-semibold' : 'font-semibold'}>{alerts.unbalancedDrafts || 0}</span></div>
            <div className="boxed p-2 flex justify-between"><span>Negative Cash/Bank Ledgers</span><span className={alerts.negativeCashLedgers > 0 ? 'text-tally-warning font-semibold' : 'font-semibold'}>{alerts.negativeCashLedgers || 0}</span></div>
            <div className="boxed p-2 flex justify-between"><span>Missing Ledger Mappings</span><span className={alerts.missingLedgerMappings > 0 ? 'text-tally-warning font-semibold' : 'font-semibold'}>{alerts.missingLedgerMappings || 0}</span></div>
          </div>
        </div>

        <div className="boxed shadow-panel">
          <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Quick Create</div>
          <div className="p-3 grid gap-2 md:grid-cols-2 text-sm">
            {quickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="focusable boxed px-2 py-2 text-left hover:bg-tally-tableHeader"
                onClick={() => navigate(action.path)}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="boxed shadow-panel">
        <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Recent Vouchers</div>
        <div className="max-h-[360px] overflow-auto">
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
            <tbody>
              {recent.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-tally-background cursor-pointer"
                  onClick={() => navigate(`/vouchers/${row.id}/edit`)}
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
