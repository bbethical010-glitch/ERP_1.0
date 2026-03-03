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
    COALESCE(SUM(lp.debit), 0) AS total_dr,
    COALESCE(SUM(lp.credit), 0) AS total_cr
  FROM accounts a
  JOIN account_groups ag ON ag.id = a.account_group_id
  LEFT JOIN ledger_postings lp ON lp.account_id = a.id
    AND lp.business_id = a.business_id
    AND ($2::date IS NULL OR lp.posting_date >= $2::date)
    AND ($3::date IS NULL OR lp.posting_date <= $3::date)
  WHERE a.business_id = $1
  GROUP BY a.id, a.code, a.name, ag.id, ag.name, ag.category
)
`;

reportsRouter.get('/trial-balance', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const hideZero = ['1', 'true', 'yes'].includes(String(req.query.hideZero || '').toLowerCase());
    const businessId = getBusinessId(req);

    const result = await pool.query(
      `${balanceCte}
       SELECT
         id AS "accountId",
         code,
         name,
         group_id AS "groupId",
         group_name AS "groupName",
         category,
         total_dr AS "drTotal",
         total_cr AS "crTotal",
         (total_dr - total_cr) AS "closingSigned",
         CASE WHEN total_dr >= total_cr THEN 'DR' ELSE 'CR' END AS "closingType",
         ABS(total_dr - total_cr) AS "closingBalance",
         CASE WHEN total_dr > total_cr THEN total_dr - total_cr ELSE 0 END AS debit,
         CASE WHEN total_cr > total_dr THEN total_cr - total_dr ELSE 0 END AS credit
       FROM account_balances
       WHERE ($4::boolean = FALSE OR ABS(total_dr - total_cr) > 0.0001)
       ORDER BY category, group_name, code`,
      [businessId, from || null, to || null, hideZero]
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
      difference: Number((totals.debit - totals.credit).toFixed(2)),
      options: { hideZero }
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
      `WITH period_lines AS (
         SELECT
           ag.code AS "groupCode",
           ag.category,
           a.name AS "accountName",
           COALESCE(SUM(lp.debit), 0) AS debit,
           COALESCE(SUM(lp.credit), 0) AS credit
         FROM ledger_postings lp
         JOIN accounts a ON a.id = lp.account_id
         JOIN account_groups ag ON ag.id = a.account_group_id
         WHERE lp.business_id = $1
           AND lp.posting_date BETWEEN $2::date AND $3::date
           AND ag.category IN ('INCOME', 'EXPENSE')
           AND a.name <> 'Year End Closing'
         GROUP BY ag.code, ag.category, a.name
       ),
       compare_lines AS (
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
           AND a.name <> 'Year End Closing'
         GROUP BY ag.category
       )
       SELECT
         COALESCE((SELECT SUM(credit - debit) FROM period_lines WHERE category = 'INCOME'), 0) AS revenue,
         COALESCE((
           SELECT SUM(debit - credit)
           FROM period_lines
           WHERE category = 'EXPENSE'
             AND ("groupCode" LIKE 'EX-IND%' OR LOWER("accountName") LIKE '%cost of goods sold%' OR LOWER("accountName") LIKE '%cogs%')
         ), 0) AS direct_costs,
         COALESCE((
           SELECT SUM(debit - credit)
           FROM period_lines
           WHERE category = 'EXPENSE'
             AND NOT ("groupCode" LIKE 'EX-IND%' OR LOWER("accountName") LIKE '%cost of goods sold%' OR LOWER("accountName") LIKE '%cogs%')
         ), 0) AS operating_expenses,
         COALESCE((SELECT SUM(credit - debit) FROM compare_lines WHERE category = 'INCOME'), 0) AS compare_income,
         COALESCE((SELECT SUM(debit - credit) FROM compare_lines WHERE category = 'EXPENSE'), 0) AS compare_expense`,
      [businessId, from, to, compareFrom || null, compareTo || null]
    );

    const revenue = Number(result.rows[0].revenue || 0);
    const directCosts = Number(result.rows[0].direct_costs || 0);
    const operatingExpenses = Number(result.rows[0].operating_expenses || 0);
    const compareIncome = Number(result.rows[0].compare_income || 0);
    const compareExpense = Number(result.rows[0].compare_expense || 0);

    const grossProfit = revenue - directCosts;
    const netProfit = grossProfit - operatingExpenses;
    const totalExpense = directCosts + operatingExpenses;

    res.json({
      revenue,
      directCosts,
      grossProfit,
      operatingExpenses,
      netProfit,
      // Backward-compatible fields
      income: revenue,
      expense: totalExpense,
      operatingProfit: grossProfit,
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
    const to = req.query.to || todayIso();
    const from = req.query.from || null;
    const pnlFrom = from || fyStart(to);
    const businessId = getBusinessId(req);

    const result = await pool.query(
      `${balanceCte}
       SELECT
         category,
         code,
         name,
         group_name AS "groupName",
         (total_dr - total_cr) AS "closingSigned"
       FROM account_balances
       ORDER BY category, group_name, code`,
      [businessId, from || null, to || null]
    );

    const assetsCurrent = result.rows
      .filter((row) => row.category === 'CURRENT_ASSET')
      .reduce((sum, row) => sum + Number(row.closingSigned || 0), 0);
    const assetsNonCurrent = result.rows
      .filter((row) => row.category === 'FIXED_ASSET')
      .reduce((sum, row) => sum + Number(row.closingSigned || 0), 0);
    const liabilities = result.rows
      .filter((row) => row.category === 'LIABILITY')
      .reduce((sum, row) => sum + Number((0 - Number(row.closingSigned || 0)).toFixed(2)), 0);
    const equityRows = result.rows.filter((row) => row.category === 'EQUITY');
    const drawings = equityRows
      .filter((row) => row.name && row.name.toLowerCase().includes('drawings'))
      .reduce((sum, row) => sum + Number(row.closingSigned || 0), 0);
    const openingCapital = equityRows
      .filter((row) => !(row.name && row.name.toLowerCase().includes('drawings')))
      .reduce((sum, row) => sum + Number((0 - Number(row.closingSigned || 0)).toFixed(2)), 0);
    const assets = assetsCurrent + assetsNonCurrent;

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
      [businessId, pnlFrom, to || null]
    );

    const currentYearProfit = Number(pnl.rows[0].income || 0) - Number(pnl.rows[0].expense || 0);
    const equity = openingCapital + currentYearProfit - drawings;
    const liabilitiesAndEquity = liabilities + equity;

    res.json({
      // Backward-compatible top-level numbers
      assets: Number(assets.toFixed(2)),
      liabilities: Number(liabilities.toFixed(2)),
      equity: Number(equity.toFixed(2)),
      retainedEarnings: Number(currentYearProfit.toFixed(2)),
      liabilitiesAndEquity: Number(liabilitiesAndEquity.toFixed(2)),
      equationDifference: Number((assets - liabilitiesAndEquity).toFixed(2)),
      equationBalanced: Number((assets - liabilitiesAndEquity).toFixed(2)) === 0,
      // New structured sections
      assetsBreakdown: {
        current: Number(assetsCurrent.toFixed(2)),
        nonCurrent: Number(assetsNonCurrent.toFixed(2)),
        total: Number(assets.toFixed(2))
      },
      liabilitiesBreakdown: {
        total: Number(liabilities.toFixed(2))
      },
      equityBreakdown: {
        openingCapital: Number(openingCapital.toFixed(2)),
        currentYearProfit: Number(currentYearProfit.toFixed(2)),
        drawings: Number(drawings.toFixed(2)),
        retainedEarnings: Number(currentYearProfit.toFixed(2)),
        total: Number(equity.toFixed(2))
      }
    });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/aging', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const asOf = req.query.asOf || todayIso();

    const result = await pool.query(
      `WITH aging_base AS (
         SELECT
           voucher_type AS "voucherType",
           outstanding_amount AS amount,
           GREATEST(0, ($2::date - COALESCE(due_date, voucher_date)))::int AS age_days
         FROM voucher_outstandings
         WHERE business_id = $1
           AND status = 'OPEN'
           AND outstanding_amount > 0
           AND voucher_date <= $2::date
       )
       SELECT
         "voucherType",
         COALESCE(SUM(CASE WHEN age_days <= 30 THEN amount ELSE 0 END), 0) AS bucket_0_30,
         COALESCE(SUM(CASE WHEN age_days > 30 AND age_days <= 60 THEN amount ELSE 0 END), 0) AS bucket_30_60,
         COALESCE(SUM(CASE WHEN age_days > 60 AND age_days <= 90 THEN amount ELSE 0 END), 0) AS bucket_60_90,
         COALESCE(SUM(CASE WHEN age_days > 90 THEN amount ELSE 0 END), 0) AS bucket_90_plus,
         COALESCE(SUM(amount), 0) AS total
       FROM aging_base
       GROUP BY "voucherType"`,
      [businessId, asOf]
    );

    const rows = Object.fromEntries(result.rows.map((row) => [row.voucherType, row]));
    const debtors = rows.SALES || {};
    const creditors = rows.PURCHASE || {};

    const shape = (row) => ({
      bucket0to30: Number(row.bucket_0_30 || 0),
      bucket30to60: Number(row.bucket_30_60 || 0),
      bucket60to90: Number(row.bucket_60_90 || 0),
      bucket90Plus: Number(row.bucket_90_plus || 0),
      total: Number(row.total || 0)
    });

    res.json({
      asOf,
      debtors: shape(debtors),
      creditors: shape(creditors)
    });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/outstanding-bills', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const type = req.query.type ? String(req.query.type).toUpperCase() : null;
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    const asOf = req.query.asOf || todayIso();

    if (type && !['SALES', 'PURCHASE'].includes(type)) {
      throw httpError(400, 'type must be SALES or PURCHASE');
    }
    if (status && !['OPEN', 'CLOSED'].includes(status)) {
      throw httpError(400, 'status must be OPEN or CLOSED');
    }

    const rows = await pool.query(
      `SELECT
         vo.id,
         vo.voucher_id AS "voucherId",
         vo.voucher_type AS "voucherType",
         vo.voucher_date AS "voucherDate",
         vo.due_date AS "dueDate",
         vo.original_amount AS "originalAmount",
         vo.outstanding_amount AS "outstandingAmount",
         vo.status,
         v.voucher_number AS "voucherNumber",
         v.narration,
         pa.id AS "partyAccountId",
         pa.name AS "partyAccountName",
         COALESCE(SUM(va.amount), 0) AS "allocatedAmount",
         GREATEST(0, ($4::date - COALESCE(vo.due_date, vo.voucher_date)))::int AS "ageDays"
       FROM voucher_outstandings vo
       LEFT JOIN vouchers v ON v.id = vo.voucher_id
       LEFT JOIN accounts pa ON pa.id = vo.party_account_id
       LEFT JOIN voucher_allocations va
         ON va.business_id = vo.business_id
        AND va.target_voucher_id = vo.voucher_id
       WHERE vo.business_id = $1
         AND ($2::text IS NULL OR vo.voucher_type = $2::voucher_type)
         AND ($3::text IS NULL OR vo.status = $3)
       GROUP BY
         vo.id, vo.voucher_id, vo.voucher_type, vo.voucher_date, vo.due_date,
         vo.original_amount, vo.outstanding_amount, vo.status,
         v.voucher_number, v.narration, pa.id, pa.name
       ORDER BY vo.voucher_date DESC, v.voucher_number DESC NULLS LAST`,
      [businessId, type, status, asOf]
    );

    const items = rows.rows.map((row) => ({
      ...row,
      originalAmount: Number(row.originalAmount || 0),
      outstandingAmount: Number(row.outstandingAmount || 0),
      allocatedAmount: Number(row.allocatedAmount || 0),
      ageDays: Number(row.ageDays || 0)
    }));

    const totals = items.reduce(
      (acc, item) => {
        if (item.voucherType === 'SALES') {
          acc.debtors += item.outstandingAmount;
        } else if (item.voucherType === 'PURCHASE') {
          acc.creditors += item.outstandingAmount;
        }
        acc.totalOutstanding += item.outstandingAmount;
        return acc;
      },
      { debtors: 0, creditors: 0, totalOutstanding: 0 }
    );

    res.json({
      asOf,
      filters: { type, status },
      totals: {
        debtors: Number(totals.debtors.toFixed(2)),
        creditors: Number(totals.creditors.toFixed(2)),
        totalOutstanding: Number(totals.totalOutstanding.toFixed(2))
      },
      items
    });
  } catch (error) {
    next(error);
  }
});
