'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { encodeCommand, parseRESP } = require('../src/redisClient');

test('encodes redis commands as RESP arrays', () => {
  assert.equal(
    encodeCommand(['SET', 'key', 'value']).toString(),
    '*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n'
  );
});

test('parses simple redis response types', () => {
  assert.deepEqual(parseRESP(Buffer.from('+OK\r\n')), {
    value: 'OK',
    offset: 5
  });
  assert.deepEqual(parseRESP(Buffer.from(':42\r\n')), {
    value: 42,
    offset: 5
  });
  assert.deepEqual(parseRESP(Buffer.from('$5\r\nhello\r\n')), {
    value: 'hello',
    offset: 11
  });
  assert.deepEqual(parseRESP(Buffer.from('*2\r\n:1\r\n$3\r\ntwo\r\n')), {
    value: [1, 'two'],
    offset: 17
  });
});

test('returns null for incomplete redis frames', () => {
  assert.equal(parseRESP(Buffer.from('$5\r\nhel')), null);
});
