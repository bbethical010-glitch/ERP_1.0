export function TopBar() {
  return (
    <header className="bg-tally-header text-white border-b border-tally-panelBorder px-4 py-2 flex items-center justify-between">
      <h1 className="text-sm md:text-base font-semibold tracking-wide">Gateway of Tally - Accounting ERP</h1>
      <div className="text-xs md:text-sm">Alt+C Create | Esc Back | Enter Save</div>
    </header>
  );
}
