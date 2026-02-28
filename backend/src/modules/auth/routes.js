import { Router } from 'express';
import { z } from 'zod';
import { createAuthToken } from '../../utils/authToken.js';
import { httpError } from '../../utils/httpError.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';

export const authRouter = Router();
const DEFAULT_BUSINESS_ID = '00000000-0000-0000-0000-000000000001';
const USER_ROLES = ['OWNER', 'MANAGER', 'ACCOUNTANT', 'VIEWER'];

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const userCreateSchema = z.object({
  username: z.string().min(3).max(50),
  displayName: z.string().min(2).max(100),
  password: z.string().min(6).max(128),
  role: z.enum(USER_ROLES).default('ACCOUNTANT')
});

const signupSchema = z.object({
  companyName: z.string().min(2).max(120),
  username: z.string().min(3).max(50),
  displayName: z.string().min(2).max(100),
  password: z.string().min(6).max(128),
  baseCurrency: z.string().length(3).optional().default('INR')
});

const registerSchema = userCreateSchema.extend({
  ownerUsername: z.string().min(1),
  ownerPassword: z.string().min(1)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(128)
});

function normalizeUsername(username) {
  return String(username || '')
    .trim()
    .toLowerCase();
}

function requireOwner(req) {
  if (req.user?.role !== 'OWNER') {
    throw httpError(403, 'Only owner users can manage users');
  }
}

function getAuthBusinessId(req) {
  const businessId = req.user?.businessId;
  if (!businessId) {
    throw httpError(401, 'Business context missing in auth token');
  }
  return businessId;
}

async function bootstrapBusinessDefaults(client, businessId) {
  // 1️⃣ Insert ROOT groups (idempotent)
  await client.query(
    `
    INSERT INTO account_groups (business_id, name, code, category, parent_group_id, is_system)
    VALUES
      ($1, 'Current Assets', 'CA', 'CURRENT_ASSET'::account_group_category, NULL, TRUE),
      ($1, 'Fixed Assets', 'FA', 'FIXED_ASSET'::account_group_category, NULL, TRUE),
      ($1, 'Liabilities', 'LI', 'LIABILITY'::account_group_category, NULL, TRUE),
      ($1, 'Income', 'IN', 'INCOME'::account_group_category, NULL, TRUE),
      ($1, 'Expenses', 'EX', 'EXPENSE'::account_group_category, NULL, TRUE),
      ($1, 'Capital Account', 'EQ', 'EQUITY'::account_group_category, NULL, TRUE)
    ON CONFLICT (business_id, code) DO NOTHING
    `,
    [businessId]
  );

  // 2️⃣ Fetch root groups for parent mapping
  const rootGroups = await client.query(
    `SELECT id, code, category FROM account_groups WHERE business_id = $1`,
    [businessId]
  );

  const getParentId = (code) => {
    const found = rootGroups.rows.find(r => r.code === code);
    return found ? found.id : null;
  };

  // 3️⃣ Insert SUB groups (idempotent)
  await client.query(
    `
    INSERT INTO account_groups
    (business_id, name, code, category, parent_group_id, is_system)
    VALUES
      ($1, 'Cash-in-Hand', 'CA-CASH', 'CURRENT_ASSET'::account_group_category, $2, TRUE),
      ($1, 'Bank Accounts', 'CA-BANK', 'CURRENT_ASSET'::account_group_category, $2, TRUE),
      ($1, 'Sundry Debtors', 'CA-AR', 'CURRENT_ASSET'::account_group_category, $2, TRUE),

      ($1, 'Sundry Creditors', 'LI-AP', 'LIABILITY'::account_group_category, $3, TRUE),

      ($1, 'Sales Accounts', 'IN-SALES', 'INCOME'::account_group_category, $4, TRUE),

      ($1, 'Purchase Accounts', 'EX-PUR', 'EXPENSE'::account_group_category, $5, TRUE),
      ($1, 'Indirect Expenses', 'EX-IND', 'EXPENSE'::account_group_category, $5, TRUE)
    ON CONFLICT (business_id, code) DO NOTHING
    `,
    [
      businessId,
      getParentId('CA'), // $2
      getParentId('LI'), // $3
      getParentId('IN'), // $4
      getParentId('EX')  // $5
    ]
  );
}

