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
    CREATE TYPE voucher_type AS ENUM ('JOURNAL', 'PAYMENT', 'RECEIPT', 'SALES', 'PURCHASE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dr_cr') THEN
    CREATE TYPE dr_cr AS ENUM ('DR', 'CR');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  base_currency CHAR(3) NOT NULL DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  transaction_id UUID NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  voucher_type voucher_type NOT NULL,
  voucher_number TEXT NOT NULL,
  voucher_date DATE NOT NULL,
  narration TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, voucher_type, voucher_number, voucher_date)
);

CREATE INDEX IF NOT EXISTS idx_vouchers_date ON vouchers (business_id, voucher_date);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (business_id, txn_date);

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
