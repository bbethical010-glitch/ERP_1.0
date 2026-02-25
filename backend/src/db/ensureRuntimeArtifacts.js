import { pool } from './pool.js';
import { env } from '../config/env.js';
import { hashPassword } from '../utils/password.js';

const DEFAULT_BUSINESS_ID = '00000000-0000-0000-0000-000000000001';

function normalizeUsername(username) {
  return String(username || '')
    .trim()
    .toLowerCase();
}

export async function ensureRuntimeArtifacts() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'voucher_type') THEN
        CREATE TYPE voucher_type AS ENUM ('JOURNAL', 'PAYMENT', 'RECEIPT', 'SALES', 'PURCHASE', 'CONTRA');
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'voucher_status') THEN
        CREATE TYPE voucher_status AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED');
      END IF;
    END $$;
  `);
  await pool.query(`ALTER TYPE voucher_type ADD VALUE IF NOT EXISTS 'CONTRA'`);
  await pool.query(`
    INSERT INTO businesses (id, name, base_currency)
    VALUES ($1, 'Demo Trading Co.', 'INR')
    ON CONFLICT (id) DO NOTHING
  `, [DEFAULT_BUSINESS_ID]);

  await pool.query(`
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
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_app_users_business_active_username ON app_users (business_id, is_active, username)`
  );
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username_unique_ci ON app_users (LOWER(username))`
  );
  await pool.query(
    `INSERT INTO app_users (
       business_id, username, display_name, password_hash, role, is_active, created_by
     ) VALUES ($1, $2, $3, $4, 'OWNER', TRUE, 'SYSTEM')
     ON CONFLICT (business_id, username)
     DO UPDATE SET
       display_name = EXCLUDED.display_name,
       password_hash = EXCLUDED.password_hash,
       role = 'OWNER',
       is_active = TRUE,
       updated_at = NOW()`,
    [DEFAULT_BUSINESS_ID, normalizeUsername(env.adminUsername), env.adminDisplayName, hashPassword(env.adminPassword)]
  );

  await pool.query(`
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
    )
  `);

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_business_created_at ON audit_logs (business_id, created_at DESC)`
  );

  await pool.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS reversed_by_voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL`
  );
  await pool.query(
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS reversed_from_voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL`
  );
  await pool.query(
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS is_system_generated BOOLEAN NOT NULL DEFAULT FALSE`
  );
  await pool.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS status voucher_status NOT NULL DEFAULT 'POSTED'`);
  await pool.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS posted_by TEXT`);
  await pool.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS cancelled_by TEXT`);
  await pool.query(`ALTER TABLE vouchers ALTER COLUMN transaction_id DROP NOT NULL`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_vouchers_status_date ON vouchers (business_id, status, voucher_date DESC)`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS voucher_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      voucher_id UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      entry_type dr_cr NOT NULL,
      amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (voucher_id, line_no)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_voucher_lines_voucher_id ON voucher_lines (voucher_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_voucher_lines_account_id ON voucher_lines (account_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS financial_years (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      is_closed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (business_id, label)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_financial_years_business_dates ON financial_years (business_id, start_date, end_date)`
  );

  await pool.query(`
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
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_ledger_postings_business_date ON ledger_postings (business_id, posting_date)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_ledger_postings_business_ledger_date ON ledger_postings (business_id, account_id, posting_date)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_ledger_postings_voucher_id ON ledger_postings (voucher_id)`
  );

  await pool.query(`
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
  `);

  await pool.query(`DROP TRIGGER IF EXISTS trg_prevent_voucher_mutation ON vouchers`);
  await pool.query(`
    CREATE TRIGGER trg_prevent_voucher_mutation
    BEFORE UPDATE OR DELETE ON vouchers
    FOR EACH ROW
    EXECUTE FUNCTION fn_prevent_voucher_mutation()
  `);

  // Backfill voucher_lines for historical posted vouchers once.
  await pool.query(`
    INSERT INTO voucher_lines (voucher_id, line_no, account_id, entry_type, amount)
    SELECT v.id, te.line_no, te.account_id, te.entry_type, te.amount
    FROM vouchers v
    JOIN transactions t ON t.id = v.transaction_id
    JOIN transaction_entries te ON te.transaction_id = t.id
    WHERE NOT EXISTS (
      SELECT 1 FROM voucher_lines vl WHERE vl.voucher_id = v.id
    )
  `);

  // Backfill ledger_postings for historical posted vouchers once.
  await pool.query(`
    INSERT INTO ledger_postings (business_id, voucher_id, transaction_id, account_id, posting_date, debit, credit)
    SELECT
      v.business_id,
      v.id,
      t.id,
      te.account_id,
      t.txn_date,
      CASE WHEN te.entry_type = 'DR' THEN te.amount ELSE 0 END AS debit,
      CASE WHEN te.entry_type = 'CR' THEN te.amount ELSE 0 END AS credit
    FROM vouchers v
    JOIN transactions t ON t.id = v.transaction_id
    JOIN transaction_entries te ON te.transaction_id = t.id
    WHERE NOT EXISTS (
      SELECT 1 FROM ledger_postings lp WHERE lp.voucher_id = v.id
    )
  `);
}
