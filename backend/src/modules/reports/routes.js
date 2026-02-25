import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';

export const reportsRouter = Router();

function getBusinessId(req) {
  const businessId = req.user?.businessId;
  if (!businessId) {
    throw httpError(401, 'Business context missing in auth token');
  }
  return businessId;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fyStart(dateIso) {
  const [year, month] = dateIso.split('-').map(Number);
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-04-01`;
}

const balanceCte = `
WITH account_balances AS (
  SELECT
    a.id,
    a.code,
    a.name,
    ag.id AS group_id,
    ag.name AS group_name,
    ag.category,
    (CASE WHEN a.opening_balance_type = 'DR' THEN a.opening_balance ELSE -a.opening_balance END)
      + COALESCE(SUM(lp.debit - lp.credit), 0) AS closing_signed
  FROM accounts a
  JOIN account_groups ag ON ag.id = a.account_group_id
  LEFT JOIN ledger_postings lp ON lp.account_id = a.id
    AND lp.business_id = a.business_id
    AND ($2::date IS NULL OR lp.posting_date >= $2::date)
    AND ($3::date IS NULL OR lp.posting_date <= $3::date)
  WHERE a.business_id = $1
  GROUP BY a.id, a.code, a.name, ag.id, ag.name, ag.category, a.opening_balance, a.opening_balance_type
)
`;

reportsRouter.get('/trial-balance', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const businessId = getBusinessId(req);

    const result = await pool.query(
      `${balanceCte}
       SELECT
         code,
         name,
         group_id AS "groupId",
         group_name AS "groupName",
         category,
         CASE WHEN closing_signed >= 0 THEN closing_signed ELSE 0 END AS debit,
         CASE WHEN closing_signed < 0 THEN ABS(closing_signed) ELSE 0 END AS credit
       FROM account_balances
       ORDER BY category, group_name, code`,
      [businessId, from || null, to || null]
    );

    const totals = result.rows.reduce(
      (acc, row) => {
        acc.debit += Number(row.debit);
        acc.credit += Number(row.credit);
        return acc;
      },
      { debit: 0, credit: 0 }
    );

    const grouped = result.rows.reduce((acc, row) => {
      if (!acc[row.category]) {
        acc[row.category] = { debit: 0, credit: 0, lines: [] };
      }
      acc[row.category].debit += Number(row.debit);
      acc[row.category].credit += Number(row.credit);
      acc[row.category].lines.push(row);
      return acc;
    }, {});

    res.json({
      lines: result.rows,
      grouped,
      totals,
      isBalanced: Number(totals.debit.toFixed(2)) === Number(totals.credit.toFixed(2)),
      difference: Number((totals.debit - totals.credit).toFixed(2))
    });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/profit-loss', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const to = req.query.to || todayIso();
    const from = req.query.from || fyStart(to);
    const compareFrom = req.query.compareFrom || `${Number(from.slice(0, 4)) - 1}${from.slice(4)}`;
    const compareTo = req.query.compareTo || `${Number(to.slice(0, 4)) - 1}${to.slice(4)}`;

    const result = await pool.query(
      `WITH period AS (
         SELECT
           ag.category,
           COALESCE(SUM(lp.debit), 0) AS debit,
           COALESCE(SUM(lp.credit), 0) AS credit
         FROM ledger_postings lp
         JOIN accounts a ON a.id = lp.account_id
         JOIN account_groups ag ON ag.id = a.account_group_id
         WHERE lp.business_id = $1
           AND lp.posting_date BETWEEN $2::date AND $3::date
           AND ag.category IN ('INCOME', 'EXPENSE')
         GROUP BY ag.category
       ),
       compare AS (
         SELECT
           ag.category,
           COALESCE(SUM(lp.debit), 0) AS debit,
           COALESCE(SUM(lp.credit), 0) AS credit
         FROM ledger_postings lp
         JOIN accounts a ON a.id = lp.account_id
         JOIN account_groups ag ON ag.id = a.account_group_id
         WHERE lp.business_id = $1
           AND ($4::date IS NULL OR lp.posting_date >= $4::date)
           AND ($5::date IS NULL OR lp.posting_date <= $5::date)
           AND ag.category IN ('INCOME', 'EXPENSE')
         GROUP BY ag.category
       )
       SELECT
         COALESCE((SELECT SUM(credit - debit) FROM period WHERE category = 'INCOME'), 0) AS income,
         COALESCE((SELECT SUM(debit - credit) FROM period WHERE category = 'EXPENSE'), 0) AS expense,
         COALESCE((SELECT SUM(credit - debit) FROM compare WHERE category = 'INCOME'), 0) AS compare_income,
         COALESCE((SELECT SUM(debit - credit) FROM compare WHERE category = 'EXPENSE'), 0) AS compare_expense`,
      [businessId, from, to, compareFrom || null, compareTo || null]
    );

    const income = Number(result.rows[0].income || 0);
    const expense = Number(result.rows[0].expense || 0);
    const compareIncome = Number(result.rows[0].compare_income || 0);
    const compareExpense = Number(result.rows[0].compare_expense || 0);

    const grossProfit = income - expense;
    const operatingProfit = grossProfit;
    const netProfit = income - expense;

    res.json({
      income,
      expense,
      grossProfit,
      operatingProfit,
      netProfit,
      comparison: {
        income: compareIncome,
        expense: compareExpense,
        netProfit: compareIncome - compareExpense
      }
    });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/balance-sheet', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const businessId = getBusinessId(req);

    const result = await pool.query(
      `${balanceCte}
       SELECT
         category,
         COALESCE(SUM(closing_signed), 0) AS signed_total
       FROM account_balances
       GROUP BY category`,
      [businessId, from || null, to || null]
    );

    const byCategory = Object.fromEntries(result.rows.map((row) => [row.category, Number(row.signed_total)]));

    const assets = (byCategory.CURRENT_ASSET || 0) + (byCategory.FIXED_ASSET || 0);
    const liabilities = Math.abs(byCategory.LIABILITY || 0);
    const equityBase = Math.abs(byCategory.EQUITY || 0);

    const pnl = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN ag.category = 'INCOME' THEN lp.credit - lp.debit ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN ag.category = 'EXPENSE' THEN lp.debit - lp.credit ELSE 0 END), 0) AS expense
       FROM ledger_postings lp
       JOIN accounts a ON a.id = lp.account_id
       JOIN account_groups ag ON ag.id = a.account_group_id
       WHERE lp.business_id = $1
         AND ($2::date IS NULL OR lp.posting_date >= $2::date)
         AND ($3::date IS NULL OR lp.posting_date <= $3::date)`,
      [businessId, from || null, to || null]
    );

    const retainedEarnings = Number(pnl.rows[0].income || 0) - Number(pnl.rows[0].expense || 0);
    const equity = equityBase + retainedEarnings;
    const liabilitiesAndEquity = liabilities + equity;

    res.json({
      assets,
      liabilities,
      equity,
      retainedEarnings,
      liabilitiesAndEquity,
      equationDifference: Number((assets - liabilitiesAndEquity).toFixed(2))
    });
  } catch (error) {
    next(error);
  }
});
