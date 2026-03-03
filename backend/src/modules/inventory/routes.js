import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';

export const inventoryRouter = Router();

function getBusinessId(req) {
  const businessId = req.user?.businessId;
  if (!businessId) {
    throw httpError(401, 'Business context missing in auth token');
  }
  return businessId;
}

function normalizeIsoDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const parsed = new Date(value || Date.now());
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function getFinancialYearRange(dateIso) {
  const [year, month] = String(dateIso || '').slice(0, 10).split('-').map(Number);
  if (!year || !month) {
    throw httpError(400, 'Invalid date');
  }
  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;
  return {
    label: `${startYear}-${String(endYear).slice(2)}`,
    startDate: `${startYear}-04-01`,
    endDate: `${endYear}-03-31`
  };
}

async function getOrCreateFinancialYear(client, businessId, postingDate) {
  const existing = await client.query(
    `SELECT id, is_closed AS "isClosed"
     FROM financial_years
     WHERE business_id = $1
       AND start_date <= $2::date
       AND end_date >= $2::date
     LIMIT 1`,
    [businessId, postingDate]
  );

  if (existing.rows[0]) {
    if (existing.rows[0].isClosed) {
      throw httpError(409, 'Financial year is closed for this posting date');
    }
    return existing.rows[0].id;
  }

  const fy = getFinancialYearRange(postingDate);
  const inserted = await client.query(
    `INSERT INTO financial_years (business_id, label, start_date, end_date, is_closed)
     VALUES ($1, $2, $3::date, $4::date, FALSE)
     RETURNING id`,
    [businessId, fy.label, fy.startDate, fy.endDate]
  );
  return inserted.rows[0].id;
}

async function ensureStockAndAdjustmentAccounts(client, businessId) {
  const stockAcc = await client.query(
    `SELECT a.id
     FROM accounts a
     WHERE a.business_id = $1 AND a.name = 'Stock-in-Hand'
     LIMIT 1`,
    [businessId]
  );
  let stockAccountId = stockAcc.rows[0]?.id;
  if (!stockAccountId) {
    const groupRes = await client.query(
      `SELECT id FROM account_groups WHERE business_id = $1 AND code IN ('CA', 'CA-STOCK') ORDER BY code = 'CA-STOCK' DESC LIMIT 1`,
      [businessId]
    );
    if (!groupRes.rows[0]) {
      throw httpError(400, 'Stock group not configured for this business');
    }
    const inserted = await client.query(
      `INSERT INTO accounts (business_id, account_group_id, code, name, normal_balance, is_system)
       VALUES ($1, $2, $3, 'Stock-in-Hand', 'DR', TRUE)
       ON CONFLICT (business_id, name)
       DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [businessId, groupRes.rows[0].id, 'STOCK-IN-HAND']
    );
    stockAccountId = inserted.rows[0].id;
  }

  const adjAcc = await client.query(
    `SELECT a.id
     FROM accounts a
     WHERE a.business_id = $1 AND a.name = 'Stock Adjustment'
     LIMIT 1`,
    [businessId]
  );
  let adjustmentAccountId = adjAcc.rows[0]?.id;
  if (!adjustmentAccountId) {
    const groupRes = await client.query(
      `SELECT id FROM account_groups WHERE business_id = $1 AND code IN ('EX', 'EX-IND') ORDER BY code = 'EX' DESC LIMIT 1`,
      [businessId]
    );
    if (!groupRes.rows[0]) {
      throw httpError(400, 'Expense group not configured for this business');
    }
    const inserted = await client.query(
      `INSERT INTO accounts (business_id, account_group_id, code, name, normal_balance, is_system)
       VALUES ($1, $2, $3, 'Stock Adjustment', 'DR', TRUE)
       ON CONFLICT (business_id, name)
       DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [businessId, groupRes.rows[0].id, 'STOCK-ADJ']
    );
    adjustmentAccountId = inserted.rows[0].id;
  }

  return { stockAccountId, adjustmentAccountId };
}

inventoryRouter.get('/summary', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const asOf = normalizeIsoDate(req.query.asOf);

    const rows = await pool.query(
      `SELECT
         p.id AS "productId",
         p.name,
         p.sku,
         p.reorder_level AS "reorderLevel",
         COALESCE(SUM(it.quantity), 0) AS quantity,
         COALESCE(SUM(it.total_value), 0) AS value,
         CASE
           WHEN COALESCE(SUM(it.quantity), 0) = 0 THEN 0
           ELSE COALESCE(SUM(it.total_value), 0) / COALESCE(SUM(it.quantity), 0)
         END AS "avgUnitCost"
       FROM inventory_transactions it
       JOIN products p ON p.id = it.product_id
       WHERE it.business_id = $1
         AND it.transaction_date <= $2::date
       GROUP BY p.id, p.name, p.sku
       ORDER BY p.name`,
      [businessId, asOf]
    );

    const items = rows.rows.map((row) => ({
      ...row,
      quantity: Number(row.quantity || 0),
      value: Number(row.value || 0),
      avgUnitCost: Number(Number(row.avgUnitCost || 0).toFixed(2)),
      reorderLevel: Number(row.reorderLevel || 0),
      lowStock: Number(row.quantity || 0) <= Number(row.reorderLevel || 0)
    }));

    const totals = items.reduce(
      (acc, item) => {
        acc.totalQuantity += item.quantity;
        acc.totalValue += item.value;
        return acc;
      },
      { totalQuantity: 0, totalValue: 0 }
    );

    res.json({
      asOf,
      totals: {
        totalQuantity: Number(totals.totalQuantity.toFixed(2)),
        totalValue: Number(totals.totalValue.toFixed(2)),
        uniqueItems: items.length,
        lowStockItems: items.filter((item) => item.lowStock).length
      },
      items
    });
  } catch (error) {
    next(error);
  }
});

