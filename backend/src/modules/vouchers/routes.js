import { Router } from 'express';
import { z } from 'zod';
import {
  cancelVoucher,
  createVoucher,
  deleteVoucher,
  getVoucherById,
  listVouchers,
  postVoucher,
  reverseVoucher,
  updateVoucher
} from './service.js';
import { httpError } from '../../utils/httpError.js';

export const vouchersRouter = Router();

const voucherSchema = z.object({
  businessId: z.string().uuid(),
  voucherType: z.enum(['JOURNAL', 'PAYMENT', 'RECEIPT', 'SALES', 'PURCHASE', 'CONTRA']),
  voucherNumber: z.string().min(1).optional(),
  voucherDate: z.string().date(),
  narration: z.string().optional(),
  mode: z.enum(['DRAFT', 'POST']).optional(),
  actorId: z.string().optional(),
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

const reversalSchema = z.object({
  businessId: z.string().uuid(),
  reversalVoucherNumber: z.string().min(1).optional(),
  reversalDate: z.string().date().optional(),
  narration: z.string().optional(),
  actorId: z.string().optional()
});

const lifecycleSchema = z.object({
  businessId: z.string().uuid(),
  actorId: z.string().optional(),
  voucherType: z.enum(['JOURNAL', 'PAYMENT', 'RECEIPT', 'SALES', 'PURCHASE', 'CONTRA']).optional(),
  voucherNumber: z.string().min(1).optional(),
  voucherDate: z.string().date().optional(),
  narration: z.string().optional(),
  entries: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        entryType: z.enum(['DR', 'CR']),
        amount: z.number().positive()
      })
    )
    .optional()
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
    const { businessId, from, to, voucherType, status, search, limit, offset } = req.query;

    if (!businessId) {
      throw httpError(400, 'businessId query parameter is required');
    }

    const result = await listVouchers({
      businessId,
      from,
      to,
      voucherType,
      status,
      search,
      limit,
      offset
    });

    res.json(result);
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

vouchersRouter.post('/:voucherId/post', async (req, res, next) => {
  try {
    const payload = lifecycleSchema.parse(req.body);
    const result = await postVoucher(req.params.voucherId, payload);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid post payload', error.issues));
    }
    next(error);
  }
});

vouchersRouter.post('/:voucherId/cancel', async (req, res, next) => {
  try {
    const payload = lifecycleSchema.parse(req.body);
    const result = await cancelVoucher(req.params.voucherId, payload);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid cancel payload', error.issues));
    }
    next(error);
  }
});

vouchersRouter.post('/:voucherId/reverse', async (req, res, next) => {
  try {
    const payload = reversalSchema.parse(req.body);
    const result = await reverseVoucher(req.params.voucherId, {
      ...payload,
      reversalDate: payload.reversalDate || new Date().toISOString().slice(0, 10)
    });
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(httpError(400, 'Invalid reversal payload', error.issues));
    }
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
