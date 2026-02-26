import { useEffect, useMemo, useRef, useState } from 'react';
import { useFocusTrap, useRoamingTabIndex } from '../hooks/useFocusUtilities';

function normalize(text) {
  return String(text || '').trim().toLowerCase();
}

export function CommandPalette({ open, commands, onClose, onNavigate }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  const containerRef = useFocusTrap(open);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return commands;
    return commands.filter((command) => {
      const haystack = normalize(`${command.label} ${command.section} ${(command.keywords || []).join(' ')}`);
      return haystack.includes(q);
    });
  }, [commands, query]);

  const { activeIndex, setActiveIndex, onKeyDown: roamingKeyDown } = useRoamingTabIndex(filtered.length);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, setActiveIndex]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        roamingKeyDown(event);
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const active = filtered[activeIndex];
        if (active) {
          onNavigate(active.path);
        }
      }
    }

    // Attach to the document so it catches even if input is off focus within trap
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, filtered, onClose, onNavigate, open, roamingKeyDown]);

  if (!open) return null;

  return (
    <div ref={containerRef} className="command-overlay" role="dialog" aria-modal="true" aria-label="Go To Command Palette">
      <div className="boxed shadow-panel command-palette">
        <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">
          Go To (Cmd/Ctrl+K)
        </div>
        <div className="p-2 border-b border-tally-panelBorder">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search screens, vouchers, reports..."
            className="focusable w-full border border-tally-panelBorder bg-white p-2 text-sm"
          />
        </div>

        <div className="max-h-[360px] overflow-auto">
          {filtered.length === 0 ? (
            <p className="p-3 text-sm">No matching commands.</p>
          ) : (
            <ul className="text-sm">
              {filtered.map((command, index) => (
                <li key={command.id}>
                  <button
                    type="button"
                    tabIndex="-1"
                    className={`focusable command-item ${index === activeIndex ? 'bg-tally-rowHover command-item-active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => onNavigate(command.path)}
                  >
                    <span className="command-main">
                      <span>{command.label}</span>
                      <span className="text-xs opacity-80">{command.section}</span>
                    </span>
                    <span className="command-hotkey">Alt+{command.hotkey}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-3 py-2 border-t border-tally-panelBorder text-xs flex justify-between">
          <span>↑/↓ Navigate • Enter Open</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}
