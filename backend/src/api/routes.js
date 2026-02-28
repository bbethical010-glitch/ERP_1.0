import { Router } from 'express';
import { accountsRouter } from '../modules/accounts/routes.js';
import { vouchersRouter } from '../modules/vouchers/routes.js';
import { reportsRouter } from '../modules/reports/routes.js';
import { daybookRouter } from '../modules/daybook/routes.js';
import { ledgerRouter } from '../modules/ledger/routes.js';
import { authRouter } from '../modules/auth/routes.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { dashboardRouter } from '../modules/dashboard/routes.js';
import { resetRouter } from '../modules/reset/routes.js';
import { auditRouter } from '../modules/audit/routes.js';
import { openingPositionRouter } from '../modules/opening-position/routes.js';
import { requireInitialized } from '../middleware/requireInitialized.js';
import { businessesRouter } from '../modules/businesses/routes.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'accounting-erp-backend' });
});

apiRouter.use('/auth', authRouter);
apiRouter.use(requireAuth);

apiRouter.use('/accounts', accountsRouter);
apiRouter.use('/ledger', requireInitialized, ledgerRouter);
apiRouter.use('/vouchers', requireInitialized, vouchersRouter);
apiRouter.use('/reports', requireInitialized, reportsRouter);
apiRouter.use('/daybook', requireInitialized, daybookRouter);
apiRouter.use('/dashboard', requireInitialized, dashboardRouter);
apiRouter.use('/businesses', businessesRouter);
apiRouter.use('/reset-company', resetRouter);
apiRouter.use('/audit', auditRouter);
apiRouter.use('/opening-position', openingPositionRouter);