inventoryRouter.get('/stock-ledger/:productId', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const productId = req.params.productId;
    const from = req.query.from || null;
    const to = req.query.to || null;

    const rows = await pool.query(
      `WITH tx AS (
         SELECT
           it.id,
           it.transaction_date,
           it.quantity,
           it.unit_cost,
           it.total_value,
           v.id AS voucher_id,
           v.voucher_type,
           v.voucher_number
         FROM inventory_transactions it
         LEFT JOIN vouchers v ON v.id = it.voucher_id
         WHERE it.business_id = $1
           AND it.product_id = $2
           AND ($3::date IS NULL OR it.transaction_date >= $3::date)
           AND ($4::date IS NULL OR it.transaction_date <= $4::date)
       )
       SELECT
         id,
         transaction_date AS "date",
         voucher_id AS "voucherId",
         voucher_type AS "voucherType",
         voucher_number AS "voucherNumber",
         CASE WHEN quantity > 0 THEN quantity ELSE 0 END AS "inwardQty",
         CASE WHEN quantity < 0 THEN ABS(quantity) ELSE 0 END AS "outwardQty",
         quantity,
         unit_cost AS "unitCost",
         total_value AS "lineValue",
         SUM(quantity) OVER (ORDER BY transaction_date, id) AS "runningQty",
         SUM(total_value) OVER (ORDER BY transaction_date, id) AS "runningValue"
       FROM tx
       ORDER BY date, id`,
      [businessId, productId, from, to]
    );

    res.json({
      productId,
      from,
      to,
      lines: rows.rows.map((row) => ({
        ...row,
        inwardQty: Number(row.inwardQty || 0),
        outwardQty: Number(row.outwardQty || 0),
        quantity: Number(row.quantity || 0),
        unitCost: Number(row.unitCost || 0),
        lineValue: Number(row.lineValue || 0),
        runningQty: Number(row.runningQty || 0),
        runningValue: Number(row.runningValue || 0)
      }))
    });
  } catch (error) {
    next(error);
  }
});

const adjustmentSchema = z.object({
  productId: z.string().uuid(),
  quantityDelta: z.number().refine((value) => value !== 0, 'quantityDelta must not be 0'),
  unitCost: z.number().nonnegative().optional(),
  adjustmentDate: z.string().date().optional(),
  narration: z.string().optional(),
  stockAccountId: z.string().uuid().optional(),
  adjustmentAccountId: z.string().uuid().optional()
});

