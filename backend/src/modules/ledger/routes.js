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

    const openingRes = await pool.query(
      `SELECT
         a.opening_balance,
         a.opening_balance_type,
         COALESCE(SUM(lp.debit - lp.credit), 0) AS movement_before
       FROM accounts a
       LEFT JOIN ledger_postings lp
         ON lp.account_id = a.id
         AND lp.business_id = a.business_id
         AND ($3::date IS NULL OR lp.posting_date < $3::date)
       WHERE a.id = $1 AND a.business_id = $2
       GROUP BY a.id`,
      [accountId, businessId, from || null]
    );

    if (openingRes.rows.length === 0) {
      throw httpError(404, 'Ledger account not found');
    }

    const openingBase =
      openingRes.rows[0].opening_balance_type === 'DR'
        ? Number(openingRes.rows[0].opening_balance)
        : -Number(openingRes.rows[0].opening_balance);
    const openingBalance = openingBase + Number(openingRes.rows[0].movement_before || 0);

    const linesRes = await pool.query(
      `WITH lines AS (
         SELECT
           lp.posting_date AS txn_date,
           v.id AS voucher_id,
           v.voucher_type AS "voucherType",
           v.voucher_number AS "voucherNumber",
           v.status,
           CASE WHEN lp.debit > 0 THEN 'DR' ELSE 'CR' END AS "entryType",
           CASE WHEN lp.debit > 0 THEN lp.debit ELSE lp.credit END AS amount,
           (lp.debit - lp.credit) AS signed_amount
         FROM ledger_postings lp
         JOIN vouchers v ON v.id = lp.voucher_id
         WHERE lp.account_id = $1
           AND lp.business_id = $2
           AND ($3::date IS NULL OR lp.posting_date >= $3::date)
           AND ($4::date IS NULL OR lp.posting_date <= $4::date)
       )
       SELECT
         txn_date AS "txnDate",
         voucher_id AS "voucherId",
         "voucherType",
         "voucherNumber",
         status,
         "entryType",
         amount,
         $5::numeric + SUM(signed_amount) OVER (ORDER BY txn_date, "voucherNumber", amount) AS "runningBalance"
       FROM lines
       ORDER BY txn_date, "voucherNumber"`,
      [accountId, businessId, from || null, to || null, openingBalance]
    );

    const lines = linesRes.rows.map((row) => ({
      ...row,
      amount: Number(row.amount),
      runningBalance: Number(row.runningBalance)
    }));

    const closingBalance = lines.length > 0 ? lines[lines.length - 1].runningBalance : openingBalance;

    res.json({
      openingBalance,
      closingBalance,
      lines
    });
  } catch (error) {
    next(error);
  }
});
