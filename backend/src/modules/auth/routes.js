import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { createAuthToken } from '../../utils/authToken.js';
import { httpError } from '../../utils/httpError.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { pool } from '../../db/pool.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';

export const authRouter = Router();

const DEFAULT_BUSINESS_ID = '00000000-0000-0000-0000-000000000001';
const USER_ROLES = ['OWNER', 'MANAGER', 'ACCOUNTANT', 'VIEWER'];

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const createUserSchema = z.object({
  businessId: z.string().uuid().optional(),
  username: z.string().min(3).max(50),
  displayName: z.string().min(2).max(100),
  password: z.string().min(6).max(128),
  role: z.enum(USER_ROLES).default('ACCOUNTANT')
});

const registerSchema = createUserSchema.extend({
  ownerUsername: z.string().min(1),
  ownerPassword: z.string().min(1)
});

function normalizeUsername(username) {
  return String(username || '')
    .trim()
    .toLowerCase();
}

function mapUserRow(row) {
  return {
    id: row.id,
    businessId: row.businessId,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    isActive: row.isActive
  };
}

async function getUserByUsername(username) {
  const result = await pool.query(
    `SELECT id,
            business_id AS "businessId",
            username,
            display_name AS "displayName",
            password_hash AS "passwordHash",
            role,
            is_active AS "isActive"
     FROM app_users
     WHERE LOWER(username) = LOWER($1)
     LIMIT 1`,
    [normalizeUsername(username)]
  );
  return result.rows[0] || null;
}

function getBusinessIdFromReq(req, fallback = DEFAULT_BUSINESS_ID) {
  return req.user?.businessId || fallback;
}

function ensureOwnerRole(userPayload) {
  if (userPayload?.role !== 'OWNER') {
    throw httpError(403, 'Only owner users can manage users');
  }
}

authRouter.post('/login', async (req, res, next) => {
  try {
    const payload = loginSchema.parse(req.body);
    const user = await getUserByUsername(payload.username);

    if (!user || !user.isActive) {
      throw httpError(401, 'Invalid username or password');
    }

    if (!verifyPassword(payload.password, user.passwordHash)) {
      throw httpError(401, 'Invalid username or password');
    }

    await pool.query(`UPDATE app_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`, [
      user.id
    ]);

    const authUser = mapUserRow(user);
    const token = createAuthToken(
      {
        sub: authUser.id,
        username: authUser.username,
        businessId: authUser.businessId,
        name: authUser.displayName,
        role: authUser.role
      },
      env.authSecret
    );

    res.json({ token, user: authUser });
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
      throw httpError(400, 'Owner role cannot be created from public register');
    }

    const owner = await getUserByUsername(payload.ownerUsername);
    if (!owner || !owner.isActive || owner.role !== 'OWNER') {
      throw httpError(401, 'Invalid owner credentials');
    }

    if (!verifyPassword(payload.ownerPassword, owner.passwordHash)) {
      throw httpError(401, 'Invalid owner credentials');
    }

    const businessId = payload.businessId || owner.businessId;
    const result = await pool.query(
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
                 is_active AS "isActive"`,
      [
        businessId,
        normalizeUsername(payload.username),
        payload.displayName.trim(),
        hashPassword(payload.password),
        payload.role,
        owner.id
      ]
    );

    res.status(201).json(mapUserRow(result.rows[0]));
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

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.sub,
    username: req.user.username || req.user.sub,
    displayName: req.user.name,
    role: req.user.role,
    businessId: req.user.businessId || DEFAULT_BUSINESS_ID
  });
});

authRouter.get('/users', requireAuth, async (req, res, next) => {
  try {
    ensureOwnerRole(req.user);
    const businessId = req.query.businessId || getBusinessIdFromReq(req);
    const result = await pool.query(
      `SELECT id,
              business_id AS "businessId",
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
    ensureOwnerRole(req.user);
    const payload = createUserSchema.parse(req.body);
    const businessId = payload.businessId || getBusinessIdFromReq(req);
    const result = await pool.query(
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
      [
        businessId,
        normalizeUsername(payload.username),
        payload.displayName.trim(),
        hashPassword(payload.password),
        payload.role,
        req.user.sub
      ]
    );
    res.status(201).json(result.rows[0]);
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
