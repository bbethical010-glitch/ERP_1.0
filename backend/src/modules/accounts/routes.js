import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';

export const accountsRouter = Router();

const createAccountSchema = z.object({
  businessId: z.string().uuid(),
  accountGroupId: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  normalBalance: z.enum(['DR', 'CR']),
  openingBalance: z.number().nonnegative().optional().default(0),
  openingBalanceType: z.enum(['DR', 'CR']).optional().default('DR')
});

const bootstrapSchema = z.object({
  businessId: z.string().uuid()
});

accountsRouter.get('/groups', async (req, res, next) => {
  try {
    const businessId = req.query.businessId;
    if (!businessId) {
      throw httpError(400, 'businessId query parameter is required');
    }

    const result = await pool.query(
      `SELECT id, name, code, category, parent_group_id AS "parentGroupId"
       FROM account_groups
       WHERE business_id = $1
       ORDER BY code`,
      [businessId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

accountsRouter.post('/groups/bootstrap', async (req, res, next) => {
  try {
    const { businessId } = bootstrapSchema.parse(req.body);
    await pool.query(
      `INSERT INTO account_groups (business_id, name, code, category, is_system)
       VALUES
        ($1, 'Current Assets', 'CA', 'CURRENT_ASSET', TRUE),
        ($1, 'Fixed Assets', 'FA', 'FIXED_ASSET', TRUE),
        ($1, 'Liabilities', 'LI', 'LIABILITY', TRUE),
        ($1, 'Income', 'IN', 'INCOME', TRUE),
        ($1, 'Expenses', 'EX', 'EXPENSE', TRUE),
        ($1, 'Capital', 'EQ', 'EQUITY', TRUE)
       ON CONFLICT (business_id, code) DO NOTHING`,
      [businessId]
    );
    res.status(201).json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid bootstrap payload', error.issues));
    }
    next(error);
  }
});

accountsRouter.get('/', async (req, res, next) => {
  try {
    const businessId = req.query.businessId;
    if (!businessId) {
      throw httpError(400, 'businessId query parameter is required');
    }

    const result = await pool.query(
      `SELECT a.id, a.code, a.name, a.normal_balance AS "normalBalance",
              a.opening_balance AS "openingBalance", a.opening_balance_type AS "openingBalanceType",
              ag.name AS "groupName", ag.category
       FROM accounts a
       JOIN account_groups ag ON ag.id = a.account_group_id
       WHERE a.business_id = $1
       ORDER BY a.code`,
      [businessId]
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

accountsRouter.post('/', async (req, res, next) => {
  try {
    const payload = createAccountSchema.parse(req.body);

    const result = await pool.query(
      `INSERT INTO accounts (business_id, account_group_id, code, name, normal_balance, opening_balance, opening_balance_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        payload.businessId,
        payload.accountGroupId,
        payload.code,
        payload.name,
        payload.normalBalance,
        payload.openingBalance,
        payload.openingBalanceType
      ]
    );

    res.status(201).json({ id: result.rows[0].id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid account payload', error.issues));
    }
    next(error);
  }
});
