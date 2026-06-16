import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'Database not reachable' } });
  }
});

export default router;
