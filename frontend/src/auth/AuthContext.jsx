import { createContext, useContext, useMemo, useState } from 'react';

const TOKEN_KEY = 'erp_auth_token';
const USER_KEY = 'erp_auth_user';

const AuthContext = createContext(null);

function getDefaultCreds() {
  return {
    username: import.meta.env.VITE_APP_ADMIN_USERNAME || 'admin',
    password: import.meta.env.VITE_APP_ADMIN_PASSWORD || 'admin123',
    displayName: import.meta.env.VITE_APP_ADMIN_DISPLAY_NAME || 'Administrator'
  };
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  });

  async function login({ username, password }) {
    const creds = getDefaultCreds();
    if (username !== creds.username || password !== creds.password) {
      throw new Error('Invalid username or password');
    }

    const nextToken = `${username}-${Date.now()}`;
    const nextUser = {
      username,
      displayName: creds.displayName,
      role: 'OWNER'
    };

    localStorage.setItem(TOKEN_KEY, nextToken);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
    return nextUser;
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }

  const value = useMemo(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token),
      login,
      logout
    }),
    [token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
