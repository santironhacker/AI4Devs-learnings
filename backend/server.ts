import app from './src/app';
import { env } from './src/config/env';
import { logger } from './src/lib/logger';

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'Server started');
});
