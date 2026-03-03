import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';

export const financialYearsRouter = Router();

const closeSchema = z.object({
  closeDate: z.string().date().optional(),
  retainedEarningsAccountId: z.string().uuid().optional(),
  actorId: z.string().optional()
});

function getBusinessId(req) {
  const businessId = req.user?.businessId;
  if (!businessId) {
    throw httpError(401, 'Business context missing in auth token');
  }
  return businessId;
}

function normalizeIsoDate(dateValue, fieldName = 'date') {
  const toLocalIso = (value) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  if (typeof dateValue === 'string') {
    const trimmed = dateValue.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return toLocalIso(parsed);
    }
  } else if (dateValue instanceof Date) {
    if (!Number.isNaN(dateValue.getTime())) {
      return toLocalIso(dateValue);
    }
  }
  throw httpError(400, `Invalid ${fieldName}`);
}

async function ensureAccountByName(client, businessId, { name, groupCode, normalBalance, code }) {
  const existing = await client.query(
    `SELECT id
     FROM accounts
     WHERE business_id = $1
       AND LOWER(name) = LOWER($2)
     LIMIT 1`,
    [businessId, name]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const group = await client.query(
    `SELECT id FROM account_groups WHERE business_id = $1 AND code = $2 LIMIT 1`,
    [businessId, groupCode]
  );
  if (!group.rows[0]) {
    throw httpError(400, `Required account group not found: ${groupCode}`);
  }

  const inserted = await client.query(
    `INSERT INTO accounts (business_id, account_group_id, code, name, normal_balance, is_system)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     RETURNING id`,
    [businessId, group.rows[0].id, code, name, normalBalance]
  );
  return inserted.rows[0].id;
}

async function getDrawingsBalance(client, businessId, closeDate) {
  const res = await client.query(
    `SELECT
       a.id,
       a.name,
       COALESCE(SUM(lp.debit - lp.credit), 0) AS signed_balance
     FROM accounts a
     JOIN account_groups ag ON ag.id = a.account_group_id
     LEFT JOIN ledger_postings lp
       ON lp.account_id = a.id
      AND lp.business_id = a.business_id
      AND lp.posting_date <= $2::date
     WHERE a.business_id = $1
       AND ag.category = 'EQUITY'
       AND LOWER(a.name) LIKE '%drawings%'
     GROUP BY a.id, a.name`,
    [businessId, closeDate]
  );

  return res.rows
    .map((row) => ({ accountId: row.id, amount: Number(row.signed_balance || 0) }))
    .filter((row) => row.amount > 0.0001);
}

financialYearsRouter.post('/:financialYearId/close', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const payload = closeSchema.parse(req.body || {});
    const actorId = payload.actorId || req.user?.sub || 'SYSTEM';

    const result = await withTransaction(async (client) => {
      const fyRes = await client.query(
        `SELECT id, label, start_date AS "startDate", end_date AS "endDate", is_closed AS "isClosed"
         FROM financial_years
         WHERE id = $1
           AND business_id = $2
         FOR UPDATE`,
        [req.params.financialYearId, businessId]
      );

      if (fyRes.rows.length === 0) {
        throw httpError(404, 'Financial year not found');
      }
      const fy = fyRes.rows[0];
      if (fy.isClosed) {
        throw httpError(409, 'Financial year is already closed');
      }

      const startDate = normalizeIsoDate(fy.startDate, 'startDate');
      const endDate = normalizeIsoDate(fy.endDate, 'endDate');
      const closeDate = payload.closeDate ? normalizeIsoDate(payload.closeDate, 'closeDate') : endDate;
      if (closeDate < startDate || closeDate > endDate) {
        throw httpError(400, 'closeDate must be within the financial year range');
      }

      const retainedEarningsAccountId =
        payload.retainedEarningsAccountId ||
        (await ensureAccountByName(client, businessId, {
          name: 'Retained Earnings',
          groupCode: 'EQ',
          normalBalance: 'CR',
          code: 'RETAINED-EARN'
        }));

      const yearCloseOffsetAccountId = await ensureAccountByName(client, businessId, {
        name: 'Year End Closing',
        groupCode: 'IN',
        normalBalance: 'CR',
        code: 'YEAR-END-CLOSE'
      });

      const pnlRes = await client.query(
        `SELECT
           COALESCE(SUM(CASE WHEN ag.category = 'INCOME' THEN lp.credit - lp.debit ELSE 0 END), 0) AS income,
           COALESCE(SUM(CASE WHEN ag.category = 'EXPENSE' THEN lp.debit - lp.credit ELSE 0 END), 0) AS expense
         FROM ledger_postings lp
         JOIN accounts a ON a.id = lp.account_id
         JOIN account_groups ag ON ag.id = a.account_group_id
         WHERE lp.business_id = $1
           AND lp.financial_year_id = $2
           AND lp.posting_date BETWEEN $3::date AND $4::date
           AND a.name <> 'Year End Closing'`,
        [businessId, fy.id, startDate, closeDate]
      );
      const netProfit = Number(pnlRes.rows[0].income || 0) - Number(pnlRes.rows[0].expense || 0);

      const drawings = await getDrawingsBalance(client, businessId, closeDate);
      const drawingsTotal = Number(drawings.reduce((sum, line) => sum + line.amount, 0).toFixed(2));

      let closingVoucherId = null;
      if (Math.abs(netProfit) > 0.0001 || drawingsTotal > 0) {
        const txnRes = await client.query(
          `INSERT INTO transactions (business_id, txn_date, narration)
           VALUES ($1, $2::date, $3)
           RETURNING id`,
          [businessId, closeDate, `FY closing transfer ${fy.label}`]
        );
        const transactionId = txnRes.rows[0].id;

        const voucherNumber = `CLS-${fy.label.replace(/[^0-9]/g, '')}`;
        const voucherRes = await client.query(
          `INSERT INTO vouchers (
             business_id, transaction_id, voucher_type, voucher_number, voucher_date,
             narration, status, posted_at, posted_by, is_system_generated
           ) VALUES ($1, $2, 'JOURNAL', $3, $4::date, $5, 'POSTED', NOW(), $6, TRUE)
           RETURNING id`,
          [businessId, transactionId, voucherNumber, closeDate, `Financial year closing ${fy.label}`, actorId]
        );
        closingVoucherId = voucherRes.rows[0].id;

        const lines = [];
        if (Math.abs(netProfit) > 0.0001) {
          const amount = Number(Math.abs(netProfit).toFixed(2));
          if (netProfit > 0) {
            lines.push({ accountId: yearCloseOffsetAccountId, entryType: 'DR', amount });
            lines.push({ accountId: retainedEarningsAccountId, entryType: 'CR', amount });
          } else {
            lines.push({ accountId: retainedEarningsAccountId, entryType: 'DR', amount });
            lines.push({ accountId: yearCloseOffsetAccountId, entryType: 'CR', amount });
          }
        }

        for (const drawing of drawings) {
          const amount = Number(drawing.amount.toFixed(2));
          if (amount <= 0) continue;
          // Transfer drawings to retained earnings: DR Retained Earnings, CR Drawings
          lines.push({ accountId: retainedEarningsAccountId, entryType: 'DR', amount });
          lines.push({ accountId: drawing.accountId, entryType: 'CR', amount });
        }

        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          await client.query(
            `INSERT INTO transaction_entries (transaction_id, line_no, account_id, entry_type, amount)
             VALUES ($1, $2, $3, $4, $5)`,
            [transactionId, i + 1, line.accountId, line.entryType, line.amount]
          );
          await client.query(
            `INSERT INTO voucher_lines (voucher_id, line_no, account_id, entry_type, amount)
             VALUES ($1, $2, $3, $4, $5)`,
            [closingVoucherId, i + 1, line.accountId, line.entryType, line.amount]
          );
          await client.query(
            `INSERT INTO ledger_postings (business_id, financial_year_id, voucher_id, transaction_id, account_id, posting_date, debit, credit)
             VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8)`,
            [
              businessId,
              fy.id,
              closingVoucherId,
              transactionId,
              line.accountId,
              closeDate,
              line.entryType === 'DR' ? line.amount : 0,
              line.entryType === 'CR' ? line.amount : 0
            ]
          );
        }
      }

      await client.query(
        `UPDATE financial_years
         SET is_closed = TRUE,
             closed_at = NOW(),
             closed_by = $1,
             closing_voucher_id = $2
         WHERE id = $3`,
        [actorId, closingVoucherId, fy.id]
      );

      return {
        ok: true,
        financialYearId: fy.id,
        label: fy.label,
        closeDate,
        netProfit: Number(netProfit.toFixed(2)),
        drawingsTransferred: drawingsTotal,
        closingVoucherId
      };
    });

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid financial year close payload', error.issues));
    }
    next(error);
  }
});
