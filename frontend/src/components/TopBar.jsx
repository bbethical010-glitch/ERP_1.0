import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function TopBar() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const canManageUsers = user?.role === 'OWNER';

  function onLogout() {
    logout();
    navigate('/login');
  }

  return (
    <header className="bg-tally-header text-white border-b border-tally-panelBorder px-4 py-2 flex items-center justify-between">
      <h1 className="text-sm md:text-base font-semibold tracking-wide">Gateway of Tally - Accounting ERP</h1>
      <div className="flex items-center gap-4 text-xs md:text-sm">
        <span>⌥C Create | ⌥U Users | Esc Back | Return Save | ⌥R Reverse</span>
        <span>{user?.displayName || user?.username}</span>
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
