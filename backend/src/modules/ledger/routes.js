import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';

export const ledgerRouter = Router();

ledgerRouter.get('/:accountId', async (req, res, next) => {
  try {
    const { accountId } = req.params;
    const { businessId, from, to } = req.query;

    if (!businessId) {
      throw httpError(400, 'businessId query parameter is required');
    }

    const result = await pool.query(
      `WITH lines AS (
         SELECT
           t.txn_date,
           v.voucher_type AS "voucherType",
           v.voucher_number AS "voucherNumber",
           te.entry_type AS "entryType",
           te.amount,
           CASE WHEN te.entry_type = 'DR' THEN te.amount ELSE -te.amount END AS signed_amount
         FROM transaction_entries te
         JOIN transactions t ON t.id = te.transaction_id
         LEFT JOIN vouchers v ON v.transaction_id = t.id
         WHERE te.account_id = $1
           AND t.business_id = $2
           AND ($3::date IS NULL OR t.txn_date >= $3::date)
           AND ($4::date IS NULL OR t.txn_date <= $4::date)
       )
       SELECT txn_date AS "txnDate", "voucherType", "voucherNumber", "entryType", amount,
              SUM(signed_amount) OVER (ORDER BY txn_date, "voucherNumber", amount) AS "runningBalance"
       FROM lines
       ORDER BY txn_date, "voucherNumber"`,
      [accountId, businessId, from || null, to || null]
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});
