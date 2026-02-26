import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getRouteLabel } from '../lib/navigation';

export function TopBar({ onOpenGoTo }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const canManageUsers = user?.role === 'OWNER';
  const routeLabel = getRouteLabel(location.pathname);

  function onLogout() {
    logout();
    navigate('/login');
  }

  return (
    <header className="bg-tally-header text-white border-b border-tally-panelBorder px-3 py-2 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-sm md:text-base font-semibold tracking-wide truncate">Gateway of Tally - Accounting ERP</h1>
        <p className="text-[11px] md:text-xs opacity-90 truncate">Gateway &gt; {routeLabel}</p>
      </div>
      <div className="flex items-center gap-3 text-[11px] md:text-xs">
        <span>⌘/Ctrl+K Go To | ⌥C Create | ⌥M Masters | ⌥T Txns | Esc Back | ⌘/Ctrl+S Save</span>
        <span>{user?.displayName || user?.username}</span>
        <button
          type="button"
          className="focusable border border-white/40 px-2 py-1"
          onClick={onOpenGoTo}
        >
          Go To
        </button>
        <button
          type="button"
          className="focusable border border-white/40 px-2 py-1"
          onClick={() => navigate('/change-password')}
        >
          Password
        </button>
        {canManageUsers && (
          <button
            type="button"
            className="focusable border border-white/40 px-2 py-1"
            onClick={() => navigate('/users')}
          >
            Users
          </button>
        )}
        <button type="button" className="focusable border border-white/40 px-2 py-1" onClick={onLogout}>
          Logout
        </button>
      </div>
    </header>
  );
}
