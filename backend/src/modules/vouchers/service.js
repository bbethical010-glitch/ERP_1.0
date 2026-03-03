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

function normalizeIsoDate(dateValue, fieldName = 'voucherDate') {
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
  } else if (typeof dateValue === 'number') {
    const parsed = new Date(dateValue);
    if (!Number.isNaN(parsed.getTime())) {
      return toLocalIso(parsed);
    }
  }

  throw httpError(400, `Invalid ${fieldName}`);
}

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

async function assertSalesVoucherShape(client, businessId, lines) {
  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const categories = await client.query(
    `SELECT a.id, ag.category
     FROM accounts a
     JOIN account_groups ag ON ag.id = a.account_group_id
     WHERE a.business_id = $1
       AND a.id = ANY($2::uuid[])`,
    [businessId, accountIds]
  );
  const categoryMap = new Map(categories.rows.map((row) => [row.id, row.category]));

  const hasRevenueCredit = lines.some(
    (line) => line.entryType === 'CR' && categoryMap.get(line.accountId) === 'INCOME'
  );
  const hasDebtorOrCashDebit = lines.some(
    (line) =>
      line.entryType === 'DR' &&
      ['CURRENT_ASSET'].includes(categoryMap.get(line.accountId))
  );

  if (!hasRevenueCredit || !hasDebtorOrCashDebit) {
    throw httpError(
      400,
      'Sales voucher must include CR to INCOME and DR to debtor/cash (CURRENT_ASSET)'
    );
  }
}

function toDateParts(voucherDate) {
  const normalizedVoucherDate = normalizeIsoDate(voucherDate, 'voucherDate');
  const [year, month] = normalizedVoucherDate.split('-').map(Number);
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
  const postingDate = normalizeIsoDate(voucherDate, 'voucherDate');
  const range = getFinancialYearRange(postingDate);
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

  const inserted = await client.query(
    `INSERT INTO financial_years (business_id, label, start_date, end_date, is_closed)
     VALUES ($1, $2, $3::date, $4::date, FALSE)
     RETURNING id`,
    [businessId, range.label, range.startDate, range.endDate]
  );

  return inserted.rows[0].id;
}

async function generateVoucherNumber(client, businessId, voucherType, voucherDate) {
  const normalizedVoucherDate = normalizeIsoDate(voucherDate, 'voucherDate');
  const { label } = getFinancialYearRange(normalizedVoucherDate);
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

async function getInventorySnapshot(client, businessId, productIds, asOfDate) {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return new Map();
  }

  const res = await client.query(
    `SELECT
       product_id,
       COALESCE(SUM(quantity), 0) AS qty,
       COALESCE(SUM(total_value), 0) AS value
     FROM inventory_transactions
     WHERE business_id = $1
       AND product_id = ANY($2::uuid[])
       AND posting_date <= $3::date
     GROUP BY product_id`,
    [businessId, productIds, normalizeIsoDate(asOfDate, 'transactionDate')]
  );

  const map = new Map();
  for (const row of res.rows) {
    const qty = Number(row.qty || 0);
    const value = Number(row.value || 0);
    map.set(row.product_id, {
      quantity: qty,
      totalValue: value,
      avgCost: qty === 0 ? 0 : value / qty
    });
  }
  return map;
}

async function getBusinessInventorySettings(client, businessId) {
  const res = await client.query(
    `SELECT
       inventory_costing_method AS "costingMethod",
       allow_negative_stock AS "allowNegativeStock"
     FROM businesses
     WHERE id = $1
     LIMIT 1`,
    [businessId]
  );
  return {
    costingMethod: res.rows[0]?.costingMethod || 'WEIGHTED_AVERAGE',
    allowNegativeStock: Boolean(res.rows[0]?.allowNegativeStock)
  };
}

async function getLatestProductUnitCost(client, businessId, productId) {
  const res = await client.query(
    `SELECT unit_cost
     FROM inventory_transactions
     WHERE business_id = $1 AND product_id = $2
     ORDER BY posting_date DESC, created_at DESC
     LIMIT 1`,
    [businessId, productId]
  );
  return Number(res.rows[0]?.unit_cost || 0);
}

async function buildFifoLots(client, businessId, productIds, asOfDate) {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return new Map();
  }

  const tx = await client.query(
    `SELECT product_id, quantity, unit_cost, posting_date, id
     FROM inventory_transactions
     WHERE business_id = $1
       AND product_id = ANY($2::uuid[])
       AND posting_date <= $3::date
     ORDER BY posting_date ASC, id ASC`,
    [businessId, productIds, normalizeIsoDate(asOfDate, 'transactionDate')]
  );

  const lotsByProduct = new Map();
  for (const productId of productIds) {
    lotsByProduct.set(productId, []);
  }

  for (const row of tx.rows) {
    const productId = row.product_id;
    const quantity = Number(row.quantity || 0);
    const unitCost = Number(row.unit_cost || 0);
    const lots = lotsByProduct.get(productId) || [];

    if (quantity > 0) {
      lots.push({ qty: quantity, unitCost });
      lotsByProduct.set(productId, lots);
      continue;
    }

    if (quantity < 0) {
      let outward = Math.abs(quantity);
      for (const lot of lots) {
        if (outward <= 0) break;
        const consume = Math.min(lot.qty, outward);
        lot.qty -= consume;
        outward -= consume;
      }
      const remainingLots = lots.filter((lot) => lot.qty > 0);
      lotsByProduct.set(productId, remainingLots);
    }
  }

  return lotsByProduct;
}

