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
