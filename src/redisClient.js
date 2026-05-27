'use strict';

const net = require('node:net');
const tls = require('node:tls');

class RedisProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RedisProtocolError';
  }
}

class RedisClient {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = Number(options.port || 6379);
    this.username = options.username;
    this.password = options.password;
    this.database = options.database;
    this.tls = Boolean(options.tls);
    this.connectTimeoutMs = Number(options.connectTimeoutMs || 3000);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.connecting = null;
    this.ready = false;
  }

  static fromURL(rawURL) {
    const url = new URL(rawURL);
    const tlsEnabled = url.protocol === 'rediss:';
    if (!tlsEnabled && url.protocol !== 'redis:') {
      throw new Error('REDIS_URL must use redis:// or rediss://');
    }

    return new RedisClient({
      host: url.hostname,
      port: url.port ? Number(url.port) : 6379,
      username: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || ''),
      database: url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : undefined,
      tls: tlsEnabled
    });
  }

  async connect() {
    if (this.ready) {
      return;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = new Promise((resolve, reject) => {
      const socket = this.tls
        ? tls.connect({ host: this.host, port: this.port })
        : net.connect({ host: this.host, port: this.port });
      const timeout = setTimeout(() => {
        socket.destroy(new Error('Redis connect timeout'));
      }, this.connectTimeoutMs);

      socket.on('connect', async () => {
        clearTimeout(timeout);
        this.socket = socket;
        this.ready = true;
        try {
          await this.#authenticate();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      socket.on('data', (chunk) => this.#onData(chunk));
      socket.on('error', (error) => this.#rejectAll(error));
      socket.on('close', () => {
        this.ready = false;
        this.connecting = null;
        this.socket = null;
        this.#rejectAll(new Error('Redis connection closed'));
      });
    });

    return this.connecting;
  }

  async command(...args) {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(encodeCommand(args), (error) => {
        if (error) {
          const pending = this.pending.pop();
          if (pending) {
            pending.reject(error);
          }
        }
      });
    });
  }

  async eval(script, optionsOrKeyCount, ...rest) {
    if (typeof optionsOrKeyCount === 'object') {
      const keys = optionsOrKeyCount.keys || [];
      const args = optionsOrKeyCount.arguments || [];
      return this.command('EVAL', script, keys.length, ...keys, ...args);
    }

    return this.command('EVAL', script, optionsOrKeyCount, ...rest);
  }

  get(key) {
    return this.command('GET', key);
  }

  set(key, value, ...args) {
    return this.command('SET', key, value, ...args);
  }

  del(key) {
    return this.command('DEL', key);
  }

  ping() {
    return this.command('PING');
  }

  async quit() {
    if (!this.socket) {
      return;
    }
    try {
      await this.command('QUIT');
    } finally {
      this.socket?.destroy();
      this.socket = null;
      this.ready = false;
    }
  }

  async #authenticate() {
    if (this.password) {
      if (this.username) {
        await this.command('AUTH', this.username, this.password);
      } else {
        await this.command('AUTH', this.password);
      }
    }
    if (this.database != null && Number.isFinite(this.database)) {
      await this.command('SELECT', this.database);
    }
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.pending.length > 0) {
      const parsed = parseRESP(this.buffer);
      if (!parsed) {
        return;
      }

      this.buffer = this.buffer.subarray(parsed.offset);
      const pending = this.pending.shift();
      if (parsed.value instanceof RedisProtocolError) {
        pending.reject(parsed.value);
      } else {
        pending.resolve(parsed.value);
      }
    }
  }

  #rejectAll(error) {
    while (this.pending.length > 0) {
      this.pending.shift().reject(error);
    }
  }
}

function encodeCommand(args) {
  const parts = [`*${args.length}\r\n`];
  for (const arg of args) {
    const value = Buffer.isBuffer(arg) ? arg : Buffer.from(String(arg));
    parts.push(`$${value.length}\r\n`, value, '\r\n');
  }
  return Buffer.concat(parts.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part)));
}

function parseRESP(buffer, offset = 0) {
  if (offset >= buffer.length) {
    return null;
  }

  const prefix = String.fromCharCode(buffer[offset]);
  const line = readLine(buffer, offset + 1);
  if (!line) {
    return null;
  }

  if (prefix === '+') {
    return { value: line.value, offset: line.offset };
  }
  if (prefix === '-') {
    return { value: new RedisProtocolError(line.value), offset: line.offset };
  }
  if (prefix === ':') {
    return { value: Number(line.value), offset: line.offset };
  }
  if (prefix === '$') {
    const length = Number(line.value);
    if (length === -1) {
      return { value: null, offset: line.offset };
    }
    const end = line.offset + length;
    if (buffer.length < end + 2) {
      return null;
    }
    return {
      value: buffer.subarray(line.offset, end).toString('utf8'),
      offset: end + 2
    };
  }
  if (prefix === '*') {
    const length = Number(line.value);
    if (length === -1) {
      return { value: null, offset: line.offset };
    }
    const values = [];
    let nextOffset = line.offset;
    for (let index = 0; index < length; index += 1) {
      const item = parseRESP(buffer, nextOffset);
      if (!item) {
        return null;
      }
      values.push(item.value);
      nextOffset = item.offset;
    }
    return { value: values, offset: nextOffset };
  }

  throw new RedisProtocolError(`Unsupported RESP prefix: ${prefix}`);
}

function readLine(buffer, offset) {
  const end = buffer.indexOf('\r\n', offset);
  if (end === -1) {
    return null;
  }
  return {
    value: buffer.subarray(offset, end).toString('utf8'),
    offset: end + 2
  };
}

module.exports = {
  RedisClient,
  RedisProtocolError,
  encodeCommand,
  parseRESP
};
