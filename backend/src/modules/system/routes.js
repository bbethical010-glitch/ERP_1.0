import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';

export const systemRouter = Router();

function getBusinessId(req) {
  const businessId = req.user?.businessId;
  if (!businessId) {
    throw httpError(401, 'Business context missing in auth token');
  }
  return businessId;
}

systemRouter.get('/integrity-check', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);

    const base = await pool.query(
      `WITH tb AS (
         SELECT
           COALESCE(SUM(debit), 0) AS total_debit,
           COALESCE(SUM(credit), 0) AS total_credit
         FROM ledger_postings
         WHERE business_id = $1
       ),
       stock_ledger AS (
         SELECT COALESCE(SUM(lp.debit - lp.credit), 0) AS stock_value
         FROM ledger_postings lp
         JOIN accounts a ON a.id = lp.account_id
         LEFT JOIN account_groups ag ON ag.id = a.account_group_id
         WHERE lp.business_id = $1
           AND (LOWER(a.name) = 'stock-in-hand' OR ag.code = 'CA-STOCK')
       ),
       stock_inventory AS (
         SELECT COALESCE(SUM(total_value), 0) AS inventory_value
         FROM inventory_transactions
         WHERE business_id = $1
       ),
       outstandings AS (
         SELECT
           COALESCE(SUM(CASE WHEN voucher_type = 'SALES' AND status = 'OPEN' THEN outstanding_amount ELSE 0 END), 0) AS debtors,
           COALESCE(SUM(CASE WHEN voucher_type = 'PURCHASE' AND status = 'OPEN' THEN outstanding_amount ELSE 0 END), 0) AS creditors
         FROM voucher_outstandings
         WHERE business_id = $1
       )
       SELECT
         tb.total_debit AS "totalDebit",
         tb.total_credit AS "totalCredit",
         (tb.total_debit - tb.total_credit) AS "trialDiff",
         stock_ledger.stock_value AS "stockLedgerValue",
         stock_inventory.inventory_value AS "inventoryValue",
         (stock_inventory.inventory_value - stock_ledger.stock_value) AS "stockDiff",
         outstandings.debtors AS "debtorsOutstanding",
         outstandings.creditors AS "creditorsOutstanding"
       FROM tb, stock_ledger, stock_inventory, outstandings`,
      [businessId]
    );

    const negativePolicy = await pool.query(
      `SELECT allow_negative_stock AS "allowNegativeStock"
       FROM businesses
       WHERE id = $1
       LIMIT 1`,
      [businessId]
    );
    const allowNegativeStock = Boolean(negativePolicy.rows[0]?.allowNegativeStock);

    const voucherImbalances = await pool.query(
      `SELECT
         voucher_id AS "voucherId",
         COALESCE(SUM(debit), 0) AS debit,
         COALESCE(SUM(credit), 0) AS credit
       FROM ledger_postings
       WHERE business_id = $1
       GROUP BY voucher_id
       HAVING ABS(COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0)) > 0.01
       ORDER BY voucher_id
       LIMIT 100`,
      [businessId]
    );

    const stockMismatches = await pool.query(
      `WITH inv AS (
         SELECT voucher_id, COALESCE(SUM(total_value), 0) AS inventory_value
         FROM inventory_transactions
         WHERE business_id = $1
         GROUP BY voucher_id
       ),
       stock AS (
         SELECT
           lp.voucher_id,
           COALESCE(SUM(lp.debit - lp.credit), 0) AS stock_value
         FROM ledger_postings lp
         JOIN accounts a ON a.id = lp.account_id
         LEFT JOIN account_groups ag ON ag.id = a.account_group_id
         WHERE lp.business_id = $1
           AND (LOWER(a.name) = 'stock-in-hand' OR ag.code = 'CA-STOCK')
         GROUP BY lp.voucher_id
       )
       SELECT
         inv.voucher_id AS "voucherId",
         inv.inventory_value AS "inventoryValue",
         COALESCE(stock.stock_value, 0) AS "stockLedgerValue",
         (inv.inventory_value - COALESCE(stock.stock_value, 0)) AS diff
       FROM inv
       LEFT JOIN stock ON stock.voucher_id = inv.voucher_id
       WHERE ABS(inv.inventory_value - COALESCE(stock.stock_value, 0)) > 0.01
       ORDER BY ABS(inv.inventory_value - COALESCE(stock.stock_value, 0)) DESC
       LIMIT 100`,
      [businessId]
    );

    const orphanPostings = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM ledger_postings lp
       LEFT JOIN voucher_lines vl
         ON vl.voucher_id = lp.voucher_id
        AND vl.account_id = lp.account_id
        AND vl.entry_type = (CASE WHEN lp.debit > 0 THEN 'DR'::dr_cr ELSE 'CR'::dr_cr END)
        AND vl.amount = (CASE WHEN lp.debit > 0 THEN lp.debit ELSE lp.credit END)
       WHERE lp.business_id = $1
         AND vl.id IS NULL`,
      [businessId]
    );

    const negativeStock = allowNegativeStock
      ? { rows: [] }
      : await pool.query(
          `SELECT
             product_id AS "productId",
             COALESCE(SUM(quantity), 0) AS quantity
           FROM inventory_transactions
           WHERE business_id = $1
           GROUP BY product_id
           HAVING COALESCE(SUM(quantity), 0) < 0
           ORDER BY quantity ASC
           LIMIT 100`,
          [businessId]
        );

    const summary = base.rows[0] || {};
    const checks = {
      trialBalanceBalanced: Math.abs(Number(summary.trialDiff || 0)) <= 0.01,
      stockFinancialReconciled: Math.abs(Number(summary.stockDiff || 0)) <= 0.01,
      noVoucherImbalances: voucherImbalances.rows.length === 0,
      noOrphanLedgerPostings: Number(orphanPostings.rows[0]?.count || 0) === 0,
      noNegativeStockViolations: negativeStock.rows.length === 0
    };
    const ok = Object.values(checks).every(Boolean);

    res.json({
      ok,
      checks,
      summary: {
        totalDebit: Number(summary.totalDebit || 0),
        totalCredit: Number(summary.totalCredit || 0),
        trialDiff: Number(summary.trialDiff || 0),
        stockLedgerValue: Number(summary.stockLedgerValue || 0),
        inventoryValue: Number(summary.inventoryValue || 0),
        stockDiff: Number(summary.stockDiff || 0),
        debtorsOutstanding: Number(summary.debtorsOutstanding || 0),
        creditorsOutstanding: Number(summary.creditorsOutstanding || 0),
        allowNegativeStock
      },
      issues: {
        voucherImbalances: voucherImbalances.rows,
        stockMismatches: stockMismatches.rows,
        orphanLedgerPostings: Number(orphanPostings.rows[0]?.count || 0),
        negativeStockViolations: negativeStock.rows
      }
    });
  } catch (error) {
    next(error);
  }
});
