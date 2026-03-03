import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';
import { requireAuth } from '../../middleware/requireAuth.js';

export const openingPositionRouter = Router();

const stockEntrySchema = z.object({
    sku: z.string().optional(),
    name: z.string().min(1),
    uom: z.string().optional(),
    initialQty: z.number().positive(),
    unitCost: z.number().nonnegative(),
});

const openingBalanceSchema = z.object({
    ledgerName: z.string().min(1),
    groupCode: z.string().min(1),
    drCr: z.enum(['DR', 'CR']),
    amount: z.number().nonnegative()
});

const openingPositionSchema = z.object({
    businessId: z.string().uuid().optional(),
    date: z.string().optional(),
    openingBalances: z.array(openingBalanceSchema),
    items: z.array(stockEntrySchema).optional(),
    stockJournalMetadata: z.object({
        narration: z.string().optional(),
        date: z.string().optional()
    }).optional()
});

openingPositionRouter.post('/', requireAuth, async (req, res, next) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const businessId = req.user?.businessId;
        if (!businessId) throw httpError(401, 'Business context missing');

        const payload = openingPositionSchema.parse(req.body);

        const voucherDate =
            payload.date ||
            payload.stockJournalMetadata?.date ||
            new Date().toISOString().slice(0, 10);

        // -----------------------------
        // Validate BEFORE opening DB transaction.
        // Keep all structural validation in-memory to avoid partial inserts
        // and to avoid deferred trigger failures on commit.
        // -----------------------------
        const manualLines = (payload.openingBalances || [])
            .filter((bal) => bal.ledgerName?.trim() && bal.groupCode?.trim() && Number(bal.amount) > 0)
            .map((bal) => ({
                ledgerName: bal.ledgerName.trim(),
                groupCode: bal.groupCode.trim(),
                entryType: bal.drCr,
                amount: Number(bal.amount)
            }));

        const items = (payload.items || []).filter((item) => item.name?.trim() && Number(item.initialQty) > 0);
        const totalInventory = items.reduce(
            (sum, item) => sum + Number(item.initialQty) * Number(item.unitCost || 0),
            0
        );

        const plannedLines = [...manualLines];
        if (totalInventory > 0) {
            plannedLines.push({
                ledgerName: 'Stock-in-Hand',
                groupCode: 'CA',
                entryType: 'DR',
                amount: Number(totalInventory.toFixed(2))
            });
        }

        if (plannedLines.length < 2) {
            throw httpError(400, 'Opening Position must contain at least 2 ledger lines (including Stock-in-Hand if applicable)');
        }

        const totals = plannedLines.reduce(
            (acc, line) => {
                if (line.entryType === 'DR') acc.dr += line.amount;
                else acc.cr += line.amount;
                return acc;
            },
            { dr: 0, cr: 0 }
        );

        const difference = Number((totals.dr - totals.cr).toFixed(2));
        if (difference !== 0) {
            throw httpError(400, `Imbalanced Opening Position. Debits: ${Number(totals.dr.toFixed(2))}, Credits: ${Number(totals.cr.toFixed(2))}`);
        }

        await client.query('BEGIN');
        inTransaction = true;

        // -----------------------------
        // Load all groups for business
        // -----------------------------
        const groupsRes = await client.query(
            `SELECT id, code FROM account_groups WHERE business_id = $1`,
            [businessId]
        );

        const groupIdByCode = new Map(groupsRes.rows.map((row) => [row.code, row.id]));
        const findGroupIdByCode = (code) => groupIdByCode.get(code);

        const ensureAccount = async (name, groupId, normalBalance) => {
            const baseCode = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16) || 'LEDGER';
            const res = await client.query(
                `SELECT id FROM accounts WHERE business_id = $1 AND name = $2`,
                [businessId, name]
            );
            if (res.rows.length > 0) return res.rows[0].id;
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
                    // Unique violation; try a different code. (Name conflicts would have been caught by earlier SELECT.)
                    if (error?.code !== '23505') throw error;
                }
            }
            throw httpError(500, 'Failed to generate unique ledger code');
        };

        let voucherId = null;
        let ledgerCount = plannedLines.length;

        // -----------------------------
        // Create Transaction & Ledger Postings Sequence
        // -----------------------------
        const transactionRes = await client.query(
            `INSERT INTO transactions (business_id, txn_date, narration)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [businessId, voucherDate, payload.stockJournalMetadata?.narration || 'Opening Financial Position Entry']
        );
        const transactionId = transactionRes.rows[0].id;

        const voucherRes = await client.query(
            `INSERT INTO vouchers
             (business_id, transaction_id, voucher_type, voucher_number, voucher_date, narration, is_system_generated, status, posted_at, posted_by)
             VALUES ($1, $2, 'JOURNAL', $3, $4, $5, TRUE, 'POSTED', NOW(), 'SYSTEM')
             RETURNING id`,
            [
                businessId,
                transactionId,
                `OP-${Date.now()}`,
                voucherDate,
                payload.stockJournalMetadata?.narration || 'Opening Financial Position Entry'
            ]
        );
        voucherId = voucherRes.rows[0].id;

        // Get or create financial year for ledger_postings
        const fyRes = await client.query(
            `SELECT id, is_closed AS "isClosed"
             FROM financial_years
             WHERE business_id = $1 AND start_date <= $2::date AND end_date >= $2::date
             LIMIT 1`,
            [businessId, voucherDate]
        );

        let financialYearId = fyRes.rows[0]?.id || null;
        if (fyRes.rows[0]?.isClosed) {
            throw httpError(409, 'Financial year is closed for this posting date');
        }

        if (!financialYearId) {
            const parsedDate = new Date(`${voucherDate}T00:00:00`);
            const year = parsedDate.getFullYear();
            const month = parsedDate.getMonth() + 1;
            const startYear = month >= 4 ? year : year - 1;
            const endYear = startYear + 1;
            const fyLabel = `${startYear}-${String(endYear).slice(2)}`;
            const fStartDate = `${startYear}-04-01`;
            const fEndDate = `${endYear}-03-31`;

            const insertedFy = await client.query(
                `INSERT INTO financial_years (business_id, label, start_date, end_date, is_closed)
                 VALUES ($1, $2, $3::date, $4::date, FALSE) RETURNING id`,
                [businessId, fyLabel, fStartDate, fEndDate]
            );
            financialYearId = insertedFy.rows[0].id;
        }

        const resolvedLines = [];
        for (const line of plannedLines) {
            const groupId = findGroupIdByCode(line.groupCode);
            if (!groupId) throw httpError(400, `Account Group not found: ${line.groupCode}`);
            const accountId = await ensureAccount(line.ledgerName, groupId, line.entryType);
            resolvedLines.push({ accountId, entryType: line.entryType, amount: line.amount });
        }

        for (let i = 0; i < resolvedLines.length; i += 1) {
            const line = resolvedLines[i];
            await client.query(
                `INSERT INTO transaction_entries (transaction_id, line_no, account_id, entry_type, amount)
                 VALUES ($1, $2, $3, $4, $5)`,
                [transactionId, i + 1, line.accountId, line.entryType, line.amount]
            );
            await client.query(
                `INSERT INTO voucher_lines (voucher_id, line_no, account_id, entry_type, amount)
                 VALUES ($1, $2, $3, $4, $5)`,
                [voucherId, i + 1, line.accountId, line.entryType, line.amount]
            );

            await client.query(
                `INSERT INTO ledger_postings (business_id, financial_year_id, voucher_id, transaction_id, account_id, posting_date, debit, credit)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    businessId,
                    financialYearId,
                    voucherId,
                    transactionId,
                    line.accountId,
                    voucherDate,
                    line.entryType === 'DR' ? line.amount : 0,
                    line.entryType === 'CR' ? line.amount : 0
                ]
            );
        }

        // -----------------------------
        // Inventory Items
        // -----------------------------
        if (items.length) {
            for (const item of items) {
                let productRes = await client.query(
                    `SELECT id FROM products WHERE business_id = $1 AND name = $2`,
                    [businessId, item.name]
                );

                let productId;

                if (productRes.rows.length === 0) {
                    const sku =
                        item.sku ||
                        item.name.toUpperCase().replace(/\s+/g, '-').slice(0, 50);

                    const insertRes = await client.query(
                        `INSERT INTO products (business_id, name, sku, category)
                         VALUES ($1, $2, $3, 'General')
                         RETURNING id`,
                        [businessId, item.name, sku]
                    );

                    productId = insertRes.rows[0].id;
                } else {
                    productId = productRes.rows[0].id;
                }

                await client.query(
                    `INSERT INTO inventory_transactions
                     (business_id, product_id, voucher_id, transaction_date, quantity, unit_cost, total_value)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        businessId,
                        productId,
                        voucherId,
                        voucherDate,
                        item.initialQty,
                        item.unitCost,
                        item.initialQty * item.unitCost
                    ]
                );
            }
        }

        await client.query(
            `UPDATE businesses
             SET is_initialized = TRUE,
                 updated_at = NOW()
             WHERE id = $1`,
            [businessId]
        );

        await client.query('COMMIT');
        inTransaction = false;

        res.status(201).json({
            ok: true,
            implementation: 'opening-position-v2',
            voucherId,
            ledgerCount,
            stockValue: totalInventory
        });

    } catch (err) {
        if (err?.message && /must contain at least 2 lines/i.test(err.message)) {
            err = httpError(
                400,
                'Opening Position must contain at least 2 ledger lines and be balanced (DR = CR). Add a balancing capital/liability line if you entered stock.',
                { dbError: err.message }
            );
        }
        if (inTransaction) {
            try {
                await client.query('ROLLBACK');
            } catch {
                // ignore rollback errors
            }
        }

        if (err instanceof z.ZodError) {
            return next(httpError(400, 'Invalid payload', err.issues));
        }

        next(err);
    } finally {
        client.release();
    }
});