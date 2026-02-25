import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
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
  const [registerSuccess, setRegisterSuccess] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  const targetPath = location.state?.from || '/gateway';

  async function onSignIn(event) {
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

  async function onSignUp(event) {
    event.preventDefault();
    setRegisterError('');
    setRegisterSuccess('');
    setIsRegistering(true);

    try {
      await api.post(
        '/auth/signup',
        {
          companyName: registerForm.companyName,
          username: registerForm.username,
          displayName: registerForm.displayName,
          password: registerForm.password
        },
        { skipAuth: true }
      );
      setRegisterSuccess('User created successfully. You can sign in now.');
      setRegisterForm((prev) => ({
        ...prev,
        companyName: '',
        username: '',
        displayName: '',
        password: ''
      }));
      setMode('signin');
    } catch (err) {
      setRegisterError(err.message || 'Sign up failed');
    } finally {
      setIsRegistering(false);
    }
  }

  return (
    <div className="min-h-screen bg-tally-background text-tally-text flex items-center justify-center p-4">
      <div className="boxed shadow-panel w-full max-w-2xl">
        <div className="bg-tally-header text-white px-4 py-2 text-sm font-semibold">Accounting ERP Access</div>
        <div className="p-3 border-b border-tally-panelBorder flex gap-2 text-sm">
          <button
            type="button"
            className={`focusable border px-3 py-1 ${mode === 'signin' ? 'bg-tally-header text-white border-tally-panelBorder' : 'bg-white border-tally-panelBorder'}`}
            onClick={() => setMode('signin')}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`focusable border px-3 py-1 ${mode === 'signup' ? 'bg-tally-header text-white border-tally-panelBorder' : 'bg-white border-tally-panelBorder'}`}
            onClick={() => setMode('signup')}
          >
            Sign Up
          </button>
        </div>

        {mode === 'signin' ? (
          <form className="p-4 grid gap-3 text-sm" onSubmit={onSignIn}>
            <label className="flex flex-col gap-1">
              Username
              <input
                autoFocus
                className="focusable border border-tally-panelBorder bg-white p-2"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1">
              Password
              <input
                type="password"
                className="focusable border border-tally-panelBorder bg-white p-2"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
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
            {registerSuccess && <div className="text-emerald-700">{registerSuccess}</div>}
          </form>
        ) : (
          <form className="p-4 grid gap-3 text-sm" onSubmit={onSignUp}>
            <label className="flex flex-col gap-1">
              Company Name
              <input
                className="focusable border border-tally-panelBorder bg-white p-2"
                value={registerForm.companyName}
                onChange={(e) => onRegisterChange('companyName', e.target.value)}
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
              New Password
              <input
                type="password"
                className="focusable border border-tally-panelBorder bg-white p-2"
                value={registerForm.password}
                onChange={(e) => onRegisterChange('password', e.target.value)}
                required
                minLength={6}
              />
            </label>
            <button
              type="submit"
              disabled={isRegistering}
              className="focusable bg-tally-header text-white border border-tally-panelBorder px-3 py-2 disabled:opacity-60"
            >
              {isRegistering ? 'Creating User...' : 'Sign Up'}
            </button>
            {registerError && <div className="text-tally-warning">{registerError}</div>}
          </form>
        )}
      </div>
    </div>
  );
}
