import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ItemizedStockEntry } from './ItemizedStockEntry';
import { OpeningPositionService } from './OpeningPositionService';
import { OpeningPositionValidator } from './OpeningPositionValidator';
import { useAuth } from '../../auth/AuthContext';

const DEFAULT_LINE = {
    ledgerName: '',
    group: '',
    drCr: 'DR',
    amount: 0
};

const COMMON_GROUPS = [
    'Capital Account',
    'Current Assets',
    'Current Liabilities',
    'Fixed Assets',
    'Investments',
    'Loans (Liability)',
    'Bank Accounts',
    'Cash-in-Hand',
    'Sundry Creditors',
    'Sundry Debtors'
];

export function OpeningPositionForm() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [showStockEntry, setShowStockEntry] = useState(false);

    // Grid State
    const [openingBalances, setOpeningBalances] = useState([
        { ledgerName: 'Owner Capital', group: 'Capital Account', drCr: 'CR', amount: 0 },
        { ledgerName: 'Cash', group: 'Cash-in-Hand', drCr: 'DR', amount: 0 },
        { ledgerName: 'Bank A/c', group: 'Bank Accounts', drCr: 'DR', amount: 0 },
        { ...DEFAULT_LINE }
    ]);

    const [inventory, setInventory] = useState([]);

    const totals = OpeningPositionValidator.calculateTotals(openingBalances, inventory);
    const tableRef = useRef(null);

    const handleLineChange = (index, field, value) => {
        const updated = [...openingBalances];
        updated[index][field] = value;

        // Auto-switch Dr/Cr based on group commonly
        if (field === 'group' && value) {
            const crGroups = ['Capital Account', 'Current Liabilities', 'Loans (Liability)', 'Sundry Creditors'];
            if (crGroups.includes(value)) {
                updated[index]['drCr'] = 'CR';
            } else {
                updated[index]['drCr'] = 'DR';
            }
        }

        setOpeningBalances(updated);
    };

    const handleAddLine = () => {
        setOpeningBalances([...openingBalances, { ...DEFAULT_LINE }]);
    };

    const handleRemoveLine = (idx) => {
        const updated = openingBalances.filter((_, i) => i !== idx);
        setOpeningBalances(updated);
    };

    const handleSubmit = async (e) => {
        e?.preventDefault();
        if (totals.variance !== 0) return;

        setIsSubmitting(true);
        setError(null);
        try {
            const validBalances = openingBalances.filter(b => b.ledgerName.trim() && b.amount > 0 && b.group);
            const validItems = inventory.filter(i => i.name.trim() && i.initialQty > 0);

            await OpeningPositionService.submitOpeningPosition({
                date: new Date().toISOString().slice(0, 10),
                openingBalances: validBalances,
                items: validItems.length > 0 ? validItems : undefined,
                stockJournalMetadata: {
                    narration: 'Opening Stock Entry'
                }
            });

            // Redirect to Gateway
            navigate('/gateway');
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Failed to submit opening position');
            setIsSubmitting(false);
        }
    };

    const canSubmit = totals.variance === 0 && (totals.sumAssets > 0 || totals.sumLiabilities > 0 || totals.ownerCapital > 0);

    // Global Keybinds
    useEffect(() => {
        const handleGlobalKeybind = (e) => {
            // Ctrl+Enter -> Submit
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (canSubmit && !isSubmitting && !showStockEntry) {
                    handleSubmit();
                }
            }
            // Alt+N -> Add row
            if (e.altKey && e.key === 'n') {
                e.preventDefault();
                if (!showStockEntry) handleAddLine();
            }
        };

        window.addEventListener('keydown', handleGlobalKeybind);
        return () => window.removeEventListener('keydown', handleGlobalKeybind);
    }, [canSubmit, isSubmitting, showStockEntry, openingBalances, inventory]);


    // Grid Navigation Logistics
    const handleGridKeyDown = (e, rowIndex, colIndex) => {
        if (!tableRef.current) return;

        const rows = Array.from(tableRef.current.querySelectorAll('tbody tr:not(.ignore-grid)'));
        const inputsInRow = rows[rowIndex]?.querySelectorAll('input, select, button');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (rowIndex < rows.length - 1) {
                const nextRowInputs = rows[rowIndex + 1].querySelectorAll('input, select, button');
                if (nextRowInputs[colIndex]) nextRowInputs[colIndex].focus();
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (rowIndex > 0) {
                const prevRowInputs = rows[rowIndex - 1].querySelectorAll('input, select, button');
                if (prevRowInputs[colIndex]) prevRowInputs[colIndex].focus();
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            // Enter moves right. If at end, moves to next row or creates new
            if (inputsInRow && colIndex < inputsInRow.length - 2) {
                inputsInRow[colIndex + 1].focus();
            } else if (rowIndex === rows.length - 1) {
                handleAddLine();
                setTimeout(() => {
                    const newRows = Array.from(tableRef.current.querySelectorAll('tbody tr:not(.ignore-grid)'));
                    const lastInputs = newRows[newRows.length - 1].querySelectorAll('input, select, button');
                    if (lastInputs[0]) lastInputs[0].focus();
                }, 50);
            } else {
                const nextRowInputs = rows[rowIndex + 1].querySelectorAll('input, select, button');
                if (nextRowInputs[0]) nextRowInputs[0].focus();
            }
        }
    };

    return (
        <div className="min-h-screen bg-tally-background text-tally-text flex flex-col items-center justify-center p-4">

            {showStockEntry && (
                <ItemizedStockEntry
                    inventory={inventory}
                    onChange={setInventory}
                    onClose={() => setShowStockEntry(false)}
                />
            )}

            <div className="boxed shadow-panel w-full max-w-6xl bg-white flex flex-col h-[85vh]">
                <div className="bg-tally-header text-white px-4 py-2 text-sm font-semibold flex items-center justify-between">
                    <span>Opening Financial Position & Stock </span>
                    <span className="text-xs opacity-80">{user?.businessName || 'New Company'}</span>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {/* LEFT COLUMN: Ledger Grid */}
                    <div className="w-2/3 border-r border-tally-panelBorder flex flex-col bg-white overflow-y-auto">
                        <div className="p-3 bg-[#f2f4f8] border-b border-tally-panelBorder flex items-center justify-between text-xs">
                            <span className="opacity-80">Enter Ledger opening balances (Tab/Enter to navigate, Alt+N to add row)</span>
                            <button
                                type="button"
                                onClick={() => setShowStockEntry(true)}
                                className="focusable bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 text-xs"
                            >
                                {inventory.length > 0 ? `Edit Inventory (${inventory.length} items)` : 'Add Stock Item'}
                            </button>
                        </div>

                        <table ref={tableRef} className="w-full text-left border-collapse text-sm">
                            <thead className="bg-[#f2f4f8] text-tally-text font-bold sticky top-0 z-10 shadow-sm border-b border-tally-panelBorder">
                                <tr>
                                    <th className="p-2 w-[35%]">Ledger Name</th>
                                    <th className="p-2 w-[30%]">Group</th>
                                    <th className="p-2 w-[10%] text-center">Dr/Cr</th>
                                    <th className="p-2 w-[20%] text-right">Amount</th>
                                    <th className="p-2 w-[5%] text-center">X</th>
                                </tr>
                            </thead>
                            <tbody>
                                {openingBalances.map((line, idx) => (
                                    <tr key={idx} className="border-b border-[#f2f4f8] hover:bg-[#fafafa]">
                                        <td className="p-1 px-2 border-r border-[#f2f4f8]">
                                            <input
                                                type="text"
                                                autoFocus={idx === 0}
                                                className="w-full focusable bg-transparent border-none outline-none"
                                                value={line.ledgerName}
                                                onChange={(e) => handleLineChange(idx, 'ledgerName', e.target.value)}
                                                onKeyDown={(e) => handleGridKeyDown(e, idx, 0)}
                                                placeholder="e.g. Sales A/c, HDFC Bank"
                                            />
                                        </td>
                                        <td className="p-1 px-2 border-r border-[#f2f4f8]">
                                            <select
                                                className="w-full focusable bg-transparent border-none outline-none text-sm"
                                                value={line.group}
                                                onChange={(e) => handleLineChange(idx, 'group', e.target.value)}
                                                onKeyDown={(e) => handleGridKeyDown(e, idx, 1)}
                                            >
                                                <option value="" disabled>Select Group...</option>
                                                {COMMON_GROUPS.map(g => (
                                                    <option key={g} value={g}>{g}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="p-1 px-2 border-r border-[#f2f4f8]">
                                            <select
                                                className="w-full focusable bg-transparent border-none outline-none text-center font-medium"
                                                value={line.drCr}
                                                onChange={(e) => handleLineChange(idx, 'drCr', e.target.value)}
                                                onKeyDown={(e) => handleGridKeyDown(e, idx, 2)}
                                            >
                                                <option value="DR">Dr</option>
                                                <option value="CR">Cr</option>
                                            </select>
                                        </td>
                                        <td className="p-1 px-2 border-r border-[#f2f4f8]">
                                            <input
                                                type="number"
                                                className="w-full focusable bg-transparent border-none outline-none text-right font-medium"
                                                value={line.amount || ''}
                                                onChange={(e) => handleLineChange(idx, 'amount', parseFloat(e.target.value) || 0)}
                                                onKeyDown={(e) => handleGridKeyDown(e, idx, 3)}
                                                min="0"
                                                step="0.01"
                                            />
                                        </td>
                                        <td className="p-1 text-center">
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveLine(idx)}
                                                tabIndex={-1}
                                                className="text-tally-warning hover:opacity-75 focusable font-bold px-2 inline-block"
                                            >×</button>
                                        </td>
                                    </tr>
                                ))}
                                <tr className="ignore-grid">
                                    <td colSpan={5} className="p-2 text-center text-xs opacity-60">
                                        End of List
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* RIGHT COLUMN: Summary Board */}
                    <div className="w-1/3 bg-[#fdfdfd] flex flex-col p-6 border-l border-tally-panelBorder">
                        <h3 className="font-bold underline mb-6 text-base tracking-wide uppercase text-gray-800">Financial Summary</h3>

                        <div className="flex flex-col gap-4 text-sm mb-auto">
                            <div className="flex justify-between items-center py-2 border-b border-tally-panelBorder border-dashed">
                                <span className="opacity-75">Debit Balances (Assets)</span>
                                <span className="font-bold">{(totals.sumAssets - totals.totalInventory).toFixed(2)}</span>
                            </div>

                            <div className="flex justify-between items-center py-2 border-b border-tally-panelBorder border-dashed text-blue-900 bg-blue-50 -mx-4 px-4 shadow-inner">
                                <span className="font-bold">Inventory Value</span>
                                <span className="font-bold text-base">{totals.totalInventory.toFixed(2)}</span>
                            </div>

                            <div className="flex justify-between items-center py-2 border-b border-tally-panelBorder border-dashed mt-4">
                                <span className="opacity-75">Credit Balances (Liabs)</span>
                                <span className="font-bold">{totals.sumLiabilities.toFixed(2)}</span>
                            </div>

                            <div className="flex justify-between items-center py-2 border-b border-tally-panelBorder border-dashed">
                                <span className="opacity-75">Owner Capital</span>
                                <span className="font-bold">{totals.ownerCapital.toFixed(2)}</span>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 mt-8">
                            <div className={`p-4 border ${Math.abs(totals.variance) < 0.01 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'} rounded shadow-sm flex flex-col`}>
                                <div className="flex justify-between items-center items-end">
                                    <span className="text-xs uppercase tracking-wide opacity-80 font-bold">Trial Balance Variance</span>
                                    <span className={`text-xl font-black ${Math.abs(totals.variance) < 0.01 ? 'text-green-700' : 'text-red-700'}`}>
                                        {Math.abs(totals.variance) < 0.01 ? '0.00' : totals.variance.toFixed(2)}
                                    </span>
                                </div>
                                {Math.abs(totals.variance) >= 0.01 ? (
                                    <span className="text-xs text-red-600 mt-2 font-medium">Assets must equal Liabilities + Capital</span>
                                ) : (
                                    <span className="text-xs text-green-700 mt-2 font-medium">Balances perfectly match!</span>
                                )}
                            </div>

                            <div className="mt-4 flex flex-col items-center gap-2">
                                {error && <div className="text-red-600 text-xs w-full text-center bg-red-50 py-1 mb-2">{error}</div>}
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    disabled={!canSubmit || isSubmitting}
                                    className="focusable bg-tally-header text-white w-full py-3 text-sm font-bold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed shadow"
                                >
                                    {isSubmitting ? 'Posting...' : 'Open Books (Ctrl+Enter)'}
                                </button>
                            </div>
                        </div>

                    </div>
                </div>

            </div>
        </div>
    );
}
