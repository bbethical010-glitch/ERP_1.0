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
    group: z.string().min(1),
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

/**
 * POST /api/v1/opening-position
 * Submits the opening financial position and inventory.
 */
openingPositionRouter.post('/', requireAuth, async (req, res, next) => {
    const client = await pool.connect();
    try {
        const businessId = req.user?.businessId;
        if (!businessId) throw httpError(401, 'Business context missing');

        const payload = openingPositionSchema.parse(req.body);

        console.log(`[OPENING] Begin opening-post for ${businessId}`);

        let totalDr = 0;
        let totalCr = 0;
        let totalInventory = 0;

        // 1. Calculate Ledger Totals
        payload.openingBalances.forEach(bal => {
            if (bal.drCr === 'DR') totalDr += bal.amount;
            else totalCr += bal.amount;
        });

        // 2. Calculate Inventory Total
        if (payload.items) {
            payload.items.forEach(item => {
                totalInventory += (item.initialQty * item.unitCost);
            });
            totalDr += totalInventory;
        }

        // Variance check: Dr = Cr
        if (Math.abs(totalDr - totalCr) > 0.01) {
            throw httpError(400, `Imbalanced Opening Position. Debits: ${totalDr}, Credits: ${totalCr}`);
        }

        await client.query('BEGIN');

        // Fetch system account groups mapping for dynamic assignment
        const groupsRes = await client.query(
            `SELECT id, name FROM account_groups WHERE business_id = $1`,
            [businessId]
        );
        const getGroupId = (groupName) => {
            const found = groupsRes.rows.find(g => g.name.toLowerCase() === groupName.toLowerCase());
            if (!found) {
                // Return a default ID if the exact group isn't found, or ideally we'd throw
                const def = groupsRes.rows.find(g => g.name === 'Current Assets');
                return def ? def.id : null;
            }
            return found.id;
        };

        // Helper: Find or Create Ledger Account
        const ensureAccount = async (name, groupId, normalBalance) => {
            const code = name.toUpperCase().replace(/\s+/g, '-').slice(0, 20);
            const res = await client.query(
                `SELECT id FROM accounts WHERE business_id = $1 AND name = $2`,
                [businessId, name]
            );
            if (res.rows.length > 0) return res.rows[0].id;

            const inserted = await client.query(
                `INSERT INTO accounts(business_id, account_group_id, code, name, normal_balance) 
         VALUES($1, $2, $3, $4, $5) RETURNING id`,
                [businessId, groupId, code, name, normalBalance]
            );
            return inserted.rows[0].id;
        };

        const voucherDate = payload.date || payload.stockJournalMetadata?.date || new Date().toISOString().slice(0, 10);

        // Create the Opening Journal Voucher
        const transactionRes = await client.query(
            `INSERT INTO transactions(business_id, txn_date, narration) VALUES($1, $2, $3) RETURNING id`,
            [businessId, voucherDate, 'Opening Financial Position Entry']
        );
        const transactionId = transactionRes.rows[0].id;

        const voucherRes = await client.query(
            `INSERT INTO vouchers(business_id, transaction_id, voucher_type, voucher_number, voucher_date, narration, is_system_generated)
       VALUES($1, $2, 'JOURNAL', 'OP-BAL-01', $3, 'Opening Financial Position Entry', TRUE) RETURNING id`,
            [businessId, transactionId, voucherDate]
        );
        const voucherId = voucherRes.rows[0].id;

        let lineNo = 1;
        let ledgerCount = 0;

        // Process all opening balances
        for (const bal of payload.openingBalances) {
            if (bal.amount <= 0) continue;

            const groupId = getGroupId(bal.group);
            if (!groupId) throw httpError(400, `Account Group not found: ${bal.group}`);

            const actId = await ensureAccount(bal.ledgerName, groupId, bal.drCr);
            ledgerCount++;

            await client.query(
                `INSERT INTO transaction_entries(transaction_id, line_no, account_id, entry_type, amount) VALUES($1, $2, $3, $4, $5)`,
                [transactionId, lineNo++, actId, bal.drCr, bal.amount]
            );
        }

        // Process Inventory Roll-up Asset
        if (totalInventory > 0) {
            const stockGroupId = getGroupId('Current Assets');
            const invActId = await ensureAccount('Stock-in-Hand', stockGroupId, 'DR');
            ledgerCount++;

            await client.query(
                `INSERT INTO transaction_entries(transaction_id, line_no, account_id, entry_type, amount) VALUES($1, $2, $3, 'DR', $4)`,
                [transactionId, lineNo++, invActId, totalInventory]
            );
        }

        // Process Stock/Inventory lines
        let itemsCount = 0;
        if (payload.items && payload.items.length > 0) {
            for (const item of payload.items) {
                // Find or create product
                let productRes = await client.query(`SELECT id FROM products WHERE business_id = $1 AND name = $2`, [businessId, item.name]);
                let productId;
                if (productRes.rows.length === 0) {
                    const sku = item.sku || item.name.toUpperCase().replace(/\s+/g, '-').slice(0, 50);
                    const insertRes = await client.query(
                        `INSERT INTO products(business_id, name, sku, category) VALUES($1, $2, $3, $4) RETURNING id`,
                        [businessId, item.name, sku, 'General']
                    );
                    productId = insertRes.rows[0].id;
                } else {
                    productId = productRes.rows[0].id;
                }
                itemsCount++;

                const totalVal = item.initialQty * item.unitCost;
                await client.query(
                    `INSERT INTO inventory_transactions(business_id, product_id, voucher_id, transaction_date, quantity, unit_cost, total_value)
             VALUES($1, $2, $3, $4, $5, $6, $7)`,
                    [businessId, productId, voucherId, voucherDate, item.initialQty, item.unitCost, totalVal]
                );
            }
        }

        // Mark Business as Initialized
        await client.query(
            "UPDATE businesses SET is_initialized = TRUE, updated_at = NOW() WHERE id = $1",
            [businessId]
        );

        await client.query('COMMIT');

        console.log(`[OPENING] Created items: ${itemsCount}; ledgerCount: ${ledgerCount}; voucherId: ${voucherId}; stockValue: ${totalInventory.toFixed(2)}`);

        res.status(201).json({
            ok: true,
            message: 'Opening position posted successfully',
            stockValue: parseFloat(totalInventory.toFixed(2)),
            ledgerCount,
            voucherId
        });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err instanceof z.ZodError) {
            return next(httpError(400, 'Invalid payload', err.issues));
        }
        next(err);
    } finally {
        client.release();
    }
});
