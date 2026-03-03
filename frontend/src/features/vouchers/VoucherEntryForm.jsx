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
import { computeVoucherTotals, validateVoucher } from '../../domain/accounting/voucherService';

const emptyLine = { accountId: '', entryType: 'DR', amount: '' };

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
  const [salesLines, setSalesLines] = useState([]);
  const [purchaseLines, setPurchaseLines] = useState([]);
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

  const totals = useMemo(() => computeVoucherTotals(entries), [entries]);

  const { data: stockSummary } = useQuery({
    queryKey: ['inventory-summary-for-voucher', businessId, voucherDate],
    enabled: Boolean(businessId) && (voucherType === 'SALES' || voucherType === 'PURCHASE'),
    queryFn: () => api.get(`/inventory/summary?asOf=${voucherDate}`)
  });

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
      const inventoryLines =
        voucherType === 'SALES'
          ? salesLines
              .filter((line) => line.productId && Number(line.quantity) > 0)
              .map((line) => ({
                productId: line.productId,
                quantity: Number(line.quantity)
              }))
          : voucherType === 'PURCHASE'
          ? purchaseLines
              .filter((line) => line.productId && Number(line.quantity) > 0 && Number(line.unitCost) > 0)
              .map((line) => ({
                productId: line.productId,
                quantity: Number(line.quantity),
                unitCost: Number(line.unitCost)
              }))
          : undefined;
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
        })),
        inventoryLines
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
        })),
        inventoryLines:
          voucherType === 'SALES'
            ? salesLines
                .filter((line) => line.productId && Number(line.quantity) > 0)
                .map((line) => ({
                  productId: line.productId,
                  quantity: Number(line.quantity)
                }))
            : voucherType === 'PURCHASE'
            ? purchaseLines
                .filter((line) => line.productId && Number(line.quantity) > 0 && Number(line.unitCost) > 0)
                .map((line) => ({
                  productId: line.productId,
                  quantity: Number(line.quantity),
                  unitCost: Number(line.unitCost)
                }))
            : undefined
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
    const { isValid, error } = validateVoucher(entries);
    if (!isValid) {
      setLineError(error);
      announceToScreenReader(`Error: ${error}`);
      return false;
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

  function addSalesLine() {
    setSalesLines((prev) => [...prev, { productId: '', quantity: '', salePrice: '' }]);
  }

  function updateSalesLine(index, key, value) {
    setSalesLines((prev) => prev.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  }

  function removeSalesLine(index) {
    setSalesLines((prev) => prev.filter((_, i) => i !== index));
  }

  function addPurchaseLine() {
    setPurchaseLines((prev) => [...prev, { productId: '', quantity: '', unitCost: '' }]);
  }

  function updatePurchaseLine(index, key, value) {
    setPurchaseLines((prev) => prev.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  }

  function removePurchaseLine(index) {
    setPurchaseLines((prev) => prev.filter((_, i) => i !== index));
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

        {voucherType === 'SALES' && (
          <div className="p-3 border-t border-tally-panelBorder text-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">Items Sold (affects inventory)</span>
              <button type="button" onClick={addSalesLine} className="focusable boxed px-2 py-1 text-xs">
                + Add Item
              </button>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-tally-tableHeader">
                <tr>
                  <th className="text-left px-2 py-1">Product</th>
                  <th className="text-right px-2 py-1">Available Qty</th>
                  <th className="text-right px-2 py-1">Qty Sold</th>
                  <th className="text-right px-2 py-1">Sale Price (optional)</th>
                  <th className="text-center px-2 py-1">X</th>
                </tr>
              </thead>
              <tbody>
                {salesLines.map((line, idx) => {
                  const product = stockSummary?.items?.find((p) => p.productId === line.productId);
                  return (
                    <tr key={idx} className="border-b border-tally-panelBorder">
                      <td className="px-2 py-1">
                        <select
                          className="focusable border border-tally-panelBorder bg-white w-full"
                          value={line.productId}
                          onChange={(e) => updateSalesLine(idx, 'productId', e.target.value)}
                        >
                          <option value="">Select item…</option>
                          {(stockSummary?.items || []).map((item) => (
                            <option key={item.productId} value={item.productId}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-right">
                        {product ? Number(product.quantity).toFixed(2) : '—'}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="focusable border border-tally-panelBorder bg-white w-full text-right"
                          value={line.quantity}
                          onChange={(e) => updateSalesLine(idx, 'quantity', e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="focusable border border-tally-panelBorder bg-white w-full text-right"
                          value={line.salePrice}
                          onChange={(e) => updateSalesLine(idx, 'salePrice', e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <button
                          type="button"
                          className="focusable text-tally-warning font-bold"
                          onClick={() => removeSalesLine(idx)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {salesLines.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-2 text-xs opacity-70 text-center">
                      No items added. Add at least one stock item to link this sale to inventory.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {voucherType === 'PURCHASE' && (
          <div className="p-3 border-t border-tally-panelBorder text-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">Items Purchased (adds to inventory)</span>
              <button type="button" onClick={addPurchaseLine} className="focusable boxed px-2 py-1 text-xs">
                + Add Item
              </button>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-tally-tableHeader">
                <tr>
                  <th className="text-left px-2 py-1">Product</th>
                  <th className="text-right px-2 py-1">Current Qty</th>
                  <th className="text-right px-2 py-1">Qty Purchased</th>
                  <th className="text-right px-2 py-1">Unit Cost</th>
                  <th className="text-center px-2 py-1">X</th>
                </tr>
              </thead>
              <tbody>
                {purchaseLines.map((line, idx) => {
                  const product = stockSummary?.items?.find((p) => p.productId === line.productId);
                  return (
                    <tr key={idx} className="border-b border-tally-panelBorder">
                      <td className="px-2 py-1">
                        <select
                          className="focusable border border-tally-panelBorder bg-white w-full"
                          value={line.productId}
                          onChange={(e) => updatePurchaseLine(idx, 'productId', e.target.value)}
                        >
                          <option value="">Select item…</option>
                          {(stockSummary?.items || []).map((item) => (
                            <option key={item.productId} value={item.productId}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-right">
                        {product ? Number(product.quantity).toFixed(2) : '—'}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="focusable border border-tally-panelBorder bg-white w-full text-right"
                          value={line.quantity}
                          onChange={(e) => updatePurchaseLine(idx, 'quantity', e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="focusable border border-tally-panelBorder bg-white w-full text-right"
                          value={line.unitCost}
                          onChange={(e) => updatePurchaseLine(idx, 'unitCost', e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <button
                          type="button"
                          className="focusable text-tally-warning font-bold"
                          onClick={() => removePurchaseLine(idx)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {purchaseLines.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-2 text-xs opacity-70 text-center">
                      No items added. Add at least one stock item to link this purchase to inventory.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="p-3 flex flex-wrap gap-2 text-sm items-center">
          <span className="text-xs">⌘/Ctrl+S Save/Post • ⌥A Add Line • ⌥L Ledger Search • ⌥1/2/3 Jump Fields</span>
          {canEdit && (
            <>
              <button type="button" onClick={addLine} className="focusable boxed px-3 py-1">⌥A Add Line</button>
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
