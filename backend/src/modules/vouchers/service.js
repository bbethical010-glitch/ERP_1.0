import { withTransaction } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';

const VOUCHER_PREFIX = {
  JOURNAL: 'JV',
  PAYMENT: 'PV',
  RECEIPT: 'RV',
  SALES: 'SV',
  PURCHASE: 'PUR',
  CONTRA: 'CV'
};

function ensureLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw httpError(400, 'Voucher requires at least two lines');
  }

  for (const line of lines) {
    const amount = Number(line.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw httpError(400, 'Voucher lines must have positive amount');
    }
    if (!line.accountId || !line.entryType) {
      throw httpError(400, 'Voucher lines require account and entry type');
    }
  }
}

function computeTotals(lines) {
  const debit = lines
    .filter((line) => line.entryType === 'DR')
    .reduce((sum, line) => sum + Number(line.amount), 0);
  const credit = lines
    .filter((line) => line.entryType === 'CR')
    .reduce((sum, line) => sum + Number(line.amount), 0);
  const difference = Number((debit - credit).toFixed(2));
  return { debit, credit, difference, isBalanced: difference === 0 };
}

async function assertAccountsBelongToBusiness(client, businessId, lines) {
  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const result = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM accounts
     WHERE business_id = $1
       AND id = ANY($2::uuid[])`,
    [businessId, accountIds]
  );

  if (result.rows[0].count !== accountIds.length) {
    throw httpError(400, 'One or more accounts do not belong to this business');
  }
}

function toDateParts(voucherDate) {
  const [year, month] = voucherDate.split('-').map(Number);
  if (!year || !month) {
    throw httpError(400, 'Invalid voucherDate');
  }
  return { year, month };
}

function getFinancialYearRange(voucherDate) {
  const { year, month } = toDateParts(voucherDate);
  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;
  return {
    label: `${startYear}-${String(endYear).slice(2)}`,
    startDate: `${startYear}-04-01`,
    endDate: `${endYear}-03-31`
  };
}

async function getOrCreateFinancialYear(client, businessId, voucherDate) {
  const range = getFinancialYearRange(voucherDate);
  const existing = await client.query(
    `SELECT id, is_closed AS "isClosed"
     FROM financial_years
     WHERE business_id = $1
       AND start_date <= $2::date
       AND end_date >= $2::date
     LIMIT 1`,
    [businessId, voucherDate]
  );

  if (existing.rows[0]) {
    if (existing.rows[0].isClosed) {
      throw httpError(409, 'Financial year is closed for this posting date');
    }
    return existing.rows[0].id;
  }

  const inserted = await client.query(
    `INSERT INTO financial_years (business_id, label, start_date, end_date, is_closed)
     VALUES ($1, $2, $3::date, $4::date, FALSE)
     RETURNING id`,
    [businessId, range.label, range.startDate, range.endDate]
  );

  return inserted.rows[0].id;
}

async function generateVoucherNumber(client, businessId, voucherType, voucherDate) {
  const { label } = getFinancialYearRange(voucherDate);
  const start = `${label.slice(0, 4)}-04-01`;
  const end = `${Number(label.slice(0, 4)) + 1}-03-31`;

  const result = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM vouchers
     WHERE business_id = $1
       AND voucher_type = $2
       AND voucher_date BETWEEN $3::date AND $4::date`,
    [businessId, voucherType, start, end]
  );

  const next = result.rows[0].count + 1;
  const prefix = VOUCHER_PREFIX[voucherType] || 'VCH';
  return `${prefix}-${String(next).padStart(4, '0')}`;
}

async function insertVoucherLines(client, voucherId, lines) {
  await client.query(`DELETE FROM voucher_lines WHERE voucher_id = $1`, [voucherId]);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    await client.query(
      `INSERT INTO voucher_lines (voucher_id, line_no, account_id, entry_type, amount)
       VALUES ($1, $2, $3, $4, $5)`,
      [voucherId, i + 1, line.accountId, line.entryType, Number(line.amount)]
    );
  }
}

