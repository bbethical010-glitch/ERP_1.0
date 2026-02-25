import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';

function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Panel({ title, children }) {
  return (
    <section className="boxed shadow-panel">
      <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">{title}</div>
      <div className="p-3 text-sm">{children}</div>
    </section>
  );
}

function PeriodFilter({ from, to, setFrom, setTo }) {
  return (
    <div className="grid gap-2 md:grid-cols-2 mb-3">
      <input type="date" className="focusable border border-tally-panelBorder bg-white p-1" value={from} onChange={(e) => setFrom(e.target.value)} />
      <input type="date" className="focusable border border-tally-panelBorder bg-white p-1" value={to} onChange={(e) => setTo(e.target.value)} />
    </div>
  );
}

export function TrialBalancePanel() {
  const { user } = useAuth();
  const businessId = user?.businessId;
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 4) + '-04-01');
  const [to, setTo] = useState(today);
  const [expanded, setExpanded] = useState({});

  const { data } = useQuery({
    queryKey: ['trial-balance', businessId, from, to],
    enabled: Boolean(businessId),
    queryFn: () => api.get(`/reports/trial-balance?from=${from}&to=${to}`)
  });

  const grouped = data?.grouped || {};
  const categories = useMemo(() => Object.keys(grouped), [grouped]);

  return (
    <Panel title="Trial Balance">
      <PeriodFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />

      {!data?.isBalanced && (
        <div className="boxed p-2 mb-2 text-tally-warning font-semibold">
          Trial Balance mismatch: Difference ₹ {formatAmount(data?.difference)}
        </div>
      )}

      <div className="grid gap-2">
        {categories.map((category) => {
          const block = grouped[category];
          const isOpen = Boolean(expanded[category]);
          return (
            <div key={category} className="boxed">
              <button
                type="button"
                className="focusable w-full text-left p-2 bg-tally-tableHeader font-semibold flex justify-between"
                onClick={() => setExpanded((prev) => ({ ...prev, [category]: !prev[category] }))}
              >
                <span>{category}</span>
                <span>DR {formatAmount(block.debit)} | CR {formatAmount(block.credit)}</span>
              </button>
              {isOpen && (
                <table className="w-full table-grid text-xs">
                  <thead className="bg-tally-background">
                    <tr><th>Code</th><th>Name</th><th>Group</th><th>Debit</th><th>Credit</th></tr>
                  </thead>
                  <tbody>
                    {block.lines.map((line) => (
                      <tr key={line.code}>
                        <td>{line.code}</td>
                        <td>{line.name}</td>
                        <td>{line.groupName}</td>
                        <td>{formatAmount(line.debit)}</td>
                        <td>{formatAmount(line.credit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      <div className="boxed mt-3 p-2 font-semibold flex justify-between">
        <span>Totals</span>
        <span>DR {formatAmount(data?.totals?.debit)} | CR {formatAmount(data?.totals?.credit)}</span>
      </div>
    </Panel>
  );
}

export function ProfitLossPanel() {
  const { user } = useAuth();
  const businessId = user?.businessId;
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 4) + '-04-01');
  const [to, setTo] = useState(today);
  const compareFrom = `${Number(from.slice(0, 4)) - 1}${from.slice(4)}`;
  const compareTo = `${Number(to.slice(0, 4)) - 1}${to.slice(4)}`;

  const { data } = useQuery({
    queryKey: ['profit-loss', businessId, from, to],
    enabled: Boolean(businessId),
    queryFn: () =>
      api.get(
        `/reports/profit-loss?from=${from}&to=${to}&compareFrom=${compareFrom}&compareTo=${compareTo}`
      )
  });

  return (
    <Panel title="Profit & Loss">
      <PeriodFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <div className="grid gap-2">
        <div className="boxed p-2 flex justify-between"><span>Revenue</span><span>₹ {formatAmount(data?.income)}</span></div>
        <div className="boxed p-2 flex justify-between"><span>Expenses</span><span>₹ {formatAmount(data?.expense)}</span></div>
        <div className="boxed p-2 flex justify-between"><span>Gross Profit</span><span>₹ {formatAmount(data?.grossProfit)}</span></div>
        <div className="boxed p-2 flex justify-between"><span>Operating Profit</span><span>₹ {formatAmount(data?.operatingProfit)}</span></div>
        <div className="boxed p-2 flex justify-between font-semibold"><span>Net Profit</span><span>₹ {formatAmount(data?.netProfit)}</span></div>
      </div>

      <div className="boxed mt-3 p-2">
        <p className="font-semibold mb-1">Comparative (Previous Period)</p>
        <p>Revenue: ₹ {formatAmount(data?.comparison?.income)}</p>
        <p>Expenses: ₹ {formatAmount(data?.comparison?.expense)}</p>
        <p>Net Profit: ₹ {formatAmount(data?.comparison?.netProfit)}</p>
      </div>
    </Panel>
  );
}

export function BalanceSheetPanel() {
  const { user } = useAuth();
  const businessId = user?.businessId;
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 4) + '-04-01');
  const [to, setTo] = useState(today);

  const { data } = useQuery({
    queryKey: ['balance-sheet', businessId, from, to],
    enabled: Boolean(businessId),
    queryFn: () => api.get(`/reports/balance-sheet?from=${from}&to=${to}`)
  });

  return (
    <Panel title="Balance Sheet">
      <PeriodFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <div className="grid gap-2">
        <div className="boxed p-2 flex justify-between"><span>Total Assets</span><span>₹ {formatAmount(data?.assets)}</span></div>
        <div className="boxed p-2 flex justify-between"><span>Total Liabilities</span><span>₹ {formatAmount(data?.liabilities)}</span></div>
        <div className="boxed p-2 flex justify-between"><span>Equity (incl. retained earnings)</span><span>₹ {formatAmount(data?.equity)}</span></div>
        <div className="boxed p-2 flex justify-between"><span>Retained Earnings</span><span>₹ {formatAmount(data?.retainedEarnings)}</span></div>
        <div className="boxed p-2 flex justify-between font-semibold"><span>Liabilities + Equity</span><span>₹ {formatAmount(data?.liabilitiesAndEquity)}</span></div>
      </div>

      {Math.abs(Number(data?.equationDifference || 0)) > 0.01 && (
        <div className="boxed mt-3 p-2 text-tally-warning font-semibold">
          Accounting equation mismatch: ₹ {formatAmount(data?.equationDifference)}
        </div>
      )}
    </Panel>
  );
}
