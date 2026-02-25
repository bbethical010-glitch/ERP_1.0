import { withTransaction } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';

function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw httpError(400, 'A voucher requires at least 2 entries');
  }

  const debit = entries
    .filter((entry) => entry.entryType === 'DR')
    .reduce((sum, entry) => sum + Number(entry.amount), 0);
  const credit = entries
    .filter((entry) => entry.entryType === 'CR')
    .reduce((sum, entry) => sum + Number(entry.amount), 0);

  if (Number(debit.toFixed(2)) !== Number(credit.toFixed(2))) {
    throw httpError(400, 'Voucher is not balanced (debit must equal credit)');
  }
}

async function assertAccountsBelongToBusiness(client, businessId, entries) {
  const accountIds = [...new Set(entries.map((line) => line.accountId))];
  const result = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM accounts
     WHERE business_id = $1
       AND id = ANY($2::uuid[])`,
    [businessId, accountIds]
  );

  if (result.rows[0].count !== accountIds.length) {
    throw httpError(400, 'One or more accounts do not belong to the business');
  }
}

async function insertEntries(client, transactionId, entries) {
  for (let i = 0; i < entries.length; i += 1) {
    const line = entries[i];
    await client.query(
      `INSERT INTO transaction_entries (transaction_id, line_no, account_id, entry_type, amount)
       VALUES ($1, $2, $3, $4, $5)`,
      [transactionId, i + 1, line.accountId, line.entryType, line.amount]
    );
  }
}

export async function createVoucher(payload) {
  validateEntries(payload.entries);

  return withTransaction(async (client) => {
    await assertAccountsBelongToBusiness(client, payload.businessId, payload.entries);

    const transactionRes = await client.query(
      `INSERT INTO transactions (business_id, txn_date, narration)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [payload.businessId, payload.voucherDate, payload.narration || null]
    );

    const transactionId = transactionRes.rows[0].id;

    await insertEntries(client, transactionId, payload.entries);

    const voucherRes = await client.query(
      `INSERT INTO vouchers (business_id, transaction_id, voucher_type, voucher_number, voucher_date, narration)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        payload.businessId,
        transactionId,
        payload.voucherType,
        payload.voucherNumber,
        payload.voucherDate,
        payload.narration || null
      ]
    );

    return {
      id: voucherRes.rows[0].id,
      transactionId
    };
  });
}

export async function getVoucherById(voucherId, businessId) {
  const result = await withTransaction(async (client) => {
    const voucherRes = await client.query(
      `SELECT v.id, v.voucher_type AS "voucherType", v.voucher_number AS "voucherNumber",
              v.voucher_date AS "voucherDate", v.narration,
              t.id AS "transactionId"
       FROM vouchers v
       JOIN transactions t ON t.id = v.transaction_id
       WHERE v.id = $1 AND v.business_id = $2`,
      [voucherId, businessId]
    );

    if (voucherRes.rows.length === 0) {
      throw httpError(404, 'Voucher not found');
    }

    const voucher = voucherRes.rows[0];
    const entriesRes = await client.query(
      `SELECT te.line_no AS "lineNo", te.account_id AS "accountId", te.entry_type AS "entryType", te.amount
       FROM transaction_entries te
       WHERE te.transaction_id = $1
       ORDER BY te.line_no`,
      [voucher.transactionId]
    );

    return { ...voucher, entries: entriesRes.rows };
  });

  return result;
}

export async function updateVoucher(voucherId, payload) {
  validateEntries(payload.entries);

  return withTransaction(async (client) => {
    const existingRes = await client.query(
      `SELECT v.id, v.transaction_id AS "transactionId"
       FROM vouchers v
       WHERE v.id = $1 AND v.business_id = $2`,
      [voucherId, payload.businessId]
    );

    if (existingRes.rows.length === 0) {
      throw httpError(404, 'Voucher not found');
    }

    await assertAccountsBelongToBusiness(client, payload.businessId, payload.entries);
    const transactionId = existingRes.rows[0].transactionId;

    await client.query(
      `UPDATE transactions
       SET txn_date = $1, narration = $2
       WHERE id = $3`,
      [payload.voucherDate, payload.narration || null, transactionId]
    );

    await client.query(
      `UPDATE vouchers
       SET voucher_type = $1, voucher_number = $2, voucher_date = $3, narration = $4
       WHERE id = $5`,
      [payload.voucherType, payload.voucherNumber, payload.voucherDate, payload.narration || null, voucherId]
    );

    await client.query(`DELETE FROM transaction_entries WHERE transaction_id = $1`, [transactionId]);
    await insertEntries(client, transactionId, payload.entries);

    return { id: voucherId, transactionId };
  });
}

export async function deleteVoucher(voucherId, businessId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `DELETE FROM vouchers
       WHERE id = $1 AND business_id = $2
       RETURNING transaction_id AS "transactionId"`,
      [voucherId, businessId]
    );

    if (result.rows.length === 0) {
      throw httpError(404, 'Voucher not found');
    }

    await client.query(`DELETE FROM transactions WHERE id = $1`, [result.rows[0].transactionId]);

    return { ok: true };
  });
}
