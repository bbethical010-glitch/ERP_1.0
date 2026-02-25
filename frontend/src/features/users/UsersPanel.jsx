import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { USER_ROLES } from '../../lib/constants';
import { useAuth } from '../../auth/AuthContext';

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN');
}

export function UsersPanel() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const businessId = user?.businessId;
  const canManageUsers = user?.role === 'OWNER';

  const [form, setForm] = useState({
    username: '',
    displayName: '',
    password: '',
    role: 'ACCOUNTANT'
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const usersQuery = useQuery({
    enabled: canManageUsers && Boolean(businessId),
    queryKey: ['auth-users', businessId],
    queryFn: () => api.get('/auth/users')
  });

  const users = useMemo(() => usersQuery.data?.items || [], [usersQuery.data]);

  const createUserMutation = useMutation({
    mutationFn: (payload) => api.post('/auth/users', payload),
    onSuccess: () => {
      setSuccess('User created successfully.');
      setError('');
      setForm({
        username: '',
        displayName: '',
        password: '',
        role: 'ACCOUNTANT'
      });
      queryClient.invalidateQueries({ queryKey: ['auth-users', businessId] });
    },
    onError: (mutationError) => {
      setSuccess('');
      setError(mutationError.message || 'Failed to create user');
    }
  });

  function onChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function onSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    createUserMutation.mutate({
      username: form.username,
      displayName: form.displayName,
      password: form.password,
      role: form.role
    });
  }

  if (!canManageUsers) {
    return (
      <div className="boxed shadow-panel p-4 text-sm">
        Only owner users can access user management.
      </div>
    );
  }

  if (usersQuery.isError) {
    return (
      <div className="boxed shadow-panel p-4 text-sm text-tally-warning">
        Failed to load users: {usersQuery.error?.message || 'Unknown error'}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <section className="boxed shadow-panel">
        <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Create User</div>
        <form className="p-3 grid gap-2 md:grid-cols-2 text-sm" onSubmit={onSubmit}>
          <label className="grid gap-1">
            Username
            <input
              className="focusable border border-tally-panelBorder bg-white p-2"
              value={form.username}
              onChange={(event) => onChange('username', event.target.value)}
              placeholder="jane"
              required
            />
          </label>
          <label className="grid gap-1">
            Display Name
            <input
              className="focusable border border-tally-panelBorder bg-white p-2"
              value={form.displayName}
              onChange={(event) => onChange('displayName', event.target.value)}
              placeholder="Jane Doe"
              required
            />
          </label>
          <label className="grid gap-1">
            Password
            <input
              type="password"
              className="focusable border border-tally-panelBorder bg-white p-2"
              value={form.password}
              onChange={(event) => onChange('password', event.target.value)}
              placeholder="Minimum 6 characters"
              required
            />
          </label>
          <label className="grid gap-1">
            Role
            <select
              className="focusable border border-tally-panelBorder bg-white p-2"
              value={form.role}
              onChange={(event) => onChange('role', event.target.value)}
            >
              {USER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>

          <div className="md:col-span-2 flex items-center gap-2">
            <button
              type="submit"
              className="focusable bg-tally-header text-white border border-tally-panelBorder px-3 py-2 disabled:opacity-50"
              disabled={createUserMutation.isPending}
            >
              {createUserMutation.isPending ? 'Creating...' : 'Create User'}
            </button>
            {error && <span className="text-tally-warning">{error}</span>}
            {success && <span className="text-emerald-700">{success}</span>}
          </div>
        </form>
      </section>

      <section className="boxed shadow-panel">
        <div className="bg-tally-header text-white px-3 py-2 text-sm font-semibold">Existing Users</div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full table-grid text-sm">
            <thead className="bg-tally-tableHeader sticky top-0 z-10">
              <tr>
                <th className="text-left">Username</th>
                <th className="text-left">Display Name</th>
                <th className="text-left">Role</th>
                <th className="text-left">Status</th>
                <th className="text-left">Last Login</th>
                <th className="text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((row) => (
                <tr key={row.id} className="hover:bg-tally-background">
                  <td>{row.username}</td>
                  <td>{row.displayName}</td>
                  <td>{row.role}</td>
                  <td>{row.isActive ? 'Active' : 'Inactive'}</td>
                  <td>{formatDateTime(row.lastLoginAt)}</td>
                  <td>{formatDateTime(row.createdAt)}</td>
                </tr>
              ))}
              {!usersQuery.isLoading && users.length === 0 && (
                <tr>
                  <td className="text-center py-3" colSpan={6}>
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
