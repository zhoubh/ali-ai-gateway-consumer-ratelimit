'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createQuotaService } = require('../src/quotaServiceServer');
const {
  GlobalConsumerRateLimiter,
  InMemoryAtomicStore
} = require('../src/globalConsumerRateLimiter');

test('quota service exposes reserve and refund endpoints', async () => {
  const limiter = new GlobalConsumerRateLimiter({
    store: new InMemoryAtomicStore(),
    gatewayId: 'dev',
    defaultLimit: { qps: 2, tpm: 100 },
    rules: []
  });
  const server = createQuotaService({ limiter });
  await listen(server);

  try {
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    const reserve = await postJSON(`${baseURL}/v1/ratelimit/reserve`, {
      tenantId: 'tenant-a',
      consumerId: 'consumer-a',
      estimatedTokens: 80
    });

    assert.equal(reserve.status, 200);
    assert.equal(reserve.body.allowed, true);
    assert.ok(reserve.body.reservationId);

    const refund = await postJSON(`${baseURL}/v1/ratelimit/refund`, {
      reservationId: reserve.body.reservationId,
      actualTokens: 20
    });

    assert.equal(refund.status, 200);
    assert.equal(refund.body.refundedTokens, 60);
  } finally {
    await close(server);
  }
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function postJSON(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  return {
    status: response.status,
    body: await response.json()
  };
}
