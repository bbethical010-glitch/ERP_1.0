-- Accounting ERP (Tally-style) base schema
-- PostgreSQL 14+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_group_category') THEN
    CREATE TYPE account_group_category AS ENUM (
      'CURRENT_ASSET',
      'FIXED_ASSET',
      'LIABILITY',
      'INCOME',
      'EXPENSE',
      'EQUITY'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'voucher_type') THEN
    CREATE TYPE voucher_type AS ENUM ('JOURNAL', 'PAYMENT', 'RECEIPT', 'SALES', 'PURCHASE', 'CONTRA');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'voucher_status') THEN
    CREATE TYPE voucher_status AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dr_cr') THEN
    CREATE TYPE dr_cr AS ENUM ('DR', 'CR');
  END IF;
END $$;

ALTER TYPE voucher_type ADD VALUE IF NOT EXISTS 'CONTRA';

CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  base_currency CHAR(3) NOT NULL DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'MANAGER', 'ACCOUNTANT', 'VIEWER')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, username)
);

CREATE INDEX IF NOT EXISTS idx_app_users_business_active_username ON app_users (business_id, is_active, username);

CREATE TABLE IF NOT EXISTS account_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  category account_group_category NOT NULL,
  parent_group_id UUID REFERENCES account_groups(id) ON DELETE RESTRICT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, code),
  UNIQUE (business_id, name)
);

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_group_id UUID NOT NULL REFERENCES account_groups(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  normal_balance dr_cr NOT NULL,
  opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  opening_balance_type dr_cr NOT NULL DEFAULT 'DR',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, code),
  UNIQUE (business_id, name)
);

-- Core double-entry header
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  txn_date DATE NOT NULL,
  narration TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Core double-entry lines (debit/credit postings)
CREATE TABLE IF NOT EXISTS transaction_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  entry_type dr_cr NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_transaction_entries_transaction_id ON transaction_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_entries_account_id ON transaction_entries(account_id);

-- Voucher metadata linked one-to-one with core transaction
CREATE TABLE IF NOT EXISTS vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  transaction_id UUID UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  voucher_type voucher_type NOT NULL,
  voucher_number TEXT NOT NULL,
  voucher_date DATE NOT NULL,
  narration TEXT,
  status voucher_status NOT NULL DEFAULT 'POSTED',
  posted_at TIMESTAMPTZ,
  posted_by TEXT,
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT,
  is_reversed BOOLEAN NOT NULL DEFAULT FALSE,
  reversed_by_voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL,
  reversed_from_voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL,
  is_system_generated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, voucher_type, voucher_number, voucher_date)
);

ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS reversed_by_voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS reversed_from_voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS is_system_generated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS status voucher_status NOT NULL DEFAULT 'POSTED';
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS posted_by TEXT;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
ALTER TABLE vouchers ALTER COLUMN transaction_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vouchers_date ON vouchers (business_id, voucher_date);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (business_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_vouchers_status_date ON vouchers (business_id, status, voucher_date DESC);

CREATE TABLE IF NOT EXISTS voucher_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  entry_type dr_cr NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (voucher_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_voucher_lines_voucher_id ON voucher_lines (voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_lines_account_id ON voucher_lines (account_id);

CREATE TABLE IF NOT EXISTS financial_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, label)
);

CREATE INDEX IF NOT EXISTS idx_financial_years_business_dates ON financial_years (business_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS ledger_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  financial_year_id UUID REFERENCES financial_years(id) ON DELETE SET NULL,
  voucher_id UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  posting_date DATE NOT NULL,
  debit NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE INDEX IF NOT EXISTS idx_ledger_postings_business_date ON ledger_postings (business_id, posting_date);
CREATE INDEX IF NOT EXISTS idx_ledger_postings_business_ledger_date ON ledger_postings (business_id, account_id, posting_date);
CREATE INDEX IF NOT EXISTS idx_ledger_postings_voucher_id ON ledger_postings (voucher_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL DEFAULT 'SYSTEM',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_business_created_at ON audit_logs (business_id, created_at DESC);

CREATE OR REPLACE FUNCTION fn_prevent_voucher_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Only draft vouchers can be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'DRAFT' THEN
      RETURN NEW;
    END IF;

    IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED' THEN
      RETURN NEW;
    END IF;

    IF OLD.status IS DISTINCT FROM NEW.status THEN
      RAISE EXCEPTION 'Only POSTED vouchers can transition to REVERSED';
    END IF;

    IF OLD.business_id IS DISTINCT FROM NEW.business_id
      OR OLD.transaction_id IS DISTINCT FROM NEW.transaction_id
      OR OLD.voucher_type IS DISTINCT FROM NEW.voucher_type
      OR OLD.voucher_number IS DISTINCT FROM NEW.voucher_number
      OR OLD.voucher_date IS DISTINCT FROM NEW.voucher_date
      OR OLD.narration IS DISTINCT FROM NEW.narration
      OR OLD.reversed_from_voucher_id IS DISTINCT FROM NEW.reversed_from_voucher_id
      OR OLD.is_system_generated IS DISTINCT FROM NEW.is_system_generated THEN
      RAISE EXCEPTION 'Core voucher fields are immutable after posting';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_voucher_mutation ON vouchers;

CREATE TRIGGER trg_prevent_voucher_mutation
BEFORE UPDATE OR DELETE ON vouchers
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_voucher_mutation();

-- Enforce transaction integrity: at least 2 lines and DR total = CR total.
CREATE OR REPLACE FUNCTION fn_validate_transaction_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_transaction_id UUID;
  v_debit NUMERIC(18,2);
  v_credit NUMERIC(18,2);
  v_line_count INTEGER;
BEGIN
  v_transaction_id := COALESCE(NEW.transaction_id, OLD.transaction_id);

  SELECT
    COALESCE(SUM(CASE WHEN entry_type = 'DR' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN entry_type = 'CR' THEN amount ELSE 0 END), 0),
    COUNT(*)
  INTO v_debit, v_credit, v_line_count
  FROM transaction_entries
  WHERE transaction_id = v_transaction_id;

  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'Transaction % must contain at least 2 lines', v_transaction_id;
  END IF;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'Transaction % is not balanced. DR=% CR=%', v_transaction_id, v_debit, v_credit;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_transaction_balance ON transaction_entries;

CREATE CONSTRAINT TRIGGER trg_validate_transaction_balance
AFTER INSERT OR UPDATE OR DELETE ON transaction_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION fn_validate_transaction_balance();

-- Seed top-level Tally-style CoA groups for each business.
-- Run these inserts after creating a business.
-- Example business bootstrap script can parameterize :business_id.

-- INSERT INTO account_groups (business_id, name, code, category, parent_group_id, is_system) VALUES
-- (:business_id, 'Current Assets', 'CA', 'CURRENT_ASSET', NULL, TRUE),
-- (:business_id, 'Fixed Assets',   'FA', 'FIXED_ASSET',   NULL, TRUE),
-- (:business_id, 'Liabilities',    'LI', 'LIABILITY',     NULL, TRUE),
-- (:business_id, 'Income',         'IN', 'INCOME',        NULL, TRUE),
-- (:business_id, 'Expenses',       'EX', 'EXPENSE',       NULL, TRUE),
-- (:business_id, 'Capital',        'EQ', 'EQUITY',        NULL, TRUE);
