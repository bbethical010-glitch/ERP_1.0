import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';
import { requireAuth } from '../../middleware/requireAuth.js';

export const businessesRouter = Router();

const patchSchema = z.object({
    name: z.string().min(2).max(120).optional(),
    address: z.string().max(500).optional(),
    financialYearStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    baseCurrency: z.string().length(3).optional()
});

/**
 * GET /businesses/me
 * Returns the current user's business/company info
 */
businessesRouter.get('/me', requireAuth, async (req, res, next) => {
    try {
        const businessId = req.user?.businessId;
        if (!businessId) throw httpError(401, 'Business context missing');

        const result = await pool.query(
            `SELECT id,
              name,
              base_currency AS "baseCurrency",
              address,
              financial_year_start AS "financialYearStart",
              created_at AS "createdAt"
       FROM businesses
       WHERE id = $1
       LIMIT 1`,
            [businessId]
        );

        if (result.rows.length === 0) throw httpError(404, 'Business not found');
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});
/**
 * GET /businesses/status
 * Returns the initialization status of the business
 */
businessesRouter.get('/status', requireAuth, async (req, res, next) => {
    try {
        const businessId = req.user?.businessId;
        if (!businessId) throw httpError(401, 'Business context missing');

        const result = await pool.query(
            `SELECT is_initialized FROM businesses WHERE id = $1 LIMIT 1`,
            [businessId]
        );

        if (result.rows.length === 0) throw httpError(404, 'Business not found');

        res.json({ isInitialized: result.rows[0].is_initialized });
    } catch (err) {
        next(err);
    }
});
/**
 * PATCH /businesses/me
 * Update company details (name, address, financial year start, currency)
 */
businessesRouter.patch('/me', requireAuth, async (req, res, next) => {
    try {
        const businessId = req.user?.businessId;
        if (!businessId) throw httpError(401, 'Business context missing');

        // Only OWNER can update company details
        if (req.user?.role !== 'OWNER') throw httpError(403, 'Only owners can update company details');

        const payload = patchSchema.parse(req.body);
        const updates = [];
        const values = [];
        let idx = 1;

        if (payload.name !== undefined) {
            updates.push(`name = $${idx++}`);
            values.push(payload.name.trim());
        }
        if (payload.address !== undefined) {
            updates.push(`address = $${idx++}`);
            values.push(payload.address.trim());
        }
        if (payload.financialYearStart !== undefined) {
            updates.push(`financial_year_start = $${idx++}`);
            values.push(payload.financialYearStart);
        }
        if (payload.baseCurrency !== undefined) {
            updates.push(`base_currency = $${idx++}`);
            values.push(payload.baseCurrency.toUpperCase());
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updates.push(`updated_at = NOW()`);
        values.push(businessId);

        const result = await pool.query(
            `UPDATE businesses SET ${updates.join(', ')}
       WHERE id = $${idx}
       RETURNING id,
                 name,
                 base_currency AS "baseCurrency",
                 address,
                 financial_year_start AS "financialYearStart"`,
            values
        );

        res.json(result.rows[0]);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return next(httpError(400, 'Invalid payload', err.issues));
        }
        next(err);
    }
});
