# AI 网关全局消费者限流

这是一个“全局消费者 QPS + TPM 固定窗口 + Redis Lua 原子扣减”的参考实现。

目标是让同一个消费者访问任意模型时共享同一套全局额度：

- `QPS`: 每秒请求数限制
- `TPM`: 每分钟 Token 使用量限制
- 维度：`tenant_id + consumer_id`
- 关键点：限流 key 不包含 `model_id`

## 目录

- [docs/global-consumer-rate-limit-design.md](docs/global-consumer-rate-limit-design.md): 详细设计
- [src/globalConsumerRateLimiter.js](src/globalConsumerRateLimiter.js): 核心限流逻辑
- [src/luaScripts.js](src/luaScripts.js): Redis Lua 原子脚本
- [src/redisLuaAtomicStore.js](src/redisLuaAtomicStore.js): Redis Lua Store 适配器
- [src/httpMiddleware.js](src/httpMiddleware.js): HTTP/插件适配示例
- [src/quotaServiceServer.js](src/quotaServiceServer.js): 可直接部署测试的 Quota Service HTTP 服务
- [test/globalConsumerRateLimiter.test.js](test/globalConsumerRateLimiter.test.js): 单元测试
- [plugins/aliyun-ai-gateway-global-consumer-ratelimit](plugins/aliyun-ai-gateway-global-consumer-ratelimit): 阿里 AI 网关 Go WASM 自定义插件

## 测试

```bash
node --test
```

或者在安装了 npm 且执行策略允许时：

```bash
npm test
```

## Quota Service

本项目包含一个可直接部署的 Quota Service：

```bash
node src/quotaServiceServer.js
```

默认使用内存 Store，适合本地调试：

```bash
DEFAULT_QPS=2 DEFAULT_TPM=1000 node src/quotaServiceServer.js
```

接入阿里云 Redis/Tair 时，启用 Redis Store：

```bash
STORE=redis \
REDIS_URL=redis://:password@redis-host:6379/0 \
GATEWAY_ID=dev-ai-gateway \
DEFAULT_QPS=20 \
DEFAULT_TPM=100000 \
node src/quotaServiceServer.js
```

也可以拆成独立环境变量：

```bash
STORE=redis
REDIS_HOST=redis-host
REDIS_PORT=6379
REDIS_USERNAME=default
REDIS_PASSWORD=password
REDIS_DATABASE=0
REDIS_TLS=false
```

Quota Service 提供：

```text
GET  /healthz
POST /v1/ratelimit/reserve
POST /v1/ratelimit/refund
```

`reserve` 示例：

```bash
curl -X POST http://127.0.0.1:8080/v1/ratelimit/reserve \
  -H "content-type: application/json" \
  -d '{"gatewayId":"dev-ai-gateway","tenantId":"tenant-a","consumerId":"consumer-a","estimatedTokens":100}'
```

Redis/Tair 模式下，QPS/TPM 计数和 reservation 都存储在 Redis 中，可以支持 Quota Service 多副本部署。
