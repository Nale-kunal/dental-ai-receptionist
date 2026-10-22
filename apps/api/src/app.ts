/**
 * Express application factory.
 * Configures all middleware, routes, and error handling.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler } from './middleware/errors/errorHandler';

// Route imports
import { authRouter } from './modules/auth/auth.routes';
import { appointmentsRouter } from './modules/appointments/appointments.routes';
import { patientsRouter } from './modules/patients/patients.routes';
import { doctorsRouter } from './modules/doctors/doctors.routes';
import { servicesRouter } from './modules/services/services.routes';
import { conversationsRouter } from './modules/conversations/conversations.routes';
import { handoffsRouter } from './modules/handoffs/handoffs.routes';
import { clinicRouter } from './modules/clinics/clinic.routes';
import { teamRouter } from './modules/team/team.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { receptionistRouter } from './modules/receptionist-settings/receptionist.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { auditRouter } from './modules/audit-history/audit.routes';
import { schedulesRouter } from './modules/schedules/schedules.routes';
import { availabilityRouter } from './modules/availability/availability.routes';
import { integrationsRouter } from './modules/integrations/whatsapp.routes';

export function createApp(): express.Application {
  const app = express();

  // ─── Request ID ─────────────────────────────────────────────────────────────
  app.use((req, _res, next) => {
    (req as any).id = uuidv4();
    next();
  });

  // ─── Security headers ────────────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // ─── CORS ─────────────────────────────────────────────────────────────────────
  const allowedOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim());
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        logger.warn('CORS rejected', { origin });
        cb(new Error('CORS policy: origin not allowed'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // ─── Body parsing ─────────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(compression());

  // ─── Request logging ──────────────────────────────────────────────────────────
  if (env.NODE_ENV !== 'test') {
    app.use(morgan('combined', {
      stream: { write: (msg) => logger.info(msg.trim()) },
      // Do not log health checks
      skip: (req) => req.url === '/health',
    }));
  }

  // ─── Global rate limiting ─────────────────────────────────────────────────────
  const globalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.', data: null },
  });
  app.use('/api', globalLimiter);

  // ─── Health check ─────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'dental-clinic-api',
      env: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  // ─── API Routes ───────────────────────────────────────────────────────────────
  const API = '/api/v1';

  app.use(`${API}/auth`, authRouter);
  app.use(`${API}/appointments`, appointmentsRouter);
  app.use(`${API}/patients`, patientsRouter);
  app.use(`${API}/doctors`, doctorsRouter);
  app.use(`${API}/services`, servicesRouter);
  app.use(`${API}/conversations`, conversationsRouter);
  app.use(`${API}/handoffs`, handoffsRouter);
  app.use(`${API}/clinic`, clinicRouter);
  app.use(`${API}/team`, teamRouter);
  app.use(`${API}/notifications`, notificationsRouter);
  app.use(`${API}/receptionist`, receptionistRouter);
  app.use(`${API}/reports`, reportsRouter);
  app.use(`${API}/audit`, auditRouter);
  app.use(`${API}/schedules`, schedulesRouter);
  app.use(`${API}/availability`, availabilityRouter);
  app.use(`${API}/integrations`, integrationsRouter);

  // ─── 404 handler ─────────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Endpoint not found', data: null });
  });

  // ─── Global error handler ─────────────────────────────────────────────────────
  app.use(errorHandler);

  return app;
}
