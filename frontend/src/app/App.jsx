import { useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { LoginPage } from '../pages/LoginPage';
import { TallyShell } from './TallyShell';
import { ViewStateProvider } from '../providers/ViewStateProvider';
import { installGlobalKeyListener } from '../lib/KeyboardManager';

/**
 * App — Entry point.
 *
 * Router only handles login ↔ authenticated boundary.
 * All internal navigation uses ViewStateProvider (no router child routes).
 */

function AuthenticatedApp() {
  return (
    <ViewStateProvider>
      <TallyShell />
    </ViewStateProvider>
  );
}

function AuthGate() {
  const { isAuthenticated, isChecking } = useAuth();

  if (isChecking) {
    return <div className="tally-panel p-2 text-sm">Validating session...</div>;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <AuthenticatedApp />;
}

export function App() {
  // Install global keyboard listener once
  useEffect(() => {
    return installGlobalKeyListener();
  }, []);

  return <AuthGate />;
}
