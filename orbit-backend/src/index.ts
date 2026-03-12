/**
 * Orbit – API Server Entry Point
 * Express + TypeScript + PostgreSQL + Redis
 */

import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { createServer } from 'http';

import { logger } from './config/logger';
import { connectDB } from './config/database';
import { connectRedis } from './config/redis';
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';

// Route modules
import authRoutes       from './routes/auth';
import donorRoutes      from './routes/donors';
import agentRoutes      from './routes/agents';
import giftRoutes       from './routes/gifts';
import pledgeRoutes     from './routes/pledges';
import campaignRoutes   from './routes/campaigns';
import outreachRoutes   from './routes/outreach';
import analyticsRoutes  from './routes/analytics';
import integrationRoutes from './routes/integrations';
import webhookRoutes    from './routes/webhooks';   // raw body needed — mounted before json()
import orgRoutes        from './routes/organizations';

const app = express();
const httpServer = createServer(app);

// ─── Security & Transport ────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
    },
  },
}));

app.use(cors({
  origin:      process.env.CLIENT_URL ?? 'http://localhost:3000',
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));

app.use(compression());
app.use(cookieParser());
app.use(morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } }));

// ─── Webhooks — must use raw body for signature verification ────
// Mount BEFORE express.json() so body is unparsed
app.use('/api/webhooks', webhookRoutes);

// ─── Body Parsing ────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Rate Limiting ───────────────────────────────────────────────
app.use('/api', rateLimiter);

// ─── Health Check ────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:  'ok',
    version: process.env.npm_package_version ?? '1.0.0',
    ts:      new Date().toISOString(),
  });
});

// ─── API Routes ──────────────────────────────────────────────────
const api = '/api/v1';
app.use(`${api}/auth`,         authRoutes);
app.use(`${api}/organizations`, orgRoutes);
app.use(`${api}/donors`,        donorRoutes);
app.use(`${api}/agents`,        agentRoutes);
app.use(`${api}/gifts`,         giftRoutes);
app.use(`${api}/pledges`,       pledgeRoutes);
app.use(`${api}/campaigns`,     campaignRoutes);
app.use(`${api}/outreach`,      outreachRoutes);
app.use(`${api}/analytics`,     analyticsRoutes);
app.use(`${api}/integrations`,  integrationRoutes);

// ─── Global Error Handler ────────────────────────────────────────
app.use(errorHandler);

// ─── Boot ────────────────────────────────────────────────────────
async function boot() {
  try {
    await connectDB();
    await connectRedis();

    // Start background workers (agent scheduler, outreach processor)
    const { startWorkers } = await import('./workers');
    await startWorkers();

    const port = Number(process.env.PORT ?? 4000);
    httpServer.listen(port, () => {
      logger.info(`🚀 Orbit API running on port ${port} [${process.env.NODE_ENV}]`);
    });
  } catch (err) {
    logger.error('Fatal boot error', err);
    process.exit(1);
  }
}

boot();

export { app };
