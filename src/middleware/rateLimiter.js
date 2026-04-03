/**
 * Scalable Rate Limiter Middleware
 * Uses Redis for distributed rate limiting across server clusters.
 * Fallbacks to in-memory store if Redis is unavailable.
 */

const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default;
const Redis = require('ioredis');
const logger = require('../utils/logger');

// Environment variables for configuration
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000; // 1 minute
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 20; // 20 hits/min

let redisStore = null;

// Initialize Redis for distributed limiting (Crucial for 30M scale)
if (process.env.USE_REDIS === 'true') {
  try {
    const client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false, // Don't block if redis is starting up
    });

    client.on('error', (err) => {
      logger.debug('RateLimiter: Redis error, using in-memory fallback.');
    });

    redisStore = new RedisStore({
      // @ts-expect-error - ioredis type mismatch in rate-limit-redis
      sendCommand: (...args) => client.call(...args),
      prefix: 'rl:',
    });

    logger.info('🚀 Rate Limiter: Distributed Redis storage enabled.');
  } catch (e) {
    logger.warn('Rate Limiter initialization error (Falling back to memory):', e.message);
  }
}

/**
 * Configure rate limiter with distributed Redis support
 */
const limiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_REQUESTS,
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false,
  store: redisStore || undefined, // undefined uses the default in-memory store
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again after a minute.',
  },
  handler: (req, res, next, options) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json(options.message);
  },
  skip: (req) => {
    // Skip rate limiting for specific routes if needed (e.g. health check)
    return req.path === '/health';
  },
});

module.exports = limiter;
