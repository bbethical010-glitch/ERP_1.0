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
  await pool.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(
    `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS inventory_costing_method TEXT NOT NULL DEFAULT 'WEIGHTED_AVERAGE'`
  );
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'businesses_inventory_costing_method_check'
          AND conrelid = 'businesses'::regclass
      ) THEN
        ALTER TABLE businesses
        ADD CONSTRAINT businesses_inventory_costing_method_check
        CHECK (inventory_costing_method IN ('WEIGHTED_AVERAGE', 'FIFO'));
      END IF;
    END $$;
  `);

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
    INSERT INTO account_groups (business_id, name, code, category, parent_group_id, is_system)
    SELECT
      parent.business_id,
      'Stock-in-Hand',
      'CA-STOCK',
      parent.category,
      parent.id,
      TRUE
    FROM account_groups parent
    WHERE parent.code = 'CA'
    ON CONFLICT (business_id, code) DO NOTHING
  `);

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
      closed_at TIMESTAMPTZ,
      closed_by TEXT,
      closing_voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (business_id, label)
    )
  `);
  await pool.query(`ALTER TABLE financial_years ADD COLUMN IF NOT EXISTS is_closed BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE financial_years ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE financial_years ADD COLUMN IF NOT EXISTS closed_by TEXT`);
  await pool.query(
    `ALTER TABLE financial_years ADD COLUMN IF NOT EXISTS closing_voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL`
  );
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
      reconciled BOOLEAN NOT NULL DEFAULT FALSE,
      reconciled_at TIMESTAMPTZ,
      reconciled_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
    )
  `);
  await pool.query(`ALTER TABLE ledger_postings ADD COLUMN IF NOT EXISTS reconciled BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE ledger_postings ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE ledger_postings ADD COLUMN IF NOT EXISTS reconciled_by TEXT`);
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sku TEXT,
      category TEXT,
      product_type TEXT NOT NULL DEFAULT 'INVENTORY'
        CHECK (product_type IN ('INVENTORY', 'FIXED_ASSET')),
      reorder_level NUMERIC(10,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (business_id, sku)
    )
  `);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS reorder_level NUMERIC(10,2) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'INVENTORY'`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_product_type_check'
          AND conrelid = 'products'::regclass
      ) THEN
        ALTER TABLE products
        ADD CONSTRAINT products_product_type_check
        CHECK (product_type IN ('INVENTORY', 'FIXED_ASSET'));
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      voucher_id UUID REFERENCES vouchers(id) ON DELETE CASCADE,
      transaction_date DATE NOT NULL,
      posting_date DATE,
      quantity NUMERIC(10,2) NOT NULL,
      unit_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_value NUMERIC(18,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS posting_date DATE`);
  await pool.query(`UPDATE inventory_transactions SET posting_date = transaction_date WHERE posting_date IS NULL`);
  await pool.query(`ALTER TABLE inventory_transactions ALTER COLUMN posting_date SET NOT NULL`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_inventory_tx_business_product ON inventory_transactions (business_id, product_id)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_inventory_tx_business_product_date ON inventory_transactions (business_id, product_id, posting_date)`
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voucher_outstandings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      voucher_id UUID NOT NULL UNIQUE REFERENCES vouchers(id) ON DELETE CASCADE,
      party_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
      voucher_type voucher_type NOT NULL CHECK (voucher_type IN ('SALES', 'PURCHASE')),
      voucher_date DATE NOT NULL,
      due_date DATE,
      original_amount NUMERIC(18,2) NOT NULL CHECK (original_amount >= 0),
      outstanding_amount NUMERIC(18,2) NOT NULL CHECK (outstanding_amount >= 0),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_voucher_outstandings_business_type_status
      ON voucher_outstandings (business_id, voucher_type, status, voucher_date)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voucher_allocations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      source_voucher_id UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
      target_voucher_id UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
      amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
      allocation_date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_voucher_allocations_business_target
      ON voucher_allocations (business_id, target_voucher_id, allocation_date)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_voucher (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      voucher_id UUID NOT NULL UNIQUE REFERENCES vouchers(id) ON DELETE CASCADE,
      supplier_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
      bill_number TEXT,
      bill_date DATE,
      total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_purchase_voucher_business_bill_date ON purchase_voucher (business_id, bill_date)`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      purchase_voucher_id UUID NOT NULL REFERENCES purchase_voucher(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      line_type TEXT NOT NULL CHECK (line_type IN ('INVENTORY', 'FIXED_ASSET')),
      product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
      asset_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
      description TEXT,
      quantity NUMERIC(12,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
      unit_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
      tax_rate NUMERIC(8,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
      tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
      line_total NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (line_total >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (purchase_voucher_id, line_no)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_purchase_lines_business_product ON purchase_lines (business_id, product_id)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_purchase_lines_business_asset ON purchase_lines (business_id, asset_account_id)`
  );
  await pool.query(`CREATE OR REPLACE VIEW fiscal_years AS SELECT * FROM financial_years`);

  await pool.query(`
    CREATE OR REPLACE FUNCTION fn_validate_ledger_postings_origin()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_expected_entry_type dr_cr;
      v_expected_amount NUMERIC(18,2);
      v_te_exists BOOLEAN;
      v_vl_exists BOOLEAN;
    BEGIN
      v_expected_entry_type := CASE WHEN NEW.debit > 0 THEN 'DR'::dr_cr ELSE 'CR'::dr_cr END;
      v_expected_amount := CASE WHEN NEW.debit > 0 THEN NEW.debit ELSE NEW.credit END;

      SELECT EXISTS(
        SELECT 1
        FROM transaction_entries te
        WHERE te.transaction_id = NEW.transaction_id
          AND te.account_id = NEW.account_id
          AND te.entry_type = v_expected_entry_type
          AND te.amount = v_expected_amount
      ) INTO v_te_exists;

      IF NOT v_te_exists THEN
        RAISE EXCEPTION 'ledger_postings must originate from transaction_entries';
      END IF;

      SELECT EXISTS(
        SELECT 1
        FROM voucher_lines vl
        WHERE vl.voucher_id = NEW.voucher_id
          AND vl.account_id = NEW.account_id
          AND vl.entry_type = v_expected_entry_type
          AND vl.amount = v_expected_amount
      ) INTO v_vl_exists;

      IF NOT v_vl_exists THEN
        RAISE EXCEPTION 'ledger_postings must originate from voucher_lines';
      END IF;

      RETURN NEW;
    END;
    $$;
  `);
  await pool.query(`DROP TRIGGER IF EXISTS trg_validate_ledger_postings_origin ON ledger_postings`);
  await pool.query(`
    CREATE TRIGGER trg_validate_ledger_postings_origin
    BEFORE INSERT OR UPDATE ON ledger_postings
    FOR EACH ROW
    EXECUTE FUNCTION fn_validate_ledger_postings_origin()
  `);

  await pool.query(`
    DO $$ 
    BEGIN 
      IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'businesses' 
          AND column_name = 'is_initialized'
      ) THEN 
        ALTER TABLE businesses ADD COLUMN is_initialized BOOLEAN NOT NULL DEFAULT FALSE;
      END IF;
    END $$;
  `);
}
