/**
 * /api/v1/auth — Authentication Routes
 *
 * POST /auth/login            Login with email + password
 * POST /auth/refresh          Rotate refresh token, issue new access token
 * POST /auth/logout           Revoke refresh token + denylist access token in Redis
 * POST /auth/forgot-password  Generate password reset token (Redis, 1hr TTL)
 * POST /auth/reset-password   Complete reset; invalidate all refresh tokens for user
 * GET  /auth/me               Return authenticated user profile
 *
 * Rate limits (per CLAUDE.md §8):
 *   POST /login    → 5  req / 15min / IP
 *   POST /refresh  → 10 req / 15min / IP
 *
 * Response envelope (per CLAUDE.md §9):
 *   Success → { data: {...} }
 *   Error   → { error: "Human-readable", code: "SCREAMING_SNAKE", details: [] }
 */

import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

import { getDB } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import { authenticate } from '../middleware/auth';

const router = Router();

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface JwtAccessPayload {
  sub:   string;
  orgId: string;
  email: string;
  role:  string;
  iat?:  number;
  exp?:  number;
}

interface JwtRefreshPayload {
  sub:  string;
  type: 'refresh';
  iat?: number;
  exp?: number;
}

interface UserRow {
  id:            string;
  org_id:        string;
  email:         string;
  first_name:    string;
  last_name:     string;
  role:          string;
  avatar_url:    string | null;
  last_login_at: Date | null;
  active:        boolean;
  password_hash: string;
}

// Extend Express Request to carry the authenticated user set by middleware
interface AuthRequest extends Request {
  user: {
    id:    string;
    orgId: string;
    email: string;
    role:  string;
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function signAccess(user: UserRow): string {
  return jwt.sign(
    { sub: user.id, orgId: user.org_id, email: user.email, role: user.role },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' },
  );
}

function signRefresh(userId: string): string {
  return jwt.sign(
    { sub: userId, type: 'refresh' },
    process.env.JWT_SECRET!,
    { expiresIn: '30d' },
  );
}

/** SHA-256 of token string — used as the DB/Redis lookup key. Never store raw tokens. */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Remaining TTL of an access token in seconds (for Redis denylist expiry). */
function accessTTL(token: string): number {
  try {
    const decoded = jwt.decode(token) as JwtAccessPayload | null;
    if (!decoded?.exp) return 900;
    return Math.max(decoded.exp - Math.floor(Date.now() / 1000), 0);
  } catch {
    return 900;
  }
}

/** Standard success envelope. */
function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ data });
}

/** Standard error envelope. */
function fail(
  res:     Response,
  status:  number,
  message: string,
  code:    string,
  details: unknown[] = [],
): void {
  res.status(status).json({ error: message, code, details });
}

/** Inline express-validator result checker → 422 on failure. */
function validate(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({
      error:   'Validation failed',
      code:    'VALIDATION_ERROR',
      details: errors.array(),
    });
    return;
  }
  next();
}

// ─── RATE LIMITERS ────────────────────────────────────────────────────────────

const loginLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many login attempts — try again in 15 minutes', code: 'RATE_LIMITED', details: [] },
});

const refreshLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many token refresh requests', code: 'RATE_LIMITED', details: [] },
});

// ─── POST /auth/login ─────────────────────────────────────────────────────────

router.post(
  '/login',
  loginLimiter,
  [
    body('email')
      .isEmail().withMessage('A valid email address is required')
      .normalizeEmail(),
    body('password')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body as { email: string; password: string };
    const db = getDB();

    const user = await db<UserRow>('users')
      .where({ email: email.toLowerCase(), active: true })
      .first();

    // Constant-time comparison even on miss — prevents timing-based user enumeration
    const dummyHash = '$2b$12$invalidhashfortimingnormalisation000000000000000000000000';
    const hash      = user?.password_hash ?? dummyHash;
    const valid     = await bcrypt.compare(password, hash);

    if (!user || !valid) {
      fail(res, 401, 'Invalid email or password', 'INVALID_CREDENTIALS');
      return;
    }

    const accessToken  = signAccess(user);
    const refreshToken = signRefresh(user.id);
    const tokenHash    = hashToken(refreshToken);
    const expiresAt    = new Date(Date.now() + 30 * 24 * 3600 * 1000);

    await Promise.all([
      db('refresh_tokens').insert({ user_id: user.id, token_hash: tokenHash, expires_at: expiresAt }),
      db('users').where({ id: user.id }).update({ last_login_at: db.fn.now() }),
    ]);

    logger.info('Login', { userId: user.id });

    ok(res, {
      accessToken,
      refreshToken,
      user: {
        id:        user.id,
        email:     user.email,
        firstName: user.first_name,
        lastName:  user.last_name,
        role:      user.role,
        orgId:     user.org_id,
      },
    });
  },
);

// ─── POST /auth/refresh ───────────────────────────────────────────────────────

