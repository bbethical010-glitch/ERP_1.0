import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { DEMO_BUSINESS_ID, VOUCHER_TYPES } from '../../lib/constants';
import { useGlobalShortcuts } from '../../hooks/useGlobalShortcuts';

const emptyLine = { accountId: '', entryType: 'DR', amount: '' };

export function VoucherEntryForm({ voucherId }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(voucherId);
  const [voucherType, setVoucherType] = useState('JOURNAL');
  const [voucherNumber, setVoucherNumber] = useState('1');
  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState('');
  const [entries, setEntries] = useState([emptyLine, { ...emptyLine, entryType: 'CR' }]);

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get(`/accounts?businessId=${DEMO_BUSINESS_ID}`)
  });

  const { data: existingVoucher, isLoading: isVoucherLoading } = useQuery({
    queryKey: ['voucher', voucherId],
    enabled: isEditMode,
    queryFn: () => api.get(`/vouchers/${voucherId}?businessId=${DEMO_BUSINESS_ID}`)
  });

  useEffect(() => {
    if (!existingVoucher) return;
    setVoucherType(existingVoucher.voucherType);
    setVoucherNumber(existingVoucher.voucherNumber);
    setVoucherDate(existingVoucher.voucherDate);
    setNarration(existingVoucher.narration || '');
    setEntries(
      existingVoucher.entries.map((line) => ({
        accountId: line.accountId,
        entryType: line.entryType,
        amount: String(line.amount)
      }))
    );
  }, [existingVoucher]);

  const createVoucher = useMutation({
    mutationFn: async () => {
      const payload = {
        businessId: DEMO_BUSINESS_ID,
        voucherType,
        voucherNumber,
        voucherDate,
        narration,
        entries: entries.map((line) => ({
          accountId: line.accountId,
          entryType: line.entryType,
          amount: Number(line.amount)
        }))
      };
      if (isEditMode) {
        return api.put(`/vouchers/${voucherId}`, payload);
      }
      return api.post('/vouchers', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['daybook'] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance'] });
      queryClient.invalidateQueries({ queryKey: ['profit-loss'] });
      queryClient.invalidateQueries({ queryKey: ['balance-sheet'] });
      if (!isEditMode) {
        setNarration('');
        setEntries([emptyLine, { ...emptyLine, entryType: 'CR' }]);
        const parsedVoucherNo = Number(voucherNumber);
        if (Number.isFinite(parsedVoucherNo)) {
          setVoucherNumber(String(parsedVoucherNo + 1));
        }
      }
    }
  });

  const removeVoucher = useMutation({
    mutationFn: async () => api.delete(`/vouchers/${voucherId}?businessId=${DEMO_BUSINESS_ID}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      navigate('/vouchers');
    }
  });

  const totals = useMemo(() => {
    const debit = entries
      .filter((line) => line.entryType === 'DR')
      .reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
    const credit = entries
      .filter((line) => line.entryType === 'CR')
      .reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
    return { debit, credit };
  }, [entries]);

  function updateLine(index, key, value) {
    setEntries((prev) => prev.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  }

  function addLine() {
    setEntries((prev) => [...prev, { ...emptyLine }]);
  }

  function submit(event) {
    event?.preventDefault();
    createVoucher.mutate();
  }

  useGlobalShortcuts({
    onSave: submit
  });

  function onFormKeyDown(event) {
    if (event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      addLine();
      return;
    }

    if (isEditMode && event.altKey && event.key.toLowerCase() === 'x') {
      event.preventDefault();
      removeVoucher.mutate();
    }
  }

  if (isVoucherLoading) {
    return <div className="boxed shadow-panel p-3 text-sm">Loading voucher...</div>;
  }

  return (
    <form className="boxed shadow-panel" onSubmit={submit} onKeyDown={onFormKeyDown}>
      <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">
        {isEditMode ? 'Edit Voucher' : 'Voucher Entry'}
      </div>
      <div className="p-3 grid gap-3 md:grid-cols-4 text-sm">
        <label className="flex flex-col gap-1">
          Type
          <select className="focusable border border-tally-panelBorder bg-white p-1" value={voucherType} onChange={(e) => setVoucherType(e.target.value)}>
            {VOUCHER_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Number
          <input className="focusable border border-tally-panelBorder bg-white p-1" value={voucherNumber} onChange={(e) => setVoucherNumber(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          Date
          <input className="focusable border border-tally-panelBorder bg-white p-1" type="date" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 md:col-span-4">
          Narration
          <input className="focusable border border-tally-panelBorder bg-white p-1" value={narration} onChange={(e) => setNarration(e.target.value)} />
        </label>
      </div>

      <table className="w-full table-grid text-sm">
        <thead className="bg-tally-tableHeader">
          <tr>
            <th className="text-left">Particulars (Ledger)</th>
            <th className="text-left">Dr/Cr</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((line, idx) => (
            <tr key={idx}>
              <td>
                <select
                  className="focusable w-full border border-tally-panelBorder bg-white p-1"
                  value={line.accountId}
                  onChange={(e) => updateLine(idx, 'accountId', e.target.value)}
                >
                  <option value="">Select account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.code} - {account.name}</option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="focusable w-full border border-tally-panelBorder bg-white p-1"
                  value={line.entryType}
                  onChange={(e) => updateLine(idx, 'entryType', e.target.value)}
                >
                  <option value="DR">DR</option>
                  <option value="CR">CR</option>
                </select>
              </td>
              <td>
                <input
                  className="focusable w-full text-right border border-tally-panelBorder bg-white p-1"
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.amount}
                  onChange={(e) => updateLine(idx, 'amount', e.target.value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-tally-tableHeader font-semibold">
            <td className="text-right" colSpan={2}>Debit Total</td>
            <td className="text-right">{totals.debit.toFixed(2)}</td>
          </tr>
          <tr className="bg-tally-tableHeader font-semibold">
            <td className="text-right" colSpan={2}>Credit Total</td>
            <td className="text-right">{totals.credit.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="p-3 flex gap-2 text-sm">
        <button type="button" onClick={addLine} className="focusable boxed px-3 py-1">Alt+A Add Line</button>
        <button type="submit" className="focusable bg-tally-header text-white px-3 py-1 border border-tally-panelBorder">
          Enter Save
        </button>
        {isEditMode && (
          <button
            type="button"
            onClick={() => removeVoucher.mutate()}
            className="focusable px-3 py-1 border border-tally-warning text-tally-warning"
          >
            Alt+X Delete
          </button>
        )}
        {createVoucher.isError && <span className="text-tally-warning">{createVoucher.error.message}</span>}
        {removeVoucher.isError && <span className="text-tally-warning">{removeVoucher.error.message}</span>}
        {createVoucher.isSuccess && <span className="text-tally-accent">{isEditMode ? 'Updated' : 'Saved'} voucher #{voucherNumber}</span>}
      </div>
    </form>
  );
}