async function readVoucherLines(client, voucherId, transactionId) {
  const fromVoucher = await client.query(
    `SELECT line_no AS "lineNo", account_id AS "accountId", entry_type AS "entryType", amount
     FROM voucher_lines
     WHERE voucher_id = $1
     ORDER BY line_no`,
    [voucherId]
  );

  if (fromVoucher.rows.length > 0) {
    return fromVoucher.rows;
  }

  if (!transactionId) return [];

  const legacy = await client.query(
    `SELECT line_no AS "lineNo", account_id AS "accountId", entry_type AS "entryType", amount
     FROM transaction_entries
     WHERE transaction_id = $1
     ORDER BY line_no`,
    [transactionId]
  );
  return legacy.rows;
}

async function insertAuditLog(client, params) {
  await client.query(
    `INSERT INTO audit_logs (business_id, actor_id, action, entity_type, entity_id, before_json, after_json, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)`,
    [
      params.businessId,
      params.actorId || 'SYSTEM',
      params.action,
      params.entityType,
      params.entityId,
      params.beforeJson ? JSON.stringify(params.beforeJson) : null,
      params.afterJson ? JSON.stringify(params.afterJson) : null,
      params.metadata ? JSON.stringify(params.metadata) : null
    ]
  );
}

async function postDraftInternal(client, voucherId, actorId, forcedVoucherNumber = null) {
  const voucherRes = await client.query(
    `SELECT id, business_id AS "businessId", voucher_type AS "voucherType", voucher_number AS "voucherNumber",
            voucher_date AS "voucherDate", narration, status, transaction_id AS "transactionId"
     FROM vouchers
     WHERE id = $1
     FOR UPDATE`,
    [voucherId]
  );

  if (voucherRes.rows.length === 0) {
    throw httpError(404, 'Voucher not found');
  }

  const voucher = voucherRes.rows[0];
  if (voucher.status === 'POSTED' || voucher.status === 'REVERSED') {
    throw httpError(409, 'Voucher is already posted');
  }

  if (voucher.status === 'CANCELLED') {
    throw httpError(409, 'Cancelled voucher cannot be posted');
  }

  const lines = await readVoucherLines(client, voucher.id, voucher.transactionId);
  ensureLines(lines);
  await assertAccountsBelongToBusiness(client, voucher.businessId, lines);

  const totals = computeTotals(lines);
  if (!totals.isBalanced) {
    throw httpError(400, `Cannot post unbalanced voucher. Difference: ${totals.difference}`);
  }

  const financialYearId = await getOrCreateFinancialYear(client, voucher.businessId, voucher.voucherDate);

  const txnRes = await client.query(
    `INSERT INTO transactions (business_id, txn_date, narration)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [voucher.businessId, voucher.voucherDate, voucher.narration || null]
  );
  const transactionId = txnRes.rows[0].id;

  for (const line of lines) {
    await client.query(
      `INSERT INTO transaction_entries (transaction_id, line_no, account_id, entry_type, amount)
       VALUES ($1, $2, $3, $4, $5)`,
      [transactionId, line.lineNo, line.accountId, line.entryType, line.amount]
    );
  }

  for (const line of lines) {
    const debit = line.entryType === 'DR' ? Number(line.amount) : 0;
    const credit = line.entryType === 'CR' ? Number(line.amount) : 0;
    await client.query(
      `INSERT INTO ledger_postings (
         business_id, financial_year_id, voucher_id, transaction_id, account_id, posting_date, debit, credit
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [voucher.businessId, financialYearId, voucher.id, transactionId, line.accountId, voucher.voucherDate, debit, credit]
    );
  }

  const voucherNumber =
    forcedVoucherNumber ||
    voucher.voucherNumber ||
    (await generateVoucherNumber(client, voucher.businessId, voucher.voucherType, voucher.voucherDate));

  await client.query(
    `UPDATE vouchers
     SET transaction_id = $1,
         voucher_number = $2,
         status = 'POSTED',
         posted_at = NOW(),
         posted_by = $3
     WHERE id = $4`,
    [transactionId, voucherNumber, actorId || 'SYSTEM', voucher.id]
  );

  await insertAuditLog(client, {
    businessId: voucher.businessId,
    actorId,
    action: 'VOUCHER_POSTED',
    entityType: 'voucher',
    entityId: voucher.id,
    afterJson: { voucherNumber, totals }
  });

  return { voucherId: voucher.id, transactionId, voucherNumber, totals };
}

