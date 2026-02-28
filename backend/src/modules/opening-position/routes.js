import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';
import { requireAuth } from '../../middleware/requireAuth.js';

export const openingPositionRouter = Router();

const stockEntrySchema = z.object({
    name: z.string().min(1),
    category: z.string().optional(),
    quantity: z.number().positive(),
    unitCost: z.number().nonnegative(),
});

const openingPositionSchema = z.object({
    assets: z.array(z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        amount: z.number().nonnegative()
    })),
    liabilities: z.array(z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        amount: z.number().nonnegative()
    })),
    capital: z.number().nonnegative(),
    inventory: z.array(stockEntrySchema)
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

        // Server-side validation
        let totalAssets = payload.assets.reduce((sum, item) => sum + item.amount, 0);
        const totalLiabilities = payload.liabilities.reduce((sum, item) => sum + item.amount, 0);
        let totalInventory = 0;

        payload.inventory.forEach(item => {
            totalInventory += (item.quantity * item.unitCost);
        });

        totalAssets += totalInventory;

        // Variance check: Assets = Liabilities + Capital
        // Due to floating point math, use a slight delta tolerance if necessary, or Math.round
        if (Math.abs(totalAssets - (totalLiabilities + payload.capital)) > 0.01) {
            throw httpError(400, `Imbalanced Opening Position. Assets: ${totalAssets}, Liabilities+Capital: ${totalLiabilities + payload.capital}`);
        }

        await client.query('BEGIN');

        // 1. Fetch system account groups mapping
        const groupsRes = await client.query(
            `SELECT id, category FROM account_groups WHERE business_id = $1`,
            [businessId]
        );
        const getGroup = (cat) => groupsRes.rows.find(g => g.category === cat)?.id;

        if (!getGroup('CURRENT_ASSET') || !getGroup('LIABILITY') || !getGroup('EQUITY')) {
            throw httpError(500, 'System account groups missing. Has the database been properly initialized?');
        }

        // Helper: Find or Create Ledger Account
        const ensureAccount = async (code, name, groupId, normalBalance) => {
            const res = await client.query(
                `SELECT id FROM accounts WHERE business_id = $1 AND code = $2`,
                [businessId, code]
            );
            if (res.rows.length > 0) return res.rows[0].id;

            const inserted = await client.query(
                `INSERT INTO accounts(business_id, account_group_id, code, name, normal_balance) 
         VALUES($1, $2, $3, $4, $5) RETURNING id`,
                [businessId, groupId, code, name, normalBalance]
            );
            return inserted.rows[0].id;
        };

        const voucherDateResult = await client.query(
            `SELECT financial_year_start FROM businesses WHERE id = $1`,
            [businessId]
        );
        const voucherDate = voucherDateResult.rows[0]?.financial_year_start || new Date().toISOString().slice(0, 10);

        // 2. Create the Opening Journal Voucher
        // Create transaction first
        const transactionRes = await client.query(
            `INSERT INTO transactions(business_id, txn_date, narration) VALUES($1, $2, $3) RETURNING id`,
            [businessId, voucherDate, 'Opening Financial Position Entry']
        );
        const transactionId = transactionRes.rows[0].id;

        // Create voucher
        const voucherRes = await client.query(
            `INSERT INTO vouchers(business_id, transaction_id, voucher_type, voucher_number, voucher_date, narration, is_system_generated)
       VALUES($1, $2, 'JOURNAL', 'OP-BAL-01', $3, 'Opening Financial Position Entry', TRUE) RETURNING id`,
            [businessId, transactionId, voucherDate]
        );
        const voucherId = voucherRes.rows[0].id;

        let lineNo = 1;

        // 3. Process Assets
        for (const asset of payload.assets) {
            if (asset.amount <= 0) continue;
            const actId = await ensureAccount(asset.code, asset.name, getGroup('CURRENT_ASSET'), 'DR');

            await client.query(
                `INSERT INTO transaction_entries(transaction_id, line_no, account_id, entry_type, amount) VALUES($1, $2, $3, 'DR', $4)`,
                [transactionId, lineNo++, actId, asset.amount]
            );
        }

        // Process Inventory Roll-up Asset
        if (totalInventory > 0) {
            const invActId = await ensureAccount('CA-INV', 'Inventory Control', getGroup('CURRENT_ASSET'), 'DR');
            await client.query(
                `INSERT INTO transaction_entries(transaction_id, line_no, account_id, entry_type, amount) VALUES($1, $2, $3, 'DR', $4)`,
                [transactionId, lineNo++, invActId, totalInventory]
            );
        }

        // 4. Process Liabilities
        for (const liab of payload.liabilities) {
            if (liab.amount <= 0) continue;
            const actId = await ensureAccount(liab.code, liab.name, getGroup('LIABILITY'), 'CR');

            await client.query(
                `INSERT INTO transaction_entries(transaction_id, line_no, account_id, entry_type, amount) VALUES($1, $2, $3, 'CR', $4)`,
                [transactionId, lineNo++, actId, liab.amount]
            );
        }

        // 5. Process Capital
        if (payload.capital > 0) {
            const actId = await ensureAccount('EQ-CAP', 'Owner Capital', getGroup('EQUITY'), 'CR');

            await client.query(
                `INSERT INTO transaction_entries(transaction_id, line_no, account_id, entry_type, amount) VALUES($1, $2, $3, 'CR', $4)`,
                [transactionId, lineNo++, actId, payload.capital]
            );
        }

        // 6. Process Stock/Inventory lines
        for (const item of payload.inventory) {
            // Find or create product
            let productRes = await client.query(`SELECT id FROM products WHERE business_id = $1 AND name = $2`, [businessId, item.name]);
            let productId;
            if (productRes.rows.length === 0) {
                // Assume SKU is basically the name formatted, or skip SKU for now
                const sku = item.name.toUpperCase().replace(/\\s+/g, '-').slice(0, 50);
                const insertRes = await client.query(
                    `INSERT INTO products(business_id, name, sku, category) VALUES($1, $2, $3, $4) RETURNING id`,
                    [businessId, item.name, sku, item.category || 'General']
                );
                productId = insertRes.rows[0].id;
            } else {
                productId = productRes.rows[0].id;
            }

            const totalVal = item.quantity * item.unitCost;
            await client.query(
                `INSERT INTO inventory_transactions(business_id, product_id, voucher_id, transaction_date, quantity, unit_cost, total_value)
         VALUES($1, $2, $3, $4, $5, $6, $7)`,
                [businessId, productId, voucherId, voucherDate, item.quantity, item.unitCost, totalVal]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Opening position posted successfully', voucherId });
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
