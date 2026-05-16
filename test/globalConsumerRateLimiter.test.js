'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GlobalConsumerRateLimiter,
  InMemoryAtomicStore
} = require('../src/globalConsumerRateLimiter');

function createLimiter(overrides = {}) {
  return new GlobalConsumerRateLimiter({
    store: new InMemoryAtomicStore(),
    gatewayId: 'gw-test',
    defaultLimit: { qps: 2, tpm: 100 },
    rules: [
      { tenantId: 'tenant-a', consumerId: 'consumer-a', qps: 2, tpm: 100 },
      { tenantId: 'tenant-a', consumerId: '*', qps: 1, tpm: 50 },
      { tenantId: '*', consumerId: 'consumer-vip', qps: 10, tpm: 1000 }
    ],
    ...overrides
  });
}

test('limits QPS globally across different models for the same consumer', () => {
  const limiter = createLimiter();
  const nowMs = 1_000;

  const first = limiter.checkRequest({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    modelId: 'model-1',
    estimatedTokens: 10,
    nowMs
  });
  const second = limiter.checkRequest({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    modelId: 'model-2',
    estimatedTokens: 10,
    nowMs
  });
  const third = limiter.checkRequest({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    modelId: 'model-3',
    estimatedTokens: 10,
    nowMs
  });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.limitType, 'qps');
});

test('QPS window resets on the next second bucket', () => {
  const limiter = createLimiter();

  assert.equal(limiter.checkRequest({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    estimatedTokens: 1,
    nowMs: 1_000
  }).allowed, true);
  assert.equal(limiter.checkRequest({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    estimatedTokens: 1,
    nowMs: 1_000
  }).allowed, true);
  assert.equal(limiter.checkRequest({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    estimatedTokens: 1,
    nowMs: 1_999
  }).allowed, false);
  assert.equal(limiter.checkRequest({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    estimatedTokens: 1,
    nowMs: 2_000
  }).allowed, true);
});

test('limits TPM globally across different models for the same consumer', () => {
  const limiter = createLimiter({ defaultLimit: { qps: 100, tpm: 100 } });
  const nowMs = 12_345;

  const first = limiter.checkRequest({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    modelId: 'model-1',
    estimatedTokens: 60,
    nowMs
  });
  const second = limiter.checkRequest({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    modelId: 'model-2',
    estimatedTokens: 41,
    nowMs
  });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.limitType, 'tpm');
  assert.equal(second.remaining.tpm, 40);
});

test('TPM reservation is refunded after actual usage is lower than estimated', () => {
  const limiter = createLimiter({ defaultLimit: { qps: 100, tpm: 100 } });
  const nowMs = 10_000;

  const reserved = limiter.checkRequest({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    estimatedTokens: 80,
    nowMs
  });
  assert.equal(reserved.allowed, true);

  const refund = limiter.completeRequest({
    reservation: reserved.reservation,
    actualTokens: 30,
    nowMs: nowMs + 100
  });
  assert.equal(refund.refundedTokens, 50);

  const next = limiter.checkRequest({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    estimatedTokens: 70,
    nowMs: nowMs + 200
  });
  assert.equal(next.allowed, true);
});

test('TPM rejected request refunds QPS reservation', () => {
  const limiter = createLimiter({ defaultLimit: { qps: 1, tpm: 10 } });
  const nowMs = 10_000;

  const rejected = limiter.checkRequest({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    estimatedTokens: 101,
    nowMs
  });
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.limitType, 'tpm');

  const accepted = limiter.checkRequest({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    estimatedTokens: 1,
    nowMs
  });
  assert.equal(accepted.allowed, true);
});

test('rule precedence resolves exact, tenant default, then global consumer rule', () => {
  const limiter = createLimiter();

  assert.deepEqual(limiter.resolveLimit({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a'
  }), { qps: 2, tpm: 100 });

  assert.deepEqual(limiter.resolveLimit({
    tenantId: 'tenant-a',
    consumerId: 'unknown'
  }), { qps: 1, tpm: 50 });

  assert.deepEqual(limiter.resolveLimit({
    tenantId: 'tenant-b',
    consumerId: 'consumer-vip'
  }), { qps: 10, tpm: 1000 });
});

test('different consumers do not share global windows', () => {
  const limiter = createLimiter({
    defaultLimit: { qps: 1, tpm: 100 },
    rules: []
  });
  const nowMs = 1_000;

  assert.equal(limiter.checkRequest({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    estimatedTokens: 1,
    nowMs
  }).allowed, true);
  assert.equal(limiter.checkRequest({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    estimatedTokens: 1,
    nowMs
  }).allowed, false);
  assert.equal(limiter.checkRequest({
    tenantId: 'tenant-a',
    consumerId: 'consumer-b',
    estimatedTokens: 1,
    nowMs
  }).allowed, true);
});

test('async store path supports Redis-like clients', async () => {
  const memoryStore = new InMemoryAtomicStore();
  const asyncStore = {
    reserveFixedWindow: (input) => Promise.resolve(memoryStore.reserveFixedWindow(input)),
    refundFixedWindow: (input) => Promise.resolve(memoryStore.refundFixedWindow(input))
  };
  const limiter = new GlobalConsumerRateLimiter({
    store: asyncStore,
    gatewayId: 'gw-test',
    defaultLimit: { qps: 1, tpm: 10 },
    rules: []
  });

  const first = await limiter.checkRequestAsync({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    estimatedTokens: 5,
    nowMs: 1_000
  });
  const second = await limiter.checkRequestAsync({
    tenantId: 'tenant-a',
    consumerId: 'consumer-a',
    estimatedTokens: 5,
    nowMs: 1_000
  });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.limitType, 'qps');
});
