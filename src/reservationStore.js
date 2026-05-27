'use strict';

class InMemoryReservationStore {
  constructor() {
    this.reservations = new Map();
  }

  async set(id, reservation, ttlSeconds) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.reservations.set(id, { reservation, expiresAt });
  }

  async get(id) {
    const entry = this.reservations.get(id);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.reservations.delete(id);
      return null;
    }
    return entry.reservation;
  }

  async delete(id) {
    this.reservations.delete(id);
  }
}

class RedisReservationStore {
  constructor(redisClient, options = {}) {
    this.redisClient = redisClient;
    this.keyPrefix = options.keyPrefix || 'ai_gateway:reservation';
  }

  async set(id, reservation, ttlSeconds) {
    await this.redisClient.set(this.#key(id), JSON.stringify(reservation), 'EX', ttlSeconds);
  }

  async get(id) {
    const raw = await this.redisClient.get(this.#key(id));
    return raw ? JSON.parse(raw) : null;
  }

  async delete(id) {
    await this.redisClient.del(this.#key(id));
  }

  #key(id) {
    return `${this.keyPrefix}:${id}`;
  }
}

module.exports = {
  InMemoryReservationStore,
  RedisReservationStore
};
