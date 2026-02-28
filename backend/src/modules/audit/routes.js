import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { pool } from '../../db/pool.js';

export const auditRouter = Router();

/**
 * GET /api/v1/audit/bootstrap-integrity
 * Verifies that a new user starts with 0 ledgers, 0 vouchers, 0 entries.
 */
auditRouter.get('/bootstrap-integrity', requireAuth, async (req, res, next) => {
    try {
        const businessId = req.user.businessId;

        if (!businessId) {
            return res.status(400).json({ error: 'No business associated with user' });
        }

        const ledgerCountRes = await pool.query('SELECT COUNT(*) FROM accounts WHERE business_id = $1', [businessId]);
        const voucherCountRes = await pool.query('SELECT COUNT(*) FROM vouchers WHERE business_id = $1', [businessId]);
        const linesCountRes = await pool.query('SELECT COUNT(*) FROM voucher_lines WHERE voucher_id IN (SELECT id FROM vouchers WHERE business_id = $1)', [businessId]);

        const ledgerCount = parseInt(ledgerCountRes.rows[0].count, 10);
        const voucherCount = parseInt(voucherCountRes.rows[0].count, 10);
        const linesCount = parseInt(linesCountRes.rows[0].count, 10);

        const isClean = ledgerCount === 0 && voucherCount === 0 && linesCount === 0;

        res.json({
            isClean,
            counts: {
                accounts: ledgerCount,
                vouchers: voucherCount,
                voucher_lines: linesCount
            },
            message: isClean ? 'Accounting data is strictly clean.' : 'Seeded data detected in accounting entities.'
        });
    } catch (err) {
        next(err);
    }
});
