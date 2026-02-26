import { useEffect, useMemo, useRef, useState } from 'react';

function normalize(text) {
  return String(text || '').trim().toLowerCase();
}

export function CommandPalette({ open, commands, onClose, onNavigate }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return commands;
    return commands.filter((command) => {
      const haystack = normalize(`${command.label} ${command.section} ${(command.keywords || []).join(' ')}`);
      return haystack.includes(q);
    });
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((idx) => Math.min(idx + 1, Math.max(filtered.length - 1, 0)));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((idx) => Math.max(idx - 1, 0));
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

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, filtered, onClose, onNavigate, open]);

  if (!open) return null;

  return (
    <div className="command-overlay" role="dialog" aria-modal="true" aria-label="Go To Command Palette">
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
                    className={`focusable command-item ${index === activeIndex ? 'command-item-active' : ''}`}
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
