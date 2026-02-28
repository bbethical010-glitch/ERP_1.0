/**
 * Standalone API Test for Opening Position Strict Logic Flow
 * Usage: node test_opening_position.js
 */
import testUrl from 'url';

const API_BASE = 'http://localhost:4000/api/v1';

async function runTest() {
    console.log('--- Starting Opening Position E2E verification ---');
    try {
        const username = `testuser_${Date.now()}`;

        // 1. Sign Up
        console.log('1. Signing up new user...');
        const signupRes = await fetch(`${API_BASE}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                companyName: 'Opening Test Corp',
                username: username,
                displayName: 'Test User',
                password: 'password123'
            })
        });

        if (!signupRes.ok) throw new Error(`Signup failed: ${await signupRes.text()}`);
        const { token } = await signupRes.json();
        const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
        console.log('   ✅ Signup successful. Token received.');

        // 2. Check strict initialization gate (Should be false)
        console.log('2. Checking /businesses/status (is_initialized)...');
        const statusRes1 = await fetch(`${API_BASE}/businesses/status`, { headers });
        const { isInitialized } = await statusRes1.json();

        if (isInitialized !== false) throw new Error(`Business started initialized!`);
        console.log('   ✅ Business strictly locked (isInitialized: false).');

        // 3. Post Opening Position Payload
        console.log('3. Posting Opening Position Payload...');
        const payload = {
            date: new Date().toISOString().slice(0, 10),
            openingBalances: [
                { ledgerName: 'Owner Capital', group: 'Capital Account', drCr: 'CR', amount: 100000.00 },
                { ledgerName: 'HDFC Bank', group: 'Bank Accounts', drCr: 'DR', amount: 50000.00 }
            ],
            items: [
                { sku: 'ITM-01', name: 'Widget Pro', uom: 'pcs', initialQty: 1000, unitCost: 50.00 } // Total inventory value: 50000
            ],
            stockJournalMetadata: {
                narration: 'Test Opening Stock'
            }
        };

        const postRes = await fetch(`${API_BASE}/opening-position`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        if (!postRes.ok) throw new Error(`Opening Position POST failed: ${await postRes.text()}`);

        const responseData = await postRes.json();
        console.log(`   ✅ Posted successfully. Response:`, responseData);

        if (responseData.stockValue !== 50000) throw new Error('Stock value calculation wrong');
        if (responseData.ledgerCount !== 3) throw new Error('Ledger count wrong (Capital, Bank, Stock)');

        // 4. Verify gate has opened
        console.log('4. Checking /businesses/status after opening books...');
        const statusRes2 = await fetch(`${API_BASE}/businesses/status`, { headers });
        const finalStatus = await statusRes2.json();

        if (finalStatus.isInitialized !== true) throw new Error(`Business did not initialize after valid POST`);
        console.log('   ✅ Gate Unlocked (isInitialized: true). Tests passed!');

    } catch (err) {
        console.error('❌ Test failed:', err.message);
        process.exit(1);
    }
}

runTest();
