import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

/**
 * ResetConfirmModal — Ctrl+R company data reset.
 * Requires typing company name to confirm. Wipes accounting data.
 */
export function ResetConfirmModal({ open, onClose, onReset }) {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [confirmText, setConfirmText] = useState('');
    const inputRef = useRef(null);

    // Fetch exact business name to match backend expectation
    const { data: business } = useQuery({
        queryKey: ['business', user?.businessId],
        queryFn: () => api.get('/businesses/me'),
        enabled: Boolean(user?.businessId && open),
    });

    const companyName = business?.name || user?.businessName || 'Company';

    useEffect(() => {
        if (open) {
            setConfirmText('');
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [open]);

    const resetMutation = useMutation({
        mutationFn: () => api.post('/reset-company', { confirmationName: confirmText }),
        onSuccess: () => {
            queryClient.invalidateQueries();
            onReset();
        },
    });

    function handleKeyDown(e) {
        if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        if (e.key === 'Enter' && confirmText === companyName) {
            e.preventDefault();
            resetMutation.mutate();
        }
    }

    if (!open) return null;

    const isMatch = confirmText === companyName;

    return (
        <div className="command-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="tally-panel w-96" onKeyDown={handleKeyDown}>
                <div className="tally-panel-header text-tally-warning">⚠ Reset Company Data</div>
                <div className="p-2 grid gap-2 text-sm">
                    <p>This will permanently delete all:</p>
                    <ul className="list-disc ml-4 text-xs">
                        <li>Ledger accounts</li>
                        <li>Account groups</li>
                        <li>Vouchers & transactions</li>
                        <li>Audit log entries</li>
                    </ul>
                    <p>Your user account and company profile will be preserved.</p>
                    <p className="font-bold">Type <span className="text-tally-accent">"{companyName}"</span> to confirm:</p>
                    <input
                        ref={inputRef}
                        className="tally-input"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder={companyName}
                    />
                    <div className="tally-status-bar">
                        {isMatch
                            ? <span className="text-green-700">✓ Match — press Enter to reset</span>
                            : <span className="opacity-60">Type company name exactly to enable reset</span>
                        }
                        {resetMutation.isError && (
                            <span className="text-tally-warning ml-2">{resetMutation.error.message}</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
