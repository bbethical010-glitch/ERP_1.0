import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

/**
 * LoginPage — Tally-style sign-in / sign-up.
 * No React Router dependency. Auth state change triggers AuthGate re-render.
 * Tab to move · Enter to submit · Esc to toggle mode
 */
export function LoginPage() {
  const { login } = useAuth();

  const [mode, setMode] = useState('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [registerForm, setRegisterForm] = useState({
    companyName: '',
    username: '',
    displayName: '',
    password: ''
  });
  const [registerError, setRegisterError] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  async function onSignIn(event) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await login({ username, password });
      // AuthGate will automatically switch to AuthenticatedApp
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  function onRegisterChange(field, value) {
    setRegisterForm((prev) => ({ ...prev, [field]: value }));
  }

  async function onSignUp(event) {
    event.preventDefault();
    setRegisterError('');
    setIsRegistering(true);
    try {
      const result = await api.post(
        '/auth/signup',
        {
          companyName: registerForm.companyName,
          username: registerForm.username,
          displayName: registerForm.displayName,
          password: registerForm.password
        },
        { skipAuth: true }
      );
      localStorage.setItem('erp_auth_token', result.token);
      localStorage.setItem('erp_auth_user', JSON.stringify(result.user));
      await login({ username: registerForm.username, password: registerForm.password });
      // AuthGate will automatically switch to AuthenticatedApp
    } catch (err) {
      setRegisterError(err.message || 'Sign up failed');
    } finally {
      setIsRegistering(false);
    }
  }

  function onTabKeyDown(e) {
    if (e.key === 'Escape') {
      setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
    }
  }

  return (
    <div
      className="min-h-screen bg-tally-background text-tally-text flex items-center justify-center p-4"
      onKeyDown={onTabKeyDown}
    >
      <div className="tally-panel w-full max-w-2xl">
        {/* App header */}
        <div className="tally-panel-header">
          <div className="text-base font-semibold">Tally-style Accounting ERP</div>
          <div className="text-xs opacity-75 mt-0.5">Keyboard-driven accounting for India & beyond</div>
        </div>

        {/* Mode tabs */}
        <div className="p-2 border-b border-tally-panelBorder flex gap-2 text-sm">
          <button
            type="button"
            className={`focusable border px-3 py-1 ${mode === 'signin' ? 'bg-tally-header text-white border-tally-panelBorder' : 'tally-btn'}`}
            onClick={() => setMode('signin')}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`focusable border px-3 py-1 ${mode === 'signup' ? 'bg-tally-header text-white border-tally-panelBorder' : 'tally-btn'}`}
            onClick={() => setMode('signup')}
          >
            Sign Up (Create Company)
          </button>
          <span className="ml-auto text-[11px] opacity-60 self-center">Esc to toggle · Tab to move · Enter to submit</span>
        </div>

        {mode === 'signin' ? (
          <form className="p-3 grid gap-2 text-sm" onSubmit={onSignIn}>
            <label className="tally-field">
              <span className="tally-field-label">Username</span>
              <input
                autoFocus
                className="tally-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </label>
            <label className="tally-field">
              <span className="tally-field-label">Password</span>
              <input
                type="password"
                className="tally-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              disabled={isSubmitting}
              className="focusable bg-tally-header text-white border border-tally-panelBorder px-3 py-1 disabled:opacity-60"
            >
              {isSubmitting ? 'Signing In...' : 'Sign In (Enter)'}
            </button>
            {error && <div className="text-tally-warning text-xs">{error}</div>}
          </form>
        ) : (
          <form className="p-3 grid gap-2 text-sm" onSubmit={onSignUp}>
            <label className="tally-field">
              <span className="tally-field-label">Company Name</span>
              <input
                autoFocus
                className="tally-input"
                value={registerForm.companyName}
                onChange={(e) => onRegisterChange('companyName', e.target.value)}
                required
              />
            </label>
            <label className="tally-field">
              <span className="tally-field-label">Username</span>
              <input
                className="tally-input"
                value={registerForm.username}
                onChange={(e) => onRegisterChange('username', e.target.value)}
                required
              />
            </label>
            <label className="tally-field">
              <span className="tally-field-label">Display Name</span>
              <input
                className="tally-input"
                value={registerForm.displayName}
                onChange={(e) => onRegisterChange('displayName', e.target.value)}
                required
              />
            </label>
            <label className="tally-field">
              <span className="tally-field-label">Password</span>
              <input
                type="password"
                className="tally-input"
                value={registerForm.password}
                onChange={(e) => onRegisterChange('password', e.target.value)}
                required
                minLength={6}
              />
            </label>
            <button
              type="submit"
              disabled={isRegistering}
              className="focusable bg-tally-header text-white border border-tally-panelBorder px-3 py-1 disabled:opacity-60"
            >
              {isRegistering ? 'Creating Company...' : 'Create Company (Enter)'}
            </button>
            {registerError && <div className="text-tally-warning text-xs">{registerError}</div>}
          </form>
        )}
        <div className="tally-status-bar">
          Tab to move between fields · Enter to submit · Esc to toggle Sign In / Sign Up
        </div>
      </div>
    </div>
  );
}
