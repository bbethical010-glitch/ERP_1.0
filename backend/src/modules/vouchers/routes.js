import { Router } from 'express';
import { z } from 'zod';
import { createVoucher, deleteVoucher, getVoucherById, updateVoucher } from './service.js';
import { pool } from '../../db/pool.js';
import { httpError } from '../../utils/httpError.js';

export const vouchersRouter = Router();

const voucherSchema = z.object({
  businessId: z.string().uuid(),
  voucherType: z.enum(['JOURNAL', 'PAYMENT', 'RECEIPT', 'SALES', 'PURCHASE']),
  voucherNumber: z.string().min(1),
  voucherDate: z.string().date(),
  narration: z.string().optional(),
  entries: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        entryType: z.enum(['DR', 'CR']),
        amount: z.number().positive()
      })
    )
    .min(2)
});

vouchersRouter.post('/', async (req, res, next) => {
  try {
    const payload = voucherSchema.parse(req.body);
    const result = await createVoucher(payload);
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid voucher payload', error.issues));
    }
    next(error);
  }
});

vouchersRouter.get('/', async (req, res, next) => {
  try {
    const businessId = req.query.businessId;
    const from = req.query.from;
    const to = req.query.to;

    if (!businessId) {
      throw httpError(400, 'businessId query parameter is required');
    }

    const result = await pool.query(
      `SELECT v.id, v.voucher_type AS "voucherType", v.voucher_number AS "voucherNumber",
              v.voucher_date AS "voucherDate", v.narration,
              t.id AS "transactionId", t.txn_date AS "transactionDate"
       FROM vouchers v
       JOIN transactions t ON t.id = v.transaction_id
       WHERE v.business_id = $1
         AND ($2::date IS NULL OR v.voucher_date >= $2::date)
         AND ($3::date IS NULL OR v.voucher_date <= $3::date)
       ORDER BY v.voucher_date DESC, v.created_at DESC`,
      [businessId, from || null, to || null]
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

vouchersRouter.get('/:voucherId', async (req, res, next) => {
  try {
    const businessId = req.query.businessId;
    if (!businessId) {
      throw httpError(400, 'businessId query parameter is required');
    }

    const voucher = await getVoucherById(req.params.voucherId, businessId);
    res.json(voucher);
  } catch (error) {
    next(error);
  }
});

vouchersRouter.put('/:voucherId', async (req, res, next) => {
  try {
    const payload = voucherSchema.parse(req.body);
    const result = await updateVoucher(req.params.voucherId, payload);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid voucher payload', error.issues));
    }
    next(error);
  }
});

vouchersRouter.delete('/:voucherId', async (req, res, next) => {
  try {
    const businessId = req.query.businessId;
    if (!businessId) {
      throw httpError(400, 'businessId query parameter is required');
    }
    const result = await deleteVoucher(req.params.voucherId, businessId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
