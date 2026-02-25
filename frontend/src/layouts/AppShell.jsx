import { Outlet, useNavigate } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts';

export function AppShell() {
  const navigate = useNavigate();

  useGlobalShortcuts({
    onCreate: () => navigate('/vouchers/new'),
    onBack: () => navigate('/gateway'),
    onUsers: () => navigate('/users'),
    onPassword: () => navigate('/change-password')
  });

  return (
    <div className="min-h-screen bg-tally-background text-tally-text">
      <TopBar />
      <main className="p-3 md:p-4">
        <Outlet />
      </main>
    </div>
  );
}
