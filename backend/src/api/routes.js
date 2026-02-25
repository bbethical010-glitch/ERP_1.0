import { Router } from 'express';
import { accountsRouter } from '../modules/accounts/routes.js';
import { vouchersRouter } from '../modules/vouchers/routes.js';
import { reportsRouter } from '../modules/reports/routes.js';
import { daybookRouter } from '../modules/daybook/routes.js';
import { ledgerRouter } from '../modules/ledger/routes.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'accounting-erp-backend' });
});

apiRouter.use('/accounts', accountsRouter);
apiRouter.use('/vouchers', vouchersRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/daybook', daybookRouter);
apiRouter.use('/ledger', ledgerRouter);
