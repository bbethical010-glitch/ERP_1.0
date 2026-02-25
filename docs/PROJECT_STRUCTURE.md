# Accounting ERP Monorepo Structure

```text
.
├── frontend/                          # React + Tailwind (Tally-like UI)
│   └── src/
│       ├── app/                       # Router, providers, app bootstrap
│       ├── components/                # Shared UI (tables, hotkey hints, dialogs)
│       ├── features/
│       │   ├── gateway/               # "Gateway of Tally" menu
│       │   ├── vouchers/              # Journal/Payment/Receipt/Sales/Purchase entry
│       │   ├── ledger/                # Ledger account detail + running balances
│       │   ├── reports/               # BS, P&L, Trial Balance
│       │   └── daybook/               # Daily transaction register
│       ├── hooks/                     # Keyboard shortcuts, focus management
│       ├── layouts/                   # Compact boxed screens
│       ├── lib/                       # API client, formatters, constants
│       ├── pages/                     # Route-level pages
│       └── styles/                    # Tailwind + theme tokens
├── backend/                           # Node.js + Fastify/Express
│   └── src/
│       ├── api/                       # Route registration, middleware
│       ├── db/                        # PG pool, migrations, repositories
│       ├── modules/
│       │   ├── accounts/              # CoA and ledger APIs
│       │   ├── vouchers/              # Voucher posting APIs
│       │   ├── reports/               # Financial statement queries
│       │   ├── daybook/               # Daily book API
│       │   └── ledger/                # Ledger drilldown API
│       ├── services/                  # Server-side financial logic
│       └── utils/                     # Shared backend helpers
├── db/
│   └── schema.sql                     # Double-entry schema + constraints/triggers
└── docs/
    └── PROJECT_STRUCTURE.md
```