function computeFifoCostFromLots(lots, soldQty) {
  let remaining = Number(soldQty);
  let cost = 0;
  let available = 0;
  for (const lot of lots) {
    available += Number(lot.qty || 0);
  }
  for (const lot of lots) {
    if (remaining <= 0) break;
    const consume = Math.min(Number(lot.qty || 0), remaining);
    cost += consume * Number(lot.unitCost || 0);
    remaining -= consume;
  }
  return {
    availableQty: available,
    totalCost: Number(cost.toFixed(2)),
    remainingQtyRequest: remaining
  };
}

async function ensureAccountingLedger(client, businessId, { name, groupCode, normalBalance }) {
  const existing = await client.query(
    `SELECT a.id
     FROM accounts a
     JOIN account_groups ag ON ag.id = a.account_group_id
     WHERE a.business_id = $1 AND a.name = $2`,
    [businessId, name]
  );
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  // Ensure the requested group exists; if not, create a sensible child group
  // under its parent (e.g. EX-IND under EX, CA-STOCK under CA).
  let groupRes = await client.query(
    `SELECT id, code, category, parent_group_id
     FROM account_groups
     WHERE business_id = $1 AND code = $2`,
    [businessId, groupCode]
  );

  if (!groupRes.rows[0]) {
    // Attempt to derive parent code from prefix before first dash, e.g. "EX" from "EX-IND"
    const parentCode = groupCode.includes('-') ? groupCode.split('-')[0] : null;
    if (!parentCode) {
      throw httpError(400, `Required account group not found for ${name} (${groupCode})`);
    }

    const parentRes = await client.query(
      `SELECT id, category
       FROM account_groups
       WHERE business_id = $1 AND code = $2`,
      [businessId, parentCode]
    );
    if (!parentRes.rows[0]) {
      throw httpError(400, `Required parent account group not found for ${name} (${parentCode})`);
    }

    const parent = parentRes.rows[0];
    const insertedGroup = await client.query(
      `INSERT INTO account_groups (business_id, name, code, category, parent_group_id, is_system)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, code, category, parent_group_id`,
      [businessId, name, groupCode, parent.category, parent.id]
    );
    groupRes.rows[0] = insertedGroup.rows[0];
  }

  const groupId = groupRes.rows[0].id;

  const baseCode = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16) || 'LEDGER';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = attempt === 0 ? baseCode : `${baseCode}-${String(Date.now()).slice(-4)}${attempt}`;
    try {
      const inserted = await client.query(
        `INSERT INTO accounts (business_id, account_group_id, code, name, normal_balance)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [businessId, groupId, code, name, normalBalance]
      );
      return inserted.rows[0].id;
    } catch (error) {
      if (error?.code !== '23505') throw error;
    }
  }
  throw httpError(500, `Failed to create ledger for ${name}`);
}

async function assertAccountCategory(client, businessId, accountId, allowedCategories, fieldLabel) {
  const res = await client.query(
    `SELECT ag.category
     FROM accounts a
     JOIN account_groups ag ON ag.id = a.account_group_id
     WHERE a.business_id = $1
       AND a.id = $2
     LIMIT 1`,
    [businessId, accountId]
  );
  if (res.rows.length === 0) {
    throw httpError(400, `${fieldLabel} account not found for this business`);
  }
  const category = res.rows[0].category;
  if (!allowedCategories.includes(category)) {
    throw httpError(
      400,
      `${fieldLabel} account must belong to one of: ${allowedCategories.join(', ')}`
    );
  }
}

async function buildPurchaseDerivedEntries(client, payload) {
  if (payload.voucherType !== 'PURCHASE') {
    return payload.entries;
  }

  if (Array.isArray(payload.entries) && payload.entries.length > 0) {
    return payload.entries;
  }

  if (!Array.isArray(payload.purchaseLines) || payload.purchaseLines.length === 0) {
    return payload.entries;
  }

  const entries = [];
  let totalDebit = 0;
  let counterpartyAccountId = null;

  const stockAccountId = await ensureAccountingLedger(client, payload.businessId, {
    name: 'Stock-in-Hand',
    groupCode: 'CA-STOCK',
    normalBalance: 'DR'
  });

  for (const line of payload.purchaseLines) {
    const qty = Number(line.quantity || 1);
    const unitCost = Number(line.unitCost || 0);
    const taxAmount =
      line.taxAmount !== undefined
        ? Number(line.taxAmount || 0)
        : Number((((unitCost * qty) * Number(line.taxRate || 0)) / 100).toFixed(2));
    const baseAmount = Number((qty * unitCost).toFixed(2));
    const grossAmount = Number((baseAmount + taxAmount).toFixed(2));

    if (grossAmount <= 0) {
      throw httpError(400, 'Invalid purchase line amount');
    }

    if (line.counterpartyAccountId) {
      counterpartyAccountId = line.counterpartyAccountId;
      await assertAccountCategory(
        client,
        payload.businessId,
        counterpartyAccountId,
        ['LIABILITY', 'CURRENT_ASSET'],
        'Counterparty'
      );
    }

    if (line.lineType === 'FIXED_ASSET') {
      const assetAccountId =
        line.assetAccountId ||
        (line.assetAccountName
          ? await ensureAccountingLedger(client, payload.businessId, {
              name: line.assetAccountName.trim(),
              groupCode: 'FA',
              normalBalance: 'DR'
            })
          : null);

      if (!assetAccountId) {
        throw httpError(400, 'Fixed asset purchase line requires assetAccountId or assetAccountName');
      }
      if (line.assetAccountId) {
        await assertAccountCategory(
          client,
          payload.businessId,
          line.assetAccountId,
          ['FIXED_ASSET'],
          'Asset'
        );
      }

      entries.push({
        accountId: assetAccountId,
        entryType: 'DR',
        amount: grossAmount
      });
      totalDebit += grossAmount;
      continue;
    }

    // Default: inventory line
    entries.push({
      accountId: stockAccountId,
      entryType: 'DR',
      amount: grossAmount
    });
    totalDebit += grossAmount;
  }

  if (!counterpartyAccountId) {
    throw httpError(400, 'Purchase lines require counterpartyAccountId to create balancing credit');
  }

  entries.push({
    accountId: counterpartyAccountId,
    entryType: 'CR',
    amount: Number(totalDebit.toFixed(2))
  });

  return entries;
}

async function upsertOutstandingForInvoice(client, { businessId, voucherId, voucherType, voucherDate, lines }) {
  if (!['SALES', 'PURCHASE'].includes(voucherType)) {
    return;
  }

  const totals = computeTotals(lines);
  const originalAmount = voucherType === 'SALES' ? Number(totals.credit.toFixed(2)) : Number(totals.debit.toFixed(2));
  if (originalAmount <= 0) {
    return;
  }

  // Best-effort party derivation: first opposite-side line
  const partyLine = lines.find((line) => {
    if (voucherType === 'SALES') return line.entryType === 'DR';
    return line.entryType === 'CR';
  });

  await client.query(
    `INSERT INTO voucher_outstandings (
       business_id, voucher_id, party_account_id, voucher_type, voucher_date, due_date, original_amount, outstanding_amount, status
     ) VALUES ($1, $2, $3, $4::voucher_type, $5::date, $5::date, $6, $6, 'OPEN')
     ON CONFLICT (voucher_id)
     DO UPDATE SET
       party_account_id = EXCLUDED.party_account_id,
       original_amount = EXCLUDED.original_amount,
       outstanding_amount = EXCLUDED.outstanding_amount,
       status = CASE WHEN EXCLUDED.outstanding_amount = 0 THEN 'CLOSED' ELSE 'OPEN' END,
       updated_at = NOW()`,
    [businessId, voucherId, partyLine?.accountId || null, voucherType, voucherDate, originalAmount]
  );
}

async function applyAllocations(client, { businessId, sourceVoucherId, sourceVoucherType, allocations, allocationDate }) {
  if (!Array.isArray(allocations) || allocations.length === 0) {
    return;
  }
  if (!['RECEIPT', 'PAYMENT'].includes(sourceVoucherType)) {
    throw httpError(400, 'Allocations are only allowed for RECEIPT or PAYMENT vouchers');
  }

  for (const allocation of allocations) {
    const amount = Number(allocation.amount || 0);
    if (amount <= 0) {
      throw httpError(400, 'Allocation amount must be greater than zero');
    }

    const target = await client.query(
      `SELECT voucher_id AS "voucherId",
              voucher_type AS "voucherType",
              outstanding_amount AS "outstandingAmount",
              status
       FROM voucher_outstandings
       WHERE business_id = $1
         AND voucher_id = $2
       FOR UPDATE`,
      [businessId, allocation.targetVoucherId]
    );

    if (target.rows.length === 0) {
      throw httpError(404, `Outstanding voucher not found: ${allocation.targetVoucherId}`);
    }

    const targetRow = target.rows[0];
    const validTarget = sourceVoucherType === 'RECEIPT' ? 'SALES' : 'PURCHASE';
    if (targetRow.voucherType !== validTarget) {
      throw httpError(400, `Invalid allocation target for ${sourceVoucherType}`);
    }

    if (amount > Number(targetRow.outstandingAmount || 0)) {
      throw httpError(400, `Allocation exceeds outstanding amount for voucher ${allocation.targetVoucherId}`);
    }

    await client.query(
      `INSERT INTO voucher_allocations (business_id, source_voucher_id, target_voucher_id, amount, allocation_date)
       VALUES ($1, $2, $3, $4, $5::date)`,
      [businessId, sourceVoucherId, allocation.targetVoucherId, amount, normalizeIsoDate(allocationDate, 'allocationDate')]
    );

    await client.query(
      `UPDATE voucher_outstandings
       SET outstanding_amount = GREATEST(0, outstanding_amount - $1),
           status = CASE WHEN GREATEST(0, outstanding_amount - $1) = 0 THEN 'CLOSED' ELSE 'OPEN' END,
           updated_at = NOW()
       WHERE business_id = $2
         AND voucher_id = $3`,
      [amount, businessId, allocation.targetVoucherId]
    );
  }
}

async function reverseInventoryMovementsForVoucher(client, { businessId, sourceVoucherId, reversalVoucherId, reversalDate }) {
  const sourceRows = await client.query(
    `SELECT product_id AS "productId", quantity, unit_cost AS "unitCost", total_value AS "totalValue"
     FROM inventory_transactions
     WHERE business_id = $1
       AND voucher_id = $2
     ORDER BY id`,
    [businessId, sourceVoucherId]
  );

  if (sourceRows.rows.length === 0) {
    return;
  }

  const postingDate = normalizeIsoDate(reversalDate, 'reversalDate');
  for (const row of sourceRows.rows) {
    const quantity = Number(row.quantity || 0);
    const unitCost = Number(row.unitCost || 0);
    const totalValue = Number(row.totalValue || 0);
    await client.query(
      `INSERT INTO inventory_transactions
       (business_id, product_id, voucher_id, transaction_date, posting_date, quantity, unit_cost, total_value)
       VALUES ($1, $2, $3, $4::date, $4::date, $5, $6, $7)`,
      [businessId, row.productId, reversalVoucherId, postingDate, -quantity, unitCost, -totalValue]
    );
  }
}

async function closeOutstandingForVoucher(client, { businessId, voucherId }) {
  await client.query(
    `UPDATE voucher_outstandings
     SET outstanding_amount = 0,
         status = 'CLOSED',
         updated_at = NOW()
     WHERE business_id = $1
       AND voucher_id = $2`,
    [businessId, voucherId]
  );
}

async function unwindAllocationsForReversal(client, { businessId, sourceVoucherId }) {
  const allocRes = await client.query(
    `SELECT target_voucher_id AS "targetVoucherId", COALESCE(SUM(amount), 0) AS amount
     FROM voucher_allocations
     WHERE business_id = $1
       AND source_voucher_id = $2
     GROUP BY target_voucher_id`,
    [businessId, sourceVoucherId]
  );

  for (const alloc of allocRes.rows) {
    const amount = Number(alloc.amount || 0);
    if (amount <= 0) continue;
    await client.query(
      `UPDATE voucher_outstandings
       SET outstanding_amount = LEAST(original_amount, outstanding_amount + $1),
           status = CASE WHEN LEAST(original_amount, outstanding_amount + $1) > 0 THEN 'OPEN' ELSE 'CLOSED' END,
           updated_at = NOW()
       WHERE business_id = $2
         AND voucher_id = $3`,
      [amount, businessId, alloc.targetVoucherId]
    );
  }
}

async function persistPurchaseDocument(client, params) {
  const { businessId, voucherId, voucherDate, purchaseLines, entries } = params;
  if (!Array.isArray(purchaseLines) || purchaseLines.length === 0) {
    return null;
  }

  const supplierAccountId =
    purchaseLines.find((line) => line.counterpartyAccountId)?.counterpartyAccountId ||
    entries?.find((line) => line.entryType === 'CR')?.accountId ||
    null;

  const totalAmount = Number(
    purchaseLines
      .reduce((sum, line) => {
        const quantity = Number(line.quantity || 1);
        const unitCost = Number(line.unitCost || 0);
        const base = quantity * unitCost;
        const taxAmount =
          line.taxAmount !== undefined
            ? Number(line.taxAmount || 0)
            : Number(((base * Number(line.taxRate || 0)) / 100).toFixed(2));
        return sum + base + taxAmount;
      }, 0)
      .toFixed(2)
  );

  const pv = await client.query(
    `INSERT INTO purchase_voucher (business_id, voucher_id, supplier_account_id, bill_date, total_amount)
     VALUES ($1, $2, $3, $4::date, $5)
     ON CONFLICT (voucher_id)
     DO UPDATE SET
       supplier_account_id = EXCLUDED.supplier_account_id,
       bill_date = EXCLUDED.bill_date,
       total_amount = EXCLUDED.total_amount,
       updated_at = NOW()
     RETURNING id`,
    [businessId, voucherId, supplierAccountId, normalizeIsoDate(voucherDate, 'voucherDate'), totalAmount]
  );
  const purchaseVoucherId = pv.rows[0].id;

  await client.query(`DELETE FROM purchase_lines WHERE purchase_voucher_id = $1`, [purchaseVoucherId]);

  for (let i = 0; i < purchaseLines.length; i += 1) {
    const line = purchaseLines[i];
    const lineType = line.lineType || 'INVENTORY';
    const quantity = Number(line.quantity || 1);
    const unitCost = Number(line.unitCost || 0);
    const base = Number((quantity * unitCost).toFixed(2));
    const taxRate = Number(line.taxRate || 0);
    const taxAmount =
      line.taxAmount !== undefined ? Number(line.taxAmount || 0) : Number(((base * taxRate) / 100).toFixed(2));
    const lineTotal = Number((base + taxAmount).toFixed(2));

    await client.query(
      `INSERT INTO purchase_lines (
         business_id, purchase_voucher_id, line_no, line_type,
         product_id, asset_account_id, description,
         quantity, unit_cost, tax_rate, tax_amount, line_total
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        businessId,
        purchaseVoucherId,
        i + 1,
        lineType,
        lineType === 'INVENTORY' ? line.productId || null : null,
        lineType === 'FIXED_ASSET' ? line.assetAccountId || null : null,
        line.description || line.assetAccountName || null,
        quantity,
        unitCost,
        taxRate,
        taxAmount,
        lineTotal
      ]
    );
  }

  return purchaseVoucherId;
}

