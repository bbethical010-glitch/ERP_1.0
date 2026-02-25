import { createHashRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../layouts/AppShell';
import { RequireAuth } from '../auth/RequireAuth';
import { GatewayPage } from '../pages/GatewayPage';
import { VoucherPage } from '../pages/VoucherPage';
import { VoucherRegisterPage } from '../pages/VoucherRegisterPage';
import { VoucherEditPage } from '../pages/VoucherEditPage';
import { LedgerPage } from '../pages/LedgerPage';
import { DaybookPage } from '../pages/DaybookPage';
import { TrialBalancePage } from '../pages/TrialBalancePage';
import { ProfitLossPage } from '../pages/ProfitLossPage';
import { BalanceSheetPage } from '../pages/BalanceSheetPage';
import { LoginPage } from '../pages/LoginPage';
import { UsersPage } from '../pages/UsersPage';
import { ChangePasswordPage } from '../pages/ChangePasswordPage';

export const router = createHashRouter([
  {
    path: '/login',
    element: <LoginPage />
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/gateway" replace /> },
      { path: 'gateway', element: <GatewayPage /> },
      { path: 'vouchers', element: <VoucherRegisterPage /> },
      { path: 'vouchers/new', element: <VoucherPage /> },
      { path: 'vouchers/:voucherId/edit', element: <VoucherEditPage /> },
      { path: 'ledger', element: <LedgerPage /> },
      { path: 'daybook', element: <DaybookPage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'change-password', element: <ChangePasswordPage /> },
      { path: 'reports/trial-balance', element: <TrialBalancePage /> },
      { path: 'reports/profit-loss', element: <ProfitLossPage /> },
      { path: 'reports/balance-sheet', element: <BalanceSheetPage /> },
      { path: '*', element: <Navigate to="/gateway" replace /> }
    ]
  },
  {
    path: '*',
    element: <Navigate to="/login" replace />
  }
]);
