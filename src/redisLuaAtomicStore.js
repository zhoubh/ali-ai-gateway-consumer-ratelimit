'use strict';

const {
  RESERVE_FIXED_WINDOW,
  REFUND_FIXED_WINDOW
} = require('./luaScripts');

class RedisLuaAtomicStore {
  constructor(redisClient) {
    if (!redisClient || typeof redisClient.eval !== 'function') {
      throw new Error('redisClient with eval(script, options) or eval(script, keys, args) is required');
    }
    this.redisClient = redisClient;
  }

  async reserveFixedWindow({ key, limit, amount, ttlMs }) {
    if (limit == null || limit < 0) {
      return { allowed: true, remaining: -1 };
    }

    const result = await this.#eval(RESERVE_FIXED_WINDOW, [key], [
      String(limit),
      String(amount),
      String(Math.ceil(ttlMs / 1000))
    ]);

    const allowed = Number(result[0]) === 1;
    return {
      allowed,
      remaining: Number(result[1])
    };
  }

  async refundFixedWindow({ key, amount, ttlMs }) {
    const result = await this.#eval(REFUND_FIXED_WINDOW, [key], [
      String(amount),
      String(Math.ceil(ttlMs / 1000))
    ]);

    return {
      current: Number(Array.isArray(result) ? result[0] : result)
    };
  }

  async #eval(script, keys, args) {
    try {
      return await this.redisClient.eval(script, {
        keys,
        arguments: args
      });
    } catch (error) {
      if (!looksLikeUnsupportedObjectEval(error)) {
        throw error;
      }

      return this.redisClient.eval(script, keys.length, ...keys, ...args);
    }
  }
}

function looksLikeUnsupportedObjectEval(error) {
  return /arguments|keys|number of keys|ERR/i.test(String(error && error.message));
}

module.exports = {
  RedisLuaAtomicStore
};
