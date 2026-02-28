import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { focusGraph } from '../core/FocusGraph';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { commandBus, COMMANDS } from '../core/CommandBus';

/**
 * LoginPage — Tally-style sign-in / sign-up.
 * No React Router dependency. Auth state change triggers AuthGate re-render.
 * Tab to move · Enter to submit · Esc to toggle mode
 */
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

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
      navigate('/', { replace: true });
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
      navigate('/', { replace: true });
    } catch (err) {
      setRegisterError(err.message || 'Sign up failed');
    } finally {
      setIsRegistering(false);
    }
  }

  useEffect(() => {
    const unsub = commandBus.subscribe(COMMANDS.VIEW_POP, () => {
      setMode((prev) => (prev === 'signin' ? 'signup' : 'signin'));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!focusGraph.isEnabled) return;

    focusGraph.init('login-page');

    if (mode === 'signin') {
      focusGraph.registerNode('btnSignin', { next: 'btnSignup', prev: 'loginBtn' });
      focusGraph.registerNode('btnSignup', { next: 'loginUser', prev: 'btnSignin' });

      focusGraph.registerNode('loginUser', { next: 'loginPass', prev: 'btnSignup' });
      focusGraph.registerNode('loginPass', { next: 'loginBtn', prev: 'loginUser' });
      focusGraph.registerNode('loginBtn', {
        next: 'btnSignin',
        prev: 'loginPass'
      });

      // Initially focus first input
      setTimeout(() => focusGraph.setCurrentNode('loginUser'), 50);
    } else {
      focusGraph.registerNode('btnSignin', { next: 'btnSignup', prev: 'regBtn' });
      focusGraph.registerNode('btnSignup', { next: 'regCompany', prev: 'btnSignin' });

      focusGraph.registerNode('regCompany', { next: 'regUser', prev: 'btnSignup' });
      focusGraph.registerNode('regUser', { next: 'regName', prev: 'regCompany' });
      focusGraph.registerNode('regName', { next: 'regPass', prev: 'regUser' });
      focusGraph.registerNode('regPass', { next: 'regBtn', prev: 'regName' });
      focusGraph.registerNode('regBtn', {
        next: 'btnSignin',
        prev: 'regPass'
      });

      setTimeout(() => focusGraph.setCurrentNode('regCompany'), 50);
    }

    return () => focusGraph.destroy();
  }, [mode]);

  return (
    <div className="min-h-screen bg-tally-background text-tally-text flex items-center justify-center p-4">
      <div className="tally-panel w-full max-w-2xl">
        {/* App header */}
        <div className="tally-panel-header">
          <div className="text-base font-semibold">Tally-style Accounting ERP</div>
          <div className="text-xs opacity-75 mt-0.5">Keyboard-driven accounting for India & beyond</div>
        </div>

        {/* Mode tabs */}
        <div className="p-2 border-b border-tally-panelBorder flex gap-2 text-sm">
          <button
            id="btnSignin"
            type="button"
            className={`focusable border px-3 py-1 ${mode === 'signin' ? 'bg-tally-header text-white border-tally-panelBorder' : 'tally-btn'}`}
            onClick={() => setMode('signin')}
          >
            Sign In
          </button>
          <button
            id="btnSignup"
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
                id="loginUser"
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
                id="loginPass"
                type="password"
                className="tally-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button
              id="loginBtn"
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
                id="regCompany"
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
                id="regUser"
                className="tally-input"
                value={registerForm.username}
                onChange={(e) => onRegisterChange('username', e.target.value)}
                required
              />
            </label>
            <label className="tally-field">
              <span className="tally-field-label">Display Name</span>
              <input
                id="regName"
                className="tally-input"
                value={registerForm.displayName}
                onChange={(e) => onRegisterChange('displayName', e.target.value)}
                required
              />
            </label>
            <label className="tally-field">
              <span className="tally-field-label">Password</span>
              <input
                id="regPass"
                type="password"
                className="tally-input"
                value={registerForm.password}
                onChange={(e) => onRegisterChange('password', e.target.value)}
                required
                minLength={6}
              />
            </label>
            <button
              id="regBtn"
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
