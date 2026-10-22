/**
 * Server entry point.
 * Validates environment, connects to the database, and starts the HTTP server.
 */

// Load environment validation FIRST before any other imports that might use env
import { getEnv } from './config/env';
getEnv(); // Will exit with a clear error if any required variable is missing

import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './database/prisma/client';
import { logger } from './config/logger';

const env = getEnv();

async function start(): Promise<void> {
  try {
    await connectDatabase();

    const app = createApp();

    const server = app.listen(env.PORT, () => {
      logger.info(`🦷 Dental Clinic API running`, {
        port: env.PORT,
        env: env.NODE_ENV,
        url: `http://localhost:${env.PORT}`,
      });
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);

      server.close(async () => {
        await disconnectDatabase();
        logger.info('Server shut down cleanly');
        process.exit(0);
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', { reason: String(reason) });
    });

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception', { message: err.message });
      process.exit(1);
    });
  } catch (err) {
    logger.error('Failed to start server', { message: String(err) });
    process.exit(1);
  }
}

start();