inventoryRouter.post('/adjustment', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const payload = adjustmentSchema.parse(req.body);
    const postingDate = normalizeIsoDate(payload.adjustmentDate || new Date(), 'adjustmentDate');
    const qtyDelta = Number(payload.quantityDelta);

    const result = await withTransaction(async (client) => {
      const settingsRes = await client.query(
        `SELECT allow_negative_stock AS "allowNegativeStock"
         FROM businesses
         WHERE id = $1
         LIMIT 1`,
        [businessId]
      );
      const allowNegativeStock = Boolean(settingsRes.rows[0]?.allowNegativeStock);

      const productRes = await client.query(
        `SELECT id, name
         FROM products
         WHERE id = $1 AND business_id = $2
         LIMIT 1`,
        [payload.productId, businessId]
      );
      if (productRes.rows.length === 0) {
        throw httpError(404, 'Product not found');
      }

      const stockRes = await client.query(
        `SELECT
           COALESCE(SUM(quantity), 0) AS qty,
           COALESCE(SUM(total_value), 0) AS value
         FROM inventory_transactions
         WHERE business_id = $1
           AND product_id = $2
           AND transaction_date <= $3::date`,
        [businessId, payload.productId, postingDate]
      );
      const availableQty = Number(stockRes.rows[0]?.qty || 0);
      const availableValue = Number(stockRes.rows[0]?.value || 0);
      const avgCost = availableQty === 0 ? 0 : availableValue / availableQty;
      const unitCost = Number(payload.unitCost ?? avgCost ?? 0);
      if (unitCost < 0) {
        throw httpError(400, 'Invalid unit cost');
      }

      if (qtyDelta < 0 && !allowNegativeStock && availableQty + qtyDelta < 0) {
        throw httpError(400, `Negative stock not allowed. Available: ${availableQty}, adjustment: ${qtyDelta}`);
      }

      const amount = Number((Math.abs(qtyDelta) * unitCost).toFixed(2));
      if (amount <= 0) {
        throw httpError(400, 'Adjustment amount must be greater than zero');
      }

      const fyId = await getOrCreateFinancialYear(client, businessId, postingDate);
      const accounts =
        payload.stockAccountId && payload.adjustmentAccountId
          ? { stockAccountId: payload.stockAccountId, adjustmentAccountId: payload.adjustmentAccountId }
          : await ensureStockAndAdjustmentAccounts(client, businessId);

      const txnRes = await client.query(
        `INSERT INTO transactions (business_id, txn_date, narration)
         VALUES ($1, $2::date, $3)
         RETURNING id`,
        [businessId, postingDate, payload.narration || `Stock adjustment for ${productRes.rows[0].name}`]
      );
      const transactionId = txnRes.rows[0].id;

      const voucherRes = await client.query(
        `INSERT INTO vouchers (business_id, transaction_id, voucher_type, voucher_number, voucher_date, narration, status, posted_at, posted_by, is_system_generated)
         VALUES (
           $1, $2, 'JOURNAL',
           CONCAT('ADJ-', to_char(NOW(), 'YYYYMMDDHH24MISS')),
           $3::date, $4, 'POSTED', NOW(), 'SYSTEM', TRUE
         )
         RETURNING id, voucher_number AS "voucherNumber"`,
        [businessId, transactionId, postingDate, payload.narration || `Stock adjustment for ${productRes.rows[0].name}`]
      );
      const voucherId = voucherRes.rows[0].id;

      const first = qtyDelta > 0
        ? { accountId: accounts.stockAccountId, type: 'DR' }
        : { accountId: accounts.adjustmentAccountId, type: 'DR' };
      const second = qtyDelta > 0
        ? { accountId: accounts.adjustmentAccountId, type: 'CR' }
        : { accountId: accounts.stockAccountId, type: 'CR' };

      await client.query(
        `INSERT INTO transaction_entries (transaction_id, line_no, account_id, entry_type, amount)
         VALUES ($1, 1, $2, $3, $4), ($1, 2, $5, $6, $4)`,
        [transactionId, first.accountId, first.type, amount, second.accountId, second.type]
      );
      await client.query(
        `INSERT INTO voucher_lines (voucher_id, line_no, account_id, entry_type, amount)
         VALUES ($1, 1, $2, $3, $4), ($1, 2, $5, $6, $4)`,
        [voucherId, first.accountId, first.type, amount, second.accountId, second.type]
      );
      await client.query(
        `INSERT INTO ledger_postings (business_id, financial_year_id, voucher_id, transaction_id, account_id, posting_date, debit, credit)
         VALUES
           ($1, $2, $3, $4, $5, $6::date, $7, 0),
           ($1, $2, $3, $4, $8, $6::date, 0, $7)`,
        [businessId, fyId, voucherId, transactionId, first.accountId, postingDate, amount, second.accountId]
      );

      const signedQty = qtyDelta;
      const signedValue = Number((qtyDelta * unitCost).toFixed(2));
      await client.query(
        `INSERT INTO inventory_transactions
         (business_id, product_id, voucher_id, transaction_date, quantity, unit_cost, total_value)
         VALUES ($1, $2, $3, $4::date, $5, $6, $7)`,
        [businessId, payload.productId, voucherId, postingDate, signedQty, unitCost, signedValue]
      );

      return {
        ok: true,
        voucherId,
        voucherNumber: voucherRes.rows[0].voucherNumber,
        quantityDelta: signedQty,
        amount
      };
    });

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid stock adjustment payload', error.issues));
    }
    next(error);
  }
});

inventoryRouter.get('/settings', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const result = await pool.query(
      `SELECT
         inventory_costing_method AS "inventoryCostingMethod",
         allow_negative_stock AS "allowNegativeStock"
       FROM businesses
       WHERE id = $1
       LIMIT 1`,
      [businessId]
    );
    if (result.rows.length === 0) {
      throw httpError(404, 'Business not found');
    }
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

const inventorySettingsSchema = z.object({
  inventoryCostingMethod: z.enum(['WEIGHTED_AVERAGE', 'FIFO']).optional(),
  allowNegativeStock: z.boolean().optional()
});

inventoryRouter.patch('/settings', async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const payload = inventorySettingsSchema.parse(req.body);

    const updates = [];
    const values = [];
    let idx = 1;
    if (payload.inventoryCostingMethod !== undefined) {
      updates.push(`inventory_costing_method = $${idx++}`);
      values.push(payload.inventoryCostingMethod);
    }
    if (payload.allowNegativeStock !== undefined) {
      updates.push(`allow_negative_stock = $${idx++}`);
      values.push(payload.allowNegativeStock);
    }
    if (updates.length === 0) {
      throw httpError(400, 'No settings provided');
    }
    values.push(businessId);

    const result = await pool.query(
      `UPDATE businesses
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${idx}
       RETURNING
         inventory_costing_method AS "inventoryCostingMethod",
         allow_negative_stock AS "allowNegativeStock"`,
      values
    );
    res.json(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid inventory settings payload', error.issues));
    }
    next(error);
  }
});
