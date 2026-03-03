export const VOUCHER_QUICK_ACTIONS = [
  { id: 'new-journal', label: 'Journal Voucher', path: '/vouchers/new?vtype=JOURNAL', hotkey: 'J' },
  { id: 'new-payment', label: 'Payment Voucher', path: '/vouchers/new?vtype=PAYMENT', hotkey: 'P' },
  { id: 'new-receipt', label: 'Receipt Voucher', path: '/vouchers/new?vtype=RECEIPT', hotkey: 'R' },
  { id: 'new-sales', label: 'Sales Voucher', path: '/vouchers/new?vtype=SALES', hotkey: 'S' },
  { id: 'new-purchase', label: 'Purchase Voucher', path: '/vouchers/new?vtype=PURCHASE', hotkey: 'U' },
  { id: 'new-contra', label: 'Contra Voucher', path: '/vouchers/new?vtype=CONTRA', hotkey: 'C' }
];

export function getGatewaySections(canManageUsers) {
  const masters = [
    { id: 'masters-ledger-create', label: 'Create Ledger', path: '/ledger/new', hotkey: 'L', keywords: ['accounts', 'masters', 'new ledger'] },
    { id: 'masters-ledgers', label: 'Ledger Reports', path: '/ledger', hotkey: 'E', keywords: ['accounts', 'masters', 'view'] },
    { id: 'masters-password', label: 'Change Password', path: '/change-password', hotkey: 'P', keywords: ['security'] },
    { id: 'masters-company', label: 'Company Setup', path: '/company-setup', hotkey: 'Y', keywords: ['company', 'business'] }
  ];

  if (canManageUsers) {
    masters.splice(2, 0, {
      id: 'masters-users',
      label: 'Users',
      path: '/users',
      hotkey: 'U',
      keywords: ['login', 'roles']
    });
  }

  return [
    {
      id: 'masters',
      label: 'Masters',
      hint: 'Ledger, groups & company setup',
      items: masters
    },
    {
      id: 'transactions',
      label: 'Transactions',
      hint: 'Day-to-day posting and books',
      items: [
        { id: 'txn-vouchers', label: 'Voucher Register', path: '/vouchers', hotkey: 'V', keywords: ['transactions'] },
        { id: 'txn-daybook', label: 'Daybook', path: '/daybook', hotkey: 'D', keywords: ['daily'] },
        ...VOUCHER_QUICK_ACTIONS.map((item) => ({
          id: `txn-${item.id}`,
          label: `Create ${item.label}`,
          path: item.path,
          hotkey: item.hotkey,
          keywords: ['create', 'voucher']
        }))
      ]
    },
    {
      id: 'reports',
      label: 'Reports',
      hint: 'Financial statements and drilldown',
      items: [
        { id: 'rep-trial', label: 'Trial Balance', path: '/reports/trial-balance', hotkey: 'T', keywords: ['drilldown'] },
        { id: 'rep-profit', label: 'Profit & Loss', path: '/reports/profit-loss', hotkey: 'O', keywords: ['income', 'expense'] },
        { id: 'rep-balance', label: 'Balance Sheet', path: '/reports/balance-sheet', hotkey: 'B', keywords: ['assets', 'liabilities'] },
        { id: 'rep-inventory', label: 'Stock Summary', path: '/inventory', hotkey: 'I', keywords: ['inventory', 'stock', 'items'] }
      ]
    }
  ];
}

const ROUTE_LABELS = new Map([
  ['/gateway', 'Gateway'],
  ['/ledger', 'Ledgers'],
  ['/vouchers', 'Voucher Register'],
  ['/vouchers/new', 'Voucher Entry'],
  ['/daybook', 'Daybook'],
  ['/inventory', 'Stock Summary'],
  ['/users', 'Users'],
  ['/change-password', 'Change Password'],
  ['/reports/trial-balance', 'Trial Balance'],
  ['/reports/profit-loss', 'Profit & Loss'],
  ['/reports/balance-sheet', 'Balance Sheet']
]);

export function getRouteLabel(pathname) {
  if (/^\/vouchers\/.+\/edit$/.test(pathname)) {
    return 'Voucher Alter';
  }
  return ROUTE_LABELS.get(pathname) || 'Gateway';
}

export function getCommandCatalog(canManageUsers) {
  const sections = getGatewaySections(canManageUsers);
  return sections.flatMap((section) =>
    section.items.map((item) => ({
      id: item.id,
      label: item.label,
      path: item.path,
      section: section.label,
      hotkey: item.hotkey,
      keywords: [...(item.keywords || []), section.label]
    }))
  );
}
