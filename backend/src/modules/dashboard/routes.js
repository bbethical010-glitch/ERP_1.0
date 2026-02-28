import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';

export const dashboardRouter = Router();

function getBusinessId(req) {
  const businessId = req.user?.businessId;
  if (!businessId) {
    throw httpError(401, 'Business context missing in auth token');
  }
  return businessId;
}

function monthStart(date) {
  const [year, month] = date.split('-');
  return `${year}-${month}-01`;
}

function fyStart(date) {
  const [year, month] = date.split('-').map(Number);
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-04-01`;
}

dashboardRouter.get('/summary', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const asOf = req.query.asOf || new Date().toISOString().slice(0, 10);

    const kpiRes = await pool.query(
      `WITH balances AS (
         SELECT
           a.id,
           a.name,
           ag.category,
           (CASE WHEN a.opening_balance_type = 'DR' THEN a.opening_balance ELSE -a.opening_balance END)
           + COALESCE(SUM(lp.debit - lp.credit), 0) AS closing_signed
         FROM accounts a
         JOIN account_groups ag ON ag.id = a.account_group_id
         LEFT JOIN ledger_postings lp ON lp.account_id = a.id
           AND lp.business_id = a.business_id
           AND lp.posting_date <= $2::date
         WHERE a.business_id = $1
         GROUP BY a.id, a.name, ag.category, a.opening_balance, a.opening_balance_type
       ),
       pnl AS (
         SELECT
           COALESCE(SUM(CASE WHEN ag.category = 'INCOME' THEN lp.credit - lp.debit ELSE 0 END), 0) AS income_mtd,
           COALESCE(SUM(CASE WHEN ag.category = 'EXPENSE' THEN lp.debit - lp.credit ELSE 0 END), 0) AS expense_mtd
         FROM ledger_postings lp
         JOIN accounts a ON a.id = lp.account_id
         JOIN account_groups ag ON ag.id = a.account_group_id
         WHERE lp.business_id = $1
           AND lp.posting_date BETWEEN $3::date AND $2::date
       ),
       pnl_ytd AS (
         SELECT
           COALESCE(SUM(CASE WHEN ag.category = 'INCOME' THEN lp.credit - lp.debit ELSE 0 END), 0) AS income_ytd,
           COALESCE(SUM(CASE WHEN ag.category = 'EXPENSE' THEN lp.debit - lp.credit ELSE 0 END), 0) AS expense_ytd
         FROM ledger_postings lp
         JOIN accounts a ON a.id = lp.account_id
         JOIN account_groups ag ON ag.id = a.account_group_id
         WHERE lp.business_id = $1
           AND lp.posting_date BETWEEN $4::date AND $2::date
       )
       SELECT
         COALESCE(SUM(CASE WHEN category IN ('CURRENT_ASSET', 'FIXED_ASSET') THEN closing_signed ELSE 0 END), 0) AS assets,
         COALESCE(SUM(CASE WHEN category = 'LIABILITY' THEN ABS(closing_signed) ELSE 0 END), 0) AS liabilities,
         COALESCE(SUM(CASE WHEN category = 'EQUITY' THEN ABS(closing_signed) ELSE 0 END), 0) AS equity,
         COALESCE(SUM(CASE WHEN name ILIKE '%cash%' OR name ILIKE '%bank%' THEN closing_signed ELSE 0 END), 0) AS cash_bank,
         (SELECT income_mtd - expense_mtd FROM pnl) AS net_profit_mtd,
         (SELECT income_ytd - expense_ytd FROM pnl_ytd) AS net_profit_ytd,
         (SELECT COALESCE(SUM(total_value), 0) FROM inventory_transactions WHERE business_id = $1 AND transaction_date <= $2::date) AS total_inventory_value,
         (SELECT COUNT(*) FROM products WHERE business_id = $1 AND created_at <= $2::date) AS unique_item_count
       FROM balances`,
      [businessId, asOf, monthStart(asOf), fyStart(asOf)]
    );

    const alertsRes = await pool.query(
      `WITH draft_imbalance AS (
         SELECT COUNT(*)::int AS count
         FROM (
           SELECT v.id,
                  COALESCE(SUM(CASE WHEN vl.entry_type = 'DR' THEN vl.amount ELSE 0 END), 0) AS dr,
                  COALESCE(SUM(CASE WHEN vl.entry_type = 'CR' THEN vl.amount ELSE 0 END), 0) AS cr
           FROM vouchers v
           LEFT JOIN voucher_lines vl ON vl.voucher_id = v.id
           WHERE v.business_id = $1 AND v.status = 'DRAFT'
           GROUP BY v.id
           HAVING COALESCE(SUM(CASE WHEN vl.entry_type = 'DR' THEN vl.amount ELSE 0 END), 0)
                <> COALESCE(SUM(CASE WHEN vl.entry_type = 'CR' THEN vl.amount ELSE 0 END), 0)
         ) x
       ),
       negative_cash AS (
         SELECT COUNT(*)::int AS count
         FROM (
           SELECT
             a.id,
             (CASE WHEN a.opening_balance_type = 'DR' THEN a.opening_balance ELSE -a.opening_balance END)
             + COALESCE(SUM(lp.debit - lp.credit), 0) AS closing_signed
           FROM accounts a
           LEFT JOIN ledger_postings lp ON lp.account_id = a.id AND lp.business_id = a.business_id
           WHERE a.business_id = $1
             AND (a.name ILIKE '%cash%' OR a.name ILIKE '%bank%')
           GROUP BY a.id, a.opening_balance, a.opening_balance_type
           HAVING (CASE WHEN a.opening_balance_type = 'DR' THEN a.opening_balance ELSE -a.opening_balance END)
             + COALESCE(SUM(lp.debit - lp.credit), 0) < 0
         ) y
       ),
       missing_group AS (
         SELECT COUNT(*)::int AS count
         FROM accounts a
         LEFT JOIN account_groups ag ON ag.id = a.account_group_id
         WHERE a.business_id = $1 AND ag.id IS NULL
       )
       SELECT
         (SELECT count FROM draft_imbalance) AS unbalanced_drafts,
         (SELECT count FROM negative_cash) AS negative_cash_ledgers,
         (SELECT count FROM missing_group) AS missing_ledger_mappings`,
      [businessId]
    );

    const recentRes = await pool.query(
      `SELECT
         v.id,
         v.voucher_type AS "voucherType",
         v.voucher_number AS "voucherNumber",
         v.voucher_date AS "voucherDate",
         v.status,
         v.narration,
         COALESCE(SUM(vl.amount), 0) AS "grossAmount"
       FROM vouchers v
       LEFT JOIN voucher_lines vl ON vl.voucher_id = v.id
       WHERE v.business_id = $1
       GROUP BY v.id
       ORDER BY v.voucher_date DESC, v.created_at DESC
       LIMIT 10`,
      [businessId]
    );

    const kpi = kpiRes.rows[0] || {};
    const alerts = alertsRes.rows[0] || {};

    res.json({
      asOf,
      kpis: {
        totalAssets: Number(kpi.assets || 0),
        totalLiabilities: Number(kpi.liabilities || 0),
        equity: Number(kpi.equity || 0),
        netProfitMtd: Number(kpi.net_profit_mtd || 0),
        netProfitYtd: Number(kpi.net_profit_ytd || 0),
        cashBankBalance: Number(kpi.cash_bank || 0),
        totalStockValue: Number(kpi.total_inventory_value || 0),
        totalUniqueItems: Number(kpi.unique_item_count || 0)
      },
      alerts: {
        unbalancedDrafts: Number(alerts.unbalanced_drafts || 0),
        negativeCashLedgers: Number(alerts.negative_cash_ledgers || 0),
        missingLedgerMappings: Number(alerts.missing_ledger_mappings || 0)
      },
      recentVouchers: recentRes.rows.map((row) => ({
        ...row,
        grossAmount: Number(row.grossAmount || 0)
      }))
    });
  } catch (error) {
    next(error);
  }
});
