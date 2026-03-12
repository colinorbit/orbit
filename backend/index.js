'use strict';
require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');
const logger      = require('./config/logger');
const { connectDB }    = require('./config/database');
const { connectRedis } = require('./config/redis');
const { startWorkers } = require('./workers/index');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
}));

// ── Stripe webhook needs raw body — MUST come before json() ─────────────────
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use('/api/webhooks/twilio', express.urlencoded({ extended: false }));

// ── General middleware ────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(compression());
app.use(morgan('dev'));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api/auth', rateLimit({ windowMs: 15*60*1000, max: 30 }));
app.use('/api',      rateLimit({ windowMs: 15*60*1000, max: 1000 }));

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/orgs',         require('./routes/orgs'));
app.use('/api/donors',       require('./routes/donors'));
app.use('/api/agents',       require('./routes/agents'));
app.use('/api/campaigns',    require('./routes/campaigns'));
app.use('/api/gifts',        require('./routes/gifts'));
app.use('/api/agreements',   require('./routes/agreements'));
app.use('/api/outreach',     require('./routes/outreach'));
app.use('/api/analytics',    require('./routes/analytics'));
app.use('/api/integrations', require('./routes/integrations'));
app.use('/api/webhooks',     require('./routes/webhooks'));
app.use('/api/billing',      require('./routes/billing'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date() }));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `${req.method} ${req.path} not found` }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  logger.error(err.message, { stack: err.stack, path: req.path });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  await connectDB();
  await connectRedis();
  await startWorkers();
  app.listen(PORT, () => logger.info(`🚀 Orbit API → http://localhost:${PORT}`));
}

process.on('SIGTERM', () => process.exit(0));
boot().catch((err) => { logger.error('Boot failed:', err); process.exit(1); });

module.exports = app;
