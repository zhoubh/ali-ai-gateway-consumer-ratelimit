'use strict';

const RESERVE_FIXED_WINDOW = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local amount = tonumber(ARGV[2])
local ttl_seconds = tonumber(ARGV[3])

if limit < 0 then
  return {1, -1}
end

local current = tonumber(redis.call("GET", key) or "0")
if current + amount > limit then
  return {0, math.max(limit - current, 0)}
end

local next_value = redis.call("INCRBY", key, amount)
redis.call("EXPIRE", key, ttl_seconds)
return {1, math.max(limit - next_value, 0)}
`;

const REFUND_FIXED_WINDOW = `
local key = KEYS[1]
local amount = tonumber(ARGV[1])
local ttl_seconds = tonumber(ARGV[2])

local current = tonumber(redis.call("GET", key) or "0")
local next_value = current - amount
if next_value < 0 then
  next_value = 0
end

redis.call("SET", key, next_value, "EX", ttl_seconds)
return next_value
`;

module.exports = {
  RESERVE_FIXED_WINDOW,
  REFUND_FIXED_WINDOW
};
