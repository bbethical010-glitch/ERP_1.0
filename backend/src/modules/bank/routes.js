import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';

export const bankRouter = Router();

function getBusinessId(req) {
  const businessId = req.user?.businessId;
  if (!businessId) {
    throw httpError(401, 'Business context missing in auth token');
  }
  return businessId;
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

const markSchema = z.object({
  postingIds: z.array(z.string().uuid()).min(1),
  reconciled: z.boolean().optional().default(true)
});

const importSchema = z.object({
  csv: z.string().min(1)
});

bankRouter.get('/accounts', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const asOf = req.query.asOf || new Date().toISOString().slice(0, 10);
    const rows = await pool.query(
      `SELECT
         a.id,
         a.code,
         a.name,
         ag.code AS "groupCode",
         COALESCE(SUM(CASE WHEN lp.posting_date <= $2::date THEN lp.debit - lp.credit ELSE 0 END), 0) AS "bookBalance",
         COALESCE(SUM(CASE WHEN lp.reconciled IS TRUE THEN lp.debit - lp.credit ELSE 0 END), 0) AS "reconciledMovement",
         COALESCE(SUM(CASE WHEN lp.reconciled IS FALSE THEN lp.debit - lp.credit ELSE 0 END), 0) AS "unreconciledMovement"
       FROM accounts a
       JOIN account_groups ag ON ag.id = a.account_group_id
       LEFT JOIN ledger_postings lp
         ON lp.account_id = a.id
        AND lp.business_id = a.business_id
       WHERE a.business_id = $1
         AND (
           ag.code ILIKE 'CA-BANK%'
           OR a.name ILIKE '%bank%'
         )
       GROUP BY a.id, a.code, a.name, ag.code
       ORDER BY a.name`,
      [businessId, asOf]
    );

    res.json({
      asOf,
      items: rows.rows.map((row) => ({
        ...row,
        bookBalance: Number(row.bookBalance || 0),
        reconciledMovement: Number(row.reconciledMovement || 0),
        unreconciledMovement: Number(row.unreconciledMovement || 0)
      }))
    });
  } catch (error) {
    next(error);
  }
});

bankRouter.get('/reconciliation', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const accountId = req.query.accountId;
    if (!accountId) {
      throw httpError(400, 'accountId is required');
    }

    const from = req.query.from || null;
    const to = req.query.to || new Date().toISOString().slice(0, 10);
    const includeReconciled = parseBoolean(req.query.includeReconciled, true);
    const statementBalance =
      req.query.statementBalance !== undefined ? Number(req.query.statementBalance) : null;
    if (statementBalance !== null && !Number.isFinite(statementBalance)) {
      throw httpError(400, 'Invalid statementBalance');
    }

    const accountRes = await pool.query(
      `SELECT id, name
       FROM accounts
       WHERE id = $1
         AND business_id = $2
       LIMIT 1`,
      [accountId, businessId]
    );
    if (accountRes.rows.length === 0) {
      throw httpError(404, 'Bank account not found');
    }

    const rows = await pool.query(
      `SELECT
         lp.id AS "postingId",
         lp.posting_date AS "postingDate",
         lp.debit,
         lp.credit,
         (lp.debit - lp.credit) AS "signedAmount",
         lp.reconciled,
         lp.reconciled_at AS "reconciledAt",
         lp.reconciled_by AS "reconciledBy",
         v.id AS "voucherId",
         v.voucher_type AS "voucherType",
         v.voucher_number AS "voucherNumber",
         v.narration
       FROM ledger_postings lp
       JOIN vouchers v ON v.id = lp.voucher_id
       WHERE lp.business_id = $1
         AND lp.account_id = $2
         AND ($3::date IS NULL OR lp.posting_date >= $3::date)
         AND ($4::date IS NULL OR lp.posting_date <= $4::date)
         AND ($5::boolean = TRUE OR lp.reconciled IS FALSE)
       ORDER BY lp.posting_date, lp.created_at, lp.id`,
      [businessId, accountId, from, to, includeReconciled]
    );

    let runningBook = 0;
    const items = rows.rows.map((row) => {
      const signedAmount = Number(row.signedAmount || 0);
      runningBook += signedAmount;
      return {
        ...row,
        debit: Number(row.debit || 0),
        credit: Number(row.credit || 0),
        signedAmount,
        runningBookBalance: Number(runningBook.toFixed(2))
      };
    });

    const totals = items.reduce(
      (acc, row) => {
        if (row.reconciled) {
          acc.reconciled += row.signedAmount;
        } else {
          acc.unreconciled += row.signedAmount;
        }
        return acc;
      },
      { reconciled: 0, unreconciled: 0 }
    );
    const bookBalance = Number((totals.reconciled + totals.unreconciled).toFixed(2));
    const bankBalance = statementBalance === null ? null : Number(statementBalance.toFixed(2));
    const difference = bankBalance === null ? null : Number((bookBalance - bankBalance).toFixed(2));

    res.json({
      account: accountRes.rows[0],
      filters: { from, to, includeReconciled },
      balances: {
        bookBalance,
        bankBalance,
        difference,
        reconciledMovement: Number(totals.reconciled.toFixed(2)),
        unreconciledMovement: Number(totals.unreconciled.toFixed(2))
      },
      items
    });
  } catch (error) {
    next(error);
  }
});

bankRouter.post('/reconciliation/mark', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const payload = markSchema.parse(req.body || {});
    const actorId = req.user?.sub || 'SYSTEM';
    const postingIds = [...new Set(payload.postingIds)];

    const result = await withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT id
         FROM ledger_postings
         WHERE business_id = $1
           AND id = ANY($2::uuid[])`,
        [businessId, postingIds]
      );
      if (existing.rows.length !== postingIds.length) {
        throw httpError(400, 'One or more postings do not belong to this business');
      }

      const updated = await client.query(
        `UPDATE ledger_postings
         SET reconciled = $1,
             reconciled_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
             reconciled_by = CASE WHEN $1 THEN $2 ELSE NULL END
         WHERE business_id = $3
           AND id = ANY($4::uuid[])
         RETURNING id`,
        [payload.reconciled, actorId, businessId, postingIds]
      );

      return {
        ok: true,
        updatedCount: updated.rows.length,
        reconciled: payload.reconciled
      };
    });

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid reconciliation payload', error.issues));
    }
    next(error);
  }
});

bankRouter.post('/reconciliation/import-csv', async (req, res, next) => {
  try {
    const _businessId = getBusinessId(req);
    const payload = importSchema.parse(req.body || {});

    const lines = payload.csv
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      throw httpError(400, 'CSV must include header and at least one row');
    }

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const rows = lines.slice(1).map((line) => {
      const cols = line.split(',').map((c) => c.trim());
      const item = {};
      headers.forEach((header, idx) => {
        item[header] = cols[idx] ?? null;
      });
      return item;
    });

    res.status(201).json({
      ok: true,
      parsedCount: rows.length,
      headers,
      preview: rows.slice(0, 20),
      note: 'CSV rows parsed. Matching and auto-reconciliation logic can be layered on top of this endpoint.'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid import payload', error.issues));
    }
    next(error);
  }
});
