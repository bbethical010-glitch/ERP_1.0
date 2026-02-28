import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ItemizedStockEntry } from './ItemizedStockEntry';
import { OpeningPositionService } from './OpeningPositionService';
import { OpeningPositionValidator } from './OpeningPositionValidator';

export function OpeningPositionForm() {
    const navigate = useNavigate();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [showStockEntry, setShowStockEntry] = useState(false);

    const [assets, setAssets] = useState([
        { code: 'CA-CASH', name: 'Cash in Hand', amount: 0 },
        { code: 'CA-BANK', name: 'Bank Balance', amount: 0 },
        { code: 'CA-AR', name: 'Accounts Receivable', amount: 0 },
        { code: 'FA', name: 'Fixed Assets', amount: 0 },
    ]);

    const [inventory, setInventory] = useState([]);

    const [liabilities, setLiabilities] = useState([
        { code: 'LI-LOAN', name: 'Loan Payable', amount: 0 },
        { code: 'LI-AP', name: 'Accounts Payable', amount: 0 },
    ]);

    const [capital, setCapital] = useState(0);
    const [autoComputeCapital, setAutoComputeCapital] = useState(true);

    const totals = OpeningPositionValidator.calculateTotals(assets, liabilities, capital, inventory);

    useEffect(() => {
        if (autoComputeCapital) {
            const needed = totals.sumAssets - totals.sumLiabilities;
            const safeCapital = needed > 0 ? needed : 0;
            setCapital(safeCapital);
        }
    }, [totals.sumAssets, totals.sumLiabilities, autoComputeCapital]);

    const handleAssetChange = (index, value) => {
        const updated = [...assets];
        updated[index].amount = parseFloat(value) || 0;
        setAssets(updated);
    };

    const handleLiabilityChange = (index, value) => {
        const updated = [...liabilities];
        updated[index].amount = parseFloat(value) || 0;
        setLiabilities(updated);
    };

    const handleSubmit = async (e) => {
        e?.preventDefault();
        if (totals.variance !== 0) return;

        setIsSubmitting(true);
        setError(null);
        try {
            await OpeningPositionService.submitOpeningPosition({
                assets,
                liabilities,
                capital,
                inventory
            });
            // Redirect to Gateway (dashboard) on success
            navigate('/gateway');
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Failed to submit opening position');
            setIsSubmitting(false);
        }
    };

    const canSubmit = totals.variance === 0 && (totals.sumAssets > 0 || totals.sumLiabilities > 0 || capital > 0);

    return (
        <div className="min-h-screen bg-tally-background text-tally-text flex flex-col items-center justify-center p-4">

            {showStockEntry && (
                <ItemizedStockEntry
                    inventory={inventory}
                    onChange={setInventory}
                    onClose={() => setShowStockEntry(false)}
                />
            )}

            <div className="boxed shadow-panel w-full max-w-4xl bg-white flex flex-col">
                <div className="bg-tally-header text-white px-4 py-2 text-sm font-semibold flex items-center justify-between">
                    <span>Opening Financial Position & Stock</span>
                </div>

                <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-6 text-sm">
                    <p className="text-gray-600 mb-2">
                        Enter your opening financial balances. The trial balance must match (Assets = Liabilities + Capital) before you can proceed.
                    </p>

                    <div className="grid grid-cols-2 gap-8">
                        {/* ASSETS Column */}
                        <div className="flex flex-col gap-4">
                            <h3 className="font-bold border-b border-tally-panelBorder pb-1">Assets (Debit)</h3>

                            <div className="flex flex-col gap-2">
                                {assets.map((asset, idx) => (
                                    <label key={asset.code} className="flex items-center justify-between">
                                        <span className="text-gray-700">{asset.name}</span>
                                        <input
                                            type="number"
                                            className="focusable border border-tally-panelBorder px-2 py-1 text-right w-32"
                                            value={asset.amount || ''}
                                            onChange={(e) => handleAssetChange(idx, e.target.value)}
                                            min="0"
                                            step="0.01"
                                        />
                                    </label>
                                ))}

                                <div className="flex justify-between items-center py-2 px-3 bg-blue-50 border border-blue-200 rounded mt-2">
                                    <span className="font-medium text-blue-900">Inventory Total</span>
                                    <div className="flex gap-2 items-center">
                                        <span className="font-bold">{totals.totalInventory.toFixed(2)}</span>
                                        <button
                                            type="button"
                                            onClick={() => setShowStockEntry(true)}
                                            className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 focusable"
                                        >
                                            {inventory.length > 0 ? `Edit (${inventory.length} items)` : 'Add Stock'}
                                        </button>
                                    </div>
                                </div>

                                <div className="flex justify-between font-bold pt-4 mt-auto border-t border-tally-panelBorder">
                                    <span>Total Assets:</span>
                                    <span>{totals.sumAssets.toFixed(2)}</span>
                                </div>
                            </div>
                        </div>

                        {/* LIABILITIES Column */}
                        <div className="flex flex-col gap-4">
                            <h3 className="font-bold border-b border-tally-panelBorder pb-1">Liabilities & Capital (Credit)</h3>

                            <div className="flex flex-col gap-2">
                                {liabilities.map((liab, idx) => (
                                    <label key={liab.code} className="flex items-center justify-between">
                                        <span className="text-gray-700">{liab.name}</span>
                                        <input
                                            type="number"
                                            className="focusable border border-tally-panelBorder px-2 py-1 text-right w-32"
                                            value={liab.amount || ''}
                                            onChange={(e) => handleLiabilityChange(idx, e.target.value)}
                                            min="0"
                                            step="0.01"
                                        />
                                    </label>
                                ))}

                                <label className="flex items-center justify-between mt-2 pt-2 border-t border-tally-panelBorder border-dashed">
                                    <div className="flex flex-col">
                                        <span className="text-gray-700 font-medium">Owner Capital</span>
                                        <label className="text-[10px] text-gray-500 flex items-center gap-1 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={autoComputeCapital}
                                                onChange={(e) => setAutoComputeCapital(e.target.checked)}
                                            />
                                            Auto-fill to balance
                                        </label>
                                    </div>
                                    <input
                                        type="number"
                                        className="focusable border border-tally-panelBorder px-2 py-1 text-right w-32 font-bold bg-[#f2f4f8]"
                                        value={capital || ''}
                                        onChange={(e) => {
                                            setAutoComputeCapital(false);
                                            setCapital(parseFloat(e.target.value) || 0);
                                        }}
                                        min="0"
                                        step="0.01"
                                    />
                                </label>

                                <div className="flex justify-between font-bold pt-4 mt-auto border-t border-tally-panelBorder">
                                    <span>Total Liab + CAP:</span>
                                    <span>{(totals.sumLiabilities + capital).toFixed(2)}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 p-3 bg-[#f2f4f8] border border-tally-panelBorder flex justify-between items-center">
                        <div className="flex items-center gap-4">
                            <span className="font-medium text-gray-700">Variance:</span>
                            <span className={`font-bold ${Math.abs(totals.variance) < 0.01 ? 'text-green-600' : 'text-tally-warning'}`}>
                                {Math.abs(totals.variance) < 0.01 ? '0.00' : totals.variance.toFixed(2)}
                            </span>
                            {Math.abs(totals.variance) >= 0.01 && (
                                <span className="text-xs text-tally-warning ml-2">Does not balance</span>
                            )}
                        </div>

                        <div className="flex gap-2">
                            {error && <span className="text-tally-warning text-xs self-center mr-2">{error}</span>}
                            <button
                                type="submit"
                                disabled={!canSubmit || isSubmitting}
                                className="focusable bg-tally-header text-white px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSubmitting ? 'Posting...' : 'Open Books (Accept)'}
                            </button>
                        </div>
                    </div>

                </form>
            </div>
        </div>
    );
}
