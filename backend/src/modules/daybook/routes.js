import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';

export const daybookRouter = Router();

function getBusinessId(req) {
  const businessId = req.user?.businessId;
  if (!businessId) {
    throw httpError(401, 'Business context missing in auth token');
  }
  return businessId;
}

daybookRouter.get('/', async (req, res, next) => {
  try {
    const { from, to, voucherType, status, limit = 50, offset = 0 } = req.query;
    const businessId = getBusinessId(req);

    const result = await pool.query(
      `SELECT
         v.id,
         v.voucher_type AS "voucherType",
         v.voucher_number AS "voucherNumber",
         v.voucher_date AS "voucherDate",
         v.status,
         v.narration,
         COALESCE(SUM(CASE WHEN vl.entry_type = 'DR' THEN vl.amount ELSE 0 END), 0) AS "debitTotal",
         COALESCE(SUM(CASE WHEN vl.entry_type = 'CR' THEN vl.amount ELSE 0 END), 0) AS "creditTotal"
       FROM vouchers v
       LEFT JOIN voucher_lines vl ON vl.voucher_id = v.id
       WHERE v.business_id = $1
         AND ($2::date IS NULL OR v.voucher_date >= $2::date)
         AND ($3::date IS NULL OR v.voucher_date <= $3::date)
         AND ($4::text IS NULL OR v.voucher_type = $4::voucher_type)
         AND ($5::text IS NULL OR v.status = $5::voucher_status)
       GROUP BY v.id
       ORDER BY v.voucher_date ASC, v.created_at ASC
       LIMIT $6 OFFSET $7`,
      [businessId, from || null, to || null, voucherType || null, status || null, Number(limit), Number(offset)]
    );

    res.json(result.rows.map((row) => ({
      ...row,
      debitTotal: Number(row.debitTotal || 0),
      creditTotal: Number(row.creditTotal || 0)
    })));
  } catch (error) {
    next(error);
  }
});
