import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../layouts/AppShell';
import { GatewayPage } from '../pages/GatewayPage';
import { VoucherPage } from '../pages/VoucherPage';
import { VoucherRegisterPage } from '../pages/VoucherRegisterPage';
import { VoucherEditPage } from '../pages/VoucherEditPage';
import { LedgerPage } from '../pages/LedgerPage';
import { DaybookPage } from '../pages/DaybookPage';
import { TrialBalancePage } from '../pages/TrialBalancePage';
import { ProfitLossPage } from '../pages/ProfitLossPage';
import { BalanceSheetPage } from '../pages/BalanceSheetPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/gateway" replace /> },
      { path: 'gateway', element: <GatewayPage /> },
      { path: 'vouchers', element: <VoucherRegisterPage /> },
      { path: 'vouchers/new', element: <VoucherPage /> },
      { path: 'vouchers/:voucherId/edit', element: <VoucherEditPage /> },
      { path: 'ledger', element: <LedgerPage /> },
      { path: 'daybook', element: <DaybookPage /> },
      { path: 'reports/trial-balance', element: <TrialBalancePage /> },
      { path: 'reports/profit-loss', element: <ProfitLossPage /> },
      { path: 'reports/balance-sheet', element: <BalanceSheetPage /> }
    ]
  }
]);
