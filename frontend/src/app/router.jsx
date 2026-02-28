import { createHashRouter, Navigate } from 'react-router-dom';
import { RequireAuth } from '../auth/RequireAuth';
import { LoginPage } from '../pages/LoginPage';
import { CompanySetupPage } from '../pages/CompanySetupPage';
import { OpeningPositionForm } from '../domain/openingPosition/OpeningPositionForm';
import { App } from './App';

export const router = createHashRouter([
  {
    path: '/login',
    element: <LoginPage />
  },
  {
    path: '/company-setup',
    element: (
      <RequireAuth requireInit={false}>
        <CompanySetupPage />
      </RequireAuth>
    )
  },
  {
    path: '/opening-position',
    element: (
      <RequireAuth requireInit={false}>
        <OpeningPositionForm />
      </RequireAuth>
    )
  },
  {
    path: '/*',
    element: (
      <RequireAuth>
        <App />
      </RequireAuth>
    )
  }
]);
