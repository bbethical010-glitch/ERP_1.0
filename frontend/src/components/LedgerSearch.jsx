import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useRoamingTabIndex } from '../hooks/useFocusUtilities';

export function LedgerSearch({ value, onChange, onBlur, autoFocus, businessId }) {
    const [query, setQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const inputRef = useRef(null);
    const dropdownRef = useRef(null);

    // Debounced query for API
    const [debouncedQuery, setDebouncedQuery] = useState('');

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(query);
        }, 150);
        return () => clearTimeout(timer);
    }, [query]);

    const { data: ledgers = [], isLoading } = useQuery({
        queryKey: ['ledgers', businessId, debouncedQuery],
        queryFn: () => api.get(`/ledgers?businessId=${businessId}&search=${debouncedQuery}&limit=20`),
        enabled: Boolean(businessId) && isOpen,
    });

    const { activeIndex, setActiveIndex, onKeyDown: roamingKeyDown } = useRoamingTabIndex(ledgers.length, -1);

    // Focus input on mount if autoFocus is true
    useEffect(() => {
        if (autoFocus && inputRef.current) {
            inputRef.current.focus();
        }
    }, [autoFocus]);

    // Keep active descendant in view
    useEffect(() => {
        if (activeIndex >= 0 && dropdownRef.current) {
            const items = dropdownRef.current.querySelectorAll('[role="option"]');
            if (items[activeIndex]) {
                items[activeIndex].scrollIntoView({ block: 'nearest' });
            }
        }
    }, [activeIndex]);


    const handleKeyDown = (e) => {
        // Open dropdown on any typing if it's closed
        if (!isOpen && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            setIsOpen(true);
        }

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!isOpen) {
                setIsOpen(true);
                e.preventDefault();
                return;
            }
            roamingKeyDown(e);
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            setIsOpen(false);
            setQuery('');
            setActiveIndex(-1);
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault(); // Prevent form submission
            if (isOpen && activeIndex >= 0 && ledgers[activeIndex]) {
                handleSelect(ledgers[activeIndex]);
            }
        }
    };

    const handleSelect = (ledger) => {
        onChange?.(ledger);
        setQuery('');
        setIsOpen(false);
        setActiveIndex(-1);
    };

    const activeDescendantId = isOpen && activeIndex >= 0 ? `ledger-option-${activeIndex}` : undefined;

    // Selected state display vs search state
    const displayValue = isOpen ? query : (value?.name || '');

    return (
        <div className="relative w-full">
            <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded={isOpen}
                aria-controls="ledger-listbox"
                aria-activedescendant={activeDescendantId}
                value={displayValue}
                onChange={(e) => {
                    setQuery(e.target.value);
                    if (!isOpen) setIsOpen(true);
                }}
                onFocus={() => setIsOpen(true)}
                onBlur={(e) => {
                    // Delay closing so click events on dropdown can fire
                    setTimeout(() => {
                        setIsOpen(false);
                        onBlur?.(e);
                    }, 100);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Select Ledger..."
                className="focusable w-full border border-tally-panelBorder bg-white px-2 py-1 text-sm outline-none focus:border-tally-primary focus:ring-1 focus:ring-tally-primary"
            />

            {isOpen && (
                <ul
                    id="ledger-listbox"
                    ref={dropdownRef}
                    role="listbox"
                    className="absolute z-50 mt-1 max-h-60 w-full overflow-auto border border-tally-panelBorder bg-white shadow-lg text-sm"
                >
                    {isLoading && <li className="px-2 py-1 text-gray-500">Loading...</li>}
                    {!isLoading && ledgers.length === 0 && (
                        <li className="px-2 py-1 text-gray-500">No ledgers found.</li>
                    )}
                    {!isLoading && ledgers.map((ledger, index) => {
                        const isSelected = index === activeIndex;
                        return (
                            <li
                                key={ledger.id}
                                id={`ledger-option-${index}`}
                                role="option"
                                aria-selected={isSelected}
                                className={`cursor-pointer px-2 py-1 ${isSelected ? 'bg-tally-rowHover text-white' : 'hover:bg-tally-background text-black'
                                    }`}
                                onMouseDown={() => handleSelect(ledger)}
                                onMouseEnter={() => setActiveIndex(index)}
                            >
                                <div className="flex justify-between items-center">
                                    <span>{ledger.name}</span>
                                    <span className="text-[10px] opacity-70 ml-2">{ledger.groupName}</span>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
