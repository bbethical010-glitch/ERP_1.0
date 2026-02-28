import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

/**
 * CompanySetupPage — Tally-style "Create Company" screen.
 * Shown after signup/first login to complete company details.
 * Ctrl+Enter / Cmd+Enter to save. Esc to skip.
 */
export function CompanySetupPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { user } = useAuth();

    const [name, setName] = useState('');
    const [financialYearStart, setFinancialYearStart] = useState(
        `${new Date().getFullYear()}-04-01`
    );
    const [baseCurrency, setBaseCurrency] = useState('INR');
    const [address, setAddress] = useState('');
    const [error, setError] = useState('');

    const nameRef = useRef(null);

    // Prefill from existing business data
    const { data: business } = useQuery({
        queryKey: ['business-me'],
        queryFn: () => api.get('/businesses/me'),
        enabled: Boolean(user)
    });

    useEffect(() => {
        if (business) {
            setName(business.name || '');
            setFinancialYearStart(business.financialYearStart?.slice(0, 10) || `${new Date().getFullYear()}-04-01`);
            setBaseCurrency(business.baseCurrency || 'INR');
            setAddress(business.address || '');
        }
        // Auto-focus on mount
        nameRef.current?.select();
    }, [business]);

    const saveMutation = useMutation({
        mutationFn: () =>
            api.patch('/businesses/me', {
                name: name.trim(),
                financialYearStart,
                baseCurrency,
                address: address.trim()
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['business-me'] });
            navigate('/opening-position');
        },
        onError: (err) => setError(err.message || 'Failed to save company details')
    });

    function handleSubmit(e) {
        e?.preventDefault();
        setError('');
        if (!name.trim()) {
            setError('Company name is required');
            nameRef.current?.focus();
            return;
        }
        saveMutation.mutate();
    }

    function handleKeyDown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            navigate('/opening-position');
        }
    }

    return (
        <div
            className="min-h-screen bg-tally-background text-tally-text flex items-center justify-center p-4"
            onKeyDown={handleKeyDown}
        >
            <div className="boxed shadow-panel w-full max-w-xl">
                {/* Header */}
                <div className="bg-tally-header text-white px-4 py-2 text-sm font-semibold flex items-center justify-between">
                    <span>Create Company</span>
                    <span className="text-xs opacity-75 font-normal">Ctrl+Enter to Save · Esc to Skip</span>
                </div>

                <form className="p-4 grid gap-3 text-sm" onSubmit={handleSubmit}>
                    {/* Company Name */}
                    <label className="flex flex-col gap-1">
                        <span>
                            <span className="hotkey">C</span>ompany Name
                        </span>
                        <input
                            ref={nameRef}
                            autoFocus
                            className="focusable border border-tally-panelBorder bg-white p-2 font-[inherit]"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Enter company name"
                            required
                        />
                    </label>

                    {/* Financial Year Start */}
                    <label className="flex flex-col gap-1">
                        <span>
                            Financial <span className="hotkey">Y</span>ear Start
                        </span>
                        <input
                            type="date"
                            className="focusable border border-tally-panelBorder bg-white p-2 font-[inherit]"
                            value={financialYearStart}
                            onChange={(e) => setFinancialYearStart(e.target.value)}
                        />
                    </label>

                    {/* Base Currency */}
                    <label className="flex flex-col gap-1">
                        <span>
                            <span className="hotkey">B</span>ase Currency
                        </span>
                        <select
                            className="focusable border border-tally-panelBorder bg-white p-2 font-[inherit]"
                            value={baseCurrency}
                            onChange={(e) => setBaseCurrency(e.target.value)}
                        >
                            <option value="INR">INR — Indian Rupee (₹)</option>
                            <option value="USD">USD — US Dollar ($)</option>
                            <option value="EUR">EUR — Euro (€)</option>
                            <option value="GBP">GBP — British Pound (£)</option>
                            <option value="AED">AED — UAE Dirham</option>
                            <option value="SGD">SGD — Singapore Dollar</option>
                        </select>
                    </label>

                    {/* Address */}
                    <label className="flex flex-col gap-1">
                        <span>
                            <span className="hotkey">A</span>ddress
                        </span>
                        <textarea
                            className="focusable border border-tally-panelBorder bg-white p-2 font-[inherit] resize-none"
                            rows={3}
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            placeholder="Company address (optional)"
                        />
                    </label>

                    {/* Error */}
                    {error && <div className="text-tally-warning text-xs">{error}</div>}

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                        <button
                            type="submit"
                            disabled={saveMutation.isPending}
                            className="focusable bg-tally-header text-white border border-tally-panelBorder px-4 py-2 disabled:opacity-60"
                        >
                            {saveMutation.isPending ? 'Saving...' : 'Accept (Ctrl+Enter)'}
                        </button>
                        <button
                            type="button"
                            className="focusable boxed px-4 py-2"
                            onClick={() => navigate('/opening-position')}
                        >
                            Skip (Esc)
                        </button>
                    </div>
                </form>

                <div className="px-4 py-2 border-t border-tally-panelBorder text-[11px] text-tally-text opacity-70">
                    Tab to move between fields · Ctrl+Enter to save · Esc to skip
                </div>
            </div>
        </div>
    );
}
