import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';

export const reportsRouter = Router();

const accountBalanceCte = `
WITH account_balances AS (
  SELECT
    a.id,
    a.name,
    a.code,
    ag.category,
    COALESCE(CASE WHEN a.opening_balance_type = 'DR' THEN a.opening_balance ELSE -a.opening_balance END, 0)
    + COALESCE(SUM(CASE WHEN te.entry_type = 'DR' THEN te.amount ELSE -te.amount END), 0) AS closing_signed
  FROM accounts a
  JOIN account_groups ag ON ag.id = a.account_group_id
  LEFT JOIN transaction_entries te ON te.account_id = a.id
  LEFT JOIN transactions t ON t.id = te.transaction_id
  WHERE a.business_id = $1
    AND ($2::date IS NULL OR t.txn_date >= $2::date OR t.txn_date IS NULL)
    AND ($3::date IS NULL OR t.txn_date <= $3::date OR t.txn_date IS NULL)
  GROUP BY a.id, a.name, a.code, ag.category, a.opening_balance, a.opening_balance_type
)
`;

reportsRouter.get('/trial-balance', async (req, res, next) => {
  try {
    const businessId = req.query.businessId;
    if (!businessId) {
      throw httpError(400, 'businessId query parameter is required');
    }

    const result = await pool.query(
      `${accountBalanceCte}
       SELECT code, name, category,
              CASE WHEN closing_signed >= 0 THEN closing_signed ELSE 0 END AS debit,
              CASE WHEN closing_signed < 0 THEN ABS(closing_signed) ELSE 0 END AS credit
       FROM account_balances
       ORDER BY code`,
      [businessId, req.query.from || null, req.query.to || null]
    );

    const totals = result.rows.reduce(
      (acc, row) => {
        acc.debit += Number(row.debit);
        acc.credit += Number(row.credit);
        return acc;
      },
      { debit: 0, credit: 0 }
    );

    res.json({ lines: result.rows, totals });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/profit-loss', async (req, res, next) => {
  try {
    const businessId = req.query.businessId;
    if (!businessId) {
      throw httpError(400, 'businessId query parameter is required');
    }

    const result = await pool.query(
      `${accountBalanceCte}
       SELECT
         COALESCE(SUM(CASE WHEN category = 'INCOME' THEN -closing_signed ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN category = 'EXPENSE' THEN closing_signed ELSE 0 END), 0) AS expense
       FROM account_balances`,
      [businessId, req.query.from || null, req.query.to || null]
    );

    const income = Number(result.rows[0].income);
    const expense = Number(result.rows[0].expense);
    res.json({ income, expense, netProfit: income - expense });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/balance-sheet', async (req, res, next) => {
  try {
    const businessId = req.query.businessId;
    if (!businessId) {
      throw httpError(400, 'businessId query parameter is required');
    }

    const result = await pool.query(
      `${accountBalanceCte}
       SELECT
         COALESCE(SUM(CASE WHEN category IN ('CURRENT_ASSET', 'FIXED_ASSET') THEN closing_signed ELSE 0 END), 0) AS assets,
         COALESCE(SUM(CASE WHEN category IN ('LIABILITY', 'EQUITY') THEN ABS(closing_signed) ELSE 0 END), 0) AS "liabilitiesAndEquity"
       FROM account_balances`,
      [businessId, req.query.from || null, req.query.to || null]
    );

    res.json({
      assets: Number(result.rows[0].assets),
      liabilitiesAndEquity: Number(result.rows[0].liabilitiesAndEquity)
    });
  } catch (error) {
    next(error);
  }
});
