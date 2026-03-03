import { useEffect, useRef, useState } from 'react';
import { TALLY_GROUP_HIERARCHY } from '../lib/constants';

/**
 * GroupSelector — Tally-style keyboard-navigable group picker.
 *
 * Usage:
 *   <GroupSelector value={groupCode} onChange={(code, label, category) => ...} />
 *
 * Keys:
 *   Arrow Down/Up — move selection
 *   Arrow Right   — expand parent group
 *   Enter         — select focused item
 *   Esc           — close without selecting
 *   Typing        — filter groups by name
 */
function toDisplayLabel(group) {
    return group.name || group.label || group.code;
}

function normalizeGroups(groups) {
    if (!Array.isArray(groups) || groups.length === 0) {
        return TALLY_GROUP_HIERARCHY.flatMap((primary) => [
            { ...primary, isParent: true, indent: 0 },
            ...(primary.children || []).map((child) => ({ ...child, isParent: false, indent: 1 }))
        ]);
    }

    const byId = new Map(groups.map((group) => [group.id, group]));
    const top = groups
        .filter((group) => !group.parentGroupId)
        .sort((a, b) => toDisplayLabel(a).localeCompare(toDisplayLabel(b)));

    const flat = [];
    for (const parent of top) {
        flat.push({
            ...parent,
            label: toDisplayLabel(parent),
            isParent: true,
            indent: 0
        });

        const children = groups
            .filter((group) => group.parentGroupId && group.parentGroupId === parent.id)
            .sort((a, b) => toDisplayLabel(a).localeCompare(toDisplayLabel(b)));

        for (const child of children) {
            flat.push({
                ...child,
                label: toDisplayLabel(child),
                isParent: false,
                indent: 1
            });
        }
    }

    // Include any orphan groups without a known parent to avoid dropping valid server data.
    const knownCodes = new Set(flat.map((group) => group.code));
    for (const group of groups) {
        if (!knownCodes.has(group.code)) {
            const parentKnown = group.parentGroupId && byId.has(group.parentGroupId);
            flat.push({
                ...group,
                label: toDisplayLabel(group),
                isParent: !parentKnown,
                indent: parentKnown ? 1 : 0
            });
        }
    }

    return flat;
}

export function GroupSelector({ id, value, onChange, disabled = false, groups = [] }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [focusedIdx, setFocusedIdx] = useState(0);
    const listRef = useRef(null);
    const triggerRef = useRef(null);
    const queryTimeout = useRef(null);

    // Flatten groups for navigation, preferring server-sourced groups when provided.
    const flatGroups = normalizeGroups(groups);

    // Filter by query
    const filtered = query.trim()
        ? flatGroups.filter((g) => g.label.toLowerCase().includes(query.toLowerCase()))
        : flatGroups;

    // Find display label for current value
    const displayLabel = value
        ? (flatGroups.find((g) => g.code === value)?.label ?? value)
        : '— Select Group —';

    function openList() {
        if (disabled) return;
        setOpen(true);
        setFocusedIdx(0);
        setQuery('');
        requestAnimationFrame(() => listRef.current?.focus());
    }

    function close(focusTrigger = true) {
        setOpen(false);
        setQuery('');
        if (focusTrigger) triggerRef.current?.focus();
    }

    function select(group) {
        onChange(group.code, group.label, group.category);
        close(false); // Do not steal focus back, allow useEnterToAdvance to move it to the next field
    }

    function onKeyDown(e) {
        if (!open) {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault();
                openList();
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setFocusedIdx((i) => Math.min(i + 1, filtered.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setFocusedIdx((i) => Math.max(i - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (filtered[focusedIdx]) select(filtered[focusedIdx]);
                break;
            case 'Escape':
                e.preventDefault();
                close();
                break;
            default:
                // Typeahead: accumulate characters
                if (e.key.length === 1) {
                    clearTimeout(queryTimeout.current);
                    setQuery((q) => q + e.key);
                    setFocusedIdx(0);
                    queryTimeout.current = setTimeout(() => setQuery(''), 1000);
                }
        }
    }

    // Scroll focused item into view
    useEffect(() => {
        if (!open) return;
        const list = listRef.current;
        if (!list) return;
        const items = list.querySelectorAll('[data-group-item]');
        items[focusedIdx]?.scrollIntoView({ block: 'nearest' });
    }, [focusedIdx, open, filtered.length]);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        function onClickOutside(e) {
            if (!listRef.current?.closest('.group-selector-root')?.contains(e.target)) {
                close();
            }
        }
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [open]);

    return (
        <div className="group-selector-root relative">
            {/* Trigger button */}
            <button
                id={id}
                ref={triggerRef}
                type="button"
                disabled={disabled}
                className="focusable w-full border border-tally-panelBorder bg-white p-1 text-left text-sm flex items-center justify-between disabled:bg-gray-100"
                onClick={openList}
                onFocus={openList}
                onKeyDown={onKeyDown}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <span className={value ? '' : 'opacity-50'}>{displayLabel}</span>
                <span className="text-[10px] opacity-50 ml-2">▼</span>
            </button>

            {/* Dropdown */}
            {open && (
                <div
                    ref={listRef}
                    role="listbox"
                    tabIndex={-1}
                    className="absolute z-50 left-0 right-0 max-h-64 overflow-y-auto boxed shadow-panel mt-0.5 bg-white outline-none text-sm"
                    onKeyDown={onKeyDown}
                >
                    {/* Search hint */}
                    {query && (
                        <div className="px-2 py-1 text-[11px] bg-tally-tableHeader border-b border-tally-panelBorder">
                            Filter: <strong>{query}</strong>
                        </div>
                    )}

                    {filtered.map((group, idx) => (
                        <div
                            key={group.code}
                            data-group-item
                            role="option"
                            aria-selected={value === group.code}
                            onClick={() => select(group)}
                            className={[
                                'px-2 py-1 cursor-pointer flex items-center gap-1 select-none',
                                group.isParent ? 'bg-tally-tableHeader font-semibold text-xs uppercase tracking-wide' : '',
                                !group.isParent ? 'pl-5' : '',
                                idx === focusedIdx ? 'bg-tally-rowHover text-white' : 'hover:bg-tally-background',
                                value === group.code && idx !== focusedIdx ? 'bg-tally-background font-semibold' : ''
                            ].join(' ')}
                        >
                            {group.isParent && <span className="text-[10px] mr-1">▶</span>}
                            {group.label}
                        </div>
                    ))}

                    {filtered.length === 0 && (
                        <div className="px-2 py-2 text-xs opacity-60 text-center">No groups match "{query}"</div>
                    )}

                    <div className="px-2 py-1 text-[10px] bg-tally-tableHeader border-t border-tally-panelBorder opacity-70">
                        ↑↓ Navigate · Enter Select · Esc Cancel · Type to filter
                    </div>
                </div>
            )}
        </div>
    );
}
