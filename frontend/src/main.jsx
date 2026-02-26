import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { AuthProvider } from './auth/AuthContext';
import { KeyboardProvider } from './providers/KeyboardProvider';
import './styles/index.css';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </KeyboardProvider>
    </AuthProvider>
  </React.StrictMode>
);
