'use strict';

const WILDCARD = '*';

class RateLimitExceededError extends Error {
  constructor(result) {
    super('Global consumer rate limit exceeded');
    this.name = 'RateLimitExceededError';
    this.code = 'GLOBAL_CONSUMER_RATE_LIMIT_EXCEEDED';
    this.result = result;
  }
}

class InMemoryAtomicStore {
  constructor() {
    this.entries = new Map();
  }

  reserveFixedWindow({ key, limit, amount, ttlMs, nowMs }) {
    if (limit == null || limit < 0) {
      return { allowed: true, remaining: -1 };
    }

    this.#expire(key, nowMs);
    const entry = this.entries.get(key) || { value: 0, expiresAt: nowMs + ttlMs };
    const nextValue = entry.value + amount;

    if (nextValue > limit) {
      return {
        allowed: false,
        remaining: Math.max(limit - entry.value, 0),
        current: entry.value
      };
    }

    entry.value = nextValue;
    entry.expiresAt = nowMs + ttlMs;
    this.entries.set(key, entry);

    return {
      allowed: true,
      remaining: Math.max(limit - entry.value, 0),
      current: entry.value
    };
  }

  refundFixedWindow({ key, amount, ttlMs, nowMs }) {
    this.#expire(key, nowMs);
    const entry = this.entries.get(key) || { value: 0, expiresAt: nowMs + ttlMs };
    entry.value = Math.max(entry.value - amount, 0);
    entry.expiresAt = nowMs + ttlMs;
    this.entries.set(key, entry);
    return { current: entry.value };
  }

  get(key, nowMs = Date.now()) {
    this.#expire(key, nowMs);
    return this.entries.get(key)?.value || 0;
  }

  #expire(key, nowMs) {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= nowMs) {
      this.entries.delete(key);
    }
  }
}

class GlobalConsumerRateLimiter {
  constructor(options) {
    if (!options || !options.store) {
      throw new Error('store is required');
    }

    this.store = options.store;
    this.gatewayId = options.gatewayId || 'default';
    this.keyPrefix = options.keyPrefix || 'ai_gateway';
    this.defaultLimit = normalizeLimit(options.defaultLimit || {});
    this.rules = (options.rules || []).map(normalizeRule);
    this.qpsWindowMs = options.qpsWindowMs || 1000;
    this.tpmWindowMs = options.tpmWindowMs || 60_000;
    this.qpsTtlMs = options.qpsTtlMs || this.qpsWindowMs * 2;
    this.tpmTtlMs = options.tpmTtlMs || this.tpmWindowMs * 2;
  }

  checkRequest(request) {
    const nowMs = request.nowMs ?? Date.now();
    const tenantId = normalizeId(request.tenantId);
    const consumerId = normalizeId(request.consumerId);
    const estimatedTokens = Math.max(Number(request.estimatedTokens || 0), 0);
    const limits = this.resolveLimit({ tenantId, consumerId });

    const qpsBucket = bucketStart(nowMs, this.qpsWindowMs);
    const qpsKey = this.#key({ tenantId, consumerId, metric: 'qps', bucket: qpsBucket });
    const qps = this.store.reserveFixedWindow({
      key: qpsKey,
      limit: limits.qps,
      amount: 1,
      ttlMs: this.qpsTtlMs,
      nowMs
    });

    if (!qps.allowed) {
      return denied({
        limitType: 'qps',
        tenantId,
        consumerId,
        limits,
        qps,
        retryAfterSeconds: secondsUntilNextWindow(nowMs, this.qpsWindowMs)
      });
    }

    const tpmBucket = bucketStart(nowMs, this.tpmWindowMs);
    const tpmKey = this.#key({ tenantId, consumerId, metric: 'tpm', bucket: tpmBucket });
    const tpm = this.store.reserveFixedWindow({
      key: tpmKey,
      limit: limits.tpm,
      amount: estimatedTokens,
      ttlMs: this.tpmTtlMs,
      nowMs
    });

    if (!tpm.allowed) {
      this.store.refundFixedWindow({
        key: qpsKey,
        amount: 1,
        ttlMs: this.qpsTtlMs,
        nowMs
      });

      return denied({
        limitType: 'tpm',
        tenantId,
        consumerId,
        limits,
        qps: { ...qps, remaining: qps.remaining + 1 },
        tpm,
        retryAfterSeconds: secondsUntilNextWindow(nowMs, this.tpmWindowMs)
      });
    }

    return {
      allowed: true,
      tenantId,
      consumerId,
      limits,
      remaining: {
        qps: qps.remaining,
        tpm: tpm.remaining
      },
      reservation: {
        tenantId,
        consumerId,
        estimatedTokens,
        qpsKey,
        tpmKey,
        qpsTtlMs: this.qpsTtlMs,
        tpmTtlMs: this.tpmTtlMs
      }
    };
  }

