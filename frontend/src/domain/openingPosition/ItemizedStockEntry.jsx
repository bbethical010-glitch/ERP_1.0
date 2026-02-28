import React, { useState, useEffect, useRef } from 'react';
import { commandBus, COMMANDS } from '../../core/CommandBus';

export function ItemizedStockEntry({ inventory, onChange, onClose }) {
    const [items, setItems] = useState(inventory || []);
    const tableRef = useRef(null);

    // Ensure there's at least one empty row if empty
    useEffect(() => {
        if (items.length === 0) {
            setItems([{ name: '', sku: '', uom: 'pcs', initialQty: 0, unitCost: 0 }]);
        }
    }, []);

    const handleAdd = () => {
        setItems([...items, { name: '', sku: '', uom: 'pcs', initialQty: 0, unitCost: 0 }]);
    };

    const handleChange = (index, field, value) => {
        const updated = [...items];
        updated[index][field] = value;
        setItems(updated);
    };

    const handleRemove = (index) => {
        const updated = items.filter((_, i) => i !== index);
        setItems(updated);
    };

    const handleSave = () => {
        const validItems = items.filter(i => i.name.trim() && i.initialQty > 0 && i.unitCost >= 0);
        onChange(validItems);
        onClose();
    };

    // Global Keydown handler
    useEffect(() => {
        const handleGlobalKeydown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSave();
            }
        };
        window.addEventListener('keydown', handleGlobalKeydown);
        return () => window.removeEventListener('keydown', handleGlobalKeydown);
    }, [items]);

    // Grid Navigation Logic
    const handleKeyDown = (e, rowIndex, colIndex) => {
        if (!tableRef.current) return;

        const rows = Array.from(tableRef.current.querySelectorAll('tbody tr'));
        const inputsInRow = rows[rowIndex]?.querySelectorAll('input, select, button');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (rowIndex < rows.length - 1) {
                const nextRowInputs = rows[rowIndex + 1].querySelectorAll('input, select, button');
                if (nextRowInputs[colIndex]) {
                    nextRowInputs[colIndex].focus();
                } else if (nextRowInputs[0]) {
                    nextRowInputs[0].focus();
                }
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (rowIndex > 0) {
                const prevRowInputs = rows[rowIndex - 1].querySelectorAll('input, select, button');
                if (prevRowInputs[colIndex]) prevRowInputs[colIndex].focus();
            }
        } else if (e.key === 'Enter' && e.target.type !== 'button') {
            e.preventDefault();
            // Move right or add row if at the end
            if (inputsInRow && colIndex < inputsInRow.length - 2) {
                inputsInRow[colIndex + 1].focus();
            } else if (rowIndex === rows.length - 2) { // -2 because of the "Add row" tr
                handleAdd();
                setTimeout(() => {
                    const newRows = Array.from(tableRef.current.querySelectorAll('tbody tr'));
                    const lastInputs = newRows[newRows.length - 2].querySelectorAll('input, select, button');
                    if (lastInputs[0]) lastInputs[0].focus();
                }, 50);
            }
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="boxed shadow-panel w-full max-w-4xl bg-tally-background flex flex-col max-h-[90vh]">
                <div className="bg-tally-header text-white px-4 py-2 text-sm font-semibold flex items-center justify-between">
                    <span>Itemized Stock Entry (Opening Inventory)</span>
                    <button className="opacity-80 hover:opacity-100 focusable" onClick={onClose}>✕</button>
                </div>

                <div className="p-4 overflow-y-auto flex-1 text-sm text-tally-text">
                    <p className="mb-2 text-xs opacity-75">Ctrl+Enter to save. Esc to close. Arrow keys to navigate.</p>
                    <table ref={tableRef} className="w-full text-left border-collapse border border-tally-panelBorder">
                        <thead className="bg-[#f2f4f8] text-tally-text font-bold">
                            <tr>
                                <th className="border border-tally-panelBorder p-2 w-[35%]">Item Name</th>
                                <th className="border border-tally-panelBorder p-2 w-[15%]">SKU</th>
                                <th className="border border-tally-panelBorder p-2 w-[10%]">UoM</th>
                                <th className="border border-tally-panelBorder p-2 w-[10%] text-right">Init Qty</th>
                                <th className="border border-tally-panelBorder p-2 w-[15%] text-right">Unit Cost</th>
                                <th className="border border-tally-panelBorder p-2 w-[10%] text-right">Total</th>
                                <th className="border border-tally-panelBorder p-2 w-[5%] text-center">X</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item, idx) => (
                                <tr key={idx}>
                                    <td className="border border-tally-panelBorder p-1">
                                        <input
                                            type="text"
                                            className="w-full focusable border-none outline-none bg-transparent"
                                            value={item.name}
                                            onChange={e => handleChange(idx, 'name', e.target.value)}
                                            onKeyDown={e => handleKeyDown(e, idx, 0)}
                                            placeholder="e.g. Widget A"
                                            autoFocus={idx === 0}
                                        />
                                    </td>
                                    <td className="border border-tally-panelBorder p-1">
                                        <input
                                            type="text"
                                            className="w-full focusable border-none outline-none bg-transparent"
                                            value={item.sku || ''}
                                            onChange={e => handleChange(idx, 'sku', e.target.value)}
                                            onKeyDown={e => handleKeyDown(e, idx, 1)}
                                        />
                                    </td>
                                    <td className="border border-tally-panelBorder p-1">
                                        <input
                                            type="text"
                                            className="w-full focusable border-none outline-none bg-transparent"
                                            value={item.uom || ''}
                                            onChange={e => handleChange(idx, 'uom', e.target.value)}
                                            onKeyDown={e => handleKeyDown(e, idx, 2)}
                                        />
                                    </td>
                                    <td className="border border-tally-panelBorder p-1">
                                        <input
                                            type="number"
                                            className="w-full text-right focusable border-none outline-none bg-transparent"
                                            value={item.initialQty || ''}
                                            onChange={e => handleChange(idx, 'initialQty', parseFloat(e.target.value) || 0)}
                                            onKeyDown={e => handleKeyDown(e, idx, 3)}
                                            min="0"
                                        />
                                    </td>
                                    <td className="border border-tally-panelBorder p-1">
                                        <input
                                            type="number"
                                            className="w-full text-right focusable border-none outline-none bg-transparent"
                                            value={item.unitCost || ''}
                                            onChange={e => handleChange(idx, 'unitCost', parseFloat(e.target.value) || 0)}
                                            onKeyDown={e => handleKeyDown(e, idx, 4)}
                                            min="0"
                                            step="0.01"
                                        />
                                    </td>
                                    <td className="border border-tally-panelBorder p-2 text-right font-medium">
                                        {((item.initialQty || 0) * (item.unitCost || 0)).toFixed(2)}
                                    </td>
                                    <td className="border border-tally-panelBorder p-1 text-center">
                                        <button
                                            type="button"
                                            onClick={() => handleRemove(idx)}
                                            onKeyDown={e => handleKeyDown(e, idx, 5)}
                                            className="text-tally-warning hover:opacity-75 focusable font-bold px-2"
                                        >×</button>
                                    </td>
                                </tr>
                            ))}
                            <tr>
                                <td colSpan={7} className="border border-tally-panelBorder p-1">
                                    <button
                                        type="button"
                                        onClick={handleAdd}
                                        className="w-full text-left focusable p-1 text-blue-600 hover:text-blue-800"
                                    >
                                        + Add row (Alt+N)
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                        <tfoot>
                            <tr className="bg-[#f2f4f8] font-bold">
                                <td colSpan={5} className="border border-tally-panelBorder p-2 text-right">Total Inventory Value:</td>
                                <td className="border border-tally-panelBorder p-2 text-right">
                                    {items.reduce((sum, item) => sum + ((item.initialQty || 0) * (item.unitCost || 0)), 0).toFixed(2)}
                                </td>
                                <td className="border border-tally-panelBorder"></td>
                            </tr>
                        </tfoot>
                    </table>

                </div>

                <div className="bg-[#f2f4f8] px-4 py-3 border-t border-tally-panelBorder flex justify-end gap-2">
                    <button
                        type="button"
                        className="focusable boxed px-4 py-1 text-sm bg-tally-header text-white"
                        onClick={handleSave}
                    >
                        Confirm & Close (Ctrl+Enter)
                    </button>
                </div>
            </div>
        </div>
    );
}