export async function createVoucher(payload) {
  return withTransaction(async (client) => {
    ensureLines(payload.entries);
    await assertAccountsBelongToBusiness(client, payload.businessId, payload.entries);

    const mode = payload.mode === 'DRAFT' ? 'DRAFT' : 'POST';
    const initialStatus = mode === 'DRAFT' ? 'DRAFT' : 'DRAFT';
    const voucherNumber =
      payload.voucherNumber ||
      (mode === 'POST'
        ? await generateVoucherNumber(client, payload.businessId, payload.voucherType, payload.voucherDate)
        : `TMP-${Date.now()}`);

    const voucherRes = await client.query(
      `INSERT INTO vouchers (
         business_id, voucher_type, voucher_number, voucher_date, narration, status
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [payload.businessId, payload.voucherType, voucherNumber, payload.voucherDate, payload.narration || null, initialStatus]
    );

    const voucherId = voucherRes.rows[0].id;
    await insertVoucherLines(client, voucherId, payload.entries);

    await insertAuditLog(client, {
      businessId: payload.businessId,
      actorId: payload.actorId,
      action: mode === 'DRAFT' ? 'VOUCHER_DRAFT_CREATED' : 'VOUCHER_CREATED',
      entityType: 'voucher',
      entityId: voucherId,
      afterJson: {
        voucherType: payload.voucherType,
        voucherNumber,
        voucherDate: payload.voucherDate,
        narration: payload.narration,
        mode,
        totals: computeTotals(payload.entries)
      }
    });

    if (mode === 'DRAFT') {
      return { id: voucherId, status: 'DRAFT', voucherNumber };
    }

    const posted = await postDraftInternal(client, voucherId, payload.actorId, voucherNumber);
    return { id: voucherId, status: 'POSTED', ...posted };
  });
}

export async function listVouchers(params) {
  const limit = Math.min(Math.max(Number(params.limit || 20), 1), 100);
  const offset = Math.max(Number(params.offset || 0), 0);

  const result = await withTransaction(async (client) => {
    const rows = await client.query(
      `SELECT v.id,
              v.voucher_type AS "voucherType",
              v.voucher_number AS "voucherNumber",
              v.voucher_date AS "voucherDate",
              v.narration,
              v.status,
              v.is_reversed AS "isReversed",
              v.reversed_by_voucher_id AS "reversedByVoucherId",
              v.reversed_from_voucher_id AS "reversedFromVoucherId",
              COALESCE(SUM(vl.amount), 0) AS "grossAmount"
       FROM vouchers v
       LEFT JOIN voucher_lines vl ON vl.voucher_id = v.id
       WHERE v.business_id = $1
         AND ($2::date IS NULL OR v.voucher_date >= $2::date)
         AND ($3::date IS NULL OR v.voucher_date <= $3::date)
         AND ($4::text IS NULL OR v.voucher_type = $4::voucher_type)
         AND ($5::text IS NULL OR v.status = $5::voucher_status)
         AND (
           $6::text IS NULL OR
           v.voucher_number ILIKE '%' || $6 || '%' OR
           COALESCE(v.narration, '') ILIKE '%' || $6 || '%'
         )
       GROUP BY v.id
       ORDER BY v.voucher_date DESC, v.created_at DESC
       LIMIT $7 OFFSET $8`,
      [
        params.businessId,
        params.from || null,
        params.to || null,
        params.voucherType || null,
        params.status || null,
        params.search || null,
        limit,
        offset
      ]
    );

    const count = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM vouchers v
       WHERE v.business_id = $1
         AND ($2::date IS NULL OR v.voucher_date >= $2::date)
         AND ($3::date IS NULL OR v.voucher_date <= $3::date)
         AND ($4::text IS NULL OR v.voucher_type = $4::voucher_type)
         AND ($5::text IS NULL OR v.status = $5::voucher_status)
         AND (
           $6::text IS NULL OR
           v.voucher_number ILIKE '%' || $6 || '%' OR
           COALESCE(v.narration, '') ILIKE '%' || $6 || '%'
         )`,
      [
        params.businessId,
        params.from || null,
        params.to || null,
        params.voucherType || null,
        params.status || null,
        params.search || null
      ]
    );

    return {
      items: rows.rows,
      page: {
        limit,
        offset,
        total: count.rows[0].count
      }
    };
  });

  return result;
}

