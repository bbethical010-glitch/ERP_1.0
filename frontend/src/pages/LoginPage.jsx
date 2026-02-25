import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const nextPath = location.state?.from || '/gateway';

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await login({ username, password });
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-tally-background text-tally-text flex items-center justify-center p-4">
      <form className="boxed shadow-panel w-full max-w-md" onSubmit={onSubmit}>
        <div className="bg-tally-header text-white px-4 py-2 text-sm font-semibold">Accounting ERP Login</div>
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
            className="focusable bg-tally-header text-white border border-tally-panelBorder px-3 py-2 disabled:opacity-70"
          >
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </button>
          {error && <div className="text-tally-warning">{error}</div>}
          <div className="text-xs">Default: admin / admin123</div>
        </div>
      </form>
    </div>
  );
}
