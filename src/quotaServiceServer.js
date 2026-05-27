'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');
const {
  GlobalConsumerRateLimiter,
  InMemoryAtomicStore
} = require('./globalConsumerRateLimiter');
const { RedisClient } = require('./redisClient');
const { RedisLuaAtomicStore } = require('./redisLuaAtomicStore');
const {
  InMemoryReservationStore,
  RedisReservationStore
} = require('./reservationStore');

function createQuotaService(options = {}) {
  const redisClient = options.redisClient || createRedisClientFromEnv();
  const store = options.store || (redisClient
    ? new RedisLuaAtomicStore(redisClient)
    : new InMemoryAtomicStore());
  const reservationStore = options.reservationStore || (redisClient
    ? new RedisReservationStore(redisClient, {
      keyPrefix: process.env.RESERVATION_KEY_PREFIX
    })
    : new InMemoryReservationStore());
  const limiter = options.limiter || new GlobalConsumerRateLimiter({
    store,
    gatewayId: options.gatewayId || process.env.GATEWAY_ID || 'dev',
    defaultLimit: {
      qps: numberFromEnv('DEFAULT_QPS', 2),
      tpm: numberFromEnv('DEFAULT_TPM', 1000)
    },
    rules: options.rules || parseRules(process.env.LIMIT_RULES)
  });

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        if (redisClient) {
          await redisClient.ping();
        }
        return writeJSON(res, 200, {
          ok: true,
          store: redisClient ? 'redis' : 'memory'
        });
      }

      if (req.method === 'POST' && req.url === '/v1/ratelimit/reserve') {
        const body = await readJSON(req);
        const result = await limiter.checkRequestAsync({
          tenantId: body.tenantId,
          consumerId: body.consumerId,
          estimatedTokens: body.estimatedTokens
        });

        if (!result.allowed) {
          return writeJSON(res, 200, {
            allowed: false,
            code: result.code,
            limitType: result.limitType,
            retryAfterSeconds: result.retryAfterSeconds,
            remaining: result.remaining
          });
        }

        const reservationId = randomUUID();
        await reservationStore.set(
          reservationId,
          result.reservation,
          numberFromEnv('RESERVATION_TTL_SECONDS', 120)
        );

        return writeJSON(res, 200, {
          allowed: true,
          reservationId,
          remaining: result.remaining
        });
      }

      if (req.method === 'POST' && req.url === '/v1/ratelimit/refund') {
        const body = await readJSON(req);
        const reservation = await reservationStore.get(body.reservationId);
        if (!reservation) {
          return writeJSON(res, 404, { error: 'reservation not found' });
        }

        const result = await limiter.completeRequestAsync({
          reservation,
          actualTokens: body.actualTokens
        });
        await reservationStore.delete(body.reservationId);

        return writeJSON(res, 200, {
          refundedTokens: result.refundedTokens,
          current: result.current
        });
      }

      writeJSON(res, 404, { error: 'not found' });
    } catch (error) {
      writeJSON(res, 500, { error: error.message });
    }
  });
}

function createRedisClientFromEnv() {
  const storeType = String(process.env.STORE || '').toLowerCase();
  if (storeType !== 'redis' && !process.env.REDIS_URL) {
    return null;
  }

  if (process.env.REDIS_URL) {
    return RedisClient.fromURL(process.env.REDIS_URL);
  }

  return new RedisClient({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: numberFromEnv('REDIS_PORT', 6379),
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    database: process.env.REDIS_DATABASE ? Number(process.env.REDIS_DATABASE) : undefined,
    tls: String(process.env.REDIS_TLS || '').toLowerCase() === 'true'
  });
}

function readJSON(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function writeJSON(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parseRules(raw) {
  if (!raw) {
    return [];
  }
  const rules = JSON.parse(raw);
  if (!Array.isArray(rules)) {
    throw new Error('LIMIT_RULES must be a JSON array');
  }
  return rules;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  createQuotaService().listen(port, () => {
    console.log(`quota service listening on ${port}`);
  });
}

module.exports = {
  createQuotaService,
  createRedisClientFromEnv
};
