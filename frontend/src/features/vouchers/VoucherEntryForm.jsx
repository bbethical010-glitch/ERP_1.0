import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { VOUCHER_TYPES } from '../../lib/constants';
import { useAuth } from '../../auth/AuthContext';
import { LedgerSearch } from '../../components/LedgerSearch';
import { announceToScreenReader } from '../../hooks/useFocusUtilities';
import { PrintModal } from '../../components/PrintModal';
import { useViewState } from '../../providers/ViewStateProvider';
import { focusGraph } from '../../core/FocusGraph';
import { gridEngine } from '../../core/GridEngine';
import { commandBus, COMMANDS } from '../../core/CommandBus';

const emptyLine = { accountId: '', entryType: 'DR', amount: '' };

function computeTotals(entries) {
  const debit = entries
    .filter((line) => line.entryType === 'DR')
    .reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  const credit = entries
    .filter((line) => line.entryType === 'CR')
    .reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  const difference = Number((debit - credit).toFixed(2));
  return { debit, credit, difference, isBalanced: difference === 0 };
}

export function VoucherEntryForm({ voucherId, vtype }) {
  const { popScreen } = useViewState();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const businessId = user?.businessId;
  const prefilledType = vtype || null;

  const [voucherType, setVoucherType] = useState(
    VOUCHER_TYPES.includes(prefilledType) ? prefilledType : 'JOURNAL'
  );
  const [voucherNumber, setVoucherNumber] = useState('');
  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState('');
  const [entries, setEntries] = useState([emptyLine, { ...emptyLine, entryType: 'CR' }]);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [lineError, setLineError] = useState('');
  const [reversalNumber, setReversalNumber] = useState('');
  const [reversalDate, setReversalDate] = useState(new Date().toISOString().slice(0, 10));
  const [isPrintOpen, setIsPrintOpen] = useState(false);

  const voucherTypeRef = useRef(null);
  const voucherDateRef = useRef(null);
  const narrationRef = useRef(null);
  const firstLedgerRef = useRef(null);
  const formRef = useRef(null);

  const isEditMode = Boolean(voucherId);


  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', businessId],
    enabled: Boolean(businessId),
    queryFn: () => api.get('/accounts')
  });

  const { data: existingVoucher, isLoading: isVoucherLoading } = useQuery({
    queryKey: ['voucher', businessId, voucherId],
    enabled: isEditMode && Boolean(businessId),
    queryFn: () => api.get(`/vouchers/${voucherId}`)
  });

  useEffect(() => {
    if (!existingVoucher) return;
    setVoucherType(existingVoucher.voucherType);
    setVoucherNumber(existingVoucher.voucherNumber || '');
    setVoucherDate(existingVoucher.voucherDate);
    setNarration(existingVoucher.narration || '');
    setEntries(
      existingVoucher.entries.map((line) => ({
        accountId: line.accountId,
        entryType: line.entryType,
        amount: String(line.amount)
      }))
    );
    setReversalNumber(`RV-${existingVoucher.voucherNumber || '0001'}`);
  }, [existingVoucher]);

  const canEdit = !isEditMode || existingVoucher?.status === 'DRAFT';
  const isPosted = isEditMode && existingVoucher?.status === 'POSTED';
  const isReversed = isEditMode && existingVoucher?.status === 'REVERSED';
  const isCancelled = isEditMode && existingVoucher?.status === 'CANCELLED';

  const totals = useMemo(() => computeTotals(entries), [entries]);

  // Phase N: Initialize GridEngine and FocusGraph
  useEffect(() => {
    // Graceful bypassing when engines are disabled
    if (gridEngine.isEnabled) {
      // 1. Grid Engine for the table rows
      gridEngine.init('voucher-grid', () => {
        // Callback when pressing Enter/Tab on the last column of the last row
        if (!totals.isBalanced && canEdit) {
          addLine();
        } else if (totals.isBalanced && canEdit) {
          focusGraph.setCurrentNode('submitVoucher');
        }
      });
    }

    if (focusGraph.isEnabled) {
      // 2. Focus Graph for the outer form fields
      focusGraph.init('voucher-form');
      focusGraph.registerNode('vType', { next: 'vNumber', prev: null });
      focusGraph.registerNode('vNumber', { next: 'vDate', prev: 'vType' });
      focusGraph.registerNode('vDate', { next: 'vNarration', prev: 'vNumber' });
      focusGraph.registerNode('vNarration', {
        next: () => {
          if (entries.length > 0 && gridEngine.isEnabled) {
            gridEngine.setCurrentCoord(0, 0);
            return null;
          }
          return 'submitVoucher';
        },
        prev: 'vDate'
      });
      focusGraph.registerNode('submitVoucher', {
        next: () => {
          postNow();
          return null;
        },
        prev: () => {
          if (entries.length > 0 && gridEngine.isEnabled) {
            gridEngine.setCurrentCoord(entries.length - 1, 3);
            return null;
          }
          return 'vNarration';
        }
      });

      if (!isEditMode) {
        setTimeout(() => {
          if (document.getElementById('vType')) {
            focusGraph.setCurrentNode('vType');
          } else {
            console.warn('[VoucherEntryForm] vType not found in DOM, skipping initial focus.');
          }
        }, 100);
      }
    }

    return () => {
      gridEngine.destroy();
      focusGraph.destroy();
    };
  }, [totals.isBalanced, canEdit, entries.length, isEditMode]);

  const prevRowsRef = useRef(entries.length);

  // Phase N: Register dynamic grid matrix whenever entries change
  useEffect(() => {
    if (!gridEngine.isEnabled) return;

    const matrix = entries.map((_, idx) => [
      `grid-ledger-${idx}`,
      null, // Group cell is display-only
      `grid-type-${idx}`,
      `grid-amount-${idx}`
    ]);
    if (gridEngine.isEnabled) {
      gridEngine.registerMatrix(matrix);

      if (entries.length > prevRowsRef.current) {
        gridEngine.setCurrentCoord(entries.length - 1, 0);
      }
    }
    prevRowsRef.current = entries.length;
  }, [entries]);

  const createOrSaveDraft = useMutation({
    mutationFn: async (mode) => {
      const payload = {
        voucherType,
        voucherNumber: voucherNumber || undefined,
        voucherDate,
        narration,
        mode,
        entries: entries.filter((line) => line.accountId).map((line) => ({
          accountId: line.accountId,
          entryType: line.entryType,
          amount: Number(line.amount)
        }))
      };
      return api.post('/vouchers', payload);
    },
    onSuccess: (result) => {
      announceToScreenReader('Voucher saved successfully');
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['daybook'] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance'] });
      queryClient.invalidateQueries({ queryKey: ['profit-loss'] });
      queryClient.invalidateQueries({ queryKey: ['balance-sheet'] });
      if (result.id) {
        // Stay on this screen to show the saved voucher
      }
    }
  });

  const postDraft = useMutation({
    mutationFn: async () =>
      api.post(`/vouchers/${voucherId}/post`, {
        voucherType,
        voucherNumber: voucherNumber || undefined,
        voucherDate,
        narration,
        entries: entries.filter((line) => line.accountId).map((line) => ({
          accountId: line.accountId,
          entryType: line.entryType,
          amount: Number(line.amount)
        }))
      }),
    onSuccess: () => {
      announceToScreenReader('Voucher posted successfully');
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['voucher', voucherId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['daybook'] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance'] });
      queryClient.invalidateQueries({ queryKey: ['profit-loss'] });
      queryClient.invalidateQueries({ queryKey: ['balance-sheet'] });
    }
  });

  const cancelDraft = useMutation({
    mutationFn: async () =>
      api.post(`/vouchers/${voucherId}/cancel`, {}),
    onSuccess: () => {
      announceToScreenReader('Voucher cancelled');
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['voucher', voucherId] });
      popScreen();
    }
  });

  const reverseVoucher = useMutation({
    mutationFn: async () =>
      api.post(`/vouchers/${voucherId}/reverse`, {
        reversalVoucherNumber: reversalNumber || undefined,
        reversalDate,
        narration: `Reversal of voucher ${voucherNumber}`
      }),
    onSuccess: (result) => {
      announceToScreenReader('Voucher reversed successfully');
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['voucher', voucherId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['daybook'] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance'] });
      queryClient.invalidateQueries({ queryKey: ['profit-loss'] });
      queryClient.invalidateQueries({ queryKey: ['balance-sheet'] });
      if (result.reversalVoucherId) {
        popScreen();
      }
    }
  });

  function validateLines() {
    const validEntries = entries.filter((line) => line.accountId);

    if (validEntries.length < 2) {
      setLineError('At least 2 ledger lines required');
      announceToScreenReader('Error: At least 2 ledger lines required');
      return false;
    }

    for (let i = 0; i < validEntries.length; i++) {
      const line = validEntries[i];
      if (!Number.isFinite(Number(line.amount)) || Number(line.amount) <= 0) {
        setLineError(`Line ${i + 1} must have an amount greater than zero`);
        announceToScreenReader(`Error: Line ${i + 1} must have an amount greater than zero`);
        return false;
      }
    }

    setLineError('');
    return true;
  }

  function updateLine(index, key, value) {
    setEntries((prev) => prev.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  }

  function addLine() {
    if (!canEdit) return;
    setEntries((prev) => [...prev, { ...emptyLine }]);
  }

  function autoBalanceToLastLine() {
    if (!canEdit || entries.length === 0) return;
    const diff = totals.difference;
    if (diff === 0) return;
    const idx = entries.length - 1;
    const entryType = diff > 0 ? 'CR' : 'DR';
    const amount = Math.abs(diff).toFixed(2);
    setEntries((prev) => prev.map((line, i) => (i === idx ? { ...line, entryType, amount } : line)));
  }

  function saveDraft() {
    if (!canEdit) return;
    if (!validateLines()) return;
    createOrSaveDraft.mutate('DRAFT');
  }

  function postNow(event) {
    event?.preventDefault();
    if (!validateLines()) return;

    if (isEditMode && existingVoucher?.status === 'DRAFT') {
      postDraft.mutate();
      return;
    }

    createOrSaveDraft.mutate('POST');
  }

  useEffect(() => {
    const unsubPrint = commandBus.subscribe(COMMANDS.PRINT, () => {
      if (isPosted) {
        setIsPrintOpen(true);
      } else {
        announceToScreenReader('Print is only available for posted vouchers');
      }
    });

    const unsubSave = commandBus.subscribe(COMMANDS.FORM_SAVE, (payload) => {
      if (!isPrintOpen) {
        if (payload?.originalEvent) payload.originalEvent.preventDefault();
        postNow(payload?.originalEvent);
      }
    });

    return () => {
      unsubPrint();
      unsubSave();
    };
  }, [isPosted, postNow]);

  function onFormKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      popScreen();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      addLine();
      return;
    }

    if (event.altKey && event.key.toLowerCase() === 'r') {
      if (isPosted) {
        // Handled below for reverse
      } else {
        event.preventDefault();
        announceToScreenReader('Repeat last voucher not implemented');
        return;
      }
    }

    if (event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      addLine();
      return;
    }

    if (event.altKey && event.key === '1') {
      event.preventDefault();
      voucherTypeRef.current?.focus();
      return;
    }

    if (event.altKey && event.key === '2') {
      event.preventDefault();
      voucherDateRef.current?.focus();
      return;
    }

    if (event.altKey && event.key === '3') {
      event.preventDefault();
      narrationRef.current?.focus();
      return;
    }

    if (isPosted && event.altKey && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      reverseVoucher.mutate();
    }
  }

  if (isVoucherLoading) {
    return <div className="boxed shadow-panel p-3 text-sm">Loading voucher...</div>;
  }

  return (
    <>
      <form className="boxed shadow-panel" onSubmit={postNow} onKeyDown={onFormKeyDown} role="region" aria-label="Voucher Entry">
        <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold flex items-center justify-between">
          <span>{isEditMode ? `Voucher (${existingVoucher?.status || '...'})` : 'Voucher Entry'}</span>
          <span className={totals.isBalanced ? '' : 'text-red-200'}>
            DR {totals.debit.toFixed(2)} | CR {totals.credit.toFixed(2)} | Diff {totals.difference.toFixed(2)}
          </span>
        </div>

        <div className="p-3 grid gap-3 md:grid-cols-6 text-sm">
          <label className="flex flex-col gap-1">
            Type
            <select
              id="vType"
              disabled={!canEdit}
              className="focusable border border-tally-panelBorder bg-white p-1 disabled:bg-gray-100"
              value={voucherType}
              onChange={(e) => setVoucherType(e.target.value)}
            >
              {VOUCHER_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            Number
            <input
              id="vNumber"
              disabled={!canEdit}
              className="focusable border border-tally-panelBorder bg-white p-1 disabled:bg-gray-100"
              value={voucherNumber}
              onChange={(e) => setVoucherNumber(e.target.value)}
              placeholder="Auto"
            />
          </label>

          <label className="flex flex-col gap-1">
            Date
            <input
              id="vDate"
              disabled={!canEdit}
              type="date"
              className="focusable border border-tally-panelBorder bg-white p-1 disabled:bg-gray-100"
              value={voucherDate}
              onChange={(e) => setVoucherDate(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 md:col-span-3">
            Narration
            <input
              id="vNarration"
              disabled={!canEdit}
              className="focusable border border-tally-panelBorder bg-white p-1 disabled:bg-gray-100"
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
            />
          </label>
        </div>

        <table className="w-full table-grid text-sm">
          <thead className="bg-tally-tableHeader">
            <tr>
              <th className="text-left">Particulars (Ledger)</th>
              <th className="text-left">Group</th>
              <th className="text-left">Dr/Cr</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((line, idx) => {
              const selected = accounts.find((acc) => acc.id === line.accountId);
              return (
                <tr key={idx} className={!totals.isBalanced && ((totals.difference > 0 && line.entryType === 'DR') || (totals.difference < 0 && line.entryType === 'CR')) ? 'bg-red-50' : ''}>
                  <td>
                    <LedgerSearch
                      id={`grid-ledger-${idx}`}
                      businessId={businessId}
                      autoFocus={false}
                      value={selected}
                      onChange={(ledgerObj) => updateLine(idx, 'accountId', ledgerObj?.id || '')}
                    />
                  </td>
                  <td>{selected?.groupName || '-'}</td>
                  <td>
                    <select
                      id={`grid-type-${idx}`}
                      disabled={!canEdit}
                      className="focusable w-full border border-tally-panelBorder bg-white p-1 disabled:bg-gray-100"
                      value={line.entryType}
                      onChange={(e) => updateLine(idx, 'entryType', e.target.value)}
                    >
                      <option value="DR">DR</option>
                      <option value="CR">CR</option>
                    </select>
                  </td>
                  <td>
                    <input
                      id={`grid-amount-${idx}`}
                      disabled={!canEdit}
                      className="focusable w-full text-right border border-tally-panelBorder bg-white p-1 disabled:bg-gray-100"
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.amount}
                      onChange={(e) => updateLine(idx, 'amount', e.target.value)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="p-3 flex flex-wrap gap-2 text-sm items-center">
          <span className="text-xs">⌘/Ctrl+S Save/Post • ⌥A Add Line • ⌥L Ledger Search • ⌥1/2/3 Jump Fields</span>
          {canEdit && (
            <>
              <button type="button" onClick={addLine} className="focusable boxed px-3 py-1">⌥A Add Line</button>
              <button type="button" onClick={autoBalanceToLastLine} className="focusable boxed px-3 py-1">Auto Balance</button>
              <button type="button" onClick={saveDraft} className="focusable boxed px-3 py-1">Save Draft</button>
              <button
                type="submit"
                disabled={!totals.isBalanced}
                className="focusable bg-tally-header text-white px-3 py-1 border border-tally-panelBorder disabled:opacity-60"
              >
                Post Voucher
              </button>
            </>
          )}

          {isEditMode && existingVoucher?.status === 'DRAFT' && (
            <>
              <button type="button" onClick={() => postDraft.mutate()} disabled={!totals.isBalanced} className="focusable bg-tally-header text-white px-3 py-1 border border-tally-panelBorder disabled:opacity-60">
                Post Draft
              </button>
              <button type="button" onClick={() => cancelDraft.mutate()} className="focusable boxed px-3 py-1 text-tally-warning border border-tally-warning">
                Cancel Draft
              </button>
            </>
          )}

          {isPosted && (
            <>
              <label className="flex items-center gap-1">
                Reversal No
                <input className="focusable border border-tally-panelBorder bg-white p-1" value={reversalNumber} onChange={(e) => setReversalNumber(e.target.value)} />
              </label>
              <label className="flex items-center gap-1">
                Reversal Date
                <input type="date" className="focusable border border-tally-panelBorder bg-white p-1" value={reversalDate} onChange={(e) => setReversalDate(e.target.value)} />
              </label>
              <button type="button" onClick={() => reverseVoucher.mutate()} className="focusable bg-tally-header text-white px-3 py-1 border border-tally-panelBorder">
                ⌥R Reverse
              </button>
              <button
                type="button"
                onClick={() => setIsPrintOpen(true)}
                className="focusable boxed px-3 py-1 border border-tally-panelBorder"
              >
                🖨 Print (Ctrl+P)
              </button>
            </>
          )}

          {isReversed && <span className="text-tally-warning font-semibold">This voucher is reversed.</span>}
          {isCancelled && <span className="text-tally-warning font-semibold">This voucher is cancelled.</span>}

          {lineError && <span className="text-tally-warning">{lineError}</span>}
          {createOrSaveDraft.isError && <span className="text-tally-warning">{createOrSaveDraft.error.message}</span>}
          {postDraft.isError && <span className="text-tally-warning">{postDraft.error.message}</span>}
          {cancelDraft.isError && <span className="text-tally-warning">{cancelDraft.error.message}</span>}
          {reverseVoucher.isError && <span className="text-tally-warning">{reverseVoucher.error.message}</span>}
        </div>
      </form>

      {/* Print Modal */}
      <PrintModal
        open={isPrintOpen}
        onClose={() => setIsPrintOpen(false)}
        voucher={existingVoucher
          ? {
            ...existingVoucher,
            entries: (existingVoucher.entries || entries).map((line) => {
              const account = accounts.find((a) => a.id === line.accountId);
              return { ...line, accountName: account?.name || line.accountId };
            })
          }
          : null}
        company={null}
      />
    </>
  );
}