async function validateInventoryFinancialSyncForVoucher(client, { businessId, voucherId }) {
  const inventoryRes = await client.query(
    `SELECT COALESCE(SUM(total_value), 0) AS value, COUNT(*)::int AS count
     FROM inventory_transactions
     WHERE business_id = $1
       AND voucher_id = $2`,
    [businessId, voucherId]
  );
  const inventoryValue = Number(inventoryRes.rows[0]?.value || 0);
  const inventoryCount = Number(inventoryRes.rows[0]?.count || 0);
  if (inventoryCount === 0) return;

  const stockAccounts = await client.query(
    `SELECT a.id
     FROM accounts a
     LEFT JOIN account_groups ag ON ag.id = a.account_group_id
     WHERE a.business_id = $1
       AND (LOWER(a.name) = 'stock-in-hand' OR ag.code = 'CA-STOCK')`,
    [businessId]
  );
  const stockAccountIds = stockAccounts.rows.map((row) => row.id);
  if (stockAccountIds.length === 0) {
    throw httpError(400, 'Stock-in-Hand account is required for inventory vouchers');
  }

  const postingRes = await client.query(
    `SELECT COALESCE(SUM(debit - credit), 0) AS value
     FROM ledger_postings
     WHERE business_id = $1
       AND voucher_id = $2
       AND account_id = ANY($3::uuid[])`,
    [businessId, voucherId, stockAccountIds]
  );
  const stockPostingValue = Number(postingRes.rows[0]?.value || 0);
  const diff = Number((inventoryValue - stockPostingValue).toFixed(2));
  if (Math.abs(diff) > 0.01) {
    throw httpError(
      400,
      `Inventory/ledger mismatch for voucher ${voucherId}. Inventory value=${inventoryValue}, Stock ledger=${stockPostingValue}`
    );
  }
}

