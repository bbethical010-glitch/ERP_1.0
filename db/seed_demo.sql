-- Demo bootstrap data for local development
-- Safe to run multiple times

INSERT INTO businesses (id, name, base_currency)
VALUES ('00000000-0000-0000-0000-000000000001', 'Demo Trading Co.', 'INR')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  base_currency = EXCLUDED.base_currency;

-- Top-level groups
INSERT INTO account_groups (business_id, name, code, category, is_system)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Current Assets', 'CA', 'CURRENT_ASSET', TRUE),
  ('00000000-0000-0000-0000-000000000001', 'Fixed Assets', 'FA', 'FIXED_ASSET', TRUE),
  ('00000000-0000-0000-0000-000000000001', 'Liabilities', 'LI', 'LIABILITY', TRUE),
  ('00000000-0000-0000-0000-000000000001', 'Income', 'IN', 'INCOME', TRUE),
  ('00000000-0000-0000-0000-000000000001', 'Expenses', 'EX', 'EXPENSE', TRUE),
  ('00000000-0000-0000-0000-000000000001', 'Capital', 'EQ', 'EQUITY', TRUE)
ON CONFLICT (business_id, code) DO NOTHING;

-- Child groups for hierarchy
INSERT INTO account_groups (business_id, name, code, category, parent_group_id, is_system)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Bank Accounts', 'CA-BANK', 'CURRENT_ASSET', (SELECT id FROM account_groups WHERE business_id = '00000000-0000-0000-0000-000000000001' AND code = 'CA'), TRUE),
  ('00000000-0000-0000-0000-000000000001', 'Cash-in-Hand', 'CA-CASH', 'CURRENT_ASSET', (SELECT id FROM account_groups WHERE business_id = '00000000-0000-0000-0000-000000000001' AND code = 'CA'), TRUE),
  ('00000000-0000-0000-0000-000000000001', 'Sundry Debtors', 'CA-AR', 'CURRENT_ASSET', (SELECT id FROM account_groups WHERE business_id = '00000000-0000-0000-0000-000000000001' AND code = 'CA'), TRUE),
  ('00000000-0000-0000-0000-000000000001', 'Sundry Creditors', 'LI-AP', 'LIABILITY', (SELECT id FROM account_groups WHERE business_id = '00000000-0000-0000-0000-000000000001' AND code = 'LI'), TRUE),
  ('00000000-0000-0000-0000-000000000001', 'Sales Accounts', 'IN-SALES', 'INCOME', (SELECT id FROM account_groups WHERE business_id = '00000000-0000-0000-0000-000000000001' AND code = 'IN'), TRUE),
  ('00000000-0000-0000-0000-000000000001', 'Purchase Accounts', 'EX-PUR', 'EXPENSE', (SELECT id FROM account_groups WHERE business_id = '00000000-0000-0000-0000-000000000001' AND code = 'EX'), TRUE),
  ('00000000-0000-0000-0000-000000000001', 'Indirect Expenses', 'EX-IND', 'EXPENSE', (SELECT id FROM account_groups WHERE business_id = '00000000-0000-0000-0000-000000000001' AND code = 'EX'), TRUE)
ON CONFLICT (business_id, code) DO NOTHING;

-- Starter ledgers
INSERT INTO accounts (business_id, account_group_id, code, name, normal_balance, opening_balance, opening_balance_type, is_system)
VALUES
  ('00000000-0000-0000-0000-000000000001', (SELECT id FROM account_groups WHERE business_id = '00000000-0000-0000-0000-000000000001' AND code = 'CA-CASH'), 'A-CASH', 'Cash', 'DR', 0, 'DR', TRUE),
  ('00000000-0000-0000-0000-000000000001', (SELECT id FROM account_groups WHERE business_id = '00000000-0000-0000-0000-000000000001' AND code = 'CA-BANK'), 'A-BANK', 'Bank', 'DR', 0, 'DR', TRUE),
  ('00000000-0000-0000-0000-000000000001', (SELECT id FROM account_groups WHERE business_id = '00000000-0000-0000-0000-000000000001' AND code = 'CA-AR'), 'A-AR', 'Accounts Receivable', 'DR', 0, 'DR', TRUE),
  ('00000000-0000-0000-0000-000000000001', (SELECT id FROM account_groups WHERE business_id = '00000000-0000-0000-0000-000000000001' AND code = 'LI-AP'), 'L-AP', 'Accounts Payable', 'CR', 0, 'CR', TRUE),
  ('00000000-0000-0000-0000-000000000001', (SELECT id FROM account_groups WHERE business_id = '00000000-0000-0000-0000-000000000001' AND code = 'IN-SALES'), 'I-SALES', 'Sales', 'CR', 0, 'CR', TRUE),
  ('00000000-0000-0000-0000-000000000001', (SELECT id FROM account_groups WHERE business_id = '00000000-0000-0000-0000-000000000001' AND code = 'EX-PUR'), 'E-PUR', 'Purchases', 'DR', 0, 'DR', TRUE),
  ('00000000-0000-0000-0000-000000000001', (SELECT id FROM account_groups WHERE business_id = '00000000-0000-0000-0000-000000000001' AND code = 'EX-IND'), 'E-RENT', 'Rent Expense', 'DR', 0, 'DR', TRUE),
  ('00000000-0000-0000-0000-000000000001', (SELECT id FROM account_groups WHERE business_id = '00000000-0000-0000-0000-000000000001' AND code = 'EQ'), 'EQ-CAP', 'Capital Account', 'CR', 0, 'CR', TRUE)
ON CONFLICT (business_id, code) DO NOTHING;