authRouter.post('/login', async (req, res, next) => {
  try {
    const payload = loginSchema.parse(req.body);
    const username = normalizeUsername(payload.username);

    const result = await pool.query(
      `SELECT id, business_id AS "businessId", username, display_name AS "displayName", role, password_hash AS "passwordHash", is_active AS "isActive"
       FROM app_users
       WHERE LOWER(username) = LOWER($1)
       LIMIT 1`,
      [username]
    );

    let user = result.rows[0];

    // Backward-compat fallback for initial bootstrap before DB user creation.
    if (!user && username === normalizeUsername(env.adminUsername) && payload.password === env.adminPassword) {
      user = {
        id: env.adminUsername,
        businessId: DEFAULT_BUSINESS_ID,
        username: env.adminUsername,
        displayName: env.adminDisplayName,
        role: 'OWNER',
        isActive: true,
        passwordHash: null
      };
    }

    if (!user || !user.isActive) {
      throw httpError(401, 'Invalid username or password');
    }

    if (user.passwordHash && !verifyPassword(payload.password, user.passwordHash)) {
      throw httpError(401, 'Invalid username or password');
    }

    await pool.query(`UPDATE app_users SET last_login_at = NOW() WHERE id = $1`, [user.id]).catch(() => { });

    const token = createAuthToken(
      {
        sub: user.id,
        username: user.username,
        businessId: user.businessId,
        name: user.displayName,
        role: user.role
      },
      env.authSecret
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        businessId: user.businessId
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid login payload', error.issues));
    }
    next(error);
  }
});

authRouter.post('/register', async (req, res, next) => {
  try {
    const payload = registerSchema.parse(req.body);
    if (payload.role === 'OWNER') {
      throw httpError(400, 'Owner role cannot be created from sign up');
    }

    const ownerResult = await pool.query(
      `SELECT id, business_id AS "businessId", role, password_hash AS "passwordHash", is_active AS "isActive"
       FROM app_users
       WHERE LOWER(username) = LOWER($1)
       LIMIT 1`,
      [normalizeUsername(payload.ownerUsername)]
    );

    if (ownerResult.rows.length === 0) {
      throw httpError(401, 'Invalid owner credentials');
    }

    const owner = ownerResult.rows[0];
    if (!owner.isActive || owner.role !== 'OWNER') {
      throw httpError(401, 'Invalid owner credentials');
    }

    if (!verifyPassword(payload.ownerPassword, owner.passwordHash)) {
      throw httpError(401, 'Invalid owner credentials');
    }

    const businessId = owner.businessId;
    if (!businessId) {
      throw httpError(500, 'Owner business context is missing');
    }
    const username = normalizeUsername(payload.username);
    const passwordHash = hashPassword(payload.password);

    const inserted = await pool.query(
      `INSERT INTO app_users (
         business_id,
         username,
         display_name,
         password_hash,
         role,
         is_active,
         created_by
       ) VALUES ($1, $2, $3, $4, $5, TRUE, $6)
       RETURNING id,
                 business_id AS "businessId",
                 username,
                 display_name AS "displayName",
                 role,
                 is_active AS "isActive",
                 created_at AS "createdAt"`,
      [businessId, username, payload.displayName.trim(), passwordHash, payload.role, owner.id]
    );

    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid register payload', error.issues));
    }
    if (error?.code === '23505') {
      return next(httpError(409, 'Username already exists'));
    }
    next(error);
  }
});

