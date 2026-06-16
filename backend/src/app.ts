import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { errorHandler } from './middleware/errorHandler';
import healthRouter from './modules/health/health.router';

const app = express();

app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());
app.use(pinoHttp({ logger }));

app.use('/api/v1/health', healthRouter);

app.use(errorHandler);

export default app;
