import { useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { TallyShell } from './TallyShell';
import { ViewStateProvider } from '../providers/ViewStateProvider';
import { inputEngine } from '../core/InputEngine';

/**
 * App — Entry point.
 *
 * Router handles login ↔ authenticated boundary now.
 * All internal navigation uses ViewStateProvider (no router child routes).
 */
export function App() {
  // Install global keyboard listener once
  useEffect(() => {
    inputEngine.init();

    return () => {
      inputEngine.destroy();
    };
  }, []);

  return (
    <ViewStateProvider>
      <TallyShell />
    </ViewStateProvider>
  );
}