export async function getVoucherById(voucherId, businessId) {
  return withTransaction(async (client) => {
    const voucherRes = await client.query(
      `SELECT v.id, v.business_id AS "businessId", v.voucher_type AS "voucherType", v.voucher_number AS "voucherNumber",
              v.voucher_date AS "voucherDate", v.narration, v.status,
              v.is_reversed AS "isReversed",
              v.reversed_by_voucher_id AS "reversedByVoucherId",
              v.reversed_from_voucher_id AS "reversedFromVoucherId",
              v.transaction_id AS "transactionId"
       FROM vouchers v
       WHERE v.id = $1 AND v.business_id = $2`,
      [voucherId, businessId]
    );

    if (voucherRes.rows.length === 0) {
      throw httpError(404, 'Voucher not found');
    }

    const voucher = voucherRes.rows[0];
    const entries = await readVoucherLines(client, voucher.id, voucher.transactionId);
    const totals = computeTotals(entries);

    return { ...voucher, entries, totals };
  });
}

export async function postVoucher(voucherId, payload) {
  return withTransaction(async (client) => {
    if (Array.isArray(payload.entries) && payload.entries.length > 0) {
      ensureLines(payload.entries);
      await assertAccountsBelongToBusiness(client, payload.businessId, payload.entries);

      const draftRes = await client.query(
        `SELECT id, status
         FROM vouchers
         WHERE id = $1 AND business_id = $2
         FOR UPDATE`,
        [voucherId, payload.businessId]
      );

      if (draftRes.rows.length === 0) {
        throw httpError(404, 'Voucher not found');
      }

      if (draftRes.rows[0].status !== 'DRAFT') {
        throw httpError(409, 'Only draft vouchers can be modified before posting');
      }

      await client.query(
        `UPDATE vouchers
         SET voucher_type = COALESCE($1::voucher_type, voucher_type),
             voucher_number = COALESCE($2, voucher_number),
             voucher_date = COALESCE($3::date, voucher_date),
             narration = COALESCE($4, narration)
         WHERE id = $5`,
        [
          payload.voucherType || null,
          payload.voucherNumber || null,
          payload.voucherDate || null,
          payload.narration || null,
          voucherId
        ]
      );

      await insertVoucherLines(client, voucherId, payload.entries);
    }

    const result = await postDraftInternal(client, voucherId, payload.actorId);
    return { id: voucherId, status: 'POSTED', ...result };
  });
}

