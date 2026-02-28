import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { api } from '../lib/api';

export function RequireAuth({ children, requireInit = true }) {
  const { isAuthenticated, isChecking, user } = useAuth();
  const location = useLocation();
  const [isInitialized, setIsInitialized] = useState(null);
  const [isCheckingInit, setIsCheckingInit] = useState(false);

  useEffect(() => {
    let active = true;

    if (isAuthenticated && requireInit && user?.businessId) {
      setIsCheckingInit(true);
      api.get('/businesses/status')
        .then((res) => {
          if (active) setIsInitialized(res.isInitialized);
        })
        .catch((err) => {
          console.error("Failed to check initialization status", err);
          if (active) setIsInitialized(false);
        })
        .finally(() => {
          if (active) setIsCheckingInit(false);
        });
    }

    return () => { active = false; };
  }, [isAuthenticated, requireInit, user?.businessId]);

  if (isChecking || (requireInit && isCheckingInit)) {
    return <div className="p-4 text-sm opacity-60">Validating access...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (requireInit && isInitialized === false) {
    return <Navigate to="/opening-position" replace />;
  }

  return children;
}
