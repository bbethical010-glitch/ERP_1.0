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

- `Alt+C`: Open voucher creation
- `Esc`: Return to Gateway
- `Enter`: Save voucher (when not typing in an input)
- `Alt+A`: Add voucher line
- `Alt+X`: Delete voucher (edit mode)
- `N`: New voucher from voucher register

## Notes

- Financial posting is server-side (`backend/src/modules/vouchers/service.js`).
- Database trigger rejects unbalanced transactions at commit time.
- Tally palette is defined in `frontend/src/styles/theme.js`.
- Demo business ID is fixed as `00000000-0000-0000-0000-000000000001`.
