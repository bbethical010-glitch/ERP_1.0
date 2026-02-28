import React, { useState } from 'react';

export function ItemizedStockEntry({ inventory, onChange, onClose }) {
    const [items, setItems] = useState(inventory || []);

    const handleAdd = () => {
        setItems([...items, { name: '', category: 'General', quantity: 0, unitCost: 0 }]);
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
        const validItems = items.filter(i => i.name.trim() && i.quantity > 0 && i.unitCost >= 0);
        onChange(validItems);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="boxed shadow-panel w-full max-w-4xl bg-tally-background flex flex-col max-h-[90vh]">
                <div className="bg-tally-header text-white px-4 py-2 text-sm font-semibold flex items-center justify-between">
                    <span>Itemized Stock Entry (Opening Inventory)</span>
                    <button className="opacity-80 hover:opacity-100" onClick={onClose}>✕</button>
                </div>

                <div className="p-4 overflow-y-auto flex-1 text-sm text-tally-text">
                    <table className="w-full text-left border-collapse border border-tally-panelBorder">
                        <thead className="bg-[#f2f4f8] text-tally-text font-bold">
                            <tr>
                                <th className="border border-tally-panelBorder p-2 w-[40%]">Item Name/SKU</th>
                                <th className="border border-tally-panelBorder p-2 w-[15%]">Category</th>
                                <th className="border border-tally-panelBorder p-2 w-[15%] text-right">Quantity</th>
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
                                            placeholder="e.g. Dell XPS 15"
                                        />
                                    </td>
                                    <td className="border border-tally-panelBorder p-1">
                                        <input
                                            type="text"
                                            className="w-full focusable border-none outline-none bg-transparent"
                                            value={item.category}
                                            onChange={e => handleChange(idx, 'category', e.target.value)}
                                        />
                                    </td>
                                    <td className="border border-tally-panelBorder p-1">
                                        <input
                                            type="number"
                                            className="w-full text-right focusable border-none outline-none bg-transparent"
                                            value={item.quantity || ''}
                                            onChange={e => handleChange(idx, 'quantity', parseFloat(e.target.value) || 0)}
                                            min="0"
                                        />
                                    </td>
                                    <td className="border border-tally-panelBorder p-1">
                                        <input
                                            type="number"
                                            className="w-full text-right focusable border-none outline-none bg-transparent"
                                            value={item.unitCost || ''}
                                            onChange={e => handleChange(idx, 'unitCost', parseFloat(e.target.value) || 0)}
                                            min="0"
                                            step="0.01"
                                        />
                                    </td>
                                    <td className="border border-tally-panelBorder p-2 text-right font-medium">
                                        {((item.quantity || 0) * (item.unitCost || 0)).toFixed(2)}
                                    </td>
                                    <td className="border border-tally-panelBorder p-1 text-center">
                                        <button
                                            type="button"
                                            onClick={() => handleRemove(idx)}
                                            className="text-tally-warning hover:opacity-75 focusable font-bold px-2"
                                        >×</button>
                                    </td>
                                </tr>
                            ))}
                            <tr>
                                <td colSpan={6} className="border border-tally-panelBorder p-1">
                                    <button
                                        type="button"
                                        onClick={handleAdd}
                                        className="w-full text-left focusable p-1 text-blue-600 hover:text-blue-800"
                                    >
                                        + Add row...
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                        <tfoot>
                            <tr className="bg-[#f2f4f8] font-bold">
                                <td colSpan={4} className="border border-tally-panelBorder p-2 text-right">Total Inventory Value:</td>
                                <td className="border border-tally-panelBorder p-2 text-right">
                                    {items.reduce((sum, item) => sum + ((item.quantity || 0) * (item.unitCost || 0)), 0).toFixed(2)}
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
                        Confirm & Close
                    </button>
                </div>
            </div>
        </div>
    );
}
