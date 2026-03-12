/**
 * Redis – ioredis client for:
 *  - Bull job queues  (agent scheduler, outreach, analytics)
 *  - Response caching (donor profiles, analytics dashboards)
 *  - Rate-limit counters
 *  - Session storage
 */

import Redis from 'ioredis';
import { logger } from './logger';

let redis: Redis;

export function getRedis(): Redis {
  if (!redis) throw new Error('Redis not initialised – call connectRedis() first');
  return redis;
}

export async function connectRedis(): Promise<void> {
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  redis.on('error', (err) => logger.error('Redis error', err));
  redis.on('reconnecting', () => logger.warn('Redis reconnecting…'));

  await redis.connect();
  logger.info('✅ Redis connected');
}
