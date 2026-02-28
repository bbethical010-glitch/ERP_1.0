import { Router } from 'express';
import { pool } from '../../db/pool.js';

export const resetRouter = Router();

/**
 * POST /api/v1/reset-company
 * Wipes all accounting data for the authenticated user's business.
 * Preserves: businesses, users tables.
 * Requires: { confirmationName: "exact company name" }
 */
resetRouter.post('/', async (req, res) => {
    try {
        const { confirmationName } = req.body;
        const businessId = req.user.businessId;

        if (!businessId) {
            return res.status(400).json({ error: 'No business associated with user' });
        }

        // Verify company name matches
        const { rows: [company] } = await pool.query(
            'SELECT name FROM businesses WHERE id = $1',
            [businessId]
        );

        if (!company) {
            return res.status(404).json({ error: 'Business not found' });
        }

        if (confirmationName !== company.name) {
            return res.status(400).json({ error: 'Company name does not match. Reset aborted.' });
        }

        // Wipe accounting data in dependency order
        await pool.query('BEGIN');
        try {
            await pool.query('DELETE FROM ledger_postings WHERE business_id = $1', [businessId]);
            await pool.query('DELETE FROM transaction_entries WHERE transaction_id IN (SELECT id FROM transactions WHERE business_id = $1)', [businessId]);
            await pool.query('DELETE FROM transactions WHERE business_id = $1', [businessId]);
            await pool.query('DELETE FROM voucher_lines WHERE voucher_id IN (SELECT id FROM vouchers WHERE business_id = $1)', [businessId]);
            await pool.query('DELETE FROM vouchers WHERE business_id = $1', [businessId]);
            await pool.query('DELETE FROM financial_years WHERE business_id = $1', [businessId]);
            await pool.query('DELETE FROM accounts WHERE business_id = $1', [businessId]);
            await pool.query('DELETE FROM account_groups WHERE business_id = $1', [businessId]);
            await pool.query('DELETE FROM inventory_transactions WHERE business_id = $1', [businessId]);
            await pool.query('DELETE FROM products WHERE business_id = $1', [businessId]);

            // Lock the system back down
            await pool.query('UPDATE businesses SET is_initialized = FALSE WHERE id = $1', [businessId]);

            await pool.query('COMMIT');
        } catch (err) {
            await pool.query('ROLLBACK');
            throw err;
        }

        res.json({ success: true, message: 'All accounting data has been reset.' });
    } catch (err) {
        console.error('Reset company error:', err);
        res.status(500).json({ error: err.message });
    }
});