async function applySalesInventoryIntegration(client, params) {
  const { businessId, voucherId, transactionId, voucherDate, inventoryLines, actorId } = params;
  if (!Array.isArray(inventoryLines) || inventoryLines.length === 0) return;

  const postingDate = normalizeIsoDate(voucherDate, 'voucherDate');
  const settings = await getBusinessInventorySettings(client, businessId);

  // Aggregate quantities per product
  const aggregate = new Map();
  for (const line of inventoryLines) {
    if (!line?.productId || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) {
      throw httpError(400, 'Invalid inventory line in sales voucher');
    }
    const qty = Number(line.quantity);
    const prev = aggregate.get(line.productId) || 0;
    aggregate.set(line.productId, prev + qty);
  }

  const productIds = [...aggregate.keys()];
  const snapshot = await getInventorySnapshot(client, businessId, productIds, postingDate);
  const fifoLotsByProduct =
    settings.costingMethod === 'FIFO'
      ? await buildFifoLots(client, businessId, productIds, postingDate)
      : null;

  let totalCost = 0;
  const perProductCost = new Map();

  for (const [productId, soldQty] of aggregate.entries()) {
    const info = snapshot.get(productId);
    const availableQty = info?.quantity || 0;
    const avgCost = info?.avgCost || 0;

    if (availableQty < soldQty && !settings.allowNegativeStock) {
      throw httpError(
        400,
        `Insufficient stock for product ${productId}. Available: ${availableQty}, attempted sale: ${soldQty}`
      );
    }

    let unitCost = avgCost;
    let cost = Number((soldQty * unitCost).toFixed(2));

    if (settings.costingMethod === 'FIFO') {
      const lots = fifoLotsByProduct?.get(productId) || [];
      const fifo = computeFifoCostFromLots(lots, soldQty);
      if (fifo.availableQty < soldQty && !settings.allowNegativeStock) {
        throw httpError(
          400,
          `Insufficient stock for product ${productId}. Available: ${fifo.availableQty}, attempted sale: ${soldQty}`
        );
      }
      if (fifo.totalCost > 0) {
        cost = fifo.totalCost;
        unitCost = Number((cost / soldQty).toFixed(6));
      }
    }

    if (cost <= 0 || unitCost <= 0) {
      // Fallback when negative stock allowed or historical cost not available.
      const latest = await getLatestProductUnitCost(client, businessId, productId);
      if (latest > 0) {
        unitCost = latest;
        cost = Number((soldQty * latest).toFixed(2));
      } else if (!settings.allowNegativeStock) {
        throw httpError(400, `Cannot compute cost for product ${productId}; cost basis unavailable`);
      } else {
        unitCost = 0;
        cost = 0;
      }
    }

    totalCost += cost;
    perProductCost.set(productId, { quantity: soldQty, unitCost, cost });
  }

  if (totalCost > 0) {
    // Ensure COGS and Stock-in-Hand ledgers exist
    const cogsAccountId = await ensureAccountingLedger(client, businessId, {
      name: 'Cost of Goods Sold',
      groupCode: 'EX-IND',
      normalBalance: 'DR'
    });
    const stockAccountId = await ensureAccountingLedger(client, businessId, {
      name: 'Stock-in-Hand',
      groupCode: 'CA-STOCK',
      normalBalance: 'DR'
    });

    // Determine starting line number
    const maxLineRes = await client.query(
      `SELECT COALESCE(MAX(line_no), 0) AS max_line
       FROM transaction_entries
       WHERE transaction_id = $1`,
      [transactionId]
    );
    let lineNo = Number(maxLineRes.rows[0]?.max_line || 0);
    const maxVoucherLineRes = await client.query(
      `SELECT COALESCE(MAX(line_no), 0) AS max_line
       FROM voucher_lines
       WHERE voucher_id = $1`,
      [voucherId]
    );
    let voucherLineNo = Number(maxVoucherLineRes.rows[0]?.max_line || 0);

    // Post COGS (DR) and Stock-in-Hand (CR) using the same transaction & voucher
    lineNo += 1;
    voucherLineNo += 1;
    await client.query(
      `INSERT INTO transaction_entries (transaction_id, line_no, account_id, entry_type, amount)
       VALUES ($1, $2, $3, 'DR', $4)`,
      [transactionId, lineNo, cogsAccountId, totalCost]
    );
    await client.query(
      `INSERT INTO voucher_lines (voucher_id, line_no, account_id, entry_type, amount)
       VALUES ($1, $2, $3, 'DR', $4)`,
      [voucherId, voucherLineNo, cogsAccountId, totalCost]
    );
    await client.query(
      `INSERT INTO ledger_postings (business_id, financial_year_id, voucher_id, transaction_id, account_id, posting_date, debit, credit)
       SELECT $1, financial_year_id, $2, $3, $4, $5, $6, 0
       FROM ledger_postings
       WHERE voucher_id = $2
       LIMIT 1`,
      [businessId, voucherId, transactionId, cogsAccountId, postingDate, totalCost]
    );

    lineNo += 1;
    voucherLineNo += 1;
    await client.query(
      `INSERT INTO transaction_entries (transaction_id, line_no, account_id, entry_type, amount)
       VALUES ($1, $2, $3, 'CR', $4)`,
      [transactionId, lineNo, stockAccountId, totalCost]
    );
    await client.query(
      `INSERT INTO voucher_lines (voucher_id, line_no, account_id, entry_type, amount)
       VALUES ($1, $2, $3, 'CR', $4)`,
      [voucherId, voucherLineNo, stockAccountId, totalCost]
    );
    await client.query(
      `INSERT INTO ledger_postings (business_id, financial_year_id, voucher_id, transaction_id, account_id, posting_date, debit, credit)
       SELECT $1, financial_year_id, $2, $3, $4, $5, 0, $6
       FROM ledger_postings
       WHERE voucher_id = $2
       LIMIT 1`,
      [businessId, voucherId, transactionId, stockAccountId, postingDate, totalCost]
    );
  }

  // Insert inventory movements (negative quantity for sales)
  for (const [productId, info] of perProductCost.entries()) {
    const { quantity, unitCost, cost } = info;
    await client.query(
      `INSERT INTO inventory_transactions
       (business_id, product_id, voucher_id, transaction_date, posting_date, quantity, unit_cost, total_value)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
      [businessId, productId, voucherId, postingDate, -quantity, unitCost, -cost]
    );
  }

  await insertAuditLog(client, {
    businessId,
    actorId,
    action: 'SALES_INVENTORY_APPLIED',
    entityType: 'voucher',
    entityId: voucherId,
    metadata: { totalCost, costingMethod: settings.costingMethod, products: [...perProductCost.entries()] }
  });
}

async function applyPurchaseInventoryIntegration(client, params) {
  const { businessId, voucherId, voucherDate, inventoryLines, purchaseLines, actorId } = params;
  const normalizedInventoryLines = Array.isArray(purchaseLines) && purchaseLines.length > 0
    ? purchaseLines
        .filter((line) => (line.lineType || 'INVENTORY') === 'INVENTORY')
        .map((line) => ({
          productId: line.productId,
          quantity: Number(line.quantity || 0),
          unitCost: Number(line.unitCost || 0),
          taxAmount:
            line.taxAmount !== undefined
              ? Number(line.taxAmount || 0)
              : Number((((Number(line.quantity || 0) * Number(line.unitCost || 0)) * Number(line.taxRate || 0)) / 100).toFixed(2))
        }))
    : (Array.isArray(inventoryLines) ? inventoryLines : []);
  if (normalizedInventoryLines.length === 0) return;

  const postingDate = normalizeIsoDate(voucherDate, 'voucherDate');

  for (const line of normalizedInventoryLines) {
    if (
      !line?.productId ||
      !Number.isFinite(Number(line.quantity)) ||
      Number(line.quantity) <= 0 ||
      !Number.isFinite(Number(line.unitCost)) ||
      Number(line.unitCost) <= 0
    ) {
      throw httpError(400, 'Invalid inventory line in purchase voucher');
    }
  }

  for (const line of normalizedInventoryLines) {
    const qty = Number(line.quantity);
    const unitCost = Number(line.unitCost);
    const base = Number((qty * unitCost).toFixed(2));
    const taxAmount = Number(line.taxAmount || 0);
    const total = Number((base + taxAmount).toFixed(2));

    await client.query(
      `INSERT INTO inventory_transactions
       (business_id, product_id, voucher_id, transaction_date, posting_date, quantity, unit_cost, total_value)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
      [businessId, line.productId, voucherId, postingDate, qty, unitCost, total]
    );
  }

  await insertAuditLog(client, {
    businessId,
    actorId,
    action: 'PURCHASE_INVENTORY_APPLIED',
    entityType: 'voucher',
    entityId: voucherId,
    metadata: {
      lines: normalizedInventoryLines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitCost: l.unitCost,
        taxAmount: l.taxAmount || 0
      }))
    }
  });
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
  const postingDate = normalizeIsoDate(voucher.voucherDate, 'voucherDate');
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

  const financialYearId = await getOrCreateFinancialYear(client, voucher.businessId, postingDate);

  const txnRes = await client.query(
    `INSERT INTO transactions (business_id, txn_date, narration)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [voucher.businessId, postingDate, voucher.narration || null]
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
      [voucher.businessId, financialYearId, voucher.id, transactionId, line.accountId, postingDate, debit, credit]
    );
  }

  const voucherNumber =
    forcedVoucherNumber ||
    voucher.voucherNumber ||
    (await generateVoucherNumber(client, voucher.businessId, voucher.voucherType, postingDate));

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
    const effectiveEntries = await buildPurchaseDerivedEntries(client, payload);
    ensureLines(effectiveEntries);
    await assertAccountsBelongToBusiness(client, payload.businessId, effectiveEntries);
    if (payload.voucherType === 'SALES') {
      await assertSalesVoucherShape(client, payload.businessId, effectiveEntries);
    }
    const voucherDate = normalizeIsoDate(payload.voucherDate, 'voucherDate');

    const mode = payload.mode === 'DRAFT' ? 'DRAFT' : 'POST';
    const initialStatus = mode === 'DRAFT' ? 'DRAFT' : 'DRAFT';
    const voucherNumber =
      payload.voucherNumber ||
      (mode === 'POST'
        ? await generateVoucherNumber(client, payload.businessId, payload.voucherType, voucherDate)
        : `TMP-${Date.now()}`);

    const voucherRes = await client.query(
      `INSERT INTO vouchers (
         business_id, voucher_type, voucher_number, voucher_date, narration, status
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [payload.businessId, payload.voucherType, voucherNumber, voucherDate, payload.narration || null, initialStatus]
    );

    const voucherId = voucherRes.rows[0].id;
    await insertVoucherLines(client, voucherId, effectiveEntries);

    await insertAuditLog(client, {
      businessId: payload.businessId,
      actorId: payload.actorId,
      action: mode === 'DRAFT' ? 'VOUCHER_DRAFT_CREATED' : 'VOUCHER_CREATED',
      entityType: 'voucher',
      entityId: voucherId,
      afterJson: {
        voucherType: payload.voucherType,
        voucherNumber,
        voucherDate,
        narration: payload.narration,
        mode,
        totals: computeTotals(effectiveEntries)
      }
    });

    if (mode === 'DRAFT') {
      return { id: voucherId, status: 'DRAFT', voucherNumber };
    }

    const posted = await postDraftInternal(client, voucherId, payload.actorId, voucherNumber);

    if (payload.voucherType === 'SALES' && Array.isArray(payload.inventoryLines) && payload.inventoryLines.length > 0) {
      await applySalesInventoryIntegration(client, {
        businessId: payload.businessId,
        voucherId,
        transactionId: posted.transactionId,
        voucherDate,
        inventoryLines: payload.inventoryLines,
        actorId: payload.actorId
      });
      await validateInventoryFinancialSyncForVoucher(client, {
        businessId: payload.businessId,
        voucherId
      });
    }
    if (
      payload.voucherType === 'PURCHASE' &&
      ((Array.isArray(payload.inventoryLines) && payload.inventoryLines.length > 0) ||
        (Array.isArray(payload.purchaseLines) && payload.purchaseLines.length > 0))
    ) {
      await applyPurchaseInventoryIntegration(client, {
        businessId: payload.businessId,
        voucherId,
        voucherDate,
        inventoryLines: payload.inventoryLines,
        purchaseLines: payload.purchaseLines,
        actorId: payload.actorId
      });
      await validateInventoryFinancialSyncForVoucher(client, {
        businessId: payload.businessId,
        voucherId
      });
    }

    if (payload.voucherType === 'PURCHASE' && Array.isArray(payload.purchaseLines) && payload.purchaseLines.length > 0) {
      await persistPurchaseDocument(client, {
        businessId: payload.businessId,
        voucherId,
        voucherDate,
        purchaseLines: payload.purchaseLines,
        entries: effectiveEntries
      });
    }

    await upsertOutstandingForInvoice(client, {
      businessId: payload.businessId,
      voucherId,
      voucherType: payload.voucherType,
      voucherDate,
      lines: effectiveEntries
    });
    await applyAllocations(client, {
      businessId: payload.businessId,
      sourceVoucherId: voucherId,
      sourceVoucherType: payload.voucherType,
      allocations: payload.allocations,
      allocationDate: voucherDate
    });

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
      items: rows.rows.map((row) => ({
        ...row,
        voucherDate: normalizeIsoDate(row.voucherDate, 'voucherDate'),
        grossAmount: Number(row.grossAmount || 0)
      })),
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

    return { ...voucher, voucherDate: normalizeIsoDate(voucher.voucherDate, 'voucherDate'), entries, totals };
  });
}

