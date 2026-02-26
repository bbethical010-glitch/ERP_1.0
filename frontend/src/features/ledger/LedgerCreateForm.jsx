import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { GroupSelector } from '../../components/GroupSelector';
import { announceToScreenReader } from '../../hooks/useFocusUtilities';
import { useViewState, SCREENS } from '../../providers/ViewStateProvider';

/**
 * LedgerCreateForm — Tally-style ledger creation form.
 *
 * Keys:
 *   Tab          — move between fields
 *   Ctrl+Enter   — save
 *   Esc          — go back
 */
export function LedgerCreateForm() {
    const { popScreen, pushScreen } = useViewState();
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const businessId = user?.businessId;

    const [name, setName] = useState('');
    const [groupCode, setGroupCode] = useState('');
    const [normalBalance, setNormalBalance] = useState('DR');
    const [openingBalance, setOpeningBalance] = useState('');
    const [openingBalanceType, setOpeningBalanceType] = useState('DR');
    const [error, setError] = useState('');

    const nameRef = useRef(null);

    // Fetch the real account_groups from the backend so we can resolve code → id
    const { data: groups = [] } = useQuery({
        queryKey: ['account-groups', businessId],
        enabled: Boolean(businessId),
        queryFn: () => api.get('/accounts/groups'),
        staleTime: 60_000
    });

    // Derive groupId so it dynamically updates when query completes
    const selectedGroup = groups.find((g) => g.code === groupCode);
    const groupId = selectedGroup?.id || '';

    // When user selects a group by code
    function onGroupChange(code, label, category) {
        setGroupCode(code);
        // Auto-set normal balance based on category
        const debitCategories = ['CURRENT_ASSET', 'FIXED_ASSET', 'EXPENSE'];
        setNormalBalance(debitCategories.includes(category) ? 'DR' : 'CR');
        setOpeningBalanceType(debitCategories.includes(category) ? 'DR' : 'CR');
    }

    const saveMutation = useMutation({
        mutationFn: () => {
            if (!groupId) throw new Error('Select a group to resolve backend ID');
            const code = `L-${name.trim().toUpperCase().replace(/\s+/g, '-').slice(0, 10)}-${Date.now() % 10000}`;
            return api.post('/accounts', {
                accountGroupId: groupId,
                code,
                name: name.trim(),
                normalBalance,
                openingBalance: Number(openingBalance) || 0,
                openingBalanceType
            });
        },
        onSuccess: () => {
            announceToScreenReader(`Ledger "${name}" created`);
            queryClient.invalidateQueries({ queryKey: ['accounts'] });
            popScreen();
        },
        onError: (err) => {
            setError(err.message || 'Failed to create ledger');
            announceToScreenReader(`Error: ${err.message}`);
        }
    });

    function validate() {
        if (!name.trim()) {
            setError('Ledger name is required');
            nameRef.current?.focus();
            return false;
        }
        if (!groupCode) {
            setError('Please select a group under');
            return false;
        }
        if (!groupId) {
            setError('Group not found in system — try refreshing');
            return false;
        }
        return true;
    }

    function handleSubmit(e) {
        e?.preventDefault();
        setError('');
        if (validate()) saveMutation.mutate();
    }

    function handleFormKeyDown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            popScreen();
        }
    }

    // Auto-focus name field on mount
    useEffect(() => {
        nameRef.current?.focus();
    }, []);

    return (
        <form
            className="tally-panel"
            onSubmit={handleSubmit}
            onKeyDown={handleFormKeyDown}
            aria-label="Create Ledger"
        >
            {/* Header */}
            <div className="tally-panel-header flex items-center justify-between">
                <span>Ledger Creation ({groups.length} groups loaded)</span>
                <span className="text-xs font-normal opacity-75">Ctrl+Enter Accept · Esc Quit</span>
            </div>

            <div className="p-2 grid gap-2 text-sm max-w-xl">
                {/* Ledger Name */}
                <label className="flex flex-col gap-1">
                    <span>
                        <span className="hotkey">N</span>ame
                    </span>
                    <input
                        ref={nameRef}
                        className="focusable border border-tally-panelBorder bg-white p-1"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ledger name"
                        required
                        autoComplete="off"
                    />
                </label>

                {/* Under (Group) */}
                <div className="flex flex-col gap-1">
                    <span>
                        <span className="hotkey">U</span>nder (Group)
                    </span>
                    <GroupSelector value={groupCode} onChange={onGroupChange} />
                    <div className="text-[11px] opacity-60">
                        Arrow ↑↓ to navigate · Enter to select · Type to filter
                    </div>
                </div>

                {/* Opening Balance */}
                <label className="flex flex-col gap-1">
                    <span>
                        <span className="hotkey">O</span>pening Balance
                    </span>
                    <div className="flex gap-2">
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="focusable border border-tally-panelBorder bg-white p-1 w-40 text-right"
                            value={openingBalance}
                            onChange={(e) => setOpeningBalance(e.target.value)}
                            placeholder="0.00"
                        />
                        <select
                            className="focusable border border-tally-panelBorder bg-white p-1"
                            value={openingBalanceType}
                            onChange={(e) => setOpeningBalanceType(e.target.value)}
                        >
                            <option value="DR">Dr</option>
                            <option value="CR">Cr</option>
                        </select>
                    </div>
                </label>

                {/* Error */}
                {error && (
                    <div
                        role="alert"
                        className="text-tally-warning text-xs border border-tally-warning px-2 py-1"
                    >
                        {error}
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                    <button
                        type="submit"
                        disabled={saveMutation.isPending}
                        className="focusable bg-tally-header text-white border border-tally-panelBorder px-4 py-1 disabled:opacity-60"
                    >
                        {saveMutation.isPending ? 'Saving...' : 'Accept (Ctrl+Enter)'}
                    </button>
                    <button
                        type="button"
                        className="focusable boxed px-4 py-1"
                        onClick={() => popScreen()}
                    >
                        Quit (Esc)
                    </button>
                </div>
            </div>

            <div className="tally-status-bar">
                Tab fields · Ctrl+Enter Accept · Esc Back
            </div>
        </form>
    );
}
