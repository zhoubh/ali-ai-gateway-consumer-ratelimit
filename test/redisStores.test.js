'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { RedisLuaAtomicStore } = require('../src/redisLuaAtomicStore');
const { RedisReservationStore } = require('../src/reservationStore');

test('RedisLuaAtomicStore supports object-style eval clients', async () => {
  const calls = [];
  const redisClient = {
    eval: async (script, options) => {
      calls.push({ script, options });
      return [1, 9];
    }
  };
  const store = new RedisLuaAtomicStore(redisClient);

  const result = await store.reserveFixedWindow({
    key: 'limit-key',
    limit: 10,
    amount: 1,
    ttlMs: 2000
  });

  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 9);
  assert.equal(calls[0].options.keys[0], 'limit-key');
  assert.deepEqual(calls[0].options.arguments, ['10', '1', '2']);
});

test('RedisReservationStore stores JSON reservations with TTL', async () => {
  const values = new Map();
  const redisClient = {
    set: async (key, value, ttlKeyword, ttlSeconds) => {
      values.set(key, { value, ttlKeyword, ttlSeconds });
      return 'OK';
    },
    get: async (key) => values.get(key)?.value || null,
    del: async (key) => {
      values.delete(key);
      return 1;
    }
  };
  const store = new RedisReservationStore(redisClient, {
    keyPrefix: 'reservation'
  });

  await store.set('id-1', { tpmKey: 'k', estimatedTokens: 10 }, 60);
  assert.equal(values.get('reservation:id-1').ttlKeyword, 'EX');
  assert.equal(values.get('reservation:id-1').ttlSeconds, 60);

  assert.deepEqual(await store.get('id-1'), {
    tpmKey: 'k',
    estimatedTokens: 10
  });

  await store.delete('id-1');
  assert.equal(await store.get('id-1'), null);
});