export async function postVoucher(voucherId, payload) {
  return withTransaction(async (client) => {
    const draftRes = await client.query(
      `SELECT id, status, voucher_type AS "voucherType", voucher_date AS "voucherDate"
       FROM vouchers
       WHERE id = $1 AND business_id = $2
       FOR UPDATE`,
      [voucherId, payload.businessId]
    );

    if (draftRes.rows.length === 0) {
      throw httpError(404, 'Voucher not found');
    }

    const draft = draftRes.rows[0];
    if (draft.status !== 'DRAFT') {
      throw httpError(409, 'Only draft vouchers can be modified before posting');
    }

    const resolvedVoucherType = payload.voucherType || draft.voucherType;
    const resolvedVoucherDate = payload.voucherDate
      ? normalizeIsoDate(payload.voucherDate, 'voucherDate')
      : normalizeIsoDate(draft.voucherDate, 'voucherDate');

    let effectiveEntries = Array.isArray(payload.entries) && payload.entries.length > 0 ? payload.entries : null;
    if (
      !effectiveEntries &&
      resolvedVoucherType === 'PURCHASE' &&
      Array.isArray(payload.purchaseLines) &&
      payload.purchaseLines.length > 0
    ) {
      effectiveEntries = await buildPurchaseDerivedEntries(client, {
        ...payload,
        voucherType: resolvedVoucherType,
        voucherDate: resolvedVoucherDate,
        entries: []
      });
    }

    if (effectiveEntries) {
      ensureLines(effectiveEntries);
      await assertAccountsBelongToBusiness(client, payload.businessId, effectiveEntries);
      if (resolvedVoucherType === 'SALES') {
        await assertSalesVoucherShape(client, payload.businessId, effectiveEntries);
      }
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
        resolvedVoucherDate,
        payload.narration || null,
        voucherId
      ]
    );

    if (effectiveEntries) {
      await insertVoucherLines(client, voucherId, effectiveEntries);
    }

    const result = await postDraftInternal(client, voucherId, payload.actorId);

    if (resolvedVoucherType === 'SALES' && Array.isArray(payload.inventoryLines) && payload.inventoryLines.length > 0) {
      await applySalesInventoryIntegration(client, {
        businessId: payload.businessId,
        voucherId,
        transactionId: result.transactionId,
        voucherDate: resolvedVoucherDate,
        inventoryLines: payload.inventoryLines,
        actorId: payload.actorId
      });
      await validateInventoryFinancialSyncForVoucher(client, {
        businessId: payload.businessId,
        voucherId
      });
    }

    if (
      resolvedVoucherType === 'PURCHASE' &&
      ((Array.isArray(payload.inventoryLines) && payload.inventoryLines.length > 0) ||
        (Array.isArray(payload.purchaseLines) && payload.purchaseLines.length > 0))
    ) {
      await applyPurchaseInventoryIntegration(client, {
        businessId: payload.businessId,
        voucherId,
        voucherDate: resolvedVoucherDate,
        inventoryLines: payload.inventoryLines,
        purchaseLines: payload.purchaseLines,
        actorId: payload.actorId
      });
      await validateInventoryFinancialSyncForVoucher(client, {
        businessId: payload.businessId,
        voucherId
      });
    }

    if (resolvedVoucherType === 'PURCHASE' && Array.isArray(payload.purchaseLines) && payload.purchaseLines.length > 0) {
      const linesForPurchase = effectiveEntries || (await readVoucherLines(client, voucherId, result.transactionId));
      await persistPurchaseDocument(client, {
        businessId: payload.businessId,
        voucherId,
        voucherDate: resolvedVoucherDate,
        purchaseLines: payload.purchaseLines,
        entries: linesForPurchase
      });
    }

    const finalLines = effectiveEntries || (await readVoucherLines(client, voucherId, result.transactionId));
    await upsertOutstandingForInvoice(client, {
      businessId: payload.businessId,
      voucherId,
      voucherType: resolvedVoucherType,
      voucherDate: resolvedVoucherDate,
      lines: finalLines
    });
    await applyAllocations(client, {
      businessId: payload.businessId,
      sourceVoucherId: voucherId,
      sourceVoucherType: resolvedVoucherType,
      allocations: payload.allocations,
      allocationDate: resolvedVoucherDate
    });

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

    const reversalDate = normalizeIsoDate(payload.reversalDate || new Date(), 'reversalDate');
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
    await reverseInventoryMovementsForVoucher(client, {
      businessId: payload.businessId,
      sourceVoucherId: voucherId,
      reversalVoucherId,
      reversalDate
    });
    await closeOutstandingForVoucher(client, {
      businessId: payload.businessId,
      voucherId
    });
    await unwindAllocationsForReversal(client, {
      businessId: payload.businessId,
      sourceVoucherId: voucherId
    });
    await validateInventoryFinancialSyncForVoucher(client, {
      businessId: payload.businessId,
      voucherId: reversalVoucherId
    });

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
