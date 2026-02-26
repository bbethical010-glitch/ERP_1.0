import pg from 'pg';
import { env } from './src/config/env.js';
const pool = new pg.Pool({ connectionString: env.databaseUrl });

async function run() {
  try {
    const signupData = {
      companyName: 'Api Reset Test',
      username: 'tester_' + Date.now(),
      displayName: 'Test User',
      password: 'password123',
      baseCurrency: 'USD'
    };
    
    // 1. Signup
    console.log("Signing up...");
    const signupRes = await fetch('http://localhost:4000/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signupData)
    });
    const signupDataJson = await signupRes.json();
    if (!signupRes.ok) throw new Error(JSON.stringify(signupDataJson));
    const token = signupDataJson.token;
    const businessId = signupDataJson.user.businessId;
    
    // 2. Check DB groups BEFORE reset
    const beforeRes = await pool.query('SELECT COUNT(*) FROM account_groups WHERE business_id = $1', [businessId]);
    console.log(`Groups BEFORE reset: ${beforeRes.rows[0].count}`);
    
    // 3. Reset
    console.log("Resetting...");
    const resetRes = await fetch('http://localhost:4000/api/v1/reset-company', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ confirmationName: 'Api Reset Test' })
    });
    if (!resetRes.ok) throw new Error(await resetRes.text());
    
    // 4. Check DB groups AFTER reset
    const afterRes = await pool.query('SELECT COUNT(*) FROM account_groups WHERE business_id = $1', [businessId]);
    console.log(`Groups AFTER reset: ${afterRes.rows[0].count}`);
    
  } catch(e) {
    console.error("Error:", e.message || e);
  } finally {
    pool.end();
  }
}
run();
