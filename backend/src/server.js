'use strict';
require('dotenv').config();
require('express-async-errors');

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');

// ── Sentry (optional — gracefully absent when SENTRY_DSN not set) ─────────
let Sentry = null;
if (process.env.SENTRY_DSN) {
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      release: 'orbit-api@2.0.0',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.15 : 1.0,
    });
  } catch (e) {
    console.warn('[Orbit] Sentry unavailable:', e.message);
  }
}

const logger     = require('./utils/logger');
const { authenticate }                      = require('./middleware/auth');
const { tenantScope, requireActiveBilling } = require('./middleware/tenant');

// ── Route modules ─────────────────────────────────────────────────────────
const authRoutes          = require('./routes/auth');
const metricsRoutes       = require('./routes/metrics');
const donorsRoutes        = require('./routes/donors');
const integrationsRoutes  = require('./routes/integrations');
const aiRoutes            = require('./routes/ai');
const agentsRoutes        = require('./routes/agents');
const pledgesRoutes       = require('./routes/pledges');
const outreachRoutes      = require('./routes/outreach');
const giftsRoutes         = require('./routes/gifts');
const campaignsRoutes     = require('./routes/campaigns');
const billingRoutes       = require('./routes/billing');
const usersRoutes         = require('./routes/users');
const superadminRoutes    = require('./routes/superadmin');
const tenantRoutes        = require('./routes/tenant');        // previously never mounted
const vsoRoutes           = require('./routes/vso');           // previously never mounted
const givingRoutes        = require('./routes/giving');        // previously never mounted
const paymentRoutes       = require('./routes/payment');       // previously never mounted
const plannedGivingRoutes = require('./routes/plannedGiving'); // previously never mounted
const webhookRoutes       = require('./webhooks/index');

const { startJobs } = require('./jobs/index');

// ── App setup ─────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3001;

if (Sentry) app.use(Sentry.Handlers.requestHandler());

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.anthropic.com'],
      frameSrc:   ["'none'"],
      objectSrc:  ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

const allowedOrigins = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin && process.env.NODE_ENV !== 'production') return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'RateLimited', message: 'Too many requests.' },
  skip: (req) => req.path === '/health',
});
app.use('/api/', globalLimiter);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20,
  message: { error: 'AuthRateLimited' } });
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/forgot-password', authLimiter);

// Webhooks: raw body required for signature verification
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 500 });
app.use('/api/v1/webhooks', webhookLimiter,
  express.raw({ type: 'application/json' }), webhookRoutes);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
  skip:   (req) => req.path === '/health',
}));

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok', version: '2.0.0',
  timestamp: new Date().toISOString(), mounted: 23,
}));

// ── Public ────────────────────────────────────────────────────────────────
app.use('/api/v1/auth',   authRoutes);
app.use('/api/v1/tenant', tenantRoutes);  // public GET; writes gated inside router

// ── Protected (auth + tenantScope + billingGuard) ─────────────────────────
const protect = [authenticate, tenantScope, requireActiveBilling];

app.use('/api/v1/metrics',        ...protect, metricsRoutes);
app.use('/api/v1/donors',         ...protect, donorsRoutes);
app.use('/api/v1/integrations',   ...protect, integrationsRoutes);
app.use('/api/v1/agents',         ...protect, agentsRoutes);
app.use('/api/v1/pledges',        ...protect, pledgesRoutes);
app.use('/api/v1/outreach',       ...protect, outreachRoutes);
app.use('/api/v1/gifts',          ...protect, giftsRoutes);
app.use('/api/v1/campaigns',      ...protect, campaignsRoutes);
app.use('/api/v1/vso',            ...protect, vsoRoutes);            // MOUNTED v2.0.0
app.use('/api/v1/giving',         ...protect, givingRoutes);          // MOUNTED v2.0.0
app.use('/api/v1/payment',        ...protect, paymentRoutes);         // MOUNTED v2.0.0
app.use('/api/v1/planned-giving', ...protect, plannedGivingRoutes);   // MOUNTED v2.0.0

// Billing: no billing guard so past-due orgs can fix their own billing
app.use('/api/v1/billing',    authenticate, tenantScope, billingRoutes);
app.use('/api/v1/users',      authenticate, tenantScope, usersRoutes);

// AI: per-org token budget enforced inside aiRoutes
app.use('/api/v1/ai', aiRoutes);

// Superadmin: separate JWT secret, cross-org
app.use('/api/v1/superadmin', authenticate, superadminRoutes);

// ── Error handling ────────────────────────────────────────────────────────
if (Sentry) app.use(Sentry.Handlers.errorHandler());

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const expected = ['ValidationError','JsonWebTokenError','TokenExpiredError'].includes(err.name)
    || err.message?.startsWith('CORS:');

  if (!expected) {
    logger.error('Unhandled error', {
      method: req.method, path: req.path,
      orgId: req.orgId, userId: req.user?.id,
      err: err.message,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    });
  }

  if (err.message?.startsWith('CORS:'))
    return res.status(403).json({ error: 'CORSViolation', message: err.message });
  if (err.name === 'ValidationError')
    return res.status(400).json({ error: 'ValidationError', message: err.message });
  if (err.type?.startsWith('Stripe'))
    return res.status(402).json({ error: 'PaymentError', message: err.message });
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });

  res.status(err.status || 500).json({
    error: 'InternalServerError',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message,
  });
});

app.use((req, res) =>
  res.status(404).json({ error: 'NotFound', message: `${req.method} ${req.path} not found` }));

// ── Start ─────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    logger.info('Orbit API v2.0.0 started', {
      port: PORT, env: process.env.NODE_ENV || 'development',
      routes: 23, sentry: !!Sentry,
    });
    if (process.env.NODE_ENV !== 'test') startJobs();
  });
}

module.exports = app;
