import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatQty(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function InventorySummaryPanel({ asOf }) {
  const effectiveAsOf = useMemo(() => asOf || todayIso(), [asOf]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['inventory-summary', effectiveAsOf],
    queryFn: () => api.get(`/inventory/summary?asOf=${encodeURIComponent(effectiveAsOf)}`)
  });

  if (isLoading) {
    return <div className="boxed shadow-panel p-3 text-sm">Loading stock summary...</div>;
  }

  if (isError) {
    return <div className="boxed shadow-panel p-3 text-sm text-tally-warning">{error?.message || 'Failed to load inventory summary'}</div>;
  }

  const items = data?.items || [];
  const totals = data?.totals || {};

  return (
    <section className="tally-panel">
      <div className="tally-panel-header">Stock Summary (as of {effectiveAsOf})</div>

      <div className="border-b border-tally-panelBorder px-2 py-1 text-xs flex gap-4 flex-wrap">
        <span>Items: <strong>{Number(totals.uniqueItems || 0)}</strong></span>
        <span>Total Qty: <strong className="tally-amount">{formatQty(totals.totalQuantity)}</strong></span>
        <span>Total Value: <strong className="tally-amount">₹{formatAmount(totals.totalValue)}</strong></span>
      </div>

      {items.length === 0 ? (
        <div className="p-3 text-sm">No inventory transactions found.</div>
      ) : (
        <div className="w-full">
          <table className="w-full text-sm">
            <thead className="bg-tally-tableHeader">
              <tr>
                <th className="text-left px-2 py-1">Item</th>
                <th className="text-left px-2 py-1">SKU</th>
                <th className="text-right px-2 py-1">Qty</th>
                <th className="text-right px-2 py-1">Avg Cost</th>
                <th className="text-right px-2 py-1">Value</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.productId} className="border-b border-tally-panelBorder">
                  <td className="px-2 py-1">{row.name}</td>
                  <td className="px-2 py-1 text-xs opacity-70">{row.sku || '—'}</td>
                  <td className="px-2 py-1 text-right">{formatQty(row.quantity)}</td>
                  <td className="px-2 py-1 text-right">₹{formatAmount(row.avgUnitCost)}</td>
                  <td className="px-2 py-1 text-right">₹{formatAmount(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="tally-status-bar">
        Esc Back · Stock value is derived from `inventory_transactions`
      </div>
    </section>
  );
}

