import pg from 'pg';
import { env } from './src/config/env.js';
import { hashPassword } from './src/utils/password.js';

const pool = new pg.Pool({ connectionString: env.databaseUrl });

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const businessRes = await client.query(
      `INSERT INTO businesses (name, base_currency) VALUES ('Node Test', 'USD') RETURNING id`
    );
    const businessId = businessRes.rows[0].id;

    // bootstrap
    await client.query(
      `INSERT INTO account_groups (business_id, name, code, category, is_system)
       VALUES
        ($1, 'Current Assets', 'CA', 'CURRENT_ASSET', TRUE),
        ($1, 'Fixed Assets', 'FA', 'FIXED_ASSET', TRUE),
        ($1, 'Liabilities', 'LI', 'LIABILITY', TRUE),
        ($1, 'Income', 'IN', 'INCOME', TRUE),
        ($1, 'Expenses', 'EX', 'EXPENSE', TRUE),
        ($1, 'Capital', 'EQ', 'EQUITY', TRUE)
       ON CONFLICT DO NOTHING`,
      [businessId]
    );
    
    await client.query(
      `INSERT INTO account_groups (business_id, name, code, category, parent_group_id, is_system)
       VALUES
        ($1, 'Bank Accounts', 'CA-BANK', 'CURRENT_ASSET', (SELECT id FROM account_groups WHERE business_id = $1 AND code = 'CA'), TRUE),
        ($1, 'Cash-in-Hand', 'CA-CASH', 'CURRENT_ASSET', (SELECT id FROM account_groups WHERE business_id = $1 AND code = 'CA'), TRUE)
       ON CONFLICT DO NOTHING`,
      [businessId]
    );

    await client.query('COMMIT');
    console.log("Business ID:", businessId);

    const check = await pool.query('SELECT name, is_system FROM account_groups WHERE business_id = $1', [businessId]);
    console.log("Groups:", check.rows);

  } catch (err) {
    console.error(err);
    await client.query('ROLLBACK');
  } finally {
    client.release();
    pool.end();
  }
}

run();
