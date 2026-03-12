'use strict';
const { createClient } = require('redis');
const logger = require('./logger');

let client;

async function connectRedis() {
  client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (err) => logger.error('Redis error:', err));
  await client.connect();
  logger.info('✅  Redis connected');
  return client;
}

function getRedisClient() { return client; }

module.exports = { connectRedis, getRedisClient };
