import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const menuItems = [
  { label: 'Voucher Register', hotkey: 'V', path: '/vouchers' },
  { label: 'Create Voucher', hotkey: 'C', path: '/vouchers/new' },
  { label: 'Ledger Display', hotkey: 'L', path: '/ledger' },
  { label: 'Daybook', hotkey: 'D', path: '/daybook' },
  { label: 'Trial Balance', hotkey: 'T', path: '/reports/trial-balance' },
  { label: 'Profit & Loss', hotkey: 'P', path: '/reports/profit-loss' },
  { label: 'Balance Sheet', hotkey: 'B', path: '/reports/balance-sheet' }
];

function renderLabel(label, hotkey) {
  const idx = label.toUpperCase().indexOf(hotkey);
  if (idx === -1) return label;
  return (
    <>
      {label.slice(0, idx)}
      <span className="hotkey">{label[idx]}</span>
      {label.slice(idx + 1)}
    </>
  );
}

export function GatewayMenu() {
  const navigate = useNavigate();
  const [activeIndex, setActiveIndex] = useState(0);

  const hotkeyMap = useMemo(
    () => Object.fromEntries(menuItems.map((item) => [item.hotkey, item.path])),
    []
  );

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % menuItems.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + menuItems.length) % menuItems.length);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      navigate(menuItems[activeIndex].path);
      return;
    }

    const key = event.key.toUpperCase();
    if (hotkeyMap[key]) {
      event.preventDefault();
      navigate(hotkeyMap[key]);
    }
  }

  return (
    <section className="boxed shadow-panel max-w-3xl focusable" tabIndex={0} autoFocus onKeyDown={onKeyDown}>
      <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Gateway of Tally</div>
      <div className="grid md:grid-cols-[2fr_1fr]">
        <ul className="m-0 p-0 list-none">
          {menuItems.map((item, idx) => (
            <li key={item.path}>
              <button
                type="button"
                className={`focusable w-full text-left px-3 py-2 border-b border-tally-panelBorder ${
                  idx === activeIndex ? 'bg-tally-tableHeader font-semibold' : ''
                }`}
                onFocus={() => setActiveIndex(idx)}
                onClick={() => navigate(item.path)}
              >
                {renderLabel(item.label, item.hotkey)}
              </button>
            </li>
          ))}
        </ul>
        <aside className="border-l border-tally-panelBorder p-3 text-xs">
          <p className="font-semibold">Shortcuts</p>
          <p>Alt+C: Create Voucher</p>
          <p>Esc: Back to Gateway</p>
          <p>Enter: Open Selected</p>
        </aside>
      </div>
    </section>
  );
}
