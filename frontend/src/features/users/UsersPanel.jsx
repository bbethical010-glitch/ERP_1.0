import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../lib/api';
import { useViewState, SCREENS } from '../../providers/ViewStateProvider';
import { commandBus, COMMANDS } from '../../core/CommandBus';
import { listEngine } from '../../core/ListEngine';
import { useEffect, useState } from 'react';

/**
 * UsersPanel — list + create users. Arrow nav, Enter to view.
 */
export function UsersPanel() {
  const { user } = useAuth();
  const { popScreen } = useViewState();
  const businessId = user?.businessId;
  const queryClient = useQueryClient();

  const [activeIndex, setActiveIndex] = useState(0);

  const { data: users = [] } = useQuery({
    queryKey: ['users', businessId],
    enabled: Boolean(businessId),
    queryFn: () => api.get('/auth/users'),
  });

  useEffect(() => {
    const listMap = users.map((u, idx) => ({
      id: `users-item-${idx}`,
      onSelect: () => {
        // No specific action on user select for now
      }
    }));

    listEngine.init(SCREENS.USERS);
    listEngine.registerItems(listMap);
    listEngine.setCurrentIndex(activeIndex);

    const originalFocus = listEngine._focusCurrent.bind(listEngine);
    listEngine._focusCurrent = () => {
      originalFocus();
      setActiveIndex(listEngine.currentIndex);
    };

    return () => listEngine.destroy();
  }, [users]);

  function handleKeyDown(e) {
    if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      commandBus.dispatch(COMMANDS.VIEW_PUSH, { screen: SCREENS.USER_CREATE });
    }
  }

  return (
    <section className="tally-panel" onKeyDown={handleKeyDown}>
      <div className="tally-panel-header">Users</div>
      <div>
        <table className="w-full table-grid text-sm">
          <thead className="tally-table-header">
            <tr><th>Username</th><th>Display Name</th><th>Role</th></tr>
          </thead>
          <tbody>
            {users.map((u, idx) => (
              <tr
                key={u.id}
                id={`users-item-${idx}`}
                className={idx === activeIndex ? 'tally-row-active' : ''}
              >
                <td>{u.username}</td>
                <td>{u.displayName}</td>
                <td>{u.role}</td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={3} className="text-center py-2 opacity-60">No users found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="tally-status-bar flex justify-between">
        <span>↑↓ Navigate · Esc Back</span>
        <span><kbd>C</kbd> Create User</span>
      </div>
    </section>
  );
}
