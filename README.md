# Accounting ERP (Tally-Style)

Monorepo with:
- `frontend`: React + Tailwind + React Query
- `backend`: Express + PostgreSQL
- `db/schema.sql`: Double-entry schema with database-level DR/CR balancing trigger

## Quick Start

1. Create PostgreSQL DB:
   - `createdb accounting_erp`
2. Configure backend env:
   - `cp backend/.env.example backend/.env`
3. Install dependencies:
   - `npm install`
4. Initialize schema and demo master data:
   - `npm run db:schema`
   - `npm run db:seed:demo`
5. Start backend:
   - `npm run dev:backend`
6. Start frontend:
   - `npm run dev:frontend`

Run backend and frontend in separate terminal tabs.
Open these URLs:
- Frontend app: `http://localhost:5173`
- Backend health: `http://localhost:4000/api/v1/health`

## Keyboard Shortcuts

- `⌥C`: Open voucher creation
- `Esc`: Return to Gateway
- `Return`: Save voucher (when not typing in an input)
- `⌥A`: Add voucher line
- `⌥R`: Reverse voucher (voucher details mode)
- `N`: New voucher from voucher register

## Login

- Login URL: `http://localhost:5173/login`
- Default credentials:
  - Username: `admin`
  - Password: `admin123`
- Update credentials in `backend/.env`:
  - `APP_ADMIN_USERNAME`
  - `APP_ADMIN_PASSWORD`
  - `APP_ADMIN_DISPLAY_NAME`
  - `AUTH_SECRET` (required for production)

## Notes

- Financial posting engine is server-side (`backend/src/modules/vouchers/service.js`).
- Voucher lifecycle: `DRAFT -> POSTED -> REVERSED` and `DRAFT -> CANCELLED`.
- Posted vouchers are immutable; corrections are done by reversal posting.
- Reports are generated from `ledger_postings` and grouped by account category/group.
- Dashboard is data-driven (`/api/v1/dashboard/summary`) with KPI cards, alerts, and recent vouchers.
- Database includes normalized tables for `voucher_lines`, `ledger_postings`, and `financial_years`.
- Audit logs are stored in `audit_logs` for voucher lifecycle events.
- Tally palette is defined in `frontend/src/styles/theme.js`.
- Demo business ID is fixed as `00000000-0000-0000-0000-000000000001`.