router.post(
  '/refresh',
  refreshLimiter,
  [
    body('refreshToken')
      .notEmpty().withMessage('refreshToken is required')
      .isJWT().withMessage('refreshToken must be a valid JWT'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const { refreshToken } = req.body as { refreshToken: string };
    const db = getDB();

    let payload: JwtRefreshPayload;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_SECRET!) as JwtRefreshPayload;
    } catch {
      fail(res, 401, 'Refresh token is invalid or expired', 'INVALID_REFRESH_TOKEN');
      return;
    }

    if (payload.type !== 'refresh') {
      fail(res, 401, 'Invalid token type', 'INVALID_REFRESH_TOKEN');
      return;
    }

    const tokenHash = hashToken(refreshToken);

    const stored = await db('refresh_tokens')
      .where({ token_hash: tokenHash })
      .where('expires_at', '>', db.fn.now())
      .first();

    if (!stored) {
      fail(res, 401, 'Refresh token has been revoked', 'REFRESH_TOKEN_REVOKED');
      return;
    }

    const user = await db<UserRow>('users')
      .where({ id: payload.sub, active: true })
      .first();

    if (!user) {
      fail(res, 401, 'User not found or inactive', 'USER_NOT_FOUND');
      return;
    }

    // Token rotation: delete old, issue new pair
    const newRefresh  = signRefresh(user.id);
    const newHash     = hashToken(newRefresh);
    const expiresAt   = new Date(Date.now() + 30 * 24 * 3600 * 1000);

    await db.transaction(async (trx) => {
      await trx('refresh_tokens').where({ token_hash: tokenHash }).delete();
      await trx('refresh_tokens').insert({ user_id: user.id, token_hash: newHash, expires_at: expiresAt });
    });

    ok(res, {
      accessToken:  signAccess(user),
      refreshToken: newRefresh,
    });
  },
);

// ─── POST /auth/logout ────────────────────────────────────────────────────────

router.post(
  '/logout',
  authenticate,
  [
    body('refreshToken')
      .optional()
      .isJWT().withMessage('refreshToken must be a valid JWT'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq    = req as AuthRequest;
    const db         = getDB();
    const redis      = getRedis();
    const bearer     = req.headers.authorization?.slice(7) ?? '';
    const tasks: Promise<unknown>[] = [];

    // 1. Denylist the access token in Redis for its remaining TTL
    if (bearer) {
      const ttl = accessTTL(bearer);
      if (ttl > 0) {
        tasks.push(redis.setex(`denylist:${hashToken(bearer)}`, ttl, '1'));
      }
    }

    // 2. Revoke the refresh token from the DB
    const { refreshToken } = req.body as { refreshToken?: string };
    if (refreshToken) {
      tasks.push(
        db('refresh_tokens').where({ token_hash: hashToken(refreshToken) }).delete(),
      );
    }

    await Promise.all(tasks);

    logger.info('Logout', { userId: authReq.user.id });
    res.status(204).end();
  },
);

// ─── POST /auth/forgot-password ───────────────────────────────────────────────

router.post(
  '/forgot-password',
  [
    body('email')
      .isEmail().withMessage('A valid email address is required')
      .normalizeEmail(),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body as { email: string };
    const db        = getDB();
    const redis     = getRedis();

    // Always return the same message — never reveal whether the account exists
    const successMsg = { message: 'If that email is registered, a reset link has been sent.' };

    const user = await db<UserRow>('users')
      .where({ email: email.toLowerCase(), active: true })
      .first();

    if (!user) {
      ok(res, successMsg);
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetKey   = `pwd_reset:${user.id}`;
    const TTL_SECS   = 3600; // 1 hour

    // Store hash only — raw token travels via email link only
    await redis.setex(resetKey, TTL_SECS, hashToken(resetToken));

    const resetUrl = `${process.env.CLIENT_URL ?? 'http://localhost:3000'}/reset-password?token=${resetToken}&uid=${user.id}`;

    if (process.env.NODE_ENV === 'production') {
      // Dispatch via SendGrid emailService (wired in Phase 3)
      // await emailService.sendPasswordReset(user.email, resetUrl);
      logger.info('Password reset requested', { userId: user.id });
    } else {
      // Dev: surface reset URL in server logs — never in API response
      logger.info('Password reset (dev)', { userId: user.id, resetUrl });
    }

    ok(res, successMsg);
  },
);

// ─── POST /auth/reset-password ────────────────────────────────────────────────

router.post(
  '/reset-password',
  [
    body('userId')
      .isUUID().withMessage('userId must be a valid UUID'),
    body('token')
      .notEmpty().withMessage('token is required')
      .isLength({ min: 64, max: 64 }).withMessage('token must be 64 hex characters'),
    body('password')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
      .matches(/[0-9]/).withMessage('Password must contain at least one number'),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    const { userId, token, password } = req.body as {
      userId:   string;
      token:    string;
      password: string;
    };
    const db    = getDB();
    const redis = getRedis();

    const resetKey   = `pwd_reset:${userId}`;
    const storedHash = await redis.get(resetKey);

    if (!storedHash || storedHash !== hashToken(token)) {
      fail(res, 400, 'Password reset token is invalid or has expired', 'INVALID_RESET_TOKEN');
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await db.transaction(async (trx) => {
      await trx('users').where({ id: userId }).update({ password_hash: passwordHash });
      // Invalidate all existing sessions for this user
      await trx('refresh_tokens').where({ user_id: userId }).delete();
    });

    // Consume the one-time reset token immediately
    await redis.del(resetKey);

    logger.info('Password reset complete', { userId });
    ok(res, { message: 'Password has been reset successfully. Please log in.' });
  },
);

// ─── GET /auth/me ─────────────────────────────────────────────────────────────

router.get(
  '/me',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const db      = getDB();

    const user = await db<UserRow>('users')
      .select('id', 'org_id', 'email', 'first_name', 'last_name', 'role', 'avatar_url', 'last_login_at')
      .where({ id: authReq.user.id })
      .first();

    if (!user) {
      fail(res, 404, 'User not found', 'NOT_FOUND');
      return;
    }

    ok(res, {
      id:          user.id,
      email:       user.email,
      firstName:   user.first_name,
      lastName:    user.last_name,
      role:        user.role,
      orgId:       user.org_id,
      avatarUrl:   user.avatar_url,
      lastLoginAt: user.last_login_at,
    });
  },
);

export default router;
