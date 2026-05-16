'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');
const {
  GlobalConsumerRateLimiter,
  InMemoryAtomicStore
} = require('./globalConsumerRateLimiter');

function createQuotaService(options = {}) {
  const reservations = new Map();
  const limiter = options.limiter || new GlobalConsumerRateLimiter({
    store: options.store || new InMemoryAtomicStore(),
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
        return writeJSON(res, 200, { ok: true });
      }

      if (req.method === 'POST' && req.url === '/v1/ratelimit/reserve') {
        const body = await readJSON(req);
        const result = limiter.checkRequest({
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
        reservations.set(reservationId, result.reservation);

        return writeJSON(res, 200, {
          allowed: true,
          reservationId,
          remaining: result.remaining
        });
      }

      if (req.method === 'POST' && req.url === '/v1/ratelimit/refund') {
        const body = await readJSON(req);
        const reservation = reservations.get(body.reservationId);
        if (!reservation) {
          return writeJSON(res, 404, { error: 'reservation not found' });
        }

        const result = limiter.completeRequest({
          reservation,
          actualTokens: body.actualTokens
        });
        reservations.delete(body.reservationId);

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
  createQuotaService
};