  async checkRequestAsync(request) {
    const nowMs = request.nowMs ?? Date.now();
    const tenantId = normalizeId(request.tenantId);
    const consumerId = normalizeId(request.consumerId);
    const estimatedTokens = Math.max(Number(request.estimatedTokens || 0), 0);
    const limits = this.resolveLimit({ tenantId, consumerId });

    const qpsBucket = bucketStart(nowMs, this.qpsWindowMs);
    const qpsKey = this.#key({ tenantId, consumerId, metric: 'qps', bucket: qpsBucket });
    const qps = await this.store.reserveFixedWindow({
      key: qpsKey,
      limit: limits.qps,
      amount: 1,
      ttlMs: this.qpsTtlMs,
      nowMs
    });

    if (!qps.allowed) {
      return denied({
        limitType: 'qps',
        tenantId,
        consumerId,
        limits,
        qps,
        retryAfterSeconds: secondsUntilNextWindow(nowMs, this.qpsWindowMs)
      });
    }

    const tpmBucket = bucketStart(nowMs, this.tpmWindowMs);
    const tpmKey = this.#key({ tenantId, consumerId, metric: 'tpm', bucket: tpmBucket });
    const tpm = await this.store.reserveFixedWindow({
      key: tpmKey,
      limit: limits.tpm,
      amount: estimatedTokens,
      ttlMs: this.tpmTtlMs,
      nowMs
    });

    if (!tpm.allowed) {
      await this.store.refundFixedWindow({
        key: qpsKey,
        amount: 1,
        ttlMs: this.qpsTtlMs,
        nowMs
      });

      return denied({
        limitType: 'tpm',
        tenantId,
        consumerId,
        limits,
        qps: { ...qps, remaining: qps.remaining + 1 },
        tpm,
        retryAfterSeconds: secondsUntilNextWindow(nowMs, this.tpmWindowMs)
      });
    }

    return {
      allowed: true,
      tenantId,
      consumerId,
      limits,
      remaining: {
        qps: qps.remaining,
        tpm: tpm.remaining
      },
      reservation: {
        tenantId,
        consumerId,
        estimatedTokens,
        qpsKey,
        tpmKey,
        qpsTtlMs: this.qpsTtlMs,
        tpmTtlMs: this.tpmTtlMs
      }
    };
  }

  completeRequest({ reservation, actualTokens, nowMs = Date.now() }) {
    if (!reservation) {
      return { refundedTokens: 0 };
    }

    const actual = Math.max(Number(actualTokens || 0), 0);
    const refund = Math.max(reservation.estimatedTokens - actual, 0);

    if (refund === 0) {
      return { refundedTokens: 0 };
    }

    const result = this.store.refundFixedWindow({
      key: reservation.tpmKey,
      amount: refund,
      ttlMs: reservation.tpmTtlMs,
      nowMs
    });

    return {
      refundedTokens: refund,
      current: result.current
    };
  }

  async completeRequestAsync({ reservation, actualTokens, nowMs = Date.now() }) {
    if (!reservation) {
      return { refundedTokens: 0 };
    }

    const actual = Math.max(Number(actualTokens || 0), 0);
    const refund = Math.max(reservation.estimatedTokens - actual, 0);

    if (refund === 0) {
      return { refundedTokens: 0 };
    }

    const result = await this.store.refundFixedWindow({
      key: reservation.tpmKey,
      amount: refund,
      ttlMs: reservation.tpmTtlMs,
      nowMs
    });

    return {
      refundedTokens: refund,
      current: result.current
    };
  }

  resolveLimit({ tenantId, consumerId }) {
    const normalizedTenant = normalizeId(tenantId);
    const normalizedConsumer = normalizeId(consumerId);
    const candidates = [
      [normalizedTenant, normalizedConsumer],
      [normalizedTenant, WILDCARD],
      [WILDCARD, normalizedConsumer],
      [WILDCARD, WILDCARD]
    ];

    for (const [candidateTenant, candidateConsumer] of candidates) {
      const rule = this.rules.find((item) => {
        return item.tenantId === candidateTenant && item.consumerId === candidateConsumer;
      });
      if (rule) {
        return {
          qps: rule.qps ?? this.defaultLimit.qps,
          tpm: rule.tpm ?? this.defaultLimit.tpm
        };
      }
    }

    return { ...this.defaultLimit };
  }

  #key({ tenantId, consumerId, metric, bucket }) {
    return [
      this.keyPrefix,
      this.gatewayId,
      'tenant',
      tenantId,
      'consumer',
      consumerId,
      metric,
      bucket
    ].join(':');
  }
}

function denied({ limitType, tenantId, consumerId, limits, qps, tpm, retryAfterSeconds }) {
  return {
    allowed: false,
    code: 'GLOBAL_CONSUMER_RATE_LIMIT_EXCEEDED',
    message: 'Global consumer rate limit exceeded',
    limitType,
    tenantId,
    consumerId,
    limits,
    remaining: {
      qps: qps?.remaining,
      tpm: tpm?.remaining
    },
    retryAfterSeconds
  };
}

function normalizeRule(rule) {
  return {
    tenantId: normalizeId(rule.tenantId || WILDCARD),
    consumerId: normalizeId(rule.consumerId || WILDCARD),
    ...normalizeLimit(rule)
  };
}

function normalizeLimit(limit) {
  return {
    qps: normalizeOptionalNumber(limit.qps),
    tpm: normalizeOptionalNumber(limit.tpm)
  };
}

function normalizeOptionalNumber(value) {
  if (value == null) {
    return undefined;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`invalid limit value: ${value}`);
  }
  return numberValue;
}

function normalizeId(value) {
  return String(value || WILDCARD).trim() || WILDCARD;
}

function bucketStart(nowMs, windowMs) {
  return Math.floor(nowMs / windowMs) * windowMs;
}

function secondsUntilNextWindow(nowMs, windowMs) {
  const elapsed = nowMs % windowMs;
  return Math.max(Math.ceil((windowMs - elapsed) / 1000), 1);
}

module.exports = {
  GlobalConsumerRateLimiter,
  InMemoryAtomicStore,
  RateLimitExceededError,
  bucketStart,
  secondsUntilNextWindow
};