export async function cancelVoucher(voucherId, payload) {
  return withTransaction(async (client) => {
    const voucherRes = await client.query(
      `SELECT id, business_id AS "businessId", status
       FROM vouchers
       WHERE id = $1 AND business_id = $2
       FOR UPDATE`,
      [voucherId, payload.businessId]
    );

    if (voucherRes.rows.length === 0) {
      throw httpError(404, 'Voucher not found');
    }

    const voucher = voucherRes.rows[0];
    if (voucher.status !== 'DRAFT') {
      throw httpError(409, 'Only draft vouchers can be cancelled');
    }

    await client.query(
      `UPDATE vouchers
       SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_by = $1
       WHERE id = $2`,
      [payload.actorId || 'SYSTEM', voucherId]
    );

    await insertAuditLog(client, {
      businessId: voucher.businessId,
      actorId: payload.actorId,
      action: 'VOUCHER_CANCELLED',
      entityType: 'voucher',
      entityId: voucherId
    });

    return { id: voucherId, status: 'CANCELLED' };
  });
}

export async function updateVoucher() {
  throw httpError(405, 'Voucher update is disabled. Use draft workflows and posting/reversal.');
}

export async function deleteVoucher() {
  throw httpError(405, 'Voucher delete is disabled. Use cancel/reversal workflows.');
}

export async function reverseVoucher(voucherId, payload) {
  return withTransaction(async (client) => {
    const originalRes = await client.query(
      `SELECT id, business_id AS "businessId", voucher_type AS "voucherType", voucher_number AS "voucherNumber",
              voucher_date AS "voucherDate", narration, status, is_reversed AS "isReversed"
       FROM vouchers
       WHERE id = $1 AND business_id = $2
       FOR UPDATE`,
      [voucherId, payload.businessId]
    );

    if (originalRes.rows.length === 0) {
      throw httpError(404, 'Voucher not found');
    }

    const original = originalRes.rows[0];

    if (original.status !== 'POSTED') {
      throw httpError(409, 'Only posted vouchers can be reversed');
    }

    if (original.isReversed) {
      throw httpError(409, 'Voucher already reversed');
    }

    const originalLines = await readVoucherLines(client, voucherId, null);
    const reversedLines = originalLines.map((line) => ({
      accountId: line.accountId,
      entryType: line.entryType === 'DR' ? 'CR' : 'DR',
      amount: Number(line.amount)
    }));

    await assertAccountsBelongToBusiness(client, payload.businessId, reversedLines);

    const reversalDate = payload.reversalDate || new Date().toISOString().slice(0, 10);
    const reversalNumber =
      payload.reversalVoucherNumber ||
      (await generateVoucherNumber(client, payload.businessId, original.voucherType, reversalDate));

    const reversalVoucherRes = await client.query(
      `INSERT INTO vouchers (
         business_id,
         voucher_type,
         voucher_number,
         voucher_date,
         narration,
         status,
         reversed_from_voucher_id,
         is_system_generated
       ) VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6, TRUE)
       RETURNING id`,
      [
        payload.businessId,
        original.voucherType,
        reversalNumber,
        reversalDate,
        payload.narration || `Reversal of ${original.voucherType} ${original.voucherNumber}`,
        voucherId
      ]
    );

    const reversalVoucherId = reversalVoucherRes.rows[0].id;
    await insertVoucherLines(client, reversalVoucherId, reversedLines);
    await postDraftInternal(client, reversalVoucherId, payload.actorId, reversalNumber);

    await client.query(
      `UPDATE vouchers
       SET status = 'REVERSED',
           is_reversed = TRUE,
           reversed_by_voucher_id = $1
       WHERE id = $2`,
      [reversalVoucherId, voucherId]
    );

    await insertAuditLog(client, {
      businessId: payload.businessId,
      actorId: payload.actorId,
      action: 'VOUCHER_REVERSED',
      entityType: 'voucher',
      entityId: voucherId,
      afterJson: {
        reversalVoucherId,
        reversalVoucherNumber: reversalNumber,
        reversalDate
      }
    });

    return {
      originalVoucherId: voucherId,
      reversalVoucherId
    };
  });
}
