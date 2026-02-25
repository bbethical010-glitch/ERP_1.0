import express from 'express';
import cors from 'cors';
import { apiRouter } from './api/routes.js';
import { errorHandler } from './api/errorHandler.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.get('/', (_req, res) => {
    res.json({
      ok: true,
      service: 'accounting-erp-backend',
      health: '/api/v1/health',
      frontendDevUrl: 'http://localhost:5173'
    });
  });
  app.use('/api/v1', apiRouter);
  app.use(errorHandler);

  return app;
}