authRouter.post('/signup', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const payload = signupSchema.parse(req.body);
    const username = normalizeUsername(payload.username);

    const existing = await client.query(`SELECT 1 FROM app_users WHERE LOWER(username) = LOWER($1) LIMIT 1`, [
      username
    ]);
    if (existing.rows.length > 0) {
      throw httpError(409, 'Username already exists');
    }

    await client.query('BEGIN');

    const businessRes = await client.query(
      `INSERT INTO businesses (name, base_currency)
       VALUES ($1, $2)
       RETURNING id`,
      [payload.companyName.trim(), payload.baseCurrency.toUpperCase()]
    );

    const businessId = businessRes.rows[0].id;
    await bootstrapBusinessDefaults(client, businessId);

    const ownerRes = await client.query(
      `INSERT INTO app_users (business_id, username, display_name, password_hash, role, is_active, created_by)
       VALUES ($1, $2, $3, $4, 'OWNER', TRUE, 'SYSTEM')
       RETURNING id, username, display_name AS "displayName", role`,
      [businessId, username, payload.displayName.trim(), hashPassword(payload.password)]
    );

    await client.query('COMMIT');

    const ledgerCountRes = await pool.query('SELECT COUNT(*) FROM accounts WHERE business_id = $1', [businessId]);
    const voucherCountRes = await pool.query('SELECT COUNT(*) FROM vouchers WHERE business_id = $1', [businessId]);

    console.log(`[BOOTSTRAP] New Company Created (${businessId})`);
    console.log(`[BOOTSTRAP] Initial ledger count: ${ledgerCountRes.rows[0].count}`);
    console.log(`[BOOTSTRAP] Initial voucher count: ${voucherCountRes.rows[0].count}`);

    const owner = ownerRes.rows[0];
    const token = createAuthToken(
      {
        sub: owner.id,
        username: owner.username,
        businessId,
        name: owner.displayName,
        role: owner.role
      },
      env.authSecret
    );

    res.status(201).json({
      token,
      user: {
        id: owner.id,
        username: owner.username,
        displayName: owner.displayName,
        role: owner.role,
        businessId
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => { });
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid signup payload', error.issues));
    }
    next(error);
  } finally {
    client.release();
  }
});

authRouter.get('/me', requireAuth, (req, res) => {
  const businessId = getAuthBusinessId(req);
  res.json({
    id: req.user.sub,
    username: req.user.username || req.user.sub,
    displayName: req.user.name,
    role: req.user.role,
    businessId
  });
});

authRouter.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const payload = changePasswordSchema.parse(req.body);
    if (payload.currentPassword === payload.newPassword) {
      throw httpError(400, 'New password must be different from current password');
    }

    const businessId = getAuthBusinessId(req);

    let result = await pool.query(
      `SELECT id, password_hash AS "passwordHash"
       FROM app_users
       WHERE id = $1 AND business_id = $2
       LIMIT 1`,
      [req.user.sub, businessId]
    );

    // Backward compatibility: token may have legacy "sub=username".
    if (result.rows.length === 0 && req.user.username) {
      result = await pool.query(
        `SELECT id, password_hash AS "passwordHash"
         FROM app_users
         WHERE LOWER(username) = LOWER($1) AND business_id = $2
         LIMIT 1`,
        [req.user.username, businessId]
      );
    }

    if (result.rows.length === 0) {
      throw httpError(404, 'User not found');
    }

    const dbUser = result.rows[0];
    if (!verifyPassword(payload.currentPassword, dbUser.passwordHash)) {
      throw httpError(401, 'Current password is incorrect');
    }

    const passwordHash = hashPassword(payload.newPassword);
    await pool.query(`UPDATE app_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [
      passwordHash,
      dbUser.id
    ]);

    res.json({ ok: true, message: 'Password changed successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid password payload', error.issues));
    }
    next(error);
  }
});

authRouter.get('/users', requireAuth, async (req, res, next) => {
  try {
    requireOwner(req);
    const businessId = getAuthBusinessId(req);
    const result = await pool.query(
      `SELECT id,
              username,
              display_name AS "displayName",
              role,
              is_active AS "isActive",
              created_at AS "createdAt",
              last_login_at AS "lastLoginAt"
       FROM app_users
       WHERE business_id = $1
       ORDER BY created_at DESC`,
      [businessId]
    );
    res.json({ items: result.rows });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/users', requireAuth, async (req, res, next) => {
  try {
    requireOwner(req);
    const payload = userCreateSchema.parse(req.body);
    const businessId = getAuthBusinessId(req);
    const username = normalizeUsername(payload.username);
    const passwordHash = hashPassword(payload.password);

    const inserted = await pool.query(
      `INSERT INTO app_users (
         business_id,
         username,
         display_name,
         password_hash,
         role,
         is_active,
         created_by
       ) VALUES ($1, $2, $3, $4, $5, TRUE, $6)
       RETURNING id,
                 username,
                 display_name AS "displayName",
                 role,
                 is_active AS "isActive",
                 created_at AS "createdAt"`,
      [businessId, username, payload.displayName.trim(), passwordHash, payload.role, req.user.sub]
    );

    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid user payload', error.issues));
    }
    if (error?.code === '23505') {
      return next(httpError(409, 'Username already exists'));
    }
    next(error);
  }
});
