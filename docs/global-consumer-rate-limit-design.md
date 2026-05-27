# 全局消费者 QPS + TPM 限流详细设计

## 1. 背景

如果只在每个 Model API 上配置消费者限流，消费者可以通过访问多个模型绕过总额度。例如每个模型限制 `50 QPS`，访问 3 个模型时理论上可以达到 `150 QPS`。

全局消费者限流用于控制消费者在整个 AI 网关实例内的总资源使用量。一旦消费者全局额度耗尽，访问所有模型都会被限制。

## 2. 目标

- 按 `tenant_id + consumer_id` 进行全局 QPS 限流。
- 按 `tenant_id + consumer_id` 进行全局 TPM 限流。
- 使用固定窗口，第一版保持简单、可审计。
- 使用 Redis Lua 保证跨网关实例的原子扣减。
- 支持请求前预扣 Token，响应后按实际消耗回补。
- 不把 `model_id` 放入全局限流 key。

## 3. 非目标

- 不在第一版实现滑动窗口或令牌桶。
- 不在第一版实现按天/月预算。
- 不在第一版实现模型权重折算。
- 不直接绑定某个网关 SDK，核心逻辑保持可嵌入。

## 4. 插件链路位置

```text
Client
  -> Consumer Auth
  -> Global Consumer Rate Limit
  -> Model Consumer Rate Limit
  -> Provider/Model Rate Limit
  -> Upstream Model
```

全局消费者限流必须在消费者认证之后执行，因为需要可靠的 `consumer_id`。

## 5. 限流 Key

全局 QPS：

```text
ai_gateway:{gateway_id}:tenant:{tenant_id}:consumer:{consumer_id}:qps:{second_bucket}
```

全局 TPM：

```text
ai_gateway:{gateway_id}:tenant:{tenant_id}:consumer:{consumer_id}:tpm:{minute_bucket}
```

注意：key 中没有 `model_id`，这是跨模型共享额度的关键。

## 6. 配置优先级

建议支持以下匹配顺序：

```text
tenant + consumer 精确匹配
  > tenant 默认 consumer = "*"
  > 全局 consumer 精确匹配 tenant = "*"
  > 全局默认 tenant = "*" consumer = "*"
  > defaultLimit
```

示例：

```json
{
  "gatewayId": "gw-prod",
  "defaultLimit": { "qps": 5, "tpm": 10000 },
  "rules": [
    { "tenantId": "tenant-a", "consumerId": "consumer-a", "qps": 50, "tpm": 100000 },
    { "tenantId": "tenant-a", "consumerId": "*", "qps": 10, "tpm": 20000 },
    { "tenantId": "*", "consumerId": "*", "qps": 5, "tpm": 10000 }
  ]
}
```

## 7. 请求处理流程

```text
1. 从认证上下文读取 tenant_id 和 consumer_id
2. 根据规则解析全局 qps_limit 和 tpm_limit
3. 对 QPS 窗口执行原子预占
4. 对 TPM 窗口执行原子预扣
5. 如果任一维度超限，返回 429
6. 请求转发给模型
7. 响应返回后读取 usage.total_tokens
8. 如果实际 token 小于预扣 token，则回补差额
```

## 8. QPS 原子扣减

固定窗口为 1 秒。Redis Lua 逻辑：

```text
current = GET key or 0
if current + 1 > qps_limit:
  reject
else:
  INCRBY key 1
  EXPIRE key 2
  allow
```

## 9. TPM 原子扣减

固定窗口为 60 秒。请求前预扣：

```text
reserved_tokens = prompt_tokens + max_completion_tokens
```

如果业务暂时无法精确分词，可以先使用请求里上报的估算值，或用 `max_tokens` 做保守预扣。

响应后回补：

```text
refund = reserved_tokens - actual_total_tokens
```

当 `refund > 0` 时执行原子回补，并保证计数不小于 0。

## 10. 失败策略

Redis 是全局一致性的关键组件。建议策略可配置：

- `fail_open`: Redis 异常时放行，优先保障可用性。
- `fail_close`: Redis 异常时拒绝，优先保障成本安全。

建议默认：

- 内部高优消费者：`fail_open`
- 免费/外部消费者：`fail_close`

## 10.1 Quota Service Redis/Tair 配置

Quota Service 支持两种运行模式：

```text
memory: 本地开发和单进程测试
redis: 连接阿里云 Redis/Tair，支持多副本和跨网关实例全局一致限流
```

Redis/Tair 环境变量：

```text
STORE=redis
REDIS_URL=redis://:password@redis-host:6379/0
```

或者：

```text
STORE=redis
REDIS_HOST=redis-host
REDIS_PORT=6379
REDIS_USERNAME=default
REDIS_PASSWORD=password
REDIS_DATABASE=0
REDIS_TLS=false
```

reservation 存储也会使用 Redis：

```text
ai_gateway:reservation:{reservation_id}
```

这样响应阶段的 `/v1/ratelimit/refund` 可以由任意 Quota Service 副本处理。

## 11. 429 响应

```json
{
  "error": {
    "code": "GLOBAL_CONSUMER_RATE_LIMIT_EXCEEDED",
    "message": "Global consumer rate limit exceeded",
    "type": "rate_limit_error",
    "limit_type": "tpm",
    "consumer_id": "consumer-a",
    "retry_after": 12
  }
}
```

推荐响应头：

```text
Retry-After: 12
X-RateLimit-Scope: global_consumer
X-RateLimit-Limit-QPS: 50
X-RateLimit-Limit-TPM: 100000
X-RateLimit-Remaining-QPS: 17
X-RateLimit-Remaining-TPM: 23500
```

## 12. 可观测性

建议记录以下指标：

- `ai_gateway_global_consumer_ratelimit_allowed_total`
- `ai_gateway_global_consumer_ratelimit_rejected_total`
- `ai_gateway_global_consumer_ratelimit_redis_error_total`
- `ai_gateway_global_consumer_tpm_reserved_total`
- `ai_gateway_global_consumer_tpm_refunded_total`

标签建议：

- `tenant_id`
- `consumer_id`
- `limit_type`
- `gateway_id`
