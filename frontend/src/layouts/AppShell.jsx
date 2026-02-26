import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts';
import { CommandPalette } from '../components/CommandPalette';
import { getCommandCatalog } from '../lib/navigation';
import { useAuth } from '../auth/AuthContext';

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const canManageUsers = user?.role === 'OWNER';
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const mainRef = useRef(null);

  const commands = useMemo(() => {
    const catalog = getCommandCatalog(canManageUsers);
    return [
      ...catalog,
      {
        id: 'logout',
        label: 'Logout',
        path: '/login',
        section: 'Session',
        hotkey: 'Q',
        keywords: ['sign out', 'exit']
      }
    ];
  }, [canManageUsers]);

  function navigateFromPalette(path) {
    setIsPaletteOpen(false);
    if (path === '/login') {
      logout();
      navigate('/login');
      return;
    }
    navigate(path);
  }

  useGlobalShortcuts({
    disabled: isPaletteOpen,
    onCreate: () => navigate('/vouchers/new'),
    onBack: () => navigate('/gateway'),
    onGateway: () => navigate('/gateway'),
    onMasters: () => navigate('/ledger'),
    onTransactions: () => navigate('/vouchers'),
    onUsers: canManageUsers ? () => navigate('/users') : undefined,
    onPassword: () => navigate('/change-password'),
    onGoTo: () => setIsPaletteOpen(true)
  });

  useEffect(() => {
    if (isPaletteOpen) return;
    requestAnimationFrame(() => mainRef.current?.focus());
  }, [location.pathname, isPaletteOpen]);

  return (
    <div className="min-h-screen bg-tally-background text-tally-text">
      <TopBar onOpenGoTo={() => setIsPaletteOpen(true)} />
      <main ref={mainRef} tabIndex={-1} className="p-2 md:p-3 focus:outline-none">
        <Outlet />
      </main>
      <CommandPalette
        open={isPaletteOpen}
        commands={commands}
        onClose={() => setIsPaletteOpen(false)}
        onNavigate={navigateFromPalette}
      />
    </div>
  );
}
