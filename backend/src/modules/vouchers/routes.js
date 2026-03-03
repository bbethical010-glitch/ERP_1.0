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

const inventoryLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  unitCost: z.number().positive().optional(),
  taxRate: z.number().nonnegative().optional(),
  taxAmount: z.number().nonnegative().optional()
});

const purchaseLineSchema = z.object({
  lineType: z.enum(['INVENTORY', 'FIXED_ASSET']).default('INVENTORY'),
  productId: z.string().uuid().optional(),
  quantity: z.number().positive().optional(),
  unitCost: z.number().nonnegative(),
  assetAccountId: z.string().uuid().optional(),
  assetAccountName: z.string().min(1).optional(),
  counterpartyAccountId: z.string().uuid().optional(),
  taxRate: z.number().nonnegative().optional(),
  taxAmount: z.number().nonnegative().optional()
}).superRefine((line, ctx) => {
  if (line.lineType === 'INVENTORY') {
    if (!line.productId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['productId'],
        message: 'Inventory purchase line requires productId'
      });
    }
    if (line.quantity === undefined || Number(line.quantity) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quantity'],
        message: 'Inventory purchase line requires positive quantity'
      });
    }
  }

  if (line.lineType === 'FIXED_ASSET' && !line.assetAccountId && !line.assetAccountName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assetAccountId'],
      message: 'Fixed asset line requires assetAccountId or assetAccountName'
    });
  }
});

const allocationSchema = z.object({
  targetVoucherId: z.string().uuid(),
  amount: z.number().positive()
});

const voucherSchema = z.object({
  voucherType: z.enum(['JOURNAL', 'PAYMENT', 'RECEIPT', 'SALES', 'PURCHASE', 'CONTRA']),
  voucherNumber: z.string().min(1).optional(),
  voucherDate: z.string().date(),
  narration: z.string().optional(),
  mode: z.enum(['DRAFT', 'POST']).optional(),
  actorId: z.string().optional(),
  inventoryLines: z
    .array(inventoryLineSchema)
    .optional(),
  purchaseLines: z
    .array(purchaseLineSchema)
    .optional(),
  allocations: z
    .array(allocationSchema)
    .optional(),
  entries: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        entryType: z.enum(['DR', 'CR']),
        amount: z.number().positive()
      })
    )
    .min(2)
    .optional()
}).superRefine((voucher, ctx) => {
  const hasEntries = Array.isArray(voucher.entries) && voucher.entries.length >= 2;
  const hasPurchaseLines = Array.isArray(voucher.purchaseLines) && voucher.purchaseLines.length > 0;
  if (!hasEntries && !(voucher.voucherType === 'PURCHASE' && hasPurchaseLines)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['entries'],
      message: 'Provide at least two entries, or for PURCHASE provide purchaseLines'
    });
  }
});

const reversalSchema = z.object({
  reversalVoucherNumber: z.string().min(1).optional(),
  reversalDate: z.string().date().optional(),
  narration: z.string().optional(),
  actorId: z.string().optional()
});

const lifecycleSchema = z.object({
  actorId: z.string().optional(),
  voucherType: z.enum(['JOURNAL', 'PAYMENT', 'RECEIPT', 'SALES', 'PURCHASE', 'CONTRA']).optional(),
  voucherNumber: z.string().min(1).optional(),
  voucherDate: z.string().date().optional(),
  narration: z.string().optional(),
  inventoryLines: z
    .array(inventoryLineSchema)
    .optional(),
  purchaseLines: z
    .array(purchaseLineSchema)
    .optional(),
  allocations: z
    .array(allocationSchema)
    .optional(),
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

function getBusinessId(req) {
  const businessId = req.user?.businessId;
  if (!businessId) {
    throw httpError(401, 'Business context missing in auth token');
  }
  return businessId;
}

vouchersRouter.post('/', async (req, res, next) => {
  try {
    const payload = voucherSchema.parse(req.body);
    const result = await createVoucher({
      ...payload,
      businessId: getBusinessId(req),
      actorId: req.user?.sub
    });
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
    const { from, to, voucherType, status, search, limit, offset } = req.query;

    const result = await listVouchers({
      businessId: getBusinessId(req),
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
    const voucher = await getVoucherById(req.params.voucherId, getBusinessId(req));
    res.json(voucher);
  } catch (error) {
    next(error);
  }
});

vouchersRouter.post('/:voucherId/post', async (req, res, next) => {
  try {
    const payload = lifecycleSchema.parse(req.body);
    const result = await postVoucher(req.params.voucherId, {
      ...payload,
      businessId: getBusinessId(req),
      actorId: req.user?.sub
    });
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
    const result = await cancelVoucher(req.params.voucherId, {
      ...payload,
      businessId: getBusinessId(req),
      actorId: req.user?.sub
    });
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
      businessId: getBusinessId(req),
      actorId: req.user?.sub,
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
    const result = await updateVoucher(req.params.voucherId, {
      ...payload,
      businessId: getBusinessId(req),
      actorId: req.user?.sub
    });
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
    const result = await deleteVoucher(req.params.voucherId, getBusinessId(req));
    res.json(result);
  } catch (error) {
    next(error);
  }
});
