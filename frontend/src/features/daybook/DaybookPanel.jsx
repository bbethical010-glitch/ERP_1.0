import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { DEMO_BUSINESS_ID } from '../../lib/constants';

export function DaybookPanel() {
  const today = new Date().toISOString().slice(0, 10);
  const { data = [] } = useQuery({
    queryKey: ['daybook', today],
    queryFn: () => api.get(`/daybook?businessId=${DEMO_BUSINESS_ID}&date=${today}`)
  });

  return (
    <section className="boxed shadow-panel">
      <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Daybook ({today})</div>
      <table className="w-full table-grid text-sm">
        <thead className="bg-tally-tableHeader">
          <tr><th>Voucher</th><th>No.</th><th>Narration</th><th>Debit</th><th>Credit</th></tr>
        </thead>
        <tbody>
          {data.map((line) => (
            <tr key={line.id}>
              <td>{line.voucherType}</td>
              <td>{line.voucherNumber}</td>
              <td>{line.narration}</td>
              <td>{Number(line.debitTotal).toFixed(2)}</td>
              <td>{Number(line.creditTotal).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
