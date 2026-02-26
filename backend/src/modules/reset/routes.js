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
            await pool.query('DELETE FROM transactions WHERE business_id = $1', [businessId]);
            await pool.query('DELETE FROM vouchers WHERE business_id = $1', [businessId]);
            await pool.query('DELETE FROM accounts WHERE business_id = $1 AND is_system = FALSE', [businessId]);
            await pool.query('DELETE FROM account_groups WHERE business_id = $1 AND is_system = FALSE', [businessId]);
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
