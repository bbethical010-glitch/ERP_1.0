import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';

export const daybookRouter = Router();

daybookRouter.get('/', async (req, res, next) => {
  try {
    const { businessId, date } = req.query;
    if (!businessId || !date) {
      throw httpError(400, 'businessId and date query parameters are required');
    }

    const result = await pool.query(
      `SELECT v.id, v.voucher_type AS "voucherType", v.voucher_number AS "voucherNumber",
              v.narration, t.txn_date AS "txnDate",
              SUM(CASE WHEN te.entry_type = 'DR' THEN te.amount ELSE 0 END) AS "debitTotal",
              SUM(CASE WHEN te.entry_type = 'CR' THEN te.amount ELSE 0 END) AS "creditTotal"
       FROM vouchers v
       JOIN transactions t ON t.id = v.transaction_id
       JOIN transaction_entries te ON te.transaction_id = t.id
       WHERE v.business_id = $1 AND t.txn_date = $2::date
       GROUP BY v.id, v.voucher_type, v.voucher_number, v.narration, t.txn_date
       ORDER BY v.created_at`,
      [businessId, date]
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});
