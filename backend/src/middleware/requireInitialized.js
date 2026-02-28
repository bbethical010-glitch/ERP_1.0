import { pool } from '../db/pool.js';
import { httpError } from '../utils/httpError.js';

/**
 * Express middleware to block access if the user's business has not completed the Opening Position.
 * Assumes \`requireAuth\` has already run, so \`req.user.businessId\` is available.
 */
export async function requireInitialized(req, res, next) {
    try {
        const businessId = req.user?.businessId;
        if (!businessId) {
            return next(httpError(401, 'Business context missing'));
        }

        const result = await pool.query(
            "SELECT is_initialized FROM businesses WHERE id = $1",
            [businessId]
        );

        if (!result.rows[0]?.is_initialized) {
            return res.status(403).json({
                error: "Books not opened yet. Complete Opening Position first."
            });
        }

        next();
    } catch (err) {
        next(err);
    }
}
