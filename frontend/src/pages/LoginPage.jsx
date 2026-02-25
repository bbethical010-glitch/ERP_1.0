import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { USER_ROLES } from '../lib/constants';

const REGISTERABLE_ROLES = USER_ROLES.filter((role) => role !== 'OWNER');

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [activeMode, setActiveMode] = useState('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    ownerUsername: '',
    ownerPassword: '',
    username: '',
    displayName: '',
    password: '',
    role: 'ACCOUNTANT'
  });
  const [registerError, setRegisterError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  const targetPath = location.state?.from || '/gateway';

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await login({ username, password });
      navigate(targetPath, { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  function onRegisterChange(field, value) {
    setRegisterForm((prev) => ({ ...prev, [field]: value }));
  }

  async function onRegister(event) {
    event.preventDefault();
    setRegisterError('');
    setRegisterSuccess('');
    setIsRegistering(true);

    try {
      await api.post(
        '/auth/register',
        {
          ownerUsername: registerForm.ownerUsername,
          ownerPassword: registerForm.ownerPassword,
          username: registerForm.username,
          displayName: registerForm.displayName,
          password: registerForm.password,
          role: registerForm.role
        },
        { skipAuth: true }
      );
      setRegisterSuccess('User created. You can now sign in.');
      setRegisterForm((prev) => ({
        ...prev,
        ownerPassword: '',
        username: '',
        displayName: '',
        password: ''
      }));
    } catch (err) {
      setRegisterError(err.message || 'User creation failed');
    } finally {
      setIsRegistering(false);
    }
  }

  return (
    <div className="min-h-screen bg-tally-background text-tally-text flex items-center justify-center p-4">
      <div className="w-full max-w-2xl boxed shadow-panel">
        <div className="bg-tally-header text-white px-4 py-2 text-sm font-semibold">Accounting ERP Access</div>
        <div className="p-3 border-b border-tally-panelBorder flex gap-2 text-sm">
          <button
            type="button"
            className={`focusable border px-3 py-1 ${activeMode === 'signin' ? 'bg-tally-header text-white border-tally-panelBorder' : 'bg-white border-tally-panelBorder'}`}
            onClick={() => setActiveMode('signin')}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`focusable border px-3 py-1 ${activeMode === 'signup' ? 'bg-tally-header text-white border-tally-panelBorder' : 'bg-white border-tally-panelBorder'}`}
            onClick={() => setActiveMode('signup')}
          >
            Sign Up
          </button>
        </div>

        {activeMode === 'signin' ? (
          <form className="w-full" onSubmit={onSubmit}>
            <div className="p-4 grid gap-3 text-sm">
              <label className="flex flex-col gap-1">
                Username
                <input
                  autoFocus
                  className="focusable border border-tally-panelBorder bg-white p-2"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                Password
                <input
                  type="password"
                  className="focusable border border-tally-panelBorder bg-white p-2"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={isSubmitting}
                className="focusable bg-tally-header text-white border border-tally-panelBorder px-3 py-2 disabled:opacity-60"
              >
                {isSubmitting ? 'Signing In...' : 'Sign In'}
              </button>
              {error && <div className="text-tally-warning">{error}</div>}
            </div>
          </form>
        ) : (
          <form className="w-full" onSubmit={onRegister}>
            <div className="p-4 grid gap-3 text-sm">
              <label className="flex flex-col gap-1">
                Owner Username
                <input
                  className="focusable border border-tally-panelBorder bg-white p-2"
                  value={registerForm.ownerUsername}
                  onChange={(e) => onRegisterChange('ownerUsername', e.target.value)}
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                Owner Password
                <input
                  type="password"
                  className="focusable border border-tally-panelBorder bg-white p-2"
                  value={registerForm.ownerPassword}
                  onChange={(e) => onRegisterChange('ownerPassword', e.target.value)}
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                New Username
                <input
                  className="focusable border border-tally-panelBorder bg-white p-2"
                  value={registerForm.username}
                  onChange={(e) => onRegisterChange('username', e.target.value)}
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                Display Name
                <input
                  className="focusable border border-tally-panelBorder bg-white p-2"
                  value={registerForm.displayName}
                  onChange={(e) => onRegisterChange('displayName', e.target.value)}
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                New User Password
                <input
                  type="password"
                  className="focusable border border-tally-panelBorder bg-white p-2"
                  value={registerForm.password}
                  onChange={(e) => onRegisterChange('password', e.target.value)}
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                Role
                <select
                  className="focusable border border-tally-panelBorder bg-white p-2"
                  value={registerForm.role}
                  onChange={(e) => onRegisterChange('role', e.target.value)}
                >
                  {REGISTERABLE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={isRegistering}
                className="focusable bg-tally-header text-white border border-tally-panelBorder px-3 py-2 disabled:opacity-60"
              >
                {isRegistering ? 'Creating User...' : 'Create User'}
              </button>
              {registerError && <div className="text-tally-warning">{registerError}</div>}
              {registerSuccess && <div className="text-emerald-700">{registerSuccess}</div>}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
